"""Task C7, audit half — measure L/R edit-bone symmetry on the legacy V1-wing blend.

`models/source/wyvern-rig-v1wing.blend` is a legacy source (106 bones, 124 vertex groups)
kept for reference, not for export. Its right wing was never mirrored cleanly from the left:
doc 41 Task C7 records 14.9-22.5 deg of roll error and 9.1-16.4 rig units of length
mismatch on `R_WingD0..3P0`, plus `R_WingBatten061..066` whose tails point backwards
(roll +128.9..+132.5 deg). This script measures that state so the fix can be verified
against numbers rather than impressions, and so the same check can be re-run afterwards.

Mirror model: a bone mirrored across the YZ plane (X -> -X) should have
`head' = (-hx, hy, hz)`, `tail' = (-tx, ty, tz)` and `matrix' = S * matrix * S` with
`S = diag(-1, 1, 1, 1)`. The orientation error is the angle between the ideal and the
actual mirrored rotation; a perfect pair reads 0.

The battens do not pair by name — `L_WingBatten040..054` against `R_WingBatten055..069` —
so they are matched by nearest mirrored head position (measured 1:1 and sequential).

The helpers below are importable so `fix_c7_v1wing_symmetry.py` fixes exactly the pairs
this audit measures.

Usage:
    ~/.local/bin/blender --background models/source/wyvern-rig-v1wing.blend \
        --python tools/blender/audit_v1wing_symmetry.py -- --json-out <path>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

LIMIT_DEG = 0.01
LIMIT_UNITS = 0.01
# 4x4 so it multiplies `matrix_local` directly and transforms points affinely.
MIRROR = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))


def counterpart(name: str) -> str | None:
    if name.startswith("L_"):
        return "R_" + name[2:]
    if name.startswith("R_"):
        return "L_" + name[2:]
    return None


def mirrored(matrix: Matrix) -> Matrix:
    return MIRROR @ matrix @ MIRROR


def orientation_error_deg(ideal: Matrix, actual: Matrix) -> float:
    """Angle between two rotations, in degrees. Quaternion dot, not Euler subtraction."""
    q_ideal = ideal.to_quaternion()
    q_actual = actual.to_quaternion()
    if q_ideal.dot(q_actual) < 0:
        q_actual.negate()
    return q_ideal.rotation_difference(q_actual).angle * 180.0 / 3.141592653589793


def batten_map(bones) -> dict[str, str]:
    """L_WingBatten040..054 -> R_WingBatten055..069 by nearest mirrored head."""
    left = sorted((b for b in bones if b.name.startswith("L_WingBatten")), key=lambda b: b.name)
    right = sorted((b for b in bones if b.name.startswith("R_WingBatten")), key=lambda b: b.name)
    pairs, used = {}, set()
    for lb in left:
        target = MIRROR @ lb.head_local
        best, best_d = None, 1e18
        for rb in right:
            if rb.name in used:
                continue
            distance = (rb.head_local - target).length
            if distance < best_d:
                best, best_d = rb, distance
        if best is not None:
            pairs[lb.name] = best.name
            used.add(best.name)
    return pairs


def all_pairs(bones) -> list[tuple[str, str]]:
    """Every L/R pair the gate covers: name counterparts plus the batten mapping."""
    pairs, seen = [], set()
    for bone in bones:
        other = counterpart(bone.name)
        if other is None or other not in bones or bone.name in seen:
            continue
        seen.update((bone.name, other))
        left, right = (bone.name, other) if bone.name.startswith("L_") else (other, bone.name)
        pairs.append((left, right))
    for left, right in batten_map(bones).items():
        if (left, right) not in pairs:
            pairs.append((left, right))
    return sorted(pairs)


def measure_pair(bones, left_name: str, right_name: str) -> dict:
    left, right = bones[left_name], bones[right_name]
    ideal_right = mirrored(left.matrix_local)
    return {
        "left": left_name,
        "right": right_name,
        "lengthLeft": round(left.length, 4),
        "lengthRight": round(right.length, 4),
        "lengthDelta": round(abs(left.length - right.length), 4),
        "orientationErrorDeg": round(orientation_error_deg(ideal_right.to_3x3(), right.matrix_local.to_3x3()), 4),
        # A mirrored bone's head/tail is the point mirror of the original's, not the
        # original run through its own (rotated) matrix.
        "headDelta": round((right.head_local - MIRROR @ left.head_local).length, 4),
        "tailDelta": round((right.tail_local - MIRROR @ left.tail_local).length, 4),
    }


def failing(pairs: list[dict]) -> list[dict]:
    return [
        p for p in pairs
        if p["orientationErrorDeg"] > LIMIT_DEG or p["lengthDelta"] > LIMIT_UNITS
    ]


def build_report() -> dict:
    armatures = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    if not armatures:
        raise SystemExit("no armature in file")
    armature = armatures[0]
    bones = armature.data.bones

    pairs = [measure_pair(bones, left, right) for left, right in all_pairs(bones)]
    batten_pairs = batten_map(bones)

    # A bone is "unmatched" only if it has NEITHER a name counterpart NOR a position
    # counterpart. The battens pair by position (`L_WingBatten040..054` against
    # `R_WingBatten055..069`), so they are matched even though no name counterpart
    # exists — counting them as unmatched made `passed` unreachable.
    unmatched = []
    for bone in bones:
        other = counterpart(bone.name)
        if other is None:
            continue                      # not an L_/R_ bone: nothing to pair with
        if other in bones:
            continue                      # paired by name
        if bone.name in batten_pairs or bone.name in batten_pairs.values():
            continue                      # paired by position
        unmatched.append(bone.name)

    # Vertex groups on the skinned meshes that no bone claims (doc 41: 18 orphaned
    # WingFinger*/WingMembrane* groups).
    bone_names = set(bones.keys())
    orphan_groups = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for group in obj.vertex_groups:
            if group.name not in bone_names:
                orphan_groups.append({"object": obj.name, "group": group.name})

    zero_user = {}
    for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
                       bpy.data.actions, bpy.data.curves, bpy.data.cameras, bpy.data.images):
        orphans = [d.name for d in collection if d.users == 0]
        if orphans:
            zero_user[collection.rna_type.identifier] = orphans

    return {
        "file": bpy.data.filepath,
        "armature": armature.name,
        "boneCount": len(bones),
        "pairs": pairs,
        "pairCount": len(pairs),
        "failingPairs": len(failing(pairs)),
        "unmatched": unmatched,
        "battenPairCount": len(batten_pairs),
        "orphanVertexGroups": orphan_groups,
        "zeroUserDatablocks": zero_user,
        "scenes": [scene.name for scene in bpy.data.scenes],
        "limits": {"orientationDeg": LIMIT_DEG, "lengthUnits": LIMIT_UNITS},
        # Doc 41's C7 verify clause: "0 L/R roll or length deviations > 0.01".
        "passed": not failing(pairs) and not unmatched,
    }


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    json_out = argv[argv.index("--json-out") + 1] if "--json-out" in argv else None

    report = build_report()
    text = json.dumps(report, indent=2)
    if json_out:
        Path(json_out).write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
