"""Dump the `Jaw` pose-bone basis for the clips whose GLB amplitude diverged.

The D2/D3/D4 gain passes amplified every rotation channel about its own bind
rotation, `bind * qpow(bind^-1 * q, gain)`. `Jaw` is not in `PROTECTED`, so the
jaw was amplified with the rest of the rig: `attack` `32.0deg -> 176.9deg`,
`attack2` `24.0deg -> 53.7deg`, `death` `50.0deg -> 179.1deg`. `breath`,
`attackAir2` and `idle` were never gain-passed and agree with the blend exactly,
which is how the divergence was localised to those three clips.

This probe emits the authored basis so a GLB-level restore can write
`rest_local * basis` back into the clip. It samples **every frame** rather than
reading keyframe points, because the GLB carries one key per frame at 24 fps and
a per-frame sample cannot disagree with the channel's key times.

Usage:
  blender --background models/source/wyvern-v2-master.blend \
          --python tools/blender/dump_jaw_basis_keys.py -- --out <path.json>
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

CLIPS = ["attack", "attack2", "death", "breath", "attackAir2", "idle"]
BONE = "Jaw"
BONE_PATH = f'pose.bones["{BONE}"].rotation_quaternion'


def bone_curves(action, bone):
    """`rotation_quaternion` fcurves for one bone, keyed by array index."""
    path = f'pose.bones["{bone}"].rotation_quaternion'
    curves = {}
    for fcurve in ActionCompat.iter_fcurves(action):
        if fcurve.data_path != path:
            continue
        curves[fcurve.array_index] = fcurve
    return curves


def argv_after_dashes():
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--bone", default="Jaw", help="pose bone to dump (default Jaw)")
    parser.add_argument("--clips", default=",".join(CLIPS), help="comma-separated action names")
    args = parser.parse_args(argv_after_dashes())

    clips = [c for c in args.clips.split(",") if c]
    out = {"bone": args.bone, "clips": {}}
    for name in clips:
        action = bpy.data.actions.get(name)
        if action is None:
            raise SystemExit(f"missing action {name!r}")
        curves = bone_curves(action, args.bone)
        if sorted(curves) != [0, 1, 2, 3]:
            raise SystemExit(f"{name}: expected 4 quaternion curves, got {sorted(curves)}")

        frames = sorted({round(kp.co[0]) for fc in curves.values() for kp in fc.keyframe_points})
        start, end = frames[0], frames[-1]
        # One sample per frame, matching the exported channel's 1-key-per-frame layout.
        samples = [[round(curves[i].evaluate(frame), 9) for i in range(4)]
                   for frame in range(start, end + 1)]

        out["clips"][name] = {"frames": [start, end], "count": len(samples), "basis": samples}
        print(f"{name}: frames {start}..{end} ({len(samples)} samples)")

    with open(args.out, "w") as handle:
        json.dump(out, handle, indent=1)
    print(f"wrote {args.out}")


main()
