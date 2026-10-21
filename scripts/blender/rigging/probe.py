"""Kinematic bone axis probe against evaluated mesh surface.

Measures the exact spatial displacement of skinned vertices when a bone is nudged.
Provides machine-readable JSON telemetry so LLMs and developers know the real
physical axis of a bone without visual guesswork.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Sequence


def _weighted_positions(bpy: Any, mesh: Any, group_index: int) -> tuple[List[Any], List[float]]:
    """Extract evaluated world-space vertex positions and vertex weights for a group."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh.evaluated_get(depsgraph)
    matrix_world = evaluated.matrix_world

    positions: List[Any] = []
    weights: List[float] = []

    for source_vertex, vertex in zip(mesh.data.vertices, evaluated.data.vertices):
        weight = next(
            (g.weight for g in source_vertex.groups if g.group == group_index),
            0.0,
        )
        if weight > 1e-6:
            positions.append(matrix_world @ vertex.co)
            weights.append(weight)

    return positions, weights


def _centroid(positions: Sequence[Any], weights: Sequence[float]) -> Any:
    """Compute the weighted center of mass for a set of positions."""
    from mathutils import Vector

    total_weight = sum(weights)
    if total_weight <= 0.0:
        return Vector((0.0, 0.0, 0.0))
    weighted_sum = sum((pos * w for pos, w in zip(positions, weights)), Vector((0.0, 0.0, 0.0)))
    return weighted_sum / total_weight


def probe_bone_axes(
    bpy: Any,
    armature: Any,
    mesh: Any,
    bone_names: Sequence[str],
    action_name: str | None = None,
    frame: int = 0,
    nudge_radians: float = 0.1,
) -> Dict[str, Any]:
    """Nudge each bone along local X, Y, Z and measure evaluated mesh displacement."""
    from mathutils import Matrix

    scene = bpy.context.scene

    if action_name and action_name in bpy.data.actions:
        action = bpy.data.actions[action_name]
        if not armature.animation_data:
            armature.animation_data_create()
        armature.animation_data.action = action
        if hasattr(action, "slots") and len(action.slots) > 0:
            armature.animation_data.action_slot = action.slots[0]

    scene.frame_set(frame)
    bpy.context.view_layer.update()

    report: Dict[str, Any] = {
        "action": action_name,
        "frame": frame,
        "nudge_radians": nudge_radians,
        "bones": {},
    }

    for bone_name in bone_names:
        group = mesh.vertex_groups.get(bone_name)
        if group is None:
            report["bones"][bone_name] = {
                "error": f"No vertex group named {bone_name!r} on mesh {mesh.name}"
            }
            continue

        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone is None:
            report["bones"][bone_name] = {
                "error": f"No pose bone named {bone_name!r} on armature {armature.name}"
            }
            continue

        base_basis = pose_bone.matrix_basis.copy()
        base_positions, weights = _weighted_positions(bpy, mesh, group.index)

        if not weights:
            report["bones"][bone_name] = {
                "weighted_vertex_count": 0,
                "warning": "Vertex group exists but has no weighted vertices",
            }
            continue

        base_center = _centroid(base_positions, weights)
        axes_data: Dict[str, Any] = {}

        for axis in ("X", "Y", "Z"):
            pose_bone.matrix_basis = base_basis @ Matrix.Rotation(nudge_radians, 4, axis)
            bpy.context.view_layer.update()

            nudged_positions, _ = _weighted_positions(bpy, mesh, group.index)
            delta = _centroid(nudged_positions, weights) - base_center
            max_displacement = max(
                (p - init).length for p, init in zip(nudged_positions, base_positions)
            )

            axes_data[axis] = {
                "weighted_centroid_delta": [round(float(v), 4) for v in delta],
                "max_vertex_displacement": round(float(max_displacement), 4),
            }

        # Restore original basis
        pose_bone.matrix_basis = base_basis
        bpy.context.view_layer.update()

        report["bones"][bone_name] = {
            "weighted_vertex_count": len(weights),
            "axes": axes_data,
        }

    return report
