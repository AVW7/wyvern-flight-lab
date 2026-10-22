"""Measure what the V2 `Jaw` bone actually does to the mesh (Task C6 evidence).

The audit in doc 41 claims the jaw "translates and yaws the lower jaw sideways
instead of hinging around the anatomical mandible joint". That is a geometric
claim and it can be settled exactly:

* A rotation about a **pure lateral axis** (world `X`) through any point leaves
  every vertex's `x` coordinate unchanged. So `max |delta_x|` over the vertices
  the jaw owns is a direct, threshold-free test of "no lateral yaw".
* A rotation about the jaw's **own long axis** (which is what a keyed
  `rotation_quaternion[1]` produces, because a Blender bone's local `Y` *is* its
  head->tail axis) is a twist: vertices swing in `x` in proportion to their
  distance from that axis.

The script reports both, at the clip frame where the jaw is widest open, for the
rest pose and for a given action. It also reports the fitted hinge axis and
pivot, so the "correct" bone orientation is a measured result rather than a
guess.

Usage:

    ~/.local/bin/blender --background models/source/wyvern-v2-master.blend \
        --python tools/blender/measure_c6_jaw_kinematics.py -- \
        [--action breath] [--frame N] [--json-out path]
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

JAW = "Jaw"


def _armature() -> bpy.types.Object:
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            return obj
    raise SystemExit("measure: no armature in scene")


def _jaw_vertex_indices() -> dict[str, list[int]]:
    """Vertices with any `Jaw` weight, per mesh object."""
    out: dict[str, list[int]] = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        group = obj.vertex_groups.get(JAW)
        if group is None:
            continue
        indices = [
            vert.index
            for vert in obj.data.vertices
            if any(element.group == group.index and element.weight > 0.0 for element in vert.groups)
        ]
        if indices:
            out[obj.name] = indices
    return out


def _rest_positions(obj: bpy.types.Object) -> list[Vector]:
    return [obj.matrix_world @ vert.co for vert in obj.data.vertices]


def _evaluated_positions(obj: bpy.types.Object) -> list[Vector]:
    """Deformed vertex positions, armature modifier evaluated, in world space."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        matrix = evaluated.matrix_world
        return [matrix @ vert.co for vert in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def _jaw_open_frame(arm: bpy.types.Object, action: bpy.types.Action) -> tuple[int, float]:
    """Frame at which the jaw is widest open, plus the angle in degrees.

    `rotation_quaternion[1]` is the `y` component, i.e. a rotation about the
    bone's local `Y`. The largest `|y|` is the widest open frame for that clip.
    """
    best_frame, best_y = None, 0.0
    for fcurve in ActionCompat.iter_fcurves(action):
        if fcurve.data_path != f'pose.bones["{JAW}"].rotation_quaternion' or fcurve.array_index != 1:
            continue
        for key in fcurve.keyframe_points:
            if abs(key.co[1]) > abs(best_y):
                best_y, best_frame = float(key.co[1]), int(round(float(key.co[0])))
    if best_frame is None:
        return 1, 0.0
    return best_frame, math.degrees(2.0 * math.asin(min(1.0, abs(best_y))))


def _stats(deltas: list[Vector], indices: list[int]) -> dict:
    if not indices:
        return {"vertices": 0}
    picked = [deltas[i] for i in indices]
    xs = [d.x for d in picked]
    ys = [d.y for d in picked]
    zs = [d.z for d in picked]
    magnitudes = [d.length for d in picked]
    return {
        "vertices": len(picked),
        "max_abs_dx": round(max(abs(x) for x in xs), 4),
        "max_abs_dy": round(max(abs(y) for y in ys), 4),
        "max_abs_dz": round(max(abs(z) for z in zs), 4),
        "dx_range": [round(min(xs), 4), round(max(xs), 4)],
        "dy_range": [round(min(ys), 4), round(max(ys), 4)],
        "dz_range": [round(min(zs), 4), round(max(zs), 4)],
        "max_displacement": round(max(magnitudes), 4),
        "mean_displacement": round(sum(magnitudes) / len(magnitudes), 4),
    }


def _hinge_from_bone(arm: bpy.types.Object, jaw: bpy.types.PoseBone) -> dict:
    """World-space hinge axis and pivot the jaw bone actually rotates about.

    Derived from the rig rather than fitted to vertices, so it explains the
    measurement instead of restating it: the mesh-side gate is `max |delta_x|`.
    """
    rest = arm.data.bones[JAW].matrix_local.to_quaternion()
    posed = jaw.matrix.to_quaternion()
    delta = posed @ rest.inverted()
    axis, angle = delta.to_axis_angle()
    axis_world = (arm.matrix_world.to_quaternion() @ axis).normalized()
    pivot = arm.matrix_world @ jaw.head
    return {
        "axis_world": [round(float(c), 5) for c in axis_world],
        "angle_deg": round(math.degrees(float(angle)), 4),
        "axis_vs_world_x_deg": round(
            math.degrees(math.acos(max(-1.0, min(1.0, abs(float(axis_world.x)))))),
            4,
        ),
        "pivot_world": [round(float(c), 3) for c in pivot],
    }


def _rest_axes(arm: bpy.types.Object) -> dict:
    """Armature-space rest axes of every bone, so the rig's own error is separable
    from the head's animation. `x_axis_vs_world_x_deg` is the quantity C6 fixes."""
    out: dict[str, dict] = {}
    for bone in arm.data.bones:
        matrix = bone.matrix_local.to_3x3()
        axes = {
            "x": matrix.col[0].normalized(),
            "y": matrix.col[1].normalized(),
            "z": matrix.col[2].normalized(),
        }
        out[bone.name] = {
            "x_axis": [round(float(c), 5) for c in axes["x"]],
            "y_axis": [round(float(c), 5) for c in axes["y"]],
            "z_axis": [round(float(c), 5) for c in axes["z"]],
            "x_axis_vs_world_x_deg": round(
                math.degrees(math.acos(max(-1.0, min(1.0, abs(float(axes["x"].x)))))),
                4,
            ),
            "y_axis_vs_world_x_deg": round(
                math.degrees(math.acos(max(-1.0, min(1.0, abs(float(axes["y"].x)))))),
                4,
            ),
        }
    return out


def _isolate_jaw(arm: bpy.types.Object, open_deg: float) -> None:
    """Bind pose everywhere, plus a single rotation of `Jaw` about its local `X`.

    This is the rig defect with the head's animation removed: any lateral vertex
    drift here is the bone frame, not the clip.
    """
    if arm.animation_data is not None:
        arm.animation_data.action = None
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        pose_bone.location = Vector((0.0, 0.0, 0.0))
        pose_bone.scale = Vector((1.0, 1.0, 1.0))
    jaw = arm.pose.bones.get(JAW)
    if jaw is not None:
        jaw.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        jaw.rotation_quaternion.rotate(
            Quaternion(Vector((1.0, 0.0, 0.0)), math.radians(open_deg))
        )
    bpy.context.view_layer.update()


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", default="breath")
    parser.add_argument("--frame", type=int)
    parser.add_argument("--isolate", action="store_true", help="bind pose + jaw-only rotation")
    parser.add_argument("--open-deg", type=float, default=45.0)
    parser.add_argument("--json-out")
    args = parser.parse_args(argv)

    arm = _armature()
    action = bpy.data.actions.get(args.action)
    if action is None:
        raise SystemExit(f"measure: no action named {args.action!r}")

    if args.isolate:
        _isolate_jaw(arm, args.open_deg)
        frame, open_deg = 0, args.open_deg
        clip_label = f"isolated jaw {args.open_deg:g}deg about local X"
    else:
        frame, open_deg = _jaw_open_frame(arm, action)
        if args.frame is not None:
            frame = args.frame

        if arm.animation_data is None:
            arm.animation_data_create()
        arm.animation_data.action = action
        try:
            slot = next((s for s in action.slots if getattr(s, "name", None) == arm.name), None)
            if slot is not None:
                arm.animation_data.action_slot = slot
        except Exception:
            pass

        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        clip_label = args.action

    axes = _rest_axes(arm)
    report: dict = {
        "blend": bpy.data.filepath,
        "mode": "isolate" if args.isolate else "action",
        "action": None if args.isolate else args.action,
        "clip": clip_label,
        "frame": frame,
        "jaw_open_deg": round(open_deg, 4),
        "bones": {},
        "rest_axes": {name: axes[name] for name in ("Head", "Jaw", "Body", "RootMotion", "Spine1") if name in axes},
        "meshes": {},
    }

    jaw_bone = arm.pose.bones.get(JAW)
    if jaw_bone is not None:
        rest = arm.data.bones[JAW].matrix_local.to_quaternion()
        now = jaw_bone.matrix.to_quaternion()
        delta = rest.inverted() @ now
        axis, angle = delta.to_axis_angle()
        report["bones"][JAW] = {
            "pose_quat": [round(float(c), 6) for c in jaw_bone.rotation_quaternion],
            "delta_vs_bind_deg": round(math.degrees(float(angle)), 4),
            "delta_axis_local": [round(float(c), 5) for c in axis],
            "head_world": [round(float(c), 4) for c in (arm.matrix_world @ jaw_bone.head)],
            "tail_world": [round(float(c), 4) for c in (arm.matrix_world @ jaw_bone.tail)],
        }

    jaw_indices = _jaw_vertex_indices()
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        rest_positions = _rest_positions(obj)
        posed = _evaluated_positions(obj)
        deltas = [p - r for p, r in zip(posed, rest_positions)]
        indices = jaw_indices.get(obj.name, [])
        report["meshes"][obj.name] = {
            "vertices": len(rest_positions),
            "jaw": _stats(deltas, indices),
            "all_max_displacement": round(max((d.length for d in deltas), default=0.0), 4),
            "hinge": _hinge_from_bone(arm, jaw_bone) if jaw_bone is not None else None,
        }

    out = json.dumps(report, indent=2, sort_keys=True)
    if args.json_out:
        path = Path(args.json_out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(out + "\n")
        print(f"measure: wrote {path}")
    else:
        print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
