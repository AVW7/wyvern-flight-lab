"""Measure the C6 defect in `models/source/wyvern-v2-master.blend` before touching it.

Task C6 claims three things about the blend, and the fix depends on all three being
true in *this* file rather than in the older `wyvern-rig.blend` the audit read:

1. `Jaw.head` is off the midline (`X = +3.6`) and sits *above* the `Head` pivot.
2. `Body` is a degenerate `0.05`-unit stub.
3. `RootMotion` runs diagonally from the floor to the dorsal spine.

The probe also answers the question the fix actually hinges on: **which actions key
`Jaw`, and with what**, because moving the edit bone changes the meaning of every
`rotation_quaternion` key on that bone and those keys must be conjugated to survive.

Usage (never start Blender from Python; see docs/BLENDER_CRASH_LOG.md):

    ~/.local/bin/blender --background models/source/wyvern-v2-master.blend \
        --python tools/blender/probe_c6_jaw_and_stub_bones.py -- [--json-out <path>]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

REPO = Path(__file__).resolve().parents[2]
BLENDER_PKG = REPO / "scripts/blender"
if str(BLENDER_PKG) not in sys.path:
    sys.path.insert(0, str(BLENDER_PKG))

from core.actions_compat import ActionCompat  # noqa: E402

WATCHED = ("Head", "Jaw", "Body", "RootMotion", "Spine1", "Neck1", "Root")


def _armature() -> bpy.types.Object:
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            return obj
    raise SystemExit("probe: no armature in scene")


def _vec(v: Vector) -> list[float]:
    return [round(float(c), 4) for c in v]


def _describe_bones(arm: bpy.types.Object) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for name in WATCHED:
        bone = arm.data.bones.get(name)
        if bone is None:
            out[name] = {"present": False}
            continue
        # `Bone.matrix_local` is the armature-space rest matrix; the audit numbers in
        # doc 41 are armature-space edit-bone coordinates, so report both.
        head = bone.head_local
        tail = bone.tail_local
        axis_y = (tail - head).normalized() if (tail - head).length > 1e-9 else Vector((0, 0, 0))
        out[name] = {
            "present": True,
            "head": _vec(head),
            "tail": _vec(tail),
            "length": round(float((tail - head).length), 4),
            "roll_deg": round(math.degrees(float(bone.matrix_local.to_quaternion().to_euler("XYZ").z)), 4),
            "y_axis": _vec(axis_y),
            "parent": bone.parent.name if bone.parent else None,
            "children": sorted(child.name for child in bone.children),
            "use_deform": bool(bone.use_deform),
            "rest_quat": [round(float(c), 6) for c in bone.matrix_local.to_quaternion()],
        }
    return out


def _jaw_actions(arm: bpy.types.Object) -> dict:
    """Every action that writes a `Jaw` channel, with its key count and value range."""
    report: dict[str, dict] = {}
    for action in bpy.data.actions:
        curves = []
        for fcurve in ActionCompat.iter_fcurves(action):
            path = fcurve.data_path
            if '"Jaw"' not in path:
                continue
            curves.append(
                {
                    "data_path": path,
                    "array_index": fcurve.array_index,
                    "keys": len(fcurve.keyframe_points),
                    "frame_range": [
                        round(float(fcurve.keyframe_points[0].co[0]), 3),
                        round(float(fcurve.keyframe_points[-1].co[0]), 3),
                    ]
                    if fcurve.keyframe_points
                    else None,
                    "value_range": [
                        round(min(float(k.co[1]) for k in fcurve.keyframe_points), 6),
                        round(max(float(k.co[1]) for k in fcurve.keyframe_points), 6),
                    ]
                    if fcurve.keyframe_points
                    else None,
                }
            )
        if curves:
            report[action.name] = {"curves": curves, "slots": len(getattr(action, "slots", []))}
    return report


def _body_actions(arm: bpy.types.Object) -> dict:
    """Every curve any action writes on `Body` / `RootMotion`.

    A rest-axis change on either bone silently remaps the meaning of its local
    channels, so the probe has to report *all* of them with their value ranges —
    a curve that is identically zero is harmless, a curve that carries motion is
    a clip rewrite.
    """
    report: dict[str, dict[str, list[dict]]] = {"Body": {}, "RootMotion": {}}
    for action in bpy.data.actions:
        for bone in report:
            for fcurve in ActionCompat.iter_fcurves(action):
                if f'"{bone}"' not in fcurve.data_path:
                    continue
                keys = fcurve.keyframe_points
                entry = {
                    "data_path": fcurve.data_path,
                    "array_index": fcurve.array_index,
                    "keys": len(keys),
                    "value_range": [round(min(float(k.co[1]) for k in keys), 8), round(max(float(k.co[1]) for k in keys), 8)]
                    if keys
                    else None,
                }
                report[bone].setdefault(action.name, []).append(entry)
    return report


def _bone_weight_totals() -> dict[str, float]:
    """Total skin weight per bone name — proves whether a rest change can move geometry."""
    totals: dict[str, float] = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        names = {group.index: group.name for group in obj.vertex_groups}
        for vert in obj.data.vertices:
            for element in vert.groups:
                name = names.get(element.group)
                if name:
                    totals[name] = totals.get(name, 0.0) + float(element.weight)
    return {name: round(total, 4) for name, total in sorted(totals.items())}


def _jaw_mesh_extent(arm: bpy.types.Object) -> dict:
    """The vertices the Jaw bone actually owns — the geometry whose pivot moves."""
    group_name = "Jaw"
    total = 0
    influenced = 0
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        group = obj.vertex_groups.get(group_name)
        if group is None:
            continue
        total += len(obj.data.vertices)
        for vert in obj.data.vertices:
            weight = 0.0
            for element in vert.groups:
                if element.group == group.index:
                    weight = element.weight
                    break
            if weight <= 0.0:
                continue
            influenced += 1
            world = obj.matrix_world @ vert.co
            lo = Vector((min(lo.x, world.x), min(lo.y, world.y), min(lo.z, world.z)))
            hi = Vector((max(hi.x, world.x), max(hi.y, world.y), max(hi.z, world.z)))
    return {
        "vertices_scanned": total,
        "vertices_with_jaw_weight": influenced,
        "jaw_weight_extent_world": [_vec(lo), _vec(hi)] if influenced else None,
    }


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--json-out")
    args = parser.parse_args(argv)

    arm = _armature()
    report = {
        "blend": bpy.data.filepath,
        "armature": arm.name,
        "armature_world": [round(float(c), 4) for row in arm.matrix_world for c in row],
        "bones": _describe_bones(arm),
        "jaw_actions": _jaw_actions(arm),
        "stub_bone_actions": _body_actions(arm),
        "bone_weight_totals": _bone_weight_totals(),
        "jaw_mesh": _jaw_mesh_extent(arm),
        "action_count": len(bpy.data.actions),
        "actions": sorted(action.name for action in bpy.data.actions),
    }

    out = json.dumps(report, indent=2, sort_keys=True)
    if args.json_out:
        path = Path(args.json_out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(out + "\n")
        print(f"probe: wrote {path}")
    else:
        print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
