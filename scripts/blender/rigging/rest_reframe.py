"""Re-frame a bone's rest orientation without moving the animation.

When a bone's rest matrix changes from `R_old` to `R_new`, every keyed channel on
that bone changes meaning, because the animated pose is

    pose = R · basis

so preserving the pose requires `basis_new = R_new⁻¹ · R_old · basis_old`.

Two properties make this safe to apply to authored curves rather than re-baking
them:

* **Quaternion product is linear in the right operand**, so `q -> c ⊗ q` is a
  plain `4×4` matrix over the components. It can therefore be applied to each
  key's value *and* both Bézier handles, which preserves the interpolated curve
  exactly instead of only the keyed frames.
* **The exported local rotation is preserved.** A glTF animation channel carries
  `(R_parent⁻¹ · R_bone) ⊗ basis`, and that product is unchanged by the
  compensation — which is the guarantee that matters, because it is the value the
  runtime actually replays.

**What is *not* invariant: the basis itself.** `basis_new = C · basis_old`, so a
detector that measures relative to *bind* sees a constant `C` offset, because
bind is the rest rotation and the rest is what moved. For the C6 jaw that offset
is `2.09°` — but its Euler-`YXZ` **pitch** component is `0.02°`, because the
correction is almost entirely yaw and roll. `poseEnvelope`'s `open_jaw` detector
reads pitch against a `2.0°` threshold, so it is unaffected. Worth knowing before
re-framing a bone whose correction *is* mostly pitch.

Deliberately bpy-free so it can be unit-tested outside Blender. Quaternions are
plain `(w, x, y, z)` tuples throughout.

Measured trap this module exists to avoid: `2·acos(|q0·q1|)` is ill-conditioned
near identity. Storing quaternions to 6 decimals makes two *identical*
orientations read as a `0.15°` difference, and makes a `0.05°` rotation read as
`0°` (because `cos(θ/2)` rounds to `1.0`). `angle_deg()` builds the relative
quaternion instead and takes `2·atan2(|v|, w)`, which stays exact where the naive
form does not.
"""

from __future__ import annotations

import math
from typing import Sequence

Quat = Sequence[float]

IDENTITY: tuple[float, float, float, float] = (1.0, 0.0, 0.0, 0.0)


def product(a: Quat, b: Quat) -> tuple[float, float, float, float]:
    """Hamilton product `a ⊗ b` for `(w, x, y, z)` quaternions."""
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    )


def conjugate(q: Quat) -> tuple[float, float, float, float]:
    w, x, y, z = q
    return (w, -x, -y, -z)


def normalize(q: Quat) -> tuple[float, float, float, float]:
    w, x, y, z = q
    length = math.sqrt(w * w + x * x + y * y + z * z)
    if length == 0.0:
        return IDENTITY
    return (w / length, x / length, y / length, z / length)


def left_multiply_matrix(c: Quat) -> list[list[float]]:
    """`q -> c ⊗ q` as a `4×4` matrix over `(w, x, y, z)`.

    Row `i` of the result is the coefficient of component `i` in `c ⊗ q`, which is
    linear in `q` — that linearity is what lets the same map be applied to Bézier
    handles.
    """
    w, x, y, z = c
    return [
        [w, -x, -y, -z],
        [x, w, -z, y],
        [y, z, w, -x],
        [z, -y, x, w],
    ]


def apply(matrix: list[list[float]], values: Sequence[float]) -> list[float]:
    return [sum(matrix[r][c] * values[c] for c in range(4)) for r in range(4)]


def compensation(old_rest: Quat, new_rest: Quat) -> tuple[float, float, float, float]:
    """`C = R_new⁻¹ · R_old`, the left multiplier that preserves the pose."""
    return normalize(product(conjugate(normalize(new_rest)), normalize(old_rest)))


def angle_deg(a: Quat, b: Quat) -> float:
    """Angle between two orientations, stable near identity."""
    aw, ax, ay, az = normalize(a)
    bw, bx, by, bz = normalize(b)
    # Relative rotation a⁻¹ ⊗ b, computed from products so nothing cancels to 1.
    rw = aw * bw + ax * bx + ay * by + az * bz
    rx = aw * bx - ax * bw - ay * bz + az * by
    ry = aw * by + ax * bz - ay * bw - az * bx
    rz = aw * bz - ax * by + ay * bx - az * bw
    if rw < 0.0:  # q and -q are the same rotation
        rw, rx, ry, rz = -rw, -rx, -ry, -rz
    return math.degrees(2.0 * math.atan2(math.sqrt(rx * rx + ry * ry + rz * rz), rw))
