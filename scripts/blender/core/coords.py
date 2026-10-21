"""Coordinate frame conventions and spatial mirror mathematics.

Wyvern V2 measured axes:
  Forward: -Y
  Up:      +Z
  Left:    +X
"""

from __future__ import annotations

import math
from typing import Sequence, Tuple


FORWARD = "-Y"
UP = "+Z"
LEFT = "+X"


def swap_side(name: str) -> str:
    """Swap left and right side prefix or token in bone / object names."""
    if name.startswith("L_"):
        return "R_" + name[2:]
    if name.startswith("R_"):
        return "L_" + name[2:]
    if name.endswith(".L"):
        return name[:-2] + ".R"
    if name.endswith(".R"):
        return name[:-2] + ".L"
    if "-L-" in name:
        return name.replace("-L-", "-R-", 1)
    if "-R-" in name:
        return name.replace("-R-", "-L-", 1)
    return name


def mirror_wing_euler_degrees(rx: float, ry: float, rz: float) -> Tuple[float, float, float]:
    """Mirror wing Euler angles (degrees) across the sagittal plane.

    On the Gothic V2 rig:
      - Local +X raises BOTH wings (symmetric, shared sign).
      - Local +Z sweeps wings in opposite directions (antisymmetric, negated sign).
      - Local +Y rolls wings in opposite directions (antisymmetric, negated sign).
    """
    return (rx, -ry, -rz)


def mirror_wing_euler_radians(rx: float, ry: float, rz: float) -> Tuple[float, float, float]:
    """Mirror wing Euler angles (radians) across the sagittal plane."""
    return (rx, -ry, -rz)


def mirror_quaternion_x_plane(w: float, x: float, y: float, z: float) -> Tuple[float, float, float, float]:
    """Reflect a rotation quaternion across the sagittal X=0 plane (S @ M @ S).

    For reflection matrix S = diag(-1, 1, 1), the conjugate transformation S * R * S
    preserves rotation sense while reflecting spatial axes:
    q' = (w, x, -y, -z).
    """
    return (w, x, -y, -z)
