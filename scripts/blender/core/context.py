"""Headless Blender context managers and object resolution utilities."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Generator, Optional


@contextmanager
def safe_mode(bpy: Any, obj: Any, target_mode: str = "OBJECT") -> Generator[None, None, None]:
    """Temporarily switch object mode and restore the previous mode on exit."""
    prev_mode = obj.mode if hasattr(obj, "mode") else "OBJECT"
    prev_active = bpy.context.view_layer.objects.active
    try:
        bpy.context.view_layer.objects.active = obj
        if prev_mode != target_mode:
            bpy.ops.object.mode_set(mode=target_mode)
        yield
    finally:
        try:
            if hasattr(obj, "mode") and obj.mode != prev_mode:
                bpy.ops.object.mode_set(mode=prev_mode)
            if prev_active:
                bpy.context.view_layer.objects.active = prev_active
        except Exception:
            pass


def get_armature_and_mesh(bpy: Any, armature_name: str = "WyvernRig") -> tuple[Any, Any]:
    """Resolve the main armature and its associated skinned mesh."""
    scene = bpy.context.scene
    armature = bpy.data.objects.get(armature_name)
    if not armature or armature.type != "ARMATURE":
        # Search objects in scene
        for obj in scene.objects:
            if obj.type == "ARMATURE" and (obj.name == armature_name or "Root" in obj.data.bones):
                armature = obj
                break

    if not armature:
        raise ValueError(f"Armature {armature_name!r} not found in scene")

    mesh = None
    for obj in scene.objects:
        if obj.type == "MESH" and (obj.parent == armature or any(m.type == "ARMATURE" and m.object == armature for m in obj.modifiers)):
            mesh = obj
            break

    if not mesh:
        raise ValueError(f"No skinned mesh found for armature {armature.name}")

    return armature, mesh
