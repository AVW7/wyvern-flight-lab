"""Dump every pose bone's `rotation_quaternion` basis, per frame, for given clips.

Companion to `dump_jaw_basis_keys.py`: that one emits a single bone in the shape
`restore_jaw_amplitude.mjs` consumes, this one emits the whole rig so a full-rig
amplitude audit can ask "which bones has a GLB-level pass re-posed?" instead of
checking one bone at a time.

Samples **every frame** rather than keyframe points, because the exported channel
carries one key per frame at 24 fps and a per-frame sample cannot disagree with the
channel's key times.

Usage:
  blender --background models/source/wyvern-v2-master.blend \
          --python tools/blender/dump_pose_basis_all.py -- \
          --clips attack,attack2 --out <path.json>
"""

import argparse
import json
import sys
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parents[2]
BLENDER_PKG = REPO / "scripts/blender"
if str(BLENDER_PKG) not in sys.path:
    sys.path.insert(0, str(BLENDER_PKG))

from core.actions_compat import ActionCompat  # noqa: E402

ARMATURE_SUFFIX = 'pose.bones["'


def rotation_curves(action):
    """`{bone: {index: fcurve}}` for every bone with a rotation_quaternion channel."""
    bones = {}
    for fcurve in ActionCompat.iter_fcurves(action):
        path = fcurve.data_path
        if not (path.startswith(ARMATURE_SUFFIX) and path.endswith('"].rotation_quaternion')):
            continue
        name = path[len(ARMATURE_SUFFIX):-len('"].rotation_quaternion')]
        bones.setdefault(name, {})[fcurve.array_index] = fcurve
    return bones


def argv_after_dashes():
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clips", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv_after_dashes())

    out = {"clips": {}}
    for name in [c for c in args.clips.split(",") if c]:
        action = bpy.data.actions.get(name)
        if action is None:
            raise SystemExit(f"missing action {name!r}")
        curves = rotation_curves(action)
        if not curves:
            raise SystemExit(f"{name}: no rotation_quaternion channels")

        frames = sorted({round(kp.co[0])
                         for bone in curves.values()
                         for fc in bone.values()
                         for kp in fc.keyframe_points})
        start, end = frames[0], frames[-1]

        bones = {}
        for bone, by_index in sorted(curves.items()):
            if sorted(by_index) != [0, 1, 2, 3]:
                raise SystemExit(f"{name}/{bone}: expected 4 quaternion curves, got {sorted(by_index)}")
            bones[bone] = [[round(by_index[i].evaluate(frame), 9) for i in range(4)]
                           for frame in range(start, end + 1)]

        out["clips"][name] = {"frames": [start, end], "count": end - start + 1, "bones": bones}
        print(f"{name}: frames {start}..{end} ({end - start + 1} samples, {len(bones)} bones)")

    with open(args.out, "w") as handle:
        json.dump(out, handle)
    print(f"wrote {args.out}")


main()
