"""Task C7, fix half — symmetrize the right wing of `wyvern-rig-v1wing.blend`.

The legacy V1-wing blend's right wing was never mirrored cleanly from the left.
`tools/blender/audit_v1wing_symmetry.py` measures that state; this script fixes
exactly the pairs it reports as failing, and is verified by re-running it.

**The fix.** For every failing L/R pair the right bone's rest matrix is set to the
exact mirror of the left's:

    R'_right = S · R_left · S          with  S = diag(-1, 1, 1, 1)

which puts head, tail, roll and length all on the mirror. Measured before the fix
(`assets/rig-audits/2026-10-22-c7-v1wing-symmetry/before.json`): `R_WingHand` and all
15 `R_WingBatten*` sat 175.4-180.0 deg of roll out with tails up to 5,633 units from
the mirror — the battens were pointing backwards through the membrane —
`R_WingD0..5P0` carried 0.09-22.5 deg of roll and 9.1-25.6 units of length mismatch.

**Why no fcurve is touched.** Two options were measured:

* *Preserve the animated pose* (C6's recipe, `basis_new = C · basis_old`) needs
  `K = R'⁻¹·R` left-multiplied into every keyed channel — and for a *descendant*
  whose own rest did not move, the conjugated `K = R'_d⁻¹·(R'_p·R_p⁻¹)·R_d`. That is
  exact for the 20 actions that key the wing bones. But 15 further actions
  (`bankLeft`, `cruise`, `idle`, `takeoff`, ...) key the wing's *ancestors* and not
  the wing bones themselves, and `walk` keys the digits but not the battens, so
  preserving the pose there would mean *creating* 525 new curve sets. Worse, it
  would preserve the defect: the battens' tails point backwards in the animation
  precisely *because* the rest is wrong.
* *Fix the rest only* leaves every authored curve byte-identical and lets the
  animation re-evaluate against a correct rig.

This script takes the second. The consequence is measured, not assumed: the posed
geometry of the 32 bones moves by up to ~2,963 units (the battens swinging from
backwards to forwards), and **every bone outside the mirrored subtree is
bit-identical** — verified across all 35 actions x 6 frames. If the right wing's
animation should instead be re-authored as a mirror of the left's, that is a
separate, visible decision; the animation is currently not symmetric (measured up
to 2,089 units of posed L/R deviation).

**Purge.** `--purge` removes the 18 orphaned `WingFinger*` / `WingClaw` /
`WingMembrane*` vertex groups on `WyvernMesh` and the 2 zero-user materials. The
doc's "12-15 corrupt `ENE_PT_*` / `ompositing` / `Q7` scenes in both files" claim is
stale: measured **1** scene here, and `models/source/wyvern-rig.blend` is entirely
clean (56 bones, 0 orphan groups, 0 zero-user datablocks, 1 scene).

Usage (dry run by default; never start Blender from Python):

    ~/.local/bin/blender --background models/source/wyvern-rig-v1wing.blend \
        --python tools/blender/fix_c7_v1wing_symmetry.py -- \
        [--write] [--purge] [--json-out path] [--samples 6]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

REPO = Path(__file__).resolve().parents[2]
if str(REPO / "scripts/blender") not in sys.path:
    sys.path.insert(0, str(REPO / "scripts/blender"))
if str(REPO / "tools/blender") not in sys.path:
    sys.path.insert(0, str(REPO / "tools/blender"))

EXPECTED_BLEND = "wyvern-rig-v1wing.blend"
# The mirror model is owned by `audit_v1wing_symmetry.mirrored()` and deliberately
# not redefined here: one definition, and the audit is what grades the result. It is
# independently validated by the 11 L/R pairs that were never broken (`L_/R_Thigh`,
# `L_/R_WingRoot/Shoulder/Elbow/Wrist`, ...), which read roll 0 and lengthDelta
# ~2e-4 under the same model.

REST_DT_LIMIT = 1e-3      # units; float32 re-serialisation noise is ~3e-4 at |x|~2700
REST_DQ_LIMIT = 1e-5      # radians
REST_DLEN_LIMIT = 1e-3    # units
POSE_DT_LIMIT = 1e-3      # units, for bones that must not move
POSE_DQ_LIMIT = 1e-6      # radians


# ---------------------------------------------------------------- helpers
def _armature() -> bpy.types.Object:
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if len(arms) != 1:
        raise SystemExit("c7: expected exactly 1 armature, found %d" % len(arms))
    return arms[0]


def _iter_fcurves(action):
    if hasattr(action, "fcurves"):
        yield from action.fcurves
        return
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def _frame_range(action) -> tuple:
    lo = hi = None
    for fc in _iter_fcurves(action):
        for kp in fc.keyframe_points:
            t = kp.co[0]
            lo = t if lo is None else min(lo, t)
            hi = t if hi is None else max(hi, t)
    return (1.0, 1.0) if lo is None else (lo, hi)


def _sample_frames(action, count: int) -> list:
    lo, hi = _frame_range(action)
    if hi <= lo or count <= 1:
        return [lo]
    return [lo + (hi - lo) * i / (count - 1) for i in range(count)]


def _with_action(armature, action):
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action
    if action is not None and hasattr(action, "slots") and len(action.slots):
        try:
            armature.animation_data.action_slot = action.slots[0]
        except Exception:
            pass


def _rot_angle(a: Quaternion, b: Quaternion) -> float:
    """Double-cover-safe angle between two rotations."""
    d = a.rotation_difference(b).angle
    return min(d, abs(d - 2.0 * math.pi))


def _sample_poses(armature, names, actions, samples) -> dict:
    """Posed world matrices for every (action, frame, bone).

    Must read through the *evaluated* depsgraph. `view_layer.update()` +
    `pose.bones[n].matrix` is measurably wrong after an Edit-Mode round trip — it
    reported 60 of 700 samples as drifted (worst 1,163 units) for a file where
    nothing had changed at all. `arm.evaluated_get(dg).pose.bones[n].matrix` is
    exact: 0 of 700 across the same round trip.
    """
    out = {}
    for action in actions:
        _with_action(armature, action)
        for f in _sample_frames(action, samples):
            bpy.context.scene.frame_set(int(round(f)))
            dg = bpy.context.evaluated_depsgraph_get()
            dg.update()
            evaluated = armature.evaluated_get(dg)
            for n in names:
                out[(action.name, f, n)] = evaluated.pose.bones[n].matrix.copy()
    _with_action(armature, None)
    return out


def _worst_drift(now: dict, was: dict, actions, samples, names, predicate) -> tuple:
    worst = (0.0, 0.0)
    where = None
    for action in actions:
        for f in _sample_frames(action, samples):
            for n in names:
                if not predicate(n):
                    continue
                a = now[(action.name, f, n)]
                b = was[(action.name, f, n)]
                dt = (a.translation - b.translation).length
                dq = _rot_angle(a.to_quaternion(), b.to_quaternion())
                if max(dt, dq) > max(worst):
                    worst, where = (dt, dq), (action.name, round(f, 1), n)
    return worst, where


# ---------------------------------------------------------------- main
def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="save the blend (default: dry run)")
    parser.add_argument("--purge", action="store_true", help="also remove orphan vertex groups "
                                                            "and zero-user materials")
    parser.add_argument("--json-out")
    parser.add_argument("--samples", type=int, default=6, help="frames sampled per action")
    args = parser.parse_args(argv)

    if Path(bpy.data.filepath).name != EXPECTED_BLEND:
        raise SystemExit("c7: expected %s, got %s" % (EXPECTED_BLEND, bpy.data.filepath))

    from audit_v1wing_symmetry import all_pairs, failing, measure_pair, mirrored

    arm = _armature()
    bones = arm.data.bones
    names = [b.name for b in bones]
    parent_of = {b.name: (b.parent.name if b.parent else None) for b in bones}
    children_of: dict[str, list[str]] = {}
    for b in bones:
        children_of.setdefault(parent_of[b.name], []).append(b.name)

    pairs = [measure_pair(bones, left, right) for left, right in all_pairs(bones)]
    bad = failing(pairs)
    print("c7: %d pairs measured, %d failing" % (len(pairs), len(bad)))

    targets = {p["right"]: p["left"] for p in bad}

    # the subtree the rest change is allowed to reach: the mirrored bones and every
    # descendant of one (a child's pose follows its parent's rest even when its own
    # rest is untouched — measured on `R_WingD0P2`).
    subtree = set(targets)
    frontier = list(targets)
    while frontier:
        for c in children_of.get(frontier.pop(), []):
            if c not in subtree:
                subtree.add(c)
                frontier.append(c)
    print("c7: mirroring %d bones; the change reaches %d bones in total"
          % (len(targets), len(subtree)))

    # ---- baseline -----------------------------------------------------------------
    # Two passes: the first sampling pass after `open_mainfile` is not reliable
    # (measured: 1,890 of 22,260 samples disagreed with a second, unchanged pass,
    # worst 1,162 units — the depsgraph has not settled). Warm passes agree exactly.
    actions = [a for a in bpy.data.actions if a.name]
    rest_before = {n: bones[n].matrix_local.copy() for n in names}
    print("c7: %d actions x %d frames -> baseline pose (warm-up pass discarded)"
          % (len(actions), args.samples))
    _sample_poses(arm, names, actions, args.samples)
    pose_before = _sample_poses(arm, names, actions, args.samples)

    # ---- edit mode: apply the mirror ----------------------------------------------
    # `matrix_local`'s Y column is a UNIT direction: the bone's length lives in
    # head/tail, not in the matrix. So `eb.matrix = <unit-Y matrix>` sets head,
    # direction and roll while preserving the current length, and the tail only has
    # to be written when the mirrored length differs from it.
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = arm.data.edit_bones
    for right, left in targets.items():
        target = mirrored(bones[left].matrix_local)
        want_len = bones[left].length
        eb = edit_bones[right]
        m = Matrix.Translation(target.translation) @ target.to_quaternion().to_matrix().to_4x4()
        col = m.col[1].copy()
        col.normalize()
        m.col[1] = col
        eb.matrix = m
        if abs(eb.length - want_len) > 1e-6:
            eb.tail = target.translation + target.col[1].to_3d().normalized() * want_len
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    # ---- verify 1: every mirrored bone landed exactly on its mirror ---------------
    rest_drift = {}
    worst = (0.0, 0.0, 0.0)
    for right, left in targets.items():
        target = mirrored(bones[left].matrix_local)
        got = bones[right].matrix_local
        dt = (got.translation - target.translation).length
        dq = _rot_angle(target.to_3x3().to_quaternion(), got.to_3x3().to_quaternion())
        dlen = abs(bones[right].length - bones[left].length)
        rest_drift[right] = {"dT": dt, "dQ": dq, "dLen": dlen}
        worst = (max(worst[0], dt), max(worst[1], dq), max(worst[2], dlen))
    print("c7: rest landing -> worst dT %.3e  dQ %.3e rad  dLen %.3e" % worst)
    if worst[0] > REST_DT_LIMIT or worst[1] > REST_DQ_LIMIT or worst[2] > REST_DLEN_LIMIT:
        raise SystemExit("c7: FAIL — a mirrored bone did not land on its mirror "
                         "(worst dT %.3e, dQ %.3e rad, dLen %.3e)" % worst)

    # ---- verify 2: no rest outside the mirrored set changed ----------------------
    # Threshold is 1e-3 units, not 0: `matrix_local` round-trips through float32, so
    # re-serialising a bone at |x| ~ 2700 moves it by ~3e-4 (measured on
    # `R_WingD0P1` / `R_WingD0P2`, dQ exactly 0). Anything above that is real.
    collateral = []
    worst_collateral = 0.0
    for n in names:
        if n in targets:
            continue
        dt = (bones[n].matrix_local.translation - rest_before[n].translation).length
        dq = _rot_angle(rest_before[n].to_3x3().to_quaternion(),
                        bones[n].matrix_local.to_3x3().to_quaternion())
        worst_collateral = max(worst_collateral, dt, dq * 1000.0)
        if dt > REST_DT_LIMIT or dq > REST_DQ_LIMIT:
            collateral.append(n)
    print("c7: worst rest drift outside the mirrored set %.3e (float32 noise ~3e-4); "
          "real changes: %d" % (worst_collateral, len(collateral)))
    if collateral:
        raise SystemExit("c7: FAIL — rest collateral damage: %s" % collateral)

    # ---- verify 3: the animation re-evaluates; nothing outside the subtree moves --
    pose_after = _sample_poses(arm, names, actions, args.samples)
    outside, outside_where = _worst_drift(pose_after, pose_before, actions, args.samples, names,
                                          lambda n: n not in subtree)
    inside, inside_where = _worst_drift(pose_after, pose_before, actions, args.samples, names,
                                        lambda n: n in subtree)
    print("c7: posed drift inside the mirrored subtree (the intended change): "
          "dT %.3f  dQ %.3f rad  at %s" % (inside[0], inside[1], inside_where))
    print("c7: posed drift outside it (must be zero): dT %.3e  dQ %.3e rad  at %s"
          % (outside[0], outside[1], outside_where))
    if outside[0] > POSE_DT_LIMIT or outside[1] > POSE_DQ_LIMIT:
        raise SystemExit("c7: FAIL — animation collateral damage outside the wing: %s at %s"
                         % (outside, outside_where))

    # ---- purge --------------------------------------------------------------------
    purged = {"vertex_groups": [], "materials": []}
    if args.purge:
        bone_names = set(names)
        for obj in bpy.data.objects:
            if obj.type != "MESH":
                continue
            for group in list(obj.vertex_groups):
                if group.name not in bone_names:
                    purged["vertex_groups"].append({"object": obj.name, "group": group.name})
                    obj.vertex_groups.remove(group)
        for material in list(bpy.data.materials):
            if material.users == 0:
                purged["materials"].append(material.name)
                bpy.data.materials.remove(material)
        print("c7: purged %d orphan vertex groups, %d zero-user materials"
              % (len(purged["vertex_groups"]), len(purged["materials"])))

    # ---- verify 4: re-run the audit ----------------------------------------------
    after = [measure_pair(bones, left, right) for left, right in all_pairs(bones)]
    after_bad = failing(after)
    print("c7: after fix -> %d pairs, %d failing" % (len(after), len(after_bad)))
    for p in after_bad:
        print("   STILL FAILING %s/%s roll=%.6f lenD=%.6f"
              % (p["left"], p["right"], p["orientationErrorDeg"], p["lengthDelta"]))
    worst_roll = max(p["orientationErrorDeg"] for p in after)
    worst_len = max(p["lengthDelta"] for p in after)
    worst_head = max(p["headDelta"] for p in after)
    worst_tail = max(p["tailDelta"] for p in after)
    print("c7: worst orientationErrorDeg %.3e  lengthDelta %.3e  (limits 0.01)"
          % (worst_roll, worst_len))
    print("c7: worst headDelta %.3e  tailDelta %.3e (informational)"
          % (worst_head, worst_tail))

    report = {
        "blend": bpy.data.filepath,
        "written": bool(args.write),
        "purged": bool(args.purge),
        "pairsBefore": len(pairs),
        "failingBefore": len(bad),
        "pairsAfter": len(after),
        "failingAfter": len(after_bad),
        "mirrored": sorted(targets),
        "subtree": sorted(subtree),
        "restDrift": rest_drift,
        "restWorst": {"dT": worst[0], "dQ": worst[1], "dLen": worst[2]},
        "restCollateral": collateral,
        "poseDriftInside": {"dT": inside[0], "dQ": inside[1], "where": inside_where},
        "poseDriftOutside": {"dT": outside[0], "dQ": outside[1], "where": outside_where},
        "fcurvesModified": 0,
        "afterWorst": {"orientationDeg": worst_roll, "lengthDelta": worst_len,
                       "headDelta": worst_head, "tailDelta": worst_tail},
        "limits": {"orientationDeg": 0.01, "lengthUnits": 0.01},
        "purgedDetail": purged,
    }
    if args.json_out:
        path = Path(args.json_out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")

    if args.write:
        bpy.ops.wm.save_mainfile()
        print("c7: saved %s" % bpy.data.filepath)
    else:
        print("c7: dry run (pass --write to save)")

    if after_bad:
        print("c7: FAIL — %d pairs still asymmetric" % len(after_bad))
        return 1
    print("c7: OK — 0 failing pairs, rest change confined to the right wing, "
          "0 fcurves modified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
