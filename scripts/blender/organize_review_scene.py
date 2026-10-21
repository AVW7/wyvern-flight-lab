"""Organize a review scene into role collections without touching bones/actions.

Run only on a saved review file and always write a separate output copy:
  blender --background review.blend --python scripts/blender/organize_review_scene.py -- \
    --out /path/to/review-organized.blend
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from contract import CONTRACT_PATH, load_contract
from audit_scene import resolve_armature


COLLECTIONS = {
    "ARMATURE": ("AUDIT | 00 Rig", "rig"),
    "MESH": ("AUDIT | 10 Geometry", "geometry"),
    "CAMERA": ("AUDIT | 20 Cameras", "camera"),
    "LIGHT": ("AUDIT | 30 Lights", "light"),
}
HELPERS = ("AUDIT | 90 Helpers", "helper")


def _scene_collections(scene: Any) -> set[Any]:
    found: set[Any] = set()
    pending = [scene.collection]
    while pending:
        collection = pending.pop()
        if collection in found:
            continue
        found.add(collection)
        pending.extend(collection.children)
    return found


def organize_scene(scene: Any, bpy: Any, contract: dict[str, Any]) -> dict[str, Any]:
    """Move scene-local objects by type; shared-scene objects are reported and skipped."""
    armature, errors = resolve_armature(list(scene.objects), contract)
    if armature is None:
        raise ValueError("refusing to organize a scene without a contract-matched rig: " + "; ".join(errors))
    scene_collections = _scene_collections(scene)
    destinations: dict[str, Any] = {}
    for object_type, (name, _role) in COLLECTIONS.items():
        collection = bpy.data.collections.get(name) or bpy.data.collections.new(name)
        if collection.name not in scene.collection.children:
            scene.collection.children.link(collection)
        destinations[object_type] = collection
    helper_collection = bpy.data.collections.get(HELPERS[0]) or bpy.data.collections.new(HELPERS[0])
    if helper_collection.name not in scene.collection.children:
        scene.collection.children.link(helper_collection)

    moved = []
    skipped_shared = []
    for obj in list(scene.objects):
        object_scenes = [other.name for other in bpy.data.scenes if other != scene and obj.name in other.objects]
        if object_scenes:
            skipped_shared.append({"object": obj.name, "other_scenes": object_scenes})
            continue
        destination = destinations.get(obj.type, helper_collection)
        role = COLLECTIONS.get(obj.type, HELPERS)[1]
        for collection in list(obj.users_collection):
            if collection in scene_collections and collection != destination:
                collection.objects.unlink(obj)
        if obj.name not in destination.objects:
            destination.objects.link(obj)
        obj["review_role"] = role
        moved.append({"object": obj.name, "type": obj.type, "collection": destination.name, "role": role})

    scene["review_contract_id"] = contract["asset"]["id"]
    scene["review_expected_asset_sha256"] = contract["asset"]["sha256"]
    scene["review_provenance"] = "unverified; compare loaded source hash before export"
    return {"scene": scene.name, "moved": moved, "skipped_shared": skipped_shared,
            "collections": sorted(collection.name for collection in [*destinations.values(), helper_collection])}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=CONTRACT_PATH)
    parser.add_argument("--out", required=True, type=Path, help="new .blend path; may not equal the input")
    parser.add_argument("--dry-run", action="store_true", help="report the proposed grouping without saving")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    contract = load_contract(args.manifest)
    import bpy
    source = Path(bpy.data.filepath).resolve() if bpy.data.filepath else None
    target = args.out.resolve()
    if source is None:
        raise SystemExit("save the source .blend before organizing it")
    if source == target:
        raise SystemExit("refusing to overwrite the source .blend; choose a separate --out path")
    if target.exists():
        raise SystemExit(f"output already exists; choose another path: {target}")
    scene = bpy.context.scene
    if args.dry_run:
        plan = [{"object": obj.name, "type": obj.type,
                 "collection": COLLECTIONS.get(obj.type, HELPERS)[0]}
                for obj in scene.objects]
        print(json.dumps({"scene": scene.name, "source": str(source), "would_move": plan}, indent=2))
        return 0
    result = organize_scene(scene, bpy, contract)
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(target))
    print(json.dumps({**result, "source": str(source), "saved_copy": str(target)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
