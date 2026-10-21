"""Build the canonical 92-bone, 2-mesh V2 master .blend from the shipped runtime GLB.

Usage (headless):
    blender --background --factory-startup \
        --python tools/blender/build_v2_master_blend.py -- \
        /tmp/wyvern-v2-master-import.glb models/source/wyvern-v2-master.blend

The input GLB must already be meshopt-decoded (tools/blender/decode_meshopt_glb.mjs).
Produces a clean single-scene project: WyvernRig (92 deform bones in the
"00 Deform" collection), WyvernBody_Rebuild + WyvernMembrane_ExportSafe, and the
18 canonical actions — no junk scenes or orphan datablocks.
"""

import json
import sys

import bpy

CANONICAL_CLIPS = [
    "attack", "attack2", "attackAir2", "bankLeft", "bankRight", "breath",
    "cruise", "death", "dive", "glide", "hover", "idle", "land", "rest",
    "scout", "speed", "takeoff", "walk",
]
EXPECTED_BONE_COUNT = 92


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 2:
        raise SystemExit("usage: build_v2_master_blend.py -- <decoded.glb> <out.blend>")
    src_glb, out_blend = argv

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src_glb)

    # Single clean scene.
    scene = bpy.context.scene
    scene.name = "Scene"
    for other in list(bpy.data.scenes):
        if other != scene:
            bpy.data.scenes.remove(other)

    armature = bpy.data.objects.get("WyvernRig")
    if armature is None or armature.type != "ARMATURE":
        raise SystemExit("Imported GLB has no WyvernRig armature")

    # Only the two canonical skinned meshes ship in the V2 runtime asset.
    keep_meshes = {"WyvernBody_Rebuild", "WyvernMembrane_ExportSafe"}
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.name not in keep_meshes:
            bpy.data.objects.remove(obj, do_unlink=True)

    bones = armature.data.bones
    if len(bones) != EXPECTED_BONE_COUNT:
        raise SystemExit(f"Expected {EXPECTED_BONE_COUNT} bones, got {len(bones)}")

    # All 92 canonical bones export as joints: deform flags on, one collection.
    deform_collection = None
    for collection in armature.data.collections:
        if collection.name == "00 Deform":
            deform_collection = collection
    if deform_collection is None:
        deform_collection = armature.data.collections.new("00 Deform")
    for bone in bones:
        bone.use_deform = True
        for collection in list(bone.collections):
            if collection.name != deform_collection.name:
                collection.unassign(bone)
        if deform_collection.name not in bone.collections:
            deform_collection.assign(bone)

    # Rename imported actions to canonical clip names when the importer suffixed them.
    clip_names = {action.name.split(".")[0] for action in bpy.data.actions}
    missing = [c for c in CANONICAL_CLIPS if c not in {a.name for a in bpy.data.actions}]
    for action in list(bpy.data.actions):
        base = action.name.split(".")[0]
        if base in CANONICAL_CLIPS and base not in {a.name for a in bpy.data.actions if a != action}:
            action.name = base
    missing = [c for c in CANONICAL_CLIPS if c not in {a.name for a in bpy.data.actions}]
    if missing:
        raise SystemExit(f"Missing canonical actions after import: {missing}")

    # Purge orphan datablocks and junk repeatedly until clean.
    for _ in range(4):
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

    bpy.ops.wm.save_as_mainfile(filepath=out_blend)

    report = {
        "blend": out_blend,
        "scene": scene.name,
        "scenes": len(bpy.data.scenes),
        "bones": len(bones),
        "deform_bones": sum(1 for b in bones if b.use_deform),
        "actions": sorted(a.name for a in bpy.data.actions),
        "meshes": sorted(o.name for o in bpy.data.objects if o.type == "MESH"),
    }
    print(json.dumps(report, indent=2, sort_keys=True))


main()
