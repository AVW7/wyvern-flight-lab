"""Author refined ground wing fold actions for the V2 Wyvern rig:
1. idle_V2Candidate: Primary standing ground idle stance with folded wings streaming backward along flanks.
2. rest_V2Candidate: Low quadrupedal ground resting posture with compact folded wings and settled body.

Uses the measured Gothic ground fold from v1_stand frame 74.
Execute inside an already-running Blender MCP session on a separate candidate.
Direct Python execution refuses to start Blender; see docs/BLENDER_CRASH_LOG.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import bpy
    from mathutils import Euler, Quaternion, Vector
    IS_BLENDER = True
except ImportError:
    IS_BLENDER = False

if IS_BLENDER:
    import math

    OUT = Path("/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0")
    OUT.mkdir(parents=True, exist_ok=True)

    rig = bpy.data.objects.get("WyvernRig") or bpy.data.objects.get("WyvernRig.001")
    if not rig:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        gothic_src = Path("/Users/ajadvanwyk/wyvern3d-v2/public/models/wyvern-gothic.glb")
        if not gothic_src.exists():
            raise RuntimeError(f"Gothic model source not found: {gothic_src}")
        bpy.ops.import_scene.gltf(filepath=str(gothic_src))
        rig = bpy.data.objects.get("WyvernRig")
        if not rig:
            raise RuntimeError("WyvernRig not found after importing wyvern-gothic.glb")

    mesh = (
        bpy.data.objects.get("WyvernMesh")
        or bpy.data.objects.get("WyvernMembrane_ExportSafe.001")
        or bpy.data.objects.get("WyvernMembrane_ExportSafe")
    )

    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"

    def ensure_action_copy(source_name: str, target_name: str):
        source = bpy.data.actions.get(source_name)
        if not source:
            alt_name = f"{source_name}.001"
            source = bpy.data.actions.get(alt_name)
        if not source:
            raise RuntimeError(f"Source action '{source_name}' (or .001) not found")
        target = bpy.data.actions.get(target_name)
        if target:
            bpy.data.actions.remove(target)
        target = source.copy()
        target.name = target_name
        return target

    def get_channel_bag(action):
        if hasattr(action, "layers") and action.layers:
            return action.layers[0].strips[0].channelbags[0]
        return action

    def remove_bone_curves(bag, bone_name: str):
        prefix = f'pose.bones["{bone_name}"].'
        curves_to_remove = [c for c in bag.fcurves if c.data_path.startswith(prefix)]
        for c in curves_to_remove:
            bag.fcurves.remove(c)

    def remove_bone_rot_curves(bag, bone_name: str):
        prefix = f'pose.bones["{bone_name}"].rotation_quaternion'
        curves_to_remove = [c for c in bag.fcurves if c.data_path == prefix]
        for c in curves_to_remove:
            bag.fcurves.remove(c)

    def remove_bone_loc_curves(bag, bone_name: str):
        prefix = f'pose.bones["{bone_name}"].location'
        curves_to_remove = [c for c in bag.fcurves if c.data_path == prefix]
        for c in curves_to_remove:
            bag.fcurves.remove(c)

    def create_quaternion_curves(bag, bone_name: str):
        prefix = f'pose.bones["{bone_name}"].rotation_quaternion'
        curves = []
        for i in range(4):
            c = bag.fcurves.new(data_path=prefix, index=i)
            curves.append(c)
        return curves

    def create_location_curves(bag, bone_name: str):
        prefix = f'pose.bones["{bone_name}"].location'
        curves = []
        for i in range(3):
            c = bag.fcurves.new(data_path=prefix, index=i)
            curves.append(c)
        return curves

    def mirror_quaternion(q: Quaternion) -> Quaternion:
        # Sagittal reflection for left-to-right on this symmetric rig: (w, x, -y, -z)
        return Quaternion((q.w, q.x, -q.y, -q.z))

    def get_stepped_frames(total: int, step: int = 2) -> list[int]:
        fr = list(range(0, total, step))
        if not fr or fr[-1] != total:
            fr.append(total)
        return fr

    # Measured ground fold from v1_stand frame 74
    BASE_LEFT_WING_QUATS: dict[str, Quaternion] = {
        "L_WingRoot": Quaternion((0.999409, -0.011475, 0.011546, -0.030270)),
        "L_WingShoulder": Quaternion((0.987004, -0.019755, 0.000196, -0.159479)),
        "L_WingElbow": Quaternion((0.949058, -0.174360, 0.038722, 0.259592)),
        "L_WingWrist": Quaternion((0.884758, -0.229626, 0.080166, -0.397554)),
        "L_WingHand": Quaternion((0.806396, 0.066337, -0.480737, 0.337961)),
        "L_WingD0P0": Quaternion((0.859344, 0.197390, -0.371146, 0.291233)),
        "L_WingD0P1": Quaternion((0.998477, 0.004022, -0.054407, 0.008159)),
        "L_WingD0P2": Quaternion((0.995774, 0.052967, -0.038464, 0.064408)),
        "L_WingD1P0": Quaternion((0.898278, 0.171288, -0.348690, 0.205361)),
        "L_WingD1P1": Quaternion((0.999739, -0.013946, -0.000038, -0.018108)),
        "L_WingD1P2": Quaternion((1.000000, 0.000027, -0.000008, 0.000028)),
        "L_WingD2P0": Quaternion((0.929226, 0.085407, -0.238632, 0.268887)),
        "L_WingD2P1": Quaternion((0.999555, -0.006488, 0.024360, -0.015919)),
        "L_WingD2P2": Quaternion((0.995672, -0.016586, 0.081817, -0.040836)),
        "L_WingD3P0": Quaternion((0.963949, -0.036301, -0.065841, 0.255245)) @ Euler((math.radians(-25), 0, math.radians(15))).to_quaternion(),
        "L_WingD3P1": Quaternion((1.000000, -0.000047, 0.000052, 0.000007)),
        "L_WingD3P2": Quaternion((0.993514, -0.000001, 0.113711, 0.000029)),
        "L_WingD4P0": Quaternion((0.964215, -0.089143, 0.077335, 0.237406)) @ Euler((math.radians(-35), 0, math.radians(25))).to_quaternion(),
        "L_WingD4P1": Quaternion((1.000000, -0.000018, 0.000014, 0.000019)),
        "L_WingD4P2": Quaternion((1.000000, -0.000006, 0.000018, -0.000030)),
        "L_WingD5P0": Quaternion((0.333764, 0.028935, 0.904297, -0.264598)),
        "L_WingD5P1": Quaternion((0.842578, 0.376681, 0.023440, 0.384218)),
        "L_WingD5P2": Quaternion((0.976299, 0.139802, -0.000015, 0.165216)),
    }

    # All membrane panel chains are zeroed to identity so membrane pleats flat
    for p in range(4):
        for seg in range(2):
            BASE_LEFT_WING_QUATS[f"L_WingPanel{p}_{seg}"] = Quaternion((1.0, 0.0, 0.0, 0.0))

    def apply_wing_fold_to_curves(bag, frames: list[int], total_frames: int, breath_cycles: int = 2):
        breath_omega = (2.0 * math.pi * breath_cycles) / total_frames

        all_bones_curves = {}
        for bone_l in BASE_LEFT_WING_QUATS:
            bone_r = bone_l.replace("L_", "R_")
            remove_bone_curves(bag, bone_l)
            remove_bone_curves(bag, bone_r)
            all_bones_curves[bone_l] = create_quaternion_curves(bag, bone_l)
            all_bones_curves[bone_r] = create_quaternion_curves(bag, bone_r)

        for f in frames:
            chest_pulse = math.sin(breath_omega * f - 0.15) * math.radians(0.8)
            sh_euler = BASE_LEFT_WING_QUATS["L_WingShoulder"].to_euler("XYZ")
            sh_euler.x += chest_pulse
            sh_q_l = sh_euler.to_quaternion()
            sh_q_r = mirror_quaternion(sh_q_l)

            for bone_l, base_q in BASE_LEFT_WING_QUATS.items():
                bone_r = bone_l.replace("L_", "R_")
                if bone_l == "L_WingShoulder":
                    ql = sh_q_l
                    qr = sh_q_r
                else:
                    ql = base_q
                    qr = mirror_quaternion(base_q)

                curves_l = all_bones_curves[bone_l]
                curves_r = all_bones_curves[bone_r]

                for i, val in enumerate((ql.w, ql.x, ql.y, ql.z)):
                    curves_l[i].keyframe_points.insert(f, val)
                for i, val in enumerate((qr.w, qr.x, qr.y, qr.z)):
                    curves_r[i].keyframe_points.insert(f, val)

    def author_idle():
        action = ensure_action_copy("idle", "idle_V2Candidate")
        bag = get_channel_bag(action)
        total_frames = 144
        frames = get_stepped_frames(total_frames, step=2)

        omega_breath = (4.0 * math.pi) / total_frames
        omega_sway = (2.0 * math.pi) / total_frames

        def breath_wave(f, phase=0.0, skew=0.2):
            th = omega_breath * f + phase
            return math.sin(th + skew * math.sin(th))

        # 1. BODY & ROOT: Grounded quadrupedal anchor (Zero translation bobbing, eliminating foot slip)
        remove_bone_rot_curves(bag, "Body")
        remove_bone_loc_curves(bag, "Body")
        body_rot_curves = create_quaternion_curves(bag, "Body")
        body_loc_curves = create_location_curves(bag, "Body")

        base_body_pitch = math.radians(12.95)
        base_body_loc = (0.017, 1119.053, 366.411)

        for f in frames:
            e = Euler((base_body_pitch, 0.0, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                body_rot_curves[i].keyframe_points.insert(f, val)
            for i in range(3):
                body_loc_curves[i].keyframe_points.insert(f, base_body_loc[i])

        # 2. SPINE: Ground anchor on Spine1; Respiration heave on Spine2 & Spine3
        remove_bone_rot_curves(bag, "Spine1")
        s1_rot_curves = create_quaternion_curves(bag, "Spine1")
        for f in frames:
            for i, val in enumerate((1.0, 0.0, 0.0, 0.0)):
                s1_rot_curves[i].keyframe_points.insert(f, val)

        spine_respiration = [
            ("Spine2", math.radians(1.2), 0.0),
            ("Spine3", math.radians(1.8), -0.15),
        ]
        for bone_name, amp, phase in spine_respiration:
            remove_bone_rot_curves(bag, bone_name)
            curves = create_quaternion_curves(bag, bone_name)
            for f in frames:
                resp = breath_wave(f, phase=phase) * amp
                e = Euler((resp, 0.0, 0.0), "XYZ")
                q = e.to_quaternion()
                for i, val in enumerate((q.w, q.x, q.y, q.z)):
                    curves[i].keyframe_points.insert(f, val)

        # 3. NECK & HEAD: Delayed follow-through lift + predatory horizon gaze stabilization
        neck_bones = [
            ("Neck1", math.radians(-4.1), math.radians(2.2), -0.65, math.radians(0.8), 0.0),
            ("Neck2", math.radians(-6.2), math.radians(2.8), -0.85, math.radians(1.2), 0.3),
        ]
        for bone_name, base_pitch, amp_breath, phase, amp_sway, sway_phase in neck_bones:
            remove_bone_rot_curves(bag, bone_name)
            curves = create_quaternion_curves(bag, bone_name)
            for f in frames:
                pitch = base_pitch + breath_wave(f, phase=phase) * amp_breath
                yaw = amp_sway * math.sin(omega_sway * f + sway_phase)
                e = Euler((pitch, 0.0, yaw), "XYZ")
                q = e.to_quaternion()
                for i, val in enumerate((q.w, q.x, q.y, q.z)):
                    curves[i].keyframe_points.insert(f, val)

        # Head counter-pitches to hold horizon eyeline stability
        remove_bone_rot_curves(bag, "Head")
        head_curves = create_quaternion_curves(bag, "Head")
        base_head_pitch = math.radians(-5.3)
        counter_pitch_amp = math.radians(-4.2)
        survey_yaw_amp = math.radians(1.5)
        subtle_roll_amp = math.radians(0.5)

        for f in frames:
            pitch = base_head_pitch + counter_pitch_amp * breath_wave(f, phase=-0.85)
            yaw = survey_yaw_amp * math.sin(omega_sway * f + 0.8)
            roll = subtle_roll_amp * math.sin(omega_sway * f)
            e = Euler((pitch, roll, yaw), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                head_curves[i].keyframe_points.insert(f, val)

        # 4. JAW: Subtle respiration nod
        remove_bone_rot_curves(bag, "Jaw")
        remove_bone_loc_curves(bag, "Jaw")
        jaw_rot_curves = create_quaternion_curves(bag, "Jaw")
        jaw_loc_curves = create_location_curves(bag, "Jaw")
        for f in frames:
            breath_jaw = math.sin(omega_breath * f) * math.radians(0.4)
            q = Quaternion((math.cos(breath_jaw / 2.0), math.sin(breath_jaw / 2.0), 0.0, 0.0))
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                jaw_rot_curves[i].keyframe_points.insert(f, val)
            for i in range(3):
                jaw_loc_curves[i].keyframe_points.insert(f, 0.0)

        # 5. LEGS: Quadrupedal ground contact stability (Zero foot slip)
        leg_standing_euler = {
            "L_Thigh": (math.radians(-26.7), math.radians(4.0), math.radians(-11.4)),
            "L_Calf":  (math.radians(50.7), math.radians(-5.5), math.radians(11.5)),
            "L_Foot":  (math.radians(3.5), math.radians(-14.2), math.radians(-9.4)),
            "L_Toes":  (0.0, 0.0, 0.0),
        }
        for bone_l, (bx, by, bz) in leg_standing_euler.items():
            bone_r = bone_l.replace("L_", "R_")
            remove_bone_rot_curves(bag, bone_l)
            remove_bone_rot_curves(bag, bone_r)
            curves_l = create_quaternion_curves(bag, bone_l)
            curves_r = create_quaternion_curves(bag, bone_r)

            q_l = Euler((bx, by, bz), "XYZ").to_quaternion()
            q_r = mirror_quaternion(q_l)
            for f in frames:
                for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                    curves_l[i].keyframe_points.insert(f, val)
                for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                    curves_r[i].keyframe_points.insert(f, val)

        # 6. TAIL: 10-bone harmonic travelling counterbalance wave
        tail_bones = [f"Tail{i}" for i in range(1, 11)]
        for idx, bone_name in enumerate(tail_bones):
            remove_bone_rot_curves(bag, bone_name)
            curves = create_quaternion_curves(bag, bone_name)
            prog = idx / 9.0
            phase_vert = math.pi - 0.16 * idx
            amp_vert = math.radians(0.35 + 0.35 * prog)
            phase_lat = -0.32 * idx
            amp_lat = math.radians(0.3 + 0.3 * idx)

            for f in frames:
                pitch = amp_vert * breath_wave(f, phase=phase_vert)
                yaw = amp_lat * math.sin(omega_sway * f + phase_lat)
                e = Euler((pitch, 0.0, yaw), "XYZ")
                q = e.to_quaternion()
                for i, val in enumerate((q.w, q.x, q.y, q.z)):
                    curves[i].keyframe_points.insert(f, val)

        # 7. WINGS: Gothic Flank-Folded Knuckle Stance
        apply_wing_fold_to_curves(bag, frames, total_frames, breath_cycles=2)

        print(f"Authored idle_V2Candidate with Gothic ground fold ({total_frames} frames)")
        return action

    def author_rest():
        action = ensure_action_copy("rest", "rest_V2Candidate")
        bag = get_channel_bag(action)
        total_frames = 144
        breath_omega = (2.0 * math.pi) / total_frames
        frames = get_stepped_frames(total_frames, step=2)

        # 1. BODY & ROOT: Low quadrupedal ground settle
        remove_bone_rot_curves(bag, "Body")
        remove_bone_loc_curves(bag, "Body")
        body_rot_curves = create_quaternion_curves(bag, "Body")
        body_loc_curves = create_location_curves(bag, "Body")

        base_rest_pitch = math.radians(-2.5)

        for f in frames:
            respiration = math.sin(breath_omega * f) * math.radians(0.8)
            pitch = base_rest_pitch + respiration
            e = Euler((pitch, 0.0, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                body_rot_curves[i].keyframe_points.insert(f, val)
            body_loc_curves[0].keyframe_points.insert(f, 0.0)
            body_loc_curves[1].keyframe_points.insert(f, 0.0)
            body_loc_curves[2].keyframe_points.insert(f, 280.0)

        # 2. Respiration on Spine1-3
        spine_bones = ["Spine1", "Spine2", "Spine3"]
        for idx, bone_name in enumerate(spine_bones):
            remove_bone_rot_curves(bag, bone_name)
            curves = create_quaternion_curves(bag, bone_name)
            amp = math.radians(0.4 + 0.3 * idx)
            for f in frames:
                resp = math.sin(breath_omega * f) * amp
                e = Euler((resp, 0.0, 0.0), "XYZ")
                q = e.to_quaternion()
                for i, val in enumerate((q.w, q.x, q.y, q.z)):
                    curves[i].keyframe_points.insert(f, val)

        # 3. HEAD & NECK
        neck_bones = [
            ("Neck1", math.radians(4.0), math.radians(0.4)),
            ("Neck2", math.radians(5.0), math.radians(0.5)),
            ("Head",  math.radians(2.0), math.radians(0.6)),
        ]
        for bone_name, base_p, amp in neck_bones:
            remove_bone_rot_curves(bag, bone_name)
            curves = create_quaternion_curves(bag, bone_name)
            for f in frames:
                pitch = base_p + math.sin(breath_omega * f) * amp
                e = Euler((pitch, 0.0, 0.0), "XYZ")
                q = e.to_quaternion()
                for i, val in enumerate((q.w, q.x, q.y, q.z)):
                    curves[i].keyframe_points.insert(f, val)

        # JAW
        remove_bone_rot_curves(bag, "Jaw")
        remove_bone_loc_curves(bag, "Jaw")
        jaw_rot_curves = create_quaternion_curves(bag, "Jaw")
        jaw_loc_curves = create_location_curves(bag, "Jaw")
        for f in frames:
            breath = math.sin(breath_omega * f) * math.radians(0.2)
            q = Quaternion((math.cos(breath / 2.0), math.sin(breath / 2.0), 0.0, 0.0))
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                jaw_rot_curves[i].keyframe_points.insert(f, val)
            jaw_loc_curves[0].keyframe_points.insert(f, 0.0)
            jaw_loc_curves[1].keyframe_points.insert(f, 0.0)
            jaw_loc_curves[2].keyframe_points.insert(f, 0.0)

        # 4. WINGS: Flank-Folded Knuckle Rest
        apply_wing_fold_to_curves(bag, frames, total_frames, breath_cycles=1)

        # 5. LEGS
        leg_rest_euler = {
            "L_Thigh": math.radians(-27.4),
            "L_Calf":  math.radians(52.1),
            "L_Foot":  math.radians(2.4),
            "L_Toes":  0.0,
        }
        for bone_l, base_pitch in leg_rest_euler.items():
            bone_r = bone_l.replace("L_", "R_")
            remove_bone_rot_curves(bag, bone_l)
            remove_bone_rot_curves(bag, bone_r)
            curves_l = create_quaternion_curves(bag, bone_l)
            curves_r = create_quaternion_curves(bag, bone_r)

            for f in [0, total_frames]:
                q_l = Euler((base_pitch, 0.0, 0.0), "XYZ").to_quaternion()
                q_r = mirror_quaternion(q_l)
                for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                    curves_l[i].keyframe_points.insert(f, val)
                for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                    curves_r[i].keyframe_points.insert(f, val)

        # 6. TAIL
        tail_bones = [f"Tail{i}" for i in range(1, 11)]
        for idx, bone_name in enumerate(tail_bones):
            remove_bone_rot_curves(bag, bone_name)
            curves = create_quaternion_curves(bag, bone_name)
            progression = idx / 9.0
            base_curl_y = math.radians(1.5 * progression)
            base_curl_z = math.radians(2.0 * progression)
            resp_amp = math.radians(0.3 + 0.5 * progression)

            for f in frames:
                resp = math.sin(breath_omega * f - idx * 0.2) * resp_amp
                e = Euler((resp, base_curl_y, base_curl_z), "XYZ")
                q = e.to_quaternion()
                for i, val in enumerate((q.w, q.x, q.y, q.z)):
                    curves[i].keyframe_points.insert(f, val)

        print(f"Authored rest_V2Candidate with Gothic ground fold ({total_frames} frames)")
        return action

    author_idle()
    author_rest()

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    if mesh:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig

    candidate_exports = [
        ("idle_V2Candidate", "idle-v2-fold-candidate.glb"),
        ("rest_V2Candidate", "rest-v2-fold-candidate.glb"),
    ]

    for act_name, glb_name in candidate_exports:
        rig.animation_data.action = bpy.data.actions[act_name]
        if hasattr(rig.animation_data, "action_suitable_slots") and rig.animation_data.action_suitable_slots:
            rig.animation_data.action_slot = rig.animation_data.action_suitable_slots[0]
        destination = OUT / glb_name
        bpy.ops.export_scene.gltf(
            filepath=str(destination),
            export_format="GLB",
            use_selection=True,
            export_animations=True,
            export_animation_mode="ACTIVE_ACTIONS",
            export_nla_strips=False,
            export_force_sampling=True,
        )
        print(f"Exported candidate action {act_name} to {destination}")

else:
    sys.exit(
        "Run this script inside an already-running Blender MCP session on a separate "
        "candidate. Automatic Blender startup is disabled because Codex-launched "
        "processes crash on this machine. See docs/BLENDER_CRASH_LOG.md."
    )
