"""Revise and coordinate `idle`, `walk`, `takeoff`, and `land` in the V2 Wyvern study:
1. `idle` (144 frames): Eases distal knuckle/digit fold tension (`WingWrist` 0.82, `WingHand` 0.68,
   `WingD0..5` 0.55 toward bind rest), lifts drooping head/neck into an alert horizon-level quadrupedal
   posture while preserving respiratory heave and gaze stabilization, and solves all 16 wing-membrane
   panel bones (`L/R_WingPanel0..3_0..1`) via `slerp(0.5)` of adjacent digits + subtle 2-cycle breath
   with exact frame 0 == 144 loop closure.
2. `walk` (59 frames): Replaces the vertical sky-sail digit posture (`tips_z = 854..1329`) with a
   balanced flank-folded knuckle-walk carriage (`idle` eased fold modulated by `walk`'s alternating
   shoulder/elbow/wrist stride swing) and solves all 16 panel bones via `slerp(0.5)` with exact
   frame 0 == 59 loop closure.
3. `takeoff` (72 frames): Aligns frames `0..6` with `idle`'s eased ground wing fold and alert head
   posture, unfurls smoothly across frames `6..18` into the high-dihedral apex while preserving the
   hind-limb crouch push-off, dual wingbeat climb, and `cruise` tuck handoff, and solves all 16 panel
   bones via `slerp(0.5)` across frames `0..72`.
4. `land` (72 frames): Preserves the `cruise` entry and nose-up air-brake flare (`0..24`), folds both
   the wing arm (`WingRoot..Hand`) and digits (`WingD0..5`) smoothly across frames `24..66` into
   `idle`'s eased ground wing fold, lifts the head/neck at touchdown (`48..72`) into `idle`'s alert
   quadrupedal posture instead of pitching downward into the floor, and solves all 16 panel bones via
   `slerp(0.5)` across frames `0..72`.

Execute inside an already-running Blender MCP session on a separate candidate:
  python3 scripts/blender/cli.py --timeout 90 exec-script tools/blender/coordinate_v2_locomotion_panels_mcp.py

Direct Python execution refuses to start Blender; see docs/BLENDER_CRASH_LOG.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import bpy
    from mathutils import Euler, Quaternion
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
    DIGIT_NAMES = [
        f"{side}_WingD{digit}P{part}"
        for side in ("L", "R")
        for digit in range(6)
        for part in range(3)
    ]
    ARM_NAMES = [
        f"{side}_{part}"
        for side in ("L", "R")
        for part in ("WingRoot", "WingShoulder", "WingElbow", "WingWrist", "WingHand")
    ]
    WING_CHAIN_NAMES = ARM_NAMES + DIGIT_NAMES
    IDENTITY_Q = Quaternion((1.0, 0.0, 0.0, 0.0))

    def smoothstep(edge0: float, edge1: float, x: float) -> float:
        t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
        return t * t * (3.0 - 2.0 * t)

    def slerp_shortest(q0: Quaternion, q1: Quaternion, t: float) -> Quaternion:
        qa = q0.copy()
        qb = q1.copy()
        if qa.dot(qb) < 0.0:
            qb.negate()
        return qa.slerp(qb, t)

    def resolve_source_action(candidates: list[str]):
        for name in candidates:
            action = bpy.data.actions.get(name)
            if action:
                return action
        raise RuntimeError(f"Could not find any action matching {candidates}")

    def isolate_single_glb_animation(glb_path: Path, expected_count: int):
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
                if acc.get("count") == expected_count:
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

    def set_bone_rot_curves(curves, bone_name: str, quats_by_frame: list[Quaternion]):
        path = f'pose.bones["{bone_name}"].rotation_quaternion'
        for curve in list(curves):
            if curve.data_path == path:
                curves.remove(curve)
        rig.pose.bones[bone_name].rotation_mode = "QUATERNION"
        n_frames = len(quats_by_frame)
        for comp in range(4):
            curve = curves.new(data_path=path, index=comp)
            curve.keyframe_points.add(n_frames)
            for f, point in enumerate(curve.keyframe_points):
                point.co = (f, quats_by_frame[f][comp])
                point.interpolation = "LINEAR"

    def solve_and_write_panels(
        candidate_action,
        end_frame: int,
        loop_closed: bool,
        breath_amp_rad: float = 0.0,
    ):
        rig.animation_data.action = candidate_action
        rig.animation_data.use_nla = False
        curves = candidate_action.layers[0].strips[0].channelbags[0].fcurves
        n_frames = end_frame + 1
        samples = {n: [] for n in PANEL_NAMES}
        measurements = []

        for frame in range(n_frames):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
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
                if breath_amp_rad > 0.0:
                    phase = panel * 0.26 + segment * 0.13
                    angle = breath_amp_rad * math.sin((4.0 * math.pi * frame / end_frame) + phase)
                    q_breath = Euler((angle, 0.0, 0.0), "XYZ").to_quaternion()
                    if side == "R":
                        q_breath = Quaternion((q_breath.w, q_breath.x, -q_breath.y, -q_breath.z))
                    rotation = rotation @ q_breath
                if samples[name] and rotation.dot(samples[name][-1][1]) < 0:
                    rotation.negate()
                samples[name].append((location.copy(), rotation.copy()))
                actual = (original[name] @ bone.matrix_local.inverted()).to_quaternion()
                errors.append(actual.rotation_difference(average).angle * 180.0 / math.pi)

            step = max(1, end_frame // 4)
            if frame % step == 0 or frame == end_frame:
                measurements.append({
                    "frame": frame,
                    "mean_neighbor_delta_degrees": sum(errors) / len(errors),
                    "max_neighbor_delta_degrees": max(errors),
                })

        if loop_closed:
            for name in PANEL_NAMES:
                loc0, rot0 = samples[name][0]
                rot_end = rot0.copy()
                if rot_end.dot(samples[name][-2][1]) < 0:
                    rot_end.negate()
                samples[name][end_frame] = (loc0.copy(), rot_end)

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
                    curve.keyframe_points.add(n_frames)
                    for frame, point in enumerate(curve.keyframe_points):
                        point.co = (frame, samples[name][frame][sample_index][component])
                        point.interpolation = "LINEAR"

        return measurements

    def export_isolated_donor(candidate_action, end_frame: int, donor_filename: str) -> str:
        rig.animation_data.action = candidate_action
        rig.animation_data.use_nla = False
        scene.render.fps = 24
        scene.frame_start = 0
        scene.frame_end = end_frame
        scene.frame_set(0)

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
        isolate_single_glb_animation(donor_path, end_frame + 1)
        return str(donor_path)

    # -------------------------------------------------------------------------
    # 1. REVISE IDLE (144 frames, loop_closed=True)
    # -------------------------------------------------------------------------
    idle_src = resolve_source_action(["idle.001", "idle"])
    existing = bpy.data.actions.get("Idle_PanelCoordination_MCP")
    if existing:
        bpy.data.actions.remove(existing)
    idle_cand = idle_src.copy()
    idle_cand.name = "Idle_PanelCoordination_MCP"
    rig.animation_data.action = idle_cand
    rig.animation_data.use_nla = False

    # Sample original idle frames 0..144 and compute eased ground wing fold + lifted horizon head posture
    idle_wing_samples = {n: [] for n in WING_CHAIN_NAMES}
    idle_neck_samples = {n: [] for n in ("Neck1", "Neck2", "Head")}
    neck_lift_offsets = {
        "Neck1": Euler((math.radians(-5.0), 0.0, 0.0), "XYZ").to_quaternion(),
        "Neck2": Euler((math.radians(-6.0), 0.0, 0.0), "XYZ").to_quaternion(),
        "Head": Euler((math.radians(-6.0), 0.0, 0.0), "XYZ").to_quaternion(),
    }

    for f in range(145):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        for side in ("L", "R"):
            for part, alpha in (
                ("WingRoot", 1.0),
                ("WingShoulder", 1.0),
                ("WingElbow", 1.0),
                ("WingWrist", 0.82),
                ("WingHand", 0.68),
            ):
                bname = f"{side}_{part}"
                q = slerp_shortest(IDENTITY_Q, rig.pose.bones[bname].rotation_quaternion, alpha)
                if idle_wing_samples[bname] and q.dot(idle_wing_samples[bname][-1]) < 0:
                    q.negate()
                idle_wing_samples[bname].append(q)
        for bname in DIGIT_NAMES:
            q = slerp_shortest(IDENTITY_Q, rig.pose.bones[bname].rotation_quaternion, 0.55)
            if idle_wing_samples[bname] and q.dot(idle_wing_samples[bname][-1]) < 0:
                q.negate()
            idle_wing_samples[bname].append(q)
        for bname, q_lift in neck_lift_offsets.items():
            q = q_lift @ rig.pose.bones[bname].rotation_quaternion
            if idle_neck_samples[bname] and q.dot(idle_neck_samples[bname][-1]) < 0:
                q.negate()
            idle_neck_samples[bname].append(q)

    # Exact loop closure at frame 144 == frame 0
    for seq_map in (idle_wing_samples, idle_neck_samples):
        for bname, seq in seq_map.items():
            q_end = seq[0].copy()
            if q_end.dot(seq[-2]) < 0:
                q_end.negate()
            seq[144] = q_end

    idle_curves = idle_cand.layers[0].strips[0].channelbags[0].fcurves
    for bname, seq in idle_wing_samples.items():
        set_bone_rot_curves(idle_curves, bname, seq)
    for bname, seq in idle_neck_samples.items():
        set_bone_rot_curves(idle_curves, bname, seq)

    # Reference eased ground fold and alert head posture at frame 0 for walk, takeoff, and land
    idle_eased_wing_f0 = {bname: seq[0].copy() for bname, seq in idle_wing_samples.items()}
    idle_lifted_neck_f0 = {bname: seq[0].copy() for bname, seq in idle_neck_samples.items()}

    idle_measurements = solve_and_write_panels(
        idle_cand, end_frame=144, loop_closed=True, breath_amp_rad=math.radians(0.35)
    )
    idle_donor = export_isolated_donor(idle_cand, 144, "idle-panel-donor-isolated.glb")

    # -------------------------------------------------------------------------
    # 2. REVISE WALK (59 frames, loop_closed=True)
    # -------------------------------------------------------------------------
    walk_src = resolve_source_action(["walk.001", "walk"])
    existing = bpy.data.actions.get("Walk_PanelCoordination_MCP")
    if existing:
        bpy.data.actions.remove(existing)
    walk_cand = walk_src.copy()
    walk_cand.name = "Walk_PanelCoordination_MCP"
    rig.animation_data.action = walk_cand
    rig.animation_data.use_nla = False

    walk_wing_samples = {n: [] for n in WING_CHAIN_NAMES}
    stride_weights = {
        "WingRoot": 0.35,
        "WingShoulder": 0.35,
        "WingElbow": 0.25,
        "WingWrist": 0.25,
        "WingHand": 0.15,
    }
    for f in range(60):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        for side in ("L", "R"):
            for part, w in stride_weights.items():
                bname = f"{side}_{part}"
                q = slerp_shortest(idle_eased_wing_f0[bname], rig.pose.bones[bname].rotation_quaternion, w)
                if walk_wing_samples[bname] and q.dot(walk_wing_samples[bname][-1]) < 0:
                    q.negate()
                walk_wing_samples[bname].append(q)
        for bname in DIGIT_NAMES:
            q = slerp_shortest(idle_eased_wing_f0[bname], rig.pose.bones[bname].rotation_quaternion, 0.10)
            if walk_wing_samples[bname] and q.dot(walk_wing_samples[bname][-1]) < 0:
                q.negate()
            walk_wing_samples[bname].append(q)

    for bname, seq in walk_wing_samples.items():
        q_end = seq[0].copy()
        if q_end.dot(seq[-2]) < 0:
            q_end.negate()
        seq[59] = q_end

    walk_curves = walk_cand.layers[0].strips[0].channelbags[0].fcurves
    for bname, seq in walk_wing_samples.items():
        set_bone_rot_curves(walk_curves, bname, seq)

    walk_measurements = solve_and_write_panels(walk_cand, end_frame=59, loop_closed=True)
    walk_donor = export_isolated_donor(walk_cand, 59, "walk-panel-donor-isolated.glb")

    # -------------------------------------------------------------------------
    # 3. REVISE TAKEOFF (72 frames, loop_closed=False)
    # -------------------------------------------------------------------------
    takeoff_src = resolve_source_action(["takeoff.001", "takeoff"])
    existing = bpy.data.actions.get("Takeoff_PanelCoordination_MCP")
    if existing:
        bpy.data.actions.remove(existing)
    takeoff_cand = takeoff_src.copy()
    takeoff_cand.name = "Takeoff_PanelCoordination_MCP"
    rig.animation_data.action = takeoff_cand
    rig.animation_data.use_nla = False

    scene.frame_set(18)
    bpy.context.view_layer.update()
    takeoff_apex_wing = {n: rig.pose.bones[n].rotation_quaternion.copy() for n in WING_CHAIN_NAMES}
    takeoff_apex_neck = {n: rig.pose.bones[n].rotation_quaternion.copy() for n in ("Neck1", "Neck2", "Head")}

    takeoff_wing_samples = {n: [] for n in WING_CHAIN_NAMES}
    takeoff_neck_samples = {n: [] for n in ("Neck1", "Neck2", "Head")}
    for f in range(73):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        s = 0.0 if f <= 6 else smoothstep(6.0, 18.0, float(f))
        for bname in WING_CHAIN_NAMES:
            if f <= 18:
                q = slerp_shortest(idle_eased_wing_f0[bname], takeoff_apex_wing[bname], s)
            else:
                q = rig.pose.bones[bname].rotation_quaternion.copy()
            if takeoff_wing_samples[bname] and q.dot(takeoff_wing_samples[bname][-1]) < 0:
                q.negate()
            takeoff_wing_samples[bname].append(q)
        for bname in ("Neck1", "Neck2", "Head"):
            if f <= 18:
                q = slerp_shortest(idle_lifted_neck_f0[bname], takeoff_apex_neck[bname], s)
            else:
                q = rig.pose.bones[bname].rotation_quaternion.copy()
            if takeoff_neck_samples[bname] and q.dot(takeoff_neck_samples[bname][-1]) < 0:
                q.negate()
            takeoff_neck_samples[bname].append(q)

    takeoff_curves = takeoff_cand.layers[0].strips[0].channelbags[0].fcurves
    for bname, seq in takeoff_wing_samples.items():
        set_bone_rot_curves(takeoff_curves, bname, seq)
    for bname, seq in takeoff_neck_samples.items():
        set_bone_rot_curves(takeoff_curves, bname, seq)

    takeoff_measurements = solve_and_write_panels(takeoff_cand, end_frame=72, loop_closed=False)
    takeoff_donor = export_isolated_donor(takeoff_cand, 72, "takeoff-panel-donor-isolated.glb")

    # -------------------------------------------------------------------------
    # 4. REVISE LAND (72 frames, loop_closed=False)
    # -------------------------------------------------------------------------
    land_src = resolve_source_action(["land.001", "land"])
    existing = bpy.data.actions.get("Land_PanelCoordination_MCP")
    if existing:
        bpy.data.actions.remove(existing)
    land_cand = land_src.copy()
    land_cand.name = "Land_PanelCoordination_MCP"
    rig.animation_data.action = land_cand
    rig.animation_data.use_nla = False

    scene.frame_set(24)
    bpy.context.view_layer.update()
    land_flare_wing = {n: rig.pose.bones[n].rotation_quaternion.copy() for n in WING_CHAIN_NAMES}
    scene.frame_set(48)
    bpy.context.view_layer.update()
    land_touchdown_neck = {n: rig.pose.bones[n].rotation_quaternion.copy() for n in ("Neck1", "Neck2", "Head")}

    land_wing_samples = {n: [] for n in WING_CHAIN_NAMES}
    land_neck_samples = {n: [] for n in ("Neck1", "Neck2", "Head")}
    for f in range(73):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        s_wing = smoothstep(24.0, 66.0, float(f))
        s_neck = smoothstep(48.0, 72.0, float(f))
        for bname in WING_CHAIN_NAMES:
            if f >= 24:
                q = slerp_shortest(land_flare_wing[bname], idle_eased_wing_f0[bname], s_wing)
            else:
                q = rig.pose.bones[bname].rotation_quaternion.copy()
            if land_wing_samples[bname] and q.dot(land_wing_samples[bname][-1]) < 0:
                q.negate()
            land_wing_samples[bname].append(q)
        for bname in ("Neck1", "Neck2", "Head"):
            if f >= 48:
                q = slerp_shortest(land_touchdown_neck[bname], idle_lifted_neck_f0[bname], s_neck)
            else:
                q = rig.pose.bones[bname].rotation_quaternion.copy()
            if land_neck_samples[bname] and q.dot(land_neck_samples[bname][-1]) < 0:
                q.negate()
            land_neck_samples[bname].append(q)

    land_curves = land_cand.layers[0].strips[0].channelbags[0].fcurves
    for bname, seq in land_wing_samples.items():
        set_bone_rot_curves(land_curves, bname, seq)
    for bname, seq in land_neck_samples.items():
        set_bone_rot_curves(land_curves, bname, seq)

    land_measurements = solve_and_write_panels(land_cand, end_frame=72, loop_closed=False)
    land_donor = export_isolated_donor(land_cand, 72, "land-panel-donor-isolated.glb")

    bpy.ops.wm.save_as_mainfile(filepath=str(WORK_BLEND))
    report = {
        "status": "completed",
        "armature": rig.name,
        "scene": scene.name,
        "saved_blend": str(WORK_BLEND),
        "clips": {
            "idle": {
                "source_action": idle_src.name,
                "candidate_action": idle_cand.name,
                "donor_glb": idle_donor,
                "panel_neighbor_delta_before_solve": idle_measurements,
            },
            "walk": {
                "source_action": walk_src.name,
                "candidate_action": walk_cand.name,
                "donor_glb": walk_donor,
                "panel_neighbor_delta_before_solve": walk_measurements,
            },
            "takeoff": {
                "source_action": takeoff_src.name,
                "candidate_action": takeoff_cand.name,
                "donor_glb": takeoff_donor,
                "panel_neighbor_delta_before_solve": takeoff_measurements,
            },
            "land": {
                "source_action": land_src.name,
                "candidate_action": land_cand.name,
                "donor_glb": land_donor,
                "panel_neighbor_delta_before_solve": land_measurements,
            },
        },
    }
    (OUT / "locomotion-panel-coordination.json").write_text(json.dumps(report, indent=2) + "\n")
    result = report
else:
    sys.exit(
        "Run this script inside an already-running Blender MCP session on a separate "
        "candidate. Automatic Blender startup is disabled because Codex-launched "
        "processes crash on this machine. See docs/BLENDER_CRASH_LOG.md."
    )
