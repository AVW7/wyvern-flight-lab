"""Standardized glTF / GLB exporter for Wyvern assets.

Enforces game-ready export flags, material alpha sanitization,
control-rig visual baking onto the 92 canonical deform bones,
and strict selection isolation so helper objects and lights are never exported.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Sequence

from rigging.control_rig import bake_control_rig_to_deform


def sanitize_materials(bpy: Any) -> None:
    """Ensure materials are opaque and free of invalid alpha connections."""
    for mat in bpy.data.materials:
        if hasattr(mat, "blend_method"):
            mat.blend_method = "OPAQUE"
        if hasattr(mat, "shadow_method"):
            mat.shadow_method = "OPAQUE"
        if getattr(mat, "use_nodes", False) and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    for inp in node.inputs:
                        if inp.name == "Alpha":
                            for link in list(inp.links):
                                mat.node_tree.links.remove(link)
                            inp.default_value = 1.0


def export_wyvern_glb(
    bpy: Any,
    output_path: str | Path,
    export_objects: Sequence[str] | None = None,
    bake_control_rig: bool = True,
) -> Path:
    """Export the designated rig and mesh to GLB with strict game engine settings."""
    sanitize_materials(bpy)

    if export_objects is None:
        # The V2 runtime rig is a two-mesh asset; fall back to the legacy
        # single-mesh layout only when the separated meshes are absent.
        if bpy.data.objects.get("WyvernBody_Rebuild") and bpy.data.objects.get("WyvernMembrane_ExportSafe"):
            export_objects = ("WyvernRig", "WyvernBody_Rebuild", "WyvernMembrane_ExportSafe")
        else:
            export_objects = ("WyvernRig", "WyvernMesh")

    scene = bpy.context.scene
    for obj in scene.objects:
        obj.select_set(False)

    target_objects = []
    for name in export_objects:
        obj = bpy.data.objects.get(name)
        if obj and obj.name in scene.objects:
            obj.select_set(True)
            target_objects.append(obj)

    if not target_objects:
        raise ValueError(f"None of the requested export objects exist in scene: {export_objects}")

    armature = next((o for o in target_objects if o.type == "ARMATURE"), None)
    if armature is not None and bake_control_rig:
        bake_control_rig_to_deform(bpy, armature, strip_controls=True)

    for obj in scene.objects:
        obj.select_set(obj in target_objects)
    bpy.context.view_layer.objects.active = armature or target_objects[0]

    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.export_scene.gltf(
        filepath=str(out_file),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        # bake_control_rig_to_deform already strips the control bones; requiring
        # vertex weights would silently drop unweighted deform bones (Root,
        # RootMotion, WingPanel roots) and inject a neutral_bone joint.
        export_def_bones=False,
        export_apply=False,
        export_yup=True,
        export_optimize_animation_size=False,
    )

    return out_file
