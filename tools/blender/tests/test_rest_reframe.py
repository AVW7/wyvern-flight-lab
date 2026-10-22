"""Unit tests for the rest re-frame maths (Task C6).

`tools/blender/fix_c6_jaw_pivot_and_stub_bones.py` rewrites authored curves with
this maths, and a wrong sign or a transposed map would silently re-pose all 18
clips. These tests pin the three properties the fix relies on:

1. `q -> c ⊗ q` really is the quaternion product (the matrix form is not a
   re-derivation that happens to look right).
2. The compensation preserves the animated pose for *arbitrary* rest changes.
3. The map is linear, so applying it to keys and handles preserves the
   interpolated curve, not just the keyed frames.

Plus a regression test for the measurement bug that cost a debugging session:
`2·acos(dot)` reads two identical orientations as `0.15°` once the components are
rounded to 6 decimals, which made a perfect compensation look broken.
"""

from __future__ import annotations

import math
from pathlib import Path
import random
import sys
import unittest

PKG = Path(__file__).resolve().parents[3] / "scripts/blender"
if str(PKG) not in sys.path:
    sys.path.insert(0, str(PKG))

from rigging import rest_reframe as rr


def _random_quat(rng: random.Random) -> tuple[float, float, float, float]:
    return rr.normalize((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))


class QuaternionProductTests(unittest.TestCase):
    def test_matrix_form_matches_the_explicit_product(self):
        rng = random.Random(20261022)
        for _ in range(200):
            c = _random_quat(rng)
            q = _random_quat(rng)
            matrix = rr.left_multiply_matrix(c)
            self.assertEqual(
                [round(v, 12) for v in rr.apply(matrix, q)],
                [round(v, 12) for v in rr.product(c, q)],
                "the 4x4 map is not the quaternion product",
            )

    def test_identity_compensation_is_a_no_op(self):
        q = (0.3, -0.4, 0.5, 0.7)
        c = rr.compensation(q, q)
        self.assertAlmostEqual(rr.angle_deg(c, rr.IDENTITY), 0.0, places=9)

    def test_compensation_preserves_the_pose(self):
        """`R_new ⊗ C ⊗ basis == R_old ⊗ basis` for arbitrary rest changes."""
        rng = random.Random(7)
        for _ in range(200):
            old_rest = _random_quat(rng)
            new_rest = _random_quat(rng)
            basis = _random_quat(rng)

            c = rr.compensation(old_rest, new_rest)
            posed_new = rr.product(rr.product(new_rest, c), basis)
            posed_old = rr.product(old_rest, basis)
            self.assertAlmostEqual(
                rr.angle_deg(posed_new, posed_old),
                0.0,
                places=6,
                msg="the compensation moved the animated pose",
            )

    def test_exported_local_rotation_is_preserved(self):
        """The glTF channel carries `(R_parent⁻¹ · R_bone) ⊗ basis`; that is the
        value the runtime replays, and it must not move."""
        rng = random.Random(11)
        for _ in range(200):
            parent = _random_quat(rng)
            old_rest = _random_quat(rng)
            new_rest = _random_quat(rng)
            basis = _random_quat(rng)
            c = rr.compensation(old_rest, new_rest)

            local_old = rr.product(rr.product(rr.conjugate(parent), old_rest), basis)
            local_new = rr.product(
                rr.product(rr.conjugate(parent), new_rest), rr.product(c, basis)
            )
            self.assertAlmostEqual(rr.angle_deg(local_new, local_old), 0.0, places=6)

    def test_basis_shifts_by_exactly_the_compensation(self):
        """Documented consequence: the basis is *not* invariant, so a bind-relative
        detector sees a constant `C` offset. Pinned so nobody "fixes" it later."""
        rng = random.Random(13)
        for _ in range(100):
            old_rest = _random_quat(rng)
            new_rest = _random_quat(rng)
            basis = _random_quat(rng)
            c = rr.compensation(old_rest, new_rest)
            shifted = rr.product(c, basis)
            self.assertAlmostEqual(rr.angle_deg(shifted, basis), rr.angle_deg(c, rr.IDENTITY), places=6)


class LinearityTests(unittest.TestCase):
    def test_map_commutes_with_component_interpolation(self):
        """Transforming keys commutes with linear interpolation, so the curve
        between two keys is preserved and not just the keys themselves."""
        rng = random.Random(99)
        c = _random_quat(rng)
        a = _random_quat(rng)
        b = _random_quat(rng)
        matrix = rr.left_multiply_matrix(c)

        for t in (0.0, 0.137, 0.5, 0.873, 1.0):
            interpolated = [(1 - t) * a[i] + t * b[i] for i in range(4)]
            transformed_then_interpolated = rr.apply(matrix, interpolated)
            interpolated_then_transformed = [
                (1 - t) * rr.apply(matrix, a)[i] + t * rr.apply(matrix, b)[i] for i in range(4)
            ]
            for left, right in zip(transformed_then_interpolated, interpolated_then_transformed):
                self.assertAlmostEqual(left, right, places=12)


class StableAngleTests(unittest.TestCase):
    def test_six_decimal_storage_does_not_inflate_the_angle(self):
        """Regression: the audit compared quaternions stored to 6 decimals and read
        a 0.15° difference for a pose that had not moved at all.

        Rounding genuinely moves the rotation by ~8e-5°, so the assertion is that
        the stable form reports *that* and not `0.15°`.
        """
        q = rr.normalize((0.0381335, 0.9992727, 5e-7, 0.0))
        stored = tuple(round(v, 6) for v in q)
        self.assertLess(rr.angle_deg(q, stored), 1e-3)

    def test_small_rotations_survive_6dp_storage(self):
        """`cos(θ/2)` rounds to `1.0` long before θ gets small, so the naive form
        reports a 0.05° rotation as exactly zero."""
        theta = 0.05
        half = math.radians(theta / 2.0)
        q = (math.cos(half), math.sin(half), 0.0, 0.0)
        stored = tuple(round(v, 6) for v in q)

        self.assertAlmostEqual(rr.angle_deg(rr.IDENTITY, stored), theta, places=3)

        naive_dot = abs(sum(rr.IDENTITY[i] * stored[i] for i in range(4)))
        naive = math.degrees(2.0 * math.acos(min(1.0, naive_dot)))
        self.assertLess(naive, 0.01, "the naive form was expected to collapse to zero here")

    def test_quarter_turn_is_ninety_degrees(self):
        half = math.radians(45.0)
        quarter = (math.cos(half), math.sin(half), 0.0, 0.0)
        self.assertAlmostEqual(rr.angle_deg(rr.IDENTITY, quarter), 90.0, places=9)

    def test_angle_is_symmetric_and_sign_insensitive(self):
        q = rr.normalize((0.2, -0.5, 0.8, 0.1))
        self.assertAlmostEqual(rr.angle_deg(q, rr.IDENTITY), rr.angle_deg(rr.IDENTITY, q), places=12)
        negated = tuple(-v for v in q)
        self.assertAlmostEqual(rr.angle_deg(q, negated), 0.0, places=9)


if __name__ == "__main__":
    unittest.main()
