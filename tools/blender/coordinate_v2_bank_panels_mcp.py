"""Coordinate all 16 wing-membrane panel bone tracks (`L/R_WingPanel0..3_0..1`) across
`bankLeft` and `bankRight` by slerping adjacent digit segment skin transforms (`WingD{p}P{s+1}`
and `WingD{p+1}P{s+1}`) and solving panel local pose transforms with exact loop closure.

Replaces the 453-shape-key morph study with export-safe skeletal bone tracks that pass
`runtime_rig_contract.mjs` (`!p.targets`) and can be spliced via `package_panel_coordination.mjs`.

Execute inside an already-running Blender MCP session on a separate candidate:
  python3 scripts/blender/cli.py --timeout 60 exec-script tools/blender/coordinate_v2_bank_panels_mcp.py

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
    import json
    import math
    import shutil
    import struct

    ROOT = Path("/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next")
    OUT = ROOT / "assets/harvest-candidates/2026-10-07/mcp-study"
    OUT.mkdir(parents=True, exist_ok=True)
    SOURCE_BLEND = OUT / "v2-panel-coordination-mcp.blend"
    WORK_BLEND = OUT / "v2-bank-panel-coordination-mcp.blend"

    rig = (
        bpy.data.objects.get("WyvernRig")
        or bpy.data.objects.get("WyvernRig.005")
        or bpy.data.objects.get("WyvernRig.001")
    )
    if not rig or rig.type != "ARMATURE":
        if bpy.data.is_dirty:
            raise RuntimeError("Active Blender scene has unsaved changes and no WyvernRig; refusing to open study")
        if not SOURCE_BLEND.is_file():
            raise RuntimeError(f"Source study not found: {SOURCE_BLEND}")
        shutil.copy2(SOURCE_BLEND, WORK_BLEND)
        bpy.ops.wm.open_mainfile(filepath=str(WORK_BLEND), load_ui=False)
        rig = (
            bpy.data.objects.get("WyvernRig")
            or bpy.data.objects.get("WyvernRig.005")
            or bpy.data.objects.get("WyvernRig.001")
        )
    if not rig or rig.type != "ARMATURE":
        raise RuntimeError("No WyvernRig armature found in the active Blender scene")

    scene = bpy.context.scene
    PANEL_NAMES = [
        f"{side}_WingPanel{panel}_{segment}"
        for side in ("L", "R")
        for panel in range(4)
        for segment in range(2)
    ]

    def isolate_single_glb_animation(glb_path: Path):
        data = glb_path.read_bytes()
        magic, version, _total_len = struct.unpack_from("<III", data, 0)
        assert magic == 0x46546C67 and version == 2
        json_len, json_type = struct.unpack_from("<II", data, 12)
        assert json_type == 0x4E4F534A
        gltf = json.loads(data[20 : 20 + json_len].decode("utf-8"))
        bin_chunk = data[20 + json_len :]
        anims = gltf.get("animations", [])
        if len(anims) > 1:
            matched = []
            for anim in anims:
                panel_ch = [
                    c for c in anim.get("channels", [])
                    if gltf["nodes"][c["target"]["node"]].get("name") in PANEL_NAMES
                ]
                if not panel_ch:
                    continue
                sampler = anim["samplers"][panel_ch[0]["sampler"]]
                acc = gltf["accessors"][sampler["output"]]
                if acc.get("count") == 145:
                    matched.append(anim)
            if not matched:
                matched = [anims[-1]]
            gltf["animations"] = [matched[-1]]
            raw_json = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
            pad = (4 - (len(raw_json) % 4)) % 4
            padded_json = raw_json + (b" " * pad)
            new_total = 12 + 8 + len(padded_json) + len(bin_chunk)
            header = struct.pack("<III", magic, version, new_total)
            json_header = struct.pack("<II", len(padded_json), json_type)
            glb_path.write_bytes(header + json_header + padded_json + bin_chunk)

    def resolve_source_action(candidates: list[str]):
        for name in candidates:
            action = bpy.data.actions.get(name)
            if action:
                return action
        raise RuntimeError(f"Could not find any action matching {candidates}")

    def coordinate_bank_clip(clip_key: str, action_candidates: list[str], candidate_name: str, donor_filename: str):
        source = resolve_source_action(action_candidates)
        existing = bpy.data.actions.get(candidate_name)
        if existing:
            bpy.data.actions.remove(existing)

        rig.animation_data.action = source
        rig.animation_data.use_nla = False

        samples = {n: [] for n in PANEL_NAMES}
        measurements = []

        for frame in range(145):
            scene.frame_set(frame)
            original = {n: b.matrix.copy() for n, b in rig.pose.bones.items()}
            desired = {}
            errors = []

            for name in PANEL_NAMES:
                side = name[0]
                panel, segment = map(int, name.split("Panel")[1].split("_"))
                adjacent = [f"{side}_WingD{digit}P{segment + 1}" for digit in (panel, panel + 1)]
                deltas = [original[n] @ rig.data.bones[n].matrix_local.inverted() for n in adjacent]
                average = deltas[0].to_quaternion().slerp(deltas[1].to_quaternion(), 0.5)
                bone = rig.data.bones[name]
                target = average.to_matrix().to_4x4() @ bone.matrix_local
                target.translation = (deltas[0] @ bone.head_local + deltas[1] @ bone.head_local) * 0.5
                desired[name] = target
                parent_pose = desired.get(bone.parent.name, original[bone.parent.name])
                basis = bone.convert_local_to_pose(
                    target,
                    bone.matrix_local,
                    parent_matrix=parent_pose,
                    parent_matrix_local=bone.parent.matrix_local,
                    invert=True,
                )
                location, rotation, _scale = basis.decompose()
                if samples[name] and rotation.dot(samples[name][-1][1]) < 0:
                    rotation.negate()
                samples[name].append((location.copy(), rotation.copy()))
                actual = (original[name] @ bone.matrix_local.inverted()).to_quaternion()
                errors.append(actual.rotation_difference(average).angle * 180.0 / math.pi)

            if frame % 18 == 0:
                measurements.append({
                    "frame": frame,
                    "mean_neighbor_delta_degrees": sum(errors) / len(errors),
                    "max_neighbor_delta_degrees": max(errors),
                })

        # Enforce exact loop seam closure at frame 144 == frame 0
        for name in PANEL_NAMES:
            loc0, rot0 = samples[name][0]
            rot_end = rot0.copy()
            if rot_end.dot(samples[name][-2][1]) < 0:
                rot_end.negate()
            samples[name][144] = (loc0.copy(), rot_end)

        candidate = source.copy()
        candidate.name = candidate_name
        curves = candidate.layers[0].strips[0].channelbags[0].fcurves
        paths = {
            f'pose.bones["{n}"].{prop}'
            for n in PANEL_NAMES
            for prop in ("location", "rotation_quaternion", "scale")
        }
        for curve in list(curves):
            if curve.data_path in paths:
                curves.remove(curve)

        for name in PANEL_NAMES:
            rig.pose.bones[name].rotation_mode = "QUATERNION"
            for prop, count, sample_index in (("location", 3, 0), ("rotation_quaternion", 4, 1)):
                for component in range(count):
                    curve = curves.new(data_path=f'pose.bones["{name}"].{prop}', index=component)
                    curve.keyframe_points.add(145)
                    for frame, point in enumerate(curve.keyframe_points):
                        point.co = (frame, samples[name][frame][sample_index][component])
                        point.interpolation = "LINEAR"

        rig.animation_data.action = candidate
        scene.render.fps = 24
        scene.frame_start = 0
        scene.frame_end = 144
        scene.frame_set(18)

        for obj in scene.objects:
            obj.select_set(obj.type in {"ARMATURE", "MESH"})
        bpy.context.view_layer.objects.active = rig

        donor_path = OUT / donor_filename
        bpy.ops.export_scene.gltf(
            filepath=str(donor_path),
            export_format="GLB",
            use_selection=True,
            use_active_scene=True,
            export_animations=True,
            export_animation_mode="ACTIVE_ACTIONS",
            export_frame_range=True,
            export_force_sampling=True,
            export_optimize_animation_size=False,
            export_skins=True,
        )
        isolate_single_glb_animation(donor_path)
        return {
            "clip": clip_key,
            "source_action": source.name,
            "candidate_action": candidate.name,
            "donor_glb": str(donor_path),
            "baseline_neighbor_delta": measurements,
        }

    left_report = coordinate_bank_clip(
        "bankLeft",
        ["bankLeft.001", "bankLeft", "V2HarvestBankReview_bankLeft", "bankLeft.005"],
        "BankLeft_PanelCoordination_MCP",
        "bankLeft-panel-donor-isolated.glb",
    )
    right_report = coordinate_bank_clip(
        "bankRight",
        ["bankRight.001", "bankRight", "bankRight.005", "V2RigReview_bankRight"],
        "BankRight_PanelCoordination_MCP",
        "bankRight-panel-donor-isolated.glb",
    )

    bpy.ops.wm.save_as_mainfile(filepath=str(WORK_BLEND))
    report = {
        "status": "completed",
        "armature": rig.name,
        "scene": scene.name,
        "method": "slerp(0.5) of adjacent digit segment skin transforms solved into panel local pose space with exact frame 0==144 loop closure",
        "changed_bones": PANEL_NAMES,
        "saved_blend": str(WORK_BLEND),
        "clips": {
            "bankLeft": left_report,
            "bankRight": right_report,
        },
    }
    (OUT / "bank-panel-coordination.json").write_text(json.dumps(report, indent=2) + "\n")
    result = report
else:
    sys.exit(
        "Run this script inside an already-running Blender MCP session on a separate "
        "candidate. Automatic Blender startup is disabled because Codex-launched "
        "processes crash on this machine. See docs/BLENDER_CRASH_LOG.md."
    )
