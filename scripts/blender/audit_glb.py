"""Validate the source Gothic GLB contract without importing geometry into Blender."""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path
from typing import Any

from contract import CONTRACT_PATH, load_contract, sha256_file


GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A


def read_glb_json(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError("file is too short to be a GLB")
    magic, version, declared_length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError(f"expected glTF binary v2; got magic={magic:#x}, version={version}")
    if declared_length != len(data):
        raise ValueError(f"GLB length header says {declared_length}, actual length is {len(data)}")
    offset = 12
    gltf = None
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        end = offset + chunk_length
        if end > len(data):
            raise ValueError("GLB chunk extends past end of file")
        if chunk_type == JSON_CHUNK:
            if gltf is not None:
                raise ValueError("GLB contains more than one JSON chunk")
            gltf = json.loads(data[offset:end].decode("utf-8"))
        offset = end
    if offset != len(data) or gltf is None:
        raise ValueError("GLB chunks are malformed or the JSON chunk is missing")
    return gltf


def audit(path: Path, contract: dict[str, Any]) -> dict[str, Any]:
    gltf = read_glb_json(path)
    errors: list[str] = []
    warnings: list[str] = []
    asset = contract["asset"]
    digest = sha256_file(path)
    if digest != asset["sha256"]:
        errors.append("SHA-256 differs from the pinned source asset")

    nodes = gltf.get("nodes", [])
    parents: dict[int, int] = {}
    malformed_parenting = []
    for parent_index, node in enumerate(nodes):
        for child_index in node.get("children", []):
            if not isinstance(child_index, int) or child_index < 0 or child_index >= len(nodes):
                malformed_parenting.append({"parent": parent_index, "child": child_index, "reason": "out of range"})
            elif child_index in parents:
                malformed_parenting.append({"parent": parent_index, "child": child_index, "reason": "multiple parents"})
            else:
                parents[child_index] = parent_index
    if malformed_parenting:
        errors.append("node hierarchy contains invalid or multiply-parented children")

    skins = gltf.get("skins", [])
    if len(skins) != asset["skinCount"]:
        errors.append(f"skin count {len(skins)} does not match contract {asset['skinCount']}")
    bone_rows = []
    if len(skins) == 1:
        skin = skins[0]
        joint_indices = skin.get("joints", [])
        if len(joint_indices) != asset["jointCount"]:
            errors.append(f"joint count {len(joint_indices)} does not match contract {asset['jointCount']}")
        for index in joint_indices:
            if not isinstance(index, int) or index < 0 or index >= len(nodes):
                errors.append(f"skin joint node index out of range: {index!r}")
                continue
            name = nodes[index].get("name")
            parent_index = parents.get(index)
            parent_name = nodes[parent_index].get("name") if parent_index is not None else None
            if parent_index is not None and parent_index not in joint_indices:
                bone_rows.append({"name": name, "parent": None, "sceneParent": parent_name})
            else:
                bone_rows.append({"name": name, "parent": parent_name})
        expected_bones = contract["bones"]
        if bone_rows != expected_bones:
            errors.append("joint names/order/parents differ from the pinned contract")
        if skin.get("name") != asset["armatureNodeName"]:
            errors.append("skin name differs from the contracted armature node name")

    scene_roots = []
    for scene in gltf.get("scenes", []):
        scene_roots.extend(nodes[index].get("name") for index in scene.get("nodes", [])
                           if isinstance(index, int) and 0 <= index < len(nodes))
    if asset["armatureNodeName"] not in scene_roots:
        errors.append("contracted armature node is not a root of a glTF scene")

    animations = gltf.get("animations", [])
    names = [animation.get("name") for animation in animations]
    if sorted(names) != contract["clips"]:
        errors.append("animation names do not exactly match the canonical clip list")
    channel_counts: dict[str, int] = {}
    invalid_channels = []
    joint_index_set = set(skins[0].get("joints", [])) if skins else set()
    for animation in animations:
        name = animation.get("name", "<unnamed>")
        channels = animation.get("channels", [])
        channel_counts[name] = len(channels)
        for channel in channels:
            target = channel.get("target", {})
            node_index = target.get("node")
            if node_index not in joint_index_set:
                invalid_channels.append({"clip": name, "node": node_index, "path": target.get("path")})
    if invalid_channels:
        errors.append("animation channels target nodes outside the contracted skin")
    if channel_counts != contract.get("animationChannelCounts", channel_counts):
        errors.append("animation channel counts differ from the pinned contract")

    expected_meshes = contract.get("meshes", [])
    mesh_rows = []
    for mesh_index, mesh in enumerate(gltf.get("meshes", [])):
        vertex_count = 0
        triangle_count = 0
        secondary_joint_attributes = []
        for primitive in mesh.get("primitives", []):
            attributes = primitive.get("attributes", {})
            position_accessor = attributes.get("POSITION")
            if isinstance(position_accessor, int) and 0 <= position_accessor < len(gltf.get("accessors", [])):
                vertex_count += gltf["accessors"][position_accessor].get("count", 0)
            index_accessor = primitive.get("indices")
            if isinstance(index_accessor, int) and 0 <= index_accessor < len(gltf.get("accessors", [])):
                if primitive.get("mode", 4) == 4:
                    triangle_count += gltf["accessors"][index_accessor].get("count", 0) // 3
            secondary_joint_attributes.extend(key for key in attributes if key.startswith("JOINTS_") and key != "JOINTS_0")
        mesh_nodes = [{"name": node.get("name"), "skinIndex": node.get("skin")}
                      for node in nodes if node.get("mesh") == mesh_index]
        mesh_rows.append({"meshName": mesh.get("name"), "vertices": vertex_count,
                          "triangles": triangle_count, "primitiveCount": len(mesh.get("primitives", [])),
                          "nodes": mesh_nodes, "secondaryJointAttributes": sorted(set(secondary_joint_attributes))})
    comparable_mesh_rows = [
        {key: row[key] for key in expected if key in row}
        for row, expected in zip(mesh_rows, expected_meshes)
    ]
    if len(mesh_rows) != len(expected_meshes) or comparable_mesh_rows != expected_meshes:
        errors.append("mesh/node/skin/geometry metadata differs from the pinned contract")
    if any(row["secondaryJointAttributes"] for row in mesh_rows):
        errors.append("mesh uses secondary joint attributes beyond the first four influences")

    if gltf.get("extensionsUsed", []) != asset.get("extensionsUsed", []):
        warnings.append("GLB extension list differs from the pinned source contract")
    return {"path": str(path), "sha256": digest, "contract_asset_id": asset["id"],
            "joint_count": len(bone_rows), "skin_count": len(skins), "clip_count": len(animations),
            "clips": names, "mesh_objects": mesh_rows, "scene_roots": scene_roots,
            "warnings": warnings, "errors": errors, "passed": not errors}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("glb", type=Path)
    parser.add_argument("--manifest", type=Path, default=CONTRACT_PATH)
    parser.add_argument("--json-out", type=Path, help="optional JSON report output path")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    report = audit(args.glb, load_contract(args.manifest))
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.json_out:
        if args.json_out.resolve() == args.glb.resolve():
            raise SystemExit("refusing to overwrite the audited GLB")
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(encoded)
    else:
        print(encoded, end="")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
