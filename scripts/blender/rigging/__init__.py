"""Rigging and skeletal inspection utilities for Wyvern armatures."""

from .control_rig import (
    CANONICAL_CONTACT_PLANE_Z,
    CONTROL_BONE_NAMES,
    CONTROL_BONE_SPECS,
    CONTROL_COLLECTION_NAME,
    DEFORM_COLLECTION_NAME,
    WING_FOLD_RATIOS,
    bake_control_rig_to_deform,
    build_control_rig,
    compute_canonical_contact_plane,
)
from .probe import probe_bone_axes

__all__ = [
    "CANONICAL_CONTACT_PLANE_Z",
    "CONTROL_BONE_NAMES",
    "CONTROL_BONE_SPECS",
    "CONTROL_COLLECTION_NAME",
    "DEFORM_COLLECTION_NAME",
    "WING_FOLD_RATIOS",
    "bake_control_rig_to_deform",
    "build_control_rig",
    "compute_canonical_contact_plane",
    "probe_bone_axes",
]
