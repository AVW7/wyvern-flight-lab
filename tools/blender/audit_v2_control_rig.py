"""Measure the V2 `10 Controls` layer inside headless Blender (Task C4 verification).

Answers three questions with numbers, not assumptions:

1. **Rest-pose fidelity** — with the control rig built and every managed constraint active
   (`ground_contact_ik = 1.0`, `panel_bisect = 1.0`), how far does each of the 92 deform bones
   move from its rest orientation? Anything above `0.01°` is a rig defect, not a tolerance.
2. **Elbow pole calibration** — `CTRL_Pole_Elbow_L/R` pins the shoulder/elbow bend plane. The
   correct `pole_angle` is the one that reproduces the rest pose, so it is solved numerically
   instead of guessed: coarse sweep, then a fine sweep around the best candidate.
3. **Panel pair-bisect** — with one digit rotated by `θ`, the inter-digital panel must follow by
   `θ/2`. Rigid parenting (the defect) gives `θ`.

Usage (never start Blender from Python; see docs/BLENDER_CRASH_LOG.md):

    ~/.local/bin/blender --background models/source/wyvern-v2-master.blend \
        --python tools/blender/audit_v2_control_rig.py -- --json-out <path> [--sweep]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion

REPO = Path(__file__).resolve().parents[2]
BLENDER_PKG = REPO / "scripts/blender"
if str(BLENDER_PKG) not in sys.path:
    sys.path.insert(0, str(BLENDER_PKG))

from contract import CONTRACT_PATH, load_contract  # noqa: E402
from rigging import control_rig  # noqa: E402

TOLERANCE_DEG = 0.01


def _args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--json-out", type=Path, default=None)
    parser.add_argument("--sweep", action="store_true", help="Solve CTRL_Pole_Elbow_L/R pole_angle")
    parser.add_argument("--armature", default="WyvernRig")
    return parser.parse_args(argv)


def _update() -> None:
    """Flush the depsgraph. A single `view_layer.update()` leaves driver-driven constraint
    influences one evaluation behind, which reads as a rig defect that is not there."""
    for _ in range(3):
        bpy.context.view_layer.update()


def _rest_pose(armature) -> None:
    """Clear every animation source so `pose.matrix` reflects rest + constraints only."""
    if armature.animation_data is not None:
        armature.animation_data.action = None
        armature.animation_data.use_nla = False
    for pb in armature.pose.bones:
        pb.matrix_basis.identity()
    _update()


def _deviation(armature, bone_names) -> dict[str, float]:
    out: dict[str, float] = {}
    for name in bone_names:
        pb = armature.pose.bones.get(name)
        bone = armature.data.bones.get(name)
        if pb is None or bone is None:
            continue
        rest_q = bone.matrix_local.to_quaternion()
        pose_q = pb.matrix.to_quaternion()
        delta = rest_q.inverted() @ pose_q
        out[name] = round(math.degrees(abs(delta.angle)), 6)
    return out


def _worst(devs: dict[str, float]) -> tuple[float, str]:
    name = max(devs, key=lambda k: devs[k]) if devs else ""
    return (devs.get(name, 0.0), name)


def _bend_plane(armature, side: str) -> tuple[Any, Any, Any]:
    """Armature-space (shoulder head, elbow head, elbow tail) for one wing chain."""
    return tuple(
        armature.pose.bones[name].matrix.translation.copy()
        for name in (f"{side}_WingShoulder", f"{side}_WingElbow")
    ) + (armature.pose.bones[f"{side}_WingElbow"].tail.copy(),)


def _plane_normal(points: tuple[Any, Any, Any]) -> Any:
    a, b, c = points
    return (b - a).cross(c - b).normalized()


def _set_pole_angle(armature, side: str, degrees: float) -> None:
    pb = armature.pose.bones[f"{side}_WingElbow"]
    ik = next(c for c in pb.constraints if c.name == f"CTRL_WingKnuckleIK_{side}")
    ik.pole_angle = math.radians(degrees)


def _displace_target(armature, side: str, distance: float) -> None:
    """Move the wing-knuckle IK target *within the rest bend plane* so the pole is exercised.

    Displacing it out of plane would rotate the shoulder/elbow/wrist triangle legitimately, so the
    bend-plane normal would change no matter how the pole is calibrated. In-plane displacement
    keeps the normal invariant, which makes any residual a genuine `pole_angle` error.
    """
    shoulder, elbow = (armature.pose.bones[name] for name in (f"{side}_WingShoulder", f"{side}_WingElbow"))
    wrist = armature.pose.bones[f"{side}_WingWrist"]
    chord_mid = (shoulder.head + wrist.head) * 0.5
    outward = (elbow.head - chord_mid)
    pb = armature.pose.bones[f"CTRL_IK_WingWrist_{side}"]
    pb.location = pb.location + outward.normalized() * distance
    _update()


def _solve_pole_angle(armature, side: str, deform: list[str]) -> dict[str, object]:
    """Solve `pole_angle` as the value that reproduces the rest pose with the knuckle IK enabled.

    A bend-plane test cannot do this: flipping the pole by 180 deg mirrors the elbow to the other
    side of the shoulder/wrist chord while leaving the plane (and its normal) unchanged. Measured
    on `wyvern-v2-master.blend`, `pole_angle = -9.25` keeps the plane to 0.02 deg and still throws
    the whole wing 176.47 deg away from rest. Rest-pose deviation separates the two branches.
    """
    armature["ground_contact_ik"] = 1.0
    _rest_pose(armature)

    def deviation_at(degrees: float) -> float:
        # Reset the pose before every sample: mutating `pole_angle` in place leaves evaluated
        # state behind, and a contaminated sample reads as a plateau that is not there.
        _rest_pose(armature)
        _set_pole_angle(armature, side, degrees)
        _update()
        worst, _ = _worst(_deviation(armature, deform))
        return round(worst, 6)

    coarse = [(round(step * 2.5, 3), deviation_at(step * 2.5)) for step in range(-72, 73)]
    best = min(coarse, key=lambda item: item[1])
    fine = [(round(best[0] + step * 0.25, 3), deviation_at(best[0] + step * 0.25)) for step in range(-8, 9)]
    best = min(fine, key=lambda item: item[1])

    _set_pole_angle(armature, side, best[0])
    _update()
    armature["ground_contact_ik"] = 0.0
    _rest_pose(armature)
    return {
        "pole_angle_deg": best[0],
        "rest_deviation_deg": best[1],
        "coarse_best": min(coarse, key=lambda item: item[1]),
        "fine_best": best,
        "samples": len(coarse) + len(fine),
        "method": "search heuristic: repeated pole mutation inside one session leaves evaluated "
                  "state behind, so these absolute values run ~3 deg high; the pristine "
                  "verification pass below is authoritative",
    }


def _panel_bisect(armature, side: str, digit: int, theta_deg: float) -> dict[str, object]:
    """Rotate `WingD{digit}P0` by theta and compare the panel against the GLB solver invariant.

    `coordinate_all_v2_clips.mjs` requires `panel_world_delta == slerp(delta_K, delta_K+1, 0.5)`,
    i.e. `theta / 2` when only digit K moves. Rigid parenting (the defect) gives `theta`.
    """
    panel = f"{side}_WingPanel{digit}_0"
    digit_pb = armature.pose.bones[f"{side}_WingD{digit}P0"]
    panel_pb = armature.pose.bones[panel]
    bind_panel = armature.data.bones[panel].matrix_local.copy()

    rest_panel = (armature.pose.bones[panel].matrix @ bind_panel.inverted()).to_quaternion()

    digit_pb.rotation_mode = "QUATERNION"
    digit_pb.rotation_quaternion = Quaternion((1.0, 0.0, 0.0), math.radians(theta_deg))
    _update()

    rigid_delta = math.degrees(
        abs((panel_pb.matrix @ bind_panel.inverted()).to_quaternion().rotation_difference(rest_panel).angle)
    )
    solved = control_rig.apply_panel_bisect(bpy, armature, [panel])
    bisected_delta = math.degrees(
        abs((panel_pb.matrix @ bind_panel.inverted()).to_quaternion().rotation_difference(rest_panel).angle)
    )

    digit_pb.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 1.0))
    _update()
    control_rig.apply_panel_bisect(bpy, armature, [panel])

    return {
        "panel": panel,
        "digit": f"{side}_WingD{digit}P0",
        "digit_rotation_deg": theta_deg,
        "expected_world_delta_deg": theta_deg / 2.0,
        "rigid_parenting_delta_deg": round(rigid_delta, 4),
        "bisected_delta_deg": round(bisected_delta, 4),
        "bisect_error_deg": round(abs(bisected_delta - theta_deg / 2.0), 4),
        "solver_self_check_deg": solved["max_error_deg"],
    }


def main() -> int:
    args = _args()
    contract = load_contract(CONTRACT_PATH)
    deform = [b["name"] for b in contract["bones"]]

    armature_path = bpy.data.filepath
    armature = bpy.data.objects.get(args.armature)
    if armature is None or armature.type != "ARMATURE":
        raise SystemExit(f"no armature {args.armature!r} in {bpy.data.filepath}")

    report: dict[str, object] = {
        "blend": bpy.data.filepath,
        "armature": armature.name,
        "tolerance_deg": TOLERANCE_DEG,
        "rest_contact_plane_z": None,
        "baseline": {},
        "control_rig": {},
        "elbow_pole": {},
        "panel_bisect": {},
    }

    _rest_pose(armature)
    baseline = _deviation(armature, deform)
    worst_baseline, worst_baseline_bone = _worst(baseline)
    report["baseline"] = {
        "worst_deviation_deg": worst_baseline,
        "worst_bone": worst_baseline_bone,
    }
    report["rest_contact_plane_z"] = round(
        min(
            armature.data.bones[f"{side}_Foot"].tail_local.z
            for side in ("L", "R")
        ),
        4,
    )

    if args.sweep:
        # Build once so the constraint stack exists, then solve each side against the wing chain.
        control_rig.build_control_rig(bpy, armature, contract=contract)
        # The IK influence is driver-driven; it must be on for the pole to have any effect.
        armature["ground_contact_ik"] = 1.0
        _update()
        for side in ("L", "R"):
            report["elbow_pole"][side] = _solve_pole_angle(armature, side, deform)

    # Re-open the blend so the verification build starts from a pristine file: a swept target
    # leaves pose state behind that a rebuild does not clear, and a contaminated baseline reads
    # as a rig defect that is not there.
    bpy.ops.wm.open_mainfile(filepath=armature_path)
    armature = bpy.data.objects[args.armature]
    _rest_pose(armature)
    rig_report = control_rig.build_control_rig(bpy, armature, contract=contract)
    report["control_rig"] = {
        "contact_plane": rig_report["contact_plane"],
        "ground_contact_ik": rig_report["ground_contact_ik"],
        "control_bone_count": rig_report["control_bone_count"],
        "deform_bone_count": rig_report["deform_bone_count"],
        "floor_clamped_controls": rig_report["floor_clamped_controls"],
    }

    armature["ground_contact_ik"] = 1.0
    _update()
    grounded = _deviation(armature, deform)
    worst_grounded, worst_grounded_bone = _worst(grounded)
    report["control_rig"]["ground_contact_ik_1_worst_deviation_deg"] = worst_grounded
    report["control_rig"]["ground_contact_ik_1_worst_bone"] = worst_grounded_bone
    report["control_rig"]["ground_contact_ik_1_per_bone"] = grounded

    report["panel_bisect"] = {
        "L_d0_20deg": _panel_bisect(armature, "L", 0, 20.0),
        "R_d0_20deg": _panel_bisect(armature, "R", 0, 20.0),
        "L_d2_30deg": _panel_bisect(armature, "L", 2, 30.0),
    }

    armature["ground_contact_ik"] = 0.0
    _update()

    passed = (
        worst_grounded <= TOLERANCE_DEG
        and report["panel_bisect"]["L_d0_20deg"]["bisect_error_deg"] <= 1.0
    )
    report["passed"] = passed
    payload = json.dumps(report, indent=2, sort_keys=True)
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(payload + "\n")
    print(payload)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
