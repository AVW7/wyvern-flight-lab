"""Task C6 — recenter the `Jaw` hinge, and give `Body` / `RootMotion` real lengths.

Three edits to `models/source/wyvern-v2-master.blend`, all in Edit Mode:

1. **`Jaw`** moves to the anatomical mandible hinge and is re-framed so its local
   `X` is exactly world `X`. A keyed `rotation_quaternion` on a Blender bone
   rotates about its **local X** (the channel array index `1` is the *x* term,
   because quaternions are stored `w, x, y, z`), so a lateral `X` axis is what
   makes the jaw pitch straight down instead of yawing. Measured before the fix:
   `Jaw.x_axis` was **2.09°** off world `X` while every other bone measured
   `0.0000°`.
2. **`Body`** grows from a `0.05`-unit stub to `Spine1.head`. This is nearly free:
   the stub already points at `Spine1` (`[0, -0.9971, 0.0761]`), so the axis moves
   by ~`0.002°` and the 993 `location` keys keep their meaning.
3. **`RootMotion`** — *opt-in via `--rootmotion-flat`.* Lying flat on the floor
   (`tail = (0, -200, 0)`) instead of stretching diagonally to `(0, 117.7, 824.2)`
   is a `98.13°` rest-orientation change, and that is where this task stops being
   a local edit: **re-framing a parent rotates its whole subtree**, because each
   child's rest-relative transform is recomputed from the new parent rest.
   Preserving the parent's own pose (the compensation below) does *not* preserve
   its children's. Measured: all 18 clips rotated by exactly `98.1301°` on `Body`
   and `Jaw`. Absorbing that at `Body` — the only child — works, but it leaves a
   constant `98°` local offset in `Body`'s curves across every clip, in exchange
   for zero functional gain (`RootMotion` carries no skin weight, and its current
   frame is already a sane Y-up: local `Y` ≈ up, local `Z` ≈ forward). So the
   re-frame is off by default and the task records it as deliberately deferred
   rather than silently applied.

**Compensation.** Moving a bone's head/tail changes its rest matrix `R`, which
changes what every keyed channel *means*. To leave the animated pose untouched:

    basis_new = C · basis_old        with  C = R_new⁻¹ · R_old
    location_new = rot(C) · location_old

Quaternion multiplication by a constant is **linear** in the four components, so
the same `4×4` map is applied to each key's value *and* both Bézier handles —
which is why this preserves the interpolated curve exactly rather than only the
keyed frames. The resulting delta-vs-bind quaternion is identical to before, so
`poseEnvelope`'s `open_jaw` detector keeps measuring the same angles.

Usage (dry run by default; never start Blender from Python):

    ~/.local/bin/blender --background models/source/wyvern-v2-master.blend \
        --python tools/blender/fix_c6_jaw_pivot_and_stub_bones.py -- \
        [--write] [--rootmotion-flat] [--json-out path]
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
BLENDER_PKG = REPO / "scripts/blender"
if str(BLENDER_PKG) not in sys.path:
    sys.path.insert(0, str(BLENDER_PKG))

from core.actions_compat import ActionCompat  # noqa: E402
from rigging import rest_reframe  # noqa: E402

# The doc's anatomical mandible hinge, in armature space (Blender +Z up).
JAW_HINGE = Vector((0.0, -565.0, 785.0))
ROOTMOTION_TAIL = Vector((0.0, -200.0, 0.0))
TOLERANCE_DEG = 0.01


def _armature() -> bpy.types.Object:
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            return obj
    raise SystemExit("c6: no armature in scene")


def _rest_quat(bone: bpy.types.Bone) -> Quaternion:
    return bone.matrix_local.to_quaternion()


def _frame(origin: Vector, x: Vector, y: Vector) -> Matrix:
    """Rest matrix from an explicit `X` and a **unit** `Y` direction.

    `EditBone.matrix` is a plain property, so it must be assigned once — mutating
    `.translation` on the returned value would write to a temporary copy.

    The `Y` column must be unit length: Blender's setter multiplies the column's
    magnitude by the bone's *existing* length, so passing `y * length` squares the
    scale (`Body` came out at `164.07 × 0.0505 = 8.29`, `RootMotion` at
    `200 × 832.57 = 166,513`). Length is set explicitly afterwards via `tail`.
    """
    x = x.normalized()
    y = y.normalized()
    x = (x - y * x.dot(y)).normalized()  # re-orthogonalise against Y
    z = x.cross(y).normalized()
    matrix = Matrix((x, y, z)).transposed().to_4x4()
    matrix.translation = origin
    return matrix


def _quat_left_multiply_matrix(c: Quaternion) -> list[list[float]]:
    """`q -> c ⊗ q` as a 4×4 matrix over `(w, x, y, z)`, via the tested module."""
    return rest_reframe.left_multiply_matrix((c.w, c.x, c.y, c.z))


def _apply(matrix: list[list[float]], values: list[float]) -> list[float]:
    return rest_reframe.apply(matrix, values)


def _conjugate_rotation(action: bpy.types.Action, bone: str, c: Quaternion) -> int:
    """Left-multiply every `rotation_quaternion` key (and handle) of `bone` by `c`."""
    path = f'pose.bones["{bone}"].rotation_quaternion'
    curves = {}
    for fcurve in ActionCompat.iter_fcurves(action):
        if fcurve.data_path == path:
            curves[fcurve.array_index] = fcurve
    if len(curves) != 4:
        return 0

    matrix = _quat_left_multiply_matrix(c)
    count = min(len(curves[index].keyframe_points) for index in range(4))
    for position in range(count):
        for attribute in ("co", "handle_left", "handle_right"):
            vector = [
                getattr(curves[index].keyframe_points[position], attribute)[1] for index in range(4)
            ]
            transformed = _apply(matrix, vector)
            for index in range(4):
                getattr(curves[index].keyframe_points[position], attribute)[1] = transformed[index]
    return count


def _conjugate_location(action: bpy.types.Action, bone: str, c: Quaternion) -> int:
    """Rotate every `location` key (and handle) of `bone` by `c`."""
    path = f'pose.bones["{bone}"].location'
    curves = {}
    for fcurve in ActionCompat.iter_fcurves(action):
        if fcurve.data_path == path:
            curves[fcurve.array_index] = fcurve
    if len(curves) != 3:
        return 0

    rotation = c.to_matrix()
    touched = max(len(curves[index].keyframe_points) for index in range(3))
    for position in range(touched):
        for attribute in ("co", "handle_left", "handle_right"):
            vector = Vector([getattr(curves[i].keyframe_points[position], attribute)[1] for i in range(3)])
            transformed = rotation @ vector
            for i in range(3):
                getattr(curves[i].keyframe_points[position], attribute)[1] = transformed[i]
    return touched


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="save the blend (default: dry run)")
    parser.add_argument(
        "--rootmotion-flat",
        action="store_true",
        help="also re-frame RootMotion flat on the floor (rotates every clip by 98.13deg "
        "unless Body absorbs it; see the module docstring)",
    )
    parser.add_argument("--json-out")
    args = parser.parse_args(argv)

    arm = _armature()
    old_rest = {name: _rest_quat(arm.data.bones[name]) for name in ("Jaw", "Body", "RootMotion")}
    old_axes = {
        name: [round(float(c), 6) for c in arm.data.bones[name].matrix_local.to_3x3().col[0].normalized()]
        for name in ("Jaw", "Body", "RootMotion")
    }

    spine1_head = arm.data.bones["Spine1"].head_local.copy()

    # ---- Edit Mode: re-frame the three bones -----------------------------------
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = arm.data.edit_bones

    jaw = edit_bones["Jaw"]
    jaw_head_before = jaw.head.copy()
    jaw_length = (jaw.tail - jaw.head).length
    jaw_y = (jaw.tail - jaw.head).normalized()
    jaw_y.x = 0.0  # sagittal plane: local Y must stay ⟂ to a lateral local X
    jaw_y.normalize()
    jaw.matrix = _frame(JAW_HINGE, Vector((1.0, 0.0, 0.0)), jaw_y)
    jaw.tail = JAW_HINGE + jaw_y * jaw_length
    jaw_head_after = jaw.head.copy()
    jaw_tail_after = jaw.tail.copy()
    jaw_length_after = (jaw.tail - jaw.head).length

    body = edit_bones["Body"]
    body_head_before = body.head.copy()
    body_length_before = (body.tail - body.head).length
    body_y = (spine1_head - body.head).normalized()
    body.matrix = _frame(body_head_before, Vector((1.0, 0.0, 0.0)), body_y)
    body.tail = body_head_before + body_y * (spine1_head - body_head_before).length
    body_tail_after = body.tail.copy()
    body_length_after = (body.tail - body.head).length

    rootmotion = edit_bones["RootMotion"]
    rm_head = rootmotion.head.copy()
    rm_tail_before = rootmotion.tail.copy()
    if args.rootmotion_flat:
        rm_y = (ROOTMOTION_TAIL - rm_head).normalized()
        rootmotion.matrix = _frame(rm_head, Vector((1.0, 0.0, 0.0)), rm_y)
        rootmotion.tail = rm_head + rm_y * (ROOTMOTION_TAIL - rm_head).length
    rm_tail_after = rootmotion.tail.copy()

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    new_rest = {name: _rest_quat(arm.data.bones[name]) for name in ("Jaw", "Body", "RootMotion")}
    new_axes = {
        name: [round(float(c), 6) for c in arm.data.bones[name].matrix_local.to_3x3().col[0].normalized()]
        for name in ("Jaw", "Body", "RootMotion")
    }
    compensation = {
        name: Quaternion(rest_reframe.compensation(
            (old_rest[name].w, old_rest[name].x, old_rest[name].y, old_rest[name].z),
            (new_rest[name].w, new_rest[name].x, new_rest[name].y, new_rest[name].z),
        ))
        for name in new_rest
    }
    drift = {
        name: round(
            rest_reframe.angle_deg(
                (old_rest[name].w, old_rest[name].x, old_rest[name].y, old_rest[name].z),
                (new_rest[name].w, new_rest[name].x, new_rest[name].y, new_rest[name].z),
            ),
            6,
        )
        for name in new_rest
    }

    # Only bones whose rest orientation actually moved need their channels rewritten;
    # conjugating by an identity would just churn every key for float noise.
    targets = ["Jaw"]
    if drift["Body"] > 1e-6:
        targets.append("Body")
    if args.rootmotion_flat and drift["RootMotion"] > 1e-6:
        targets.append("RootMotion")

    # ---- Conjugate every action so the animated pose is unchanged --------------
    per_action: dict[str, dict] = {}
    for action in bpy.data.actions:
        entry = {}
        for name in targets:
            entry[name] = {
                "rotation_keys": _conjugate_rotation(action, name, compensation[name]),
                "location_keys": _conjugate_location(action, name, compensation[name]),
            }
        per_action[action.name] = entry

    report = {
        "blend": bpy.data.filepath,
        "written": bool(args.write),
        "jaw": {
            "head_before": [round(float(c), 4) for c in jaw_head_before],
            "head_after": [round(float(c), 4) for c in jaw_head_after],
            "tail_after": [round(float(c), 4) for c in jaw_tail_after],
            "length": round(float(jaw_length_after), 4),
            "x_axis_before": old_axes["Jaw"],
            "x_axis_after": new_axes["Jaw"],
            "x_axis_vs_world_x_deg_before": round(
                math.degrees(math.acos(min(1.0, abs(old_axes["Jaw"][0])))), 4
            ),
            "x_axis_vs_world_x_deg_after": round(
                math.degrees(math.acos(min(1.0, abs(new_axes["Jaw"][0])))), 4
            ),
        },
        "body": {
            "length_before": round(float(body_length_before), 4),
            "length_after": round(float(body_length_after), 4),
            "tail_after": [round(float(c), 4) for c in body_tail_after],
        },
        "rootmotion": {
            "tail_before": [round(float(c), 4) for c in rm_tail_before],
            "tail_after": [round(float(c), 4) for c in rm_tail_after],
        },
        "rest_orientation_drift_deg": drift,
        "compensated_bones": targets,
        "rootmotion_flat": bool(args.rootmotion_flat),
        "actions_compensated": len(per_action),
        "per_action": per_action,
    }

    out = json.dumps(report, indent=2, sort_keys=True)
    if args.json_out:
        path = Path(args.json_out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(out + "\n")

    print(f"c6: Jaw head {report['jaw']['head_before']} -> {report['jaw']['head_after']}")
    print(f"c6: Jaw x-axis vs world X {report['jaw']['x_axis_vs_world_x_deg_before']}deg -> "
          f"{report['jaw']['x_axis_vs_world_x_deg_after']}deg")
    print(f"c6: Body length {report['body']['length_before']} -> {report['body']['length_after']}")
    print(f"c6: RootMotion tail {report['rootmotion']['tail_before']} -> {report['rootmotion']['tail_after']}")
    print(f"c6: rest orientation drift {drift}")
    print(f"c6: compensated {len(per_action)} actions")

    if args.write:
        bpy.ops.wm.save_mainfile()
        print(f"c6: saved {bpy.data.filepath}")
    else:
        print("c6: dry run (pass --write to save)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
