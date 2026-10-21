"""Author the non-deforming `10 Controls` animator layer on WyvernRig inside Blender MCP.

Adds foot/toe and wing-knuckle IK controls with floor-plane `LIMIT_LOCATION` constraints
(`Z >= contact_plane_z`), master `CTRL_WingFold_L/R` drivers across `WingElbow..WingD0..5`,
and `CTRL_Tail_Base/Mid/Tip` damped-track controls for `Tail1..10`.

Execute inside an already-running Blender MCP session on a separate candidate:
  python3 scripts/blender/cli.py --timeout 60 exec-script tools/blender/author_v2_control_rig_mcp.py

Direct Python execution refuses to start Blender; see docs/BLENDER_CRASH_LOG.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import bpy
    IS_BLENDER = True
except ImportError:
    IS_BLENDER = False

if IS_BLENDER:
    ROOT = Path("/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next")
    BLENDER_PKG = ROOT / "scripts/blender"
    if str(BLENDER_PKG) not in sys.path:
        sys.path.insert(0, str(BLENDER_PKG))

    from rigging.control_rig import build_control_rig

    rig = (
        bpy.data.objects.get("WyvernRig")
        or bpy.data.objects.get("WyvernRig.006")
        or bpy.data.objects.get("WyvernRig.005")
        or bpy.data.objects.get("WyvernRig.001")
    )
    if not rig or rig.type != "ARMATURE":
        raise RuntimeError("No WyvernRig armature found in the active Blender scene")

    result = build_control_rig(bpy, rig)
else:
    sys.exit(
        "Run this script inside an already-running Blender MCP session on a separate "
        "candidate. Automatic Blender startup is disabled because Codex-launched "
        "processes crash on this machine. See docs/BLENDER_CRASH_LOG.md."
    )
