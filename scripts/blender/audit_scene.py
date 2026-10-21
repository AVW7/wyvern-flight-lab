"""Read-only structural audit for a Gothic V2 Blender file.

Run with:
  blender --background review.blend --python scripts/blender/audit_scene.py -- \
    --json-out /tmp/wyvern-rig-audit.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from contract import CONTRACT_PATH, bone_parent_map, iter_action_fcurves, load_contract, sha256_file


BONE_PATH = re.compile(r'pose\.bones\["([^"]+)"\]')


def _deform_bones(armature_data: Any) -> list[Any]:
    return [bone for bone in armature_data.bones if getattr(bone, "use_deform", True)]


def _control_bones(armature_data: Any) -> list[Any]:
    return [bone for bone in armature_data.bones if not getattr(bone, "use_deform", True)]


def resolve_armature(objects: list[Any], contract: dict[str, Any]) -> tuple[Any | None, list[str]]:
    expected = {bone["name"]: bone["parent"] for bone in contract["bones"]}
    candidates: list[tuple[Any, int, list[str]]] = []
    for obj in objects:
        if obj.type != "ARMATURE":
            continue
        actual = bone_parent_map(_deform_bones(obj.data))
        missing = sorted(set(expected) - set(actual))
        mismatched = sorted(name for name in expected if name in actual and expected[name] != actual[name])
        score = len(expected) - len(missing) - len(mismatched)
        if not missing and not mismatched:
            candidates.append((obj, score, mismatched))
    if not candidates:
        return None, ["no armature matches every contracted bone and parent"]
    exact_name = contract["asset"].get("armatureNodeName")
    named = [item for item in candidates if item[0].name == exact_name]
    choices = named or candidates
    if len(choices) != 1:
        return None, ["ambiguous matching armatures: " + ", ".join(x[0].name for x in choices)]
    return choices[0][0], []


def action_summary(action: Any, slot_identifier: str | None = None) -> dict[str, Any]:
    keyed: dict[str, int] = {}
    paths: set[str] = set()
    for curve in iter_action_fcurves(action, slot_identifier):
        match = BONE_PATH.search(curve.data_path)
        if not match:
            continue
        name = match.group(1)
        count = len(curve.keyframe_points)
        keyed[name] = max(keyed.get(name, 0), count)
        paths.add(curve.data_path.rsplit(".", 1)[-1])
    return {
        "name": action.name,
        "frame_range": [round(x, 4) for x in action.frame_range],
        "animated_bones": sorted(name for name, count in keyed.items() if count > 2),
        "animated_bone_count": sum(count > 2 for count in keyed.values()),
        "curve_property_types": sorted(paths),
        "slot": slot_identifier,
        "available_slots": [slot.identifier for slot in action.slots] if hasattr(action, "slots") else [],
    }


def slot_for_armature(action: Any, armature: Any) -> str | None:
    slots = list(getattr(action, "slots", []))
    if not slots:
        return None
    exact = [slot.identifier for slot in slots if slot.identifier == f"OB{armature.name}"]
    if len(exact) == 1:
        return exact[0]
    return slots[0].identifier if len(slots) == 1 else None


def mesh_summary(obj: Any) -> dict[str, Any]:
    groups = {group.index: group.name for group in obj.vertex_groups}
    skinned = [modifier for modifier in obj.modifiers if modifier.type == "ARMATURE"]
    unweighted = 0
    max_influences = 0
    unnormalized = 0
    weighted_groups: set[str] = set()
    for vertex in obj.data.vertices:
        entries = [(g.group, g.weight) for g in vertex.groups if g.weight > 1e-7]
        if not entries:
            unweighted += 1
            continue
        max_influences = max(max_influences, len(entries))
        if abs(sum(weight for _, weight in entries) - 1.0) > 1e-4:
            unnormalized += 1
        weighted_groups.update(groups[index] for index, _ in entries if index in groups)
    return {
        "name": obj.name,
        "vertices": len(obj.data.vertices),
        "vertex_groups": len(obj.vertex_groups),
        "unweighted_vertices": unweighted,
        "unnormalized_weight_vertices": unnormalized,
        "max_influences": max_influences,
        "weighted_group_count": len(weighted_groups),
        "armature_modifiers": [modifier.object.name if modifier.object else None for modifier in skinned],
    }


def build_report(bpy: Any, contract: dict[str, Any], source_glb: Path | None = None) -> dict[str, Any]:
    scene = bpy.context.scene
    armature, errors = resolve_armature(list(scene.objects), contract)
    expected_parent = {bone["name"]: bone["parent"] for bone in contract["bones"]}
    bone_report: dict[str, Any] = {"expected_count": len(expected_parent), "matched": armature is not None}
    actions = []
    if armature:
        actual_parent = bone_parent_map(_deform_bones(armature.data))
        control_bones = sorted(bone.name for bone in _control_bones(armature.data))
        bone_report.update({
            "object": armature.name,
            "actual_count": len(actual_parent),
            "control_bone_count": len(control_bones),
            "control_bones": control_bones,
            "missing": sorted(set(expected_parent) - set(actual_parent)),
            "extra": sorted(set(actual_parent) - set(expected_parent)),
            "parent_mismatches": sorted(
                (
                    {"bone": name, "expected": parent, "actual": actual_parent.get(name)}
                    for name, parent in expected_parent.items()
                    if name in actual_parent and parent != actual_parent[name]
                ),
                key=lambda row: row["bone"],
            ),
            "bone_collections": sorted(collection.name for collection in armature.data.collections)
            if hasattr(armature.data, "collections") else [],
        })
        actions = [action_summary(action, slot_for_armature(action, armature)) for action in bpy.data.actions]
    active_action = None
    if armature and armature.animation_data and armature.animation_data.action:
        active_action = action_summary(
            armature.animation_data.action,
            armature.animation_data.action_slot.identifier
            if armature.animation_data.action_slot else slot_for_armature(armature.animation_data.action, armature),
        )
    meshes = [mesh_summary(obj) for obj in scene.objects if obj.type == "MESH"]
    report = {
        "contract_version": contract["contractVersion"],
        "asset_contract": contract["asset"],
        "coordinate_frame": contract.get("coordinateFrame"),
        "blend_file": bpy.data.filepath,
        "blend_sha256": sha256_file(bpy.data.filepath) if bpy.data.filepath and Path(bpy.data.filepath).is_file() else None,
        "blender_version": bpy.app.version_string,
        "active_scene": scene.name,
        "active_frame": scene.frame_current,
        "scene_provenance": scene.get("review_provenance", "not recorded"),
        "scene_contract_id": scene.get("review_contract_id"),
        "scene_expected_source_sha256": scene.get("review_expected_asset_sha256"),
        "scene_count": len(bpy.data.scenes),
        "empty_scene_names": sorted(item.name for item in bpy.data.scenes if len(item.objects) == 0),
        "active_object": bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None,
        "active_scene_objects": [{"name": obj.name, "type": obj.type,
                                  "hide_viewport": obj.hide_viewport, "hide_render": obj.hide_render,
                                  "collections": sorted(collection.name for collection in obj.users_collection)}
                                 for obj in scene.objects],
        "cameras": sorted(obj.name for obj in scene.objects if obj.type == "CAMERA"),
        "armature": bone_report,
        "active_action": active_action,
        "meshes": meshes,
        "canonical_clips": contract["clips"],
        "actions": actions,
        "errors": errors,
        "warnings": [],
    }
    if source_glb:
        source_hash = sha256_file(source_glb)
        report["source_glb"] = {"path": str(source_glb), "sha256": source_hash,
                                "matches_contract": source_hash == contract["asset"]["sha256"]}
        if source_hash != contract["asset"]["sha256"]:
            report["warnings"].append("source GLB hash differs from the pinned contract")
    if not armature:
        report["errors"] = errors
    else:
        missing_clips = sorted(set(contract["clips"]) - {action.name for action in bpy.data.actions})
        if missing_clips:
            report["warnings"].append("canonical actions missing by exact name: " + ", ".join(missing_clips))
        multi_slot = [action.name for action in bpy.data.actions
                      if len(getattr(action, "slots", [])) > 1 and slot_for_armature(action, armature) is None]
        if multi_slot:
            report["warnings"].append("actions need explicit slot mapping for this armature: " + ", ".join(multi_slot))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=CONTRACT_PATH)
    parser.add_argument("--source-glb", type=Path, help="optional source asset to hash-check")
    parser.add_argument("--json-out", type=Path, help="write the JSON report here; stdout is the default")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    contract = load_contract(args.manifest)
    import bpy  # Blender-only dependency stays behind the command entry point.
    report = build_report(bpy, contract, args.source_glb)
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.json_out:
        if bpy.data.filepath and args.json_out.resolve() == Path(bpy.data.filepath).resolve():
            raise SystemExit("refusing to overwrite the open .blend with an audit report")
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(encoded)
    else:
        print(encoded, end="")
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
