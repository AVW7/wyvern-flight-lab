"""Author refined locomotion and rest actions for the V2 Wyvern rig:
1. hover: Supported airborne stationary posture, vertical lift wing cadence, stabilized predatory eyeline, caudal counter-heave.
2. scout: Slow cruising search flight, broad horizon scanning with neck/head yaw/pitch, steady gliding dihedral carriage.
3. speed: Forward high-speed flight posture, swept tucked wings, low drag profile, tight caudal stream, streamlined leg tuck.
4. rest: Low supported quadrupedal resting stance, relaxed folded wings along flanks, quiet respiratory modulation.
"""

import json
import math
import socket
from pathlib import Path

BLENDER_SCRIPT = """
import math
from pathlib import Path
import bpy
from mathutils import Quaternion, Euler, Vector

OUT = Path("/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0")
RIG_NAME = "WyvernRig.001"
MESH_NAME = "WyvernMembrane_ExportSafe.001"

rig = bpy.data.objects[RIG_NAME]
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"

def ensure_action_copy(source_name, target_name):
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

def remove_bone_rot_curves(bag, bone_name):
    prefix = f'pose.bones["{bone_name}"].rotation_quaternion'
    curves_to_remove = [c for c in bag.fcurves if c.data_path == prefix]
    for c in curves_to_remove:
        bag.fcurves.remove(c)

def remove_bone_loc_curves(bag, bone_name):
    prefix = f'pose.bones["{bone_name}"].location'
    curves_to_remove = [c for c in bag.fcurves if c.data_path == prefix]
    for c in curves_to_remove:
        bag.fcurves.remove(c)

def create_quaternion_curves(bag, bone_name):
    prefix = f'pose.bones["{bone_name}"].rotation_quaternion'
    curves = []
    for i in range(4):
        c = bag.fcurves.new(data_path=prefix, index=i)
        curves.append(c)
    return curves

def create_location_curves(bag, bone_name):
    prefix = f'pose.bones["{bone_name}"].location'
    curves = []
    for i in range(3):
        c = bag.fcurves.new(data_path=prefix, index=i)
        curves.append(c)
    return curves

def mirror_quaternion(q):
    return Quaternion((q.w, q.x, -q.y, -q.z))

def smoothstep(edge0, edge1, x):
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)

def lerp(a, b, t):
    return a + (b - a) * t

def lerp_tuple(t1, t2, t):
    return tuple(lerp(a, b, t) for a, b in zip(t1, t2))

def get_stepped_frames(total, step=2):
    fr = list(range(0, total, step))
    if not fr or fr[-1] != total:
        fr.append(total)
    return fr

# =============================================================
# 1. AUTHOR HOVER (Airborne Stationary Lift Cadence, 144 frames)
# =============================================================
def author_hover():
    action = ensure_action_copy("hover", "hover_V2Candidate")
    bag = get_channel_bag(action)
    total_frames = 144
    beat_period = 36.0
    omega_beat = 2.0 * math.pi / beat_period
    frames = get_stepped_frames(total_frames, 2)

    # 1. ROOT & ROOTMOTION: Neutralize vendor -38° RootMotion pitch tilt to retain flight elevation space
    remove_bone_rot_curves(bag, "RootMotion")
    remove_bone_loc_curves(bag, "RootMotion")
    rm_rot = create_quaternion_curves(bag, "RootMotion")
    rm_loc = create_location_curves(bag, "RootMotion")
    for f in [0, total_frames]:
        for i, val in enumerate((1.0, 0.0, 0.0, 0.0)):
            rm_rot[i].keyframe_points.insert(f, val)
        for i in range(3):
            rm_loc[i].keyframe_points.insert(f, 0.0)

    # 2. JAW: Natural closed resting posture (0° pitch), zeroed socket location
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    for f in frames:
        breath = math.sin(omega_beat * f) * math.radians(0.3)
        q = Quaternion((math.cos(breath / 2.0), math.sin(breath / 2.0), 0.0, 0.0))
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_curves[i].keyframe_points.insert(f, val)
    for f in [0, total_frames]:
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(f, 0.0)

    # 3. BODY: Vertical lift equilibrium
    remove_bone_rot_curves(bag, "Body")
    remove_bone_loc_curves(bag, "Body")
    body_rot_curves = create_quaternion_curves(bag, "Body")
    body_loc_curves = create_location_curves(bag, "Body")
    base_body_pitch = math.radians(1.5)

    for f in frames:
        heave_z = math.sin(omega_beat * f - math.pi * 0.25) * 8.0
        pitch = base_body_pitch + math.sin(omega_beat * f) * math.radians(1.8)
        e = Euler((pitch, 0.0, 0.0), "XYZ")
        q = e.to_quaternion()
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            body_rot_curves[i].keyframe_points.insert(f, val)
        body_loc_curves[0].keyframe_points.insert(f, 0.0)
        body_loc_curves[1].keyframe_points.insert(f, 0.0)
        body_loc_curves[2].keyframe_points.insert(f, heave_z)

    # 3. HEAD & NECK: Predatory Eyeline Stabilization
    neck_bones = [
        ("Neck1", math.radians(2.0), -math.radians(1.0)),
        ("Neck2", math.radians(2.5), -math.radians(1.2)),
        ("Head",  math.radians(0.0), -math.radians(1.5)),
    ]
    for bone_name, base_p, counter_amp in neck_bones:
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        for f in frames:
            counter_pitch = base_p + math.sin(omega_beat * f) * counter_amp
            scan_yaw = math.sin(2.0 * math.pi * f / total_frames) * math.radians(3.5)
            e = Euler((counter_pitch, scan_yaw, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(f, val)

    # 4. WINGS: Rhythmic Vertical Lift Wingbeat with Smoothstep Distal Easing
    for digit in range(6):
        for part in [0, 1, 2]:
            bone_l = f"L_WingD{digit}P{part}"
            bone_r = f"R_WingD{digit}P{part}"
            remove_bone_rot_curves(bag, bone_l)
            remove_bone_rot_curves(bag, bone_r)

    wing_joints = ["L_WingShoulder", "L_WingElbow", "L_WingWrist", "L_WingHand"]
    curves_dict = {}
    for bone_l in wing_joints:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_dict[bone_l] = create_quaternion_curves(bag, bone_l)
        curves_dict[bone_r] = create_quaternion_curves(bag, bone_r)

    digit_curves = {}
    for digit in range(6):
        for part in [0, 1, 2]:
            bone_l = f"L_WingD{digit}P{part}"
            bone_r = f"R_WingD{digit}P{part}"
            digit_curves[bone_l] = create_quaternion_curves(bag, bone_l)
            digit_curves[bone_r] = create_quaternion_curves(bag, bone_r)

    for f in frames:
        sin_flap = math.sin(omega_beat * f)
        shoulder_pitch = sin_flap * math.radians(30.0)
        shoulder_yaw = math.cos(omega_beat * f) * math.radians(6.0)
        shoulder_roll = math.sin(omega_beat * f) * math.radians(8.0)

        down_factor = smoothstep(-0.2, 0.9, sin_flap)
        elbow_pitch = lerp(-math.radians(14.0), math.radians(6.0), down_factor)
        elbow_yaw = lerp(math.radians(24.0), math.radians(10.0), down_factor)
        wrist_roll = lerp(-math.radians(25.0), -math.radians(8.0), down_factor)
        hand_roll = lerp(-math.radians(20.0), -math.radians(5.0), down_factor)

        q_sh_l = Euler((shoulder_pitch, shoulder_yaw, shoulder_roll), "XYZ").to_quaternion()
        q_el_l = Euler((elbow_pitch, elbow_yaw, 0.0), "XYZ").to_quaternion()
        q_wr_l = Euler((0.0, 0.0, wrist_roll), "XYZ").to_quaternion()
        q_hd_l = Euler((0.0, 0.0, hand_roll), "XYZ").to_quaternion()

        for q_l, bone_l in [(q_sh_l, "L_WingShoulder"), (q_el_l, "L_WingElbow"), (q_wr_l, "L_WingWrist"), (q_hd_l, "L_WingHand")]:
            bone_r = bone_l.replace("L_", "R_")
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_dict[bone_l][i].keyframe_points.insert(f, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_dict[bone_r][i].keyframe_points.insert(f, val)

        for digit in range(6):
            q_d0 = Euler((-math.radians(2.0) * down_factor, 0.0, 0.0), "XYZ").to_quaternion()
            q_d1 = Euler((math.radians(1.5) * down_factor, 0.0, 0.0), "XYZ").to_quaternion()
            q_d2 = Euler((math.radians(1.0) * down_factor, 0.0, 0.0), "XYZ").to_quaternion()
            for part, q_l in [(0, q_d0), (1, q_d1), (2, q_d2)]:
                b_l = f"L_WingD{digit}P{part}"
                b_r = f"R_WingD{digit}P{part}"
                q_r = mirror_quaternion(q_l)
                for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                    digit_curves[b_l][i].keyframe_points.insert(f, val)
                for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                    digit_curves[b_r][i].keyframe_points.insert(f, val)

    # 5. LEGS: Airborne hover semi-tuck
    leg_bones = ["L_Thigh", "L_Calf", "L_Foot", "L_Toes"]
    for bone_l in leg_bones:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)
        for f in frames:
            bob = math.sin(omega_beat * f) * math.radians(1.5)
            if bone_l == "L_Thigh":
                e = Euler((math.radians(12.0) + bob, 0.0, 0.0), "XYZ")
            elif bone_l == "L_Calf":
                e = Euler((math.radians(22.0) - bob, 0.0, 0.0), "XYZ")
            elif bone_l == "L_Foot":
                e = Euler((-math.radians(12.0) + bob, 0.0, 0.0), "XYZ")
            else:
                e = Euler((0.0, 0.0, 0.0), "XYZ")
            q_l = e.to_quaternion()
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(f, val)

    # 6. TAIL: 10-bone caudal wave
    tail_bones = [f"Tail{i}" for i in range(1, 11)]
    for idx, bone_name in enumerate(tail_bones):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        progression = idx / 9.0
        pitch_amp = math.radians(1.2 + 2.5 * progression)
        yaw_amp = math.radians(0.5 + 1.2 * progression)
        phase_lag = idx * 0.35

        for f in frames:
            pitch = math.sin(omega_beat * f - phase_lag) * pitch_amp
            yaw = math.cos(2.0 * math.pi * f / total_frames - phase_lag) * yaw_amp
            e = Euler((pitch, 0.0, yaw), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(f, val)

    print("Author hover complete")
    return action


# =============================================================
# 2. AUTHOR SCOUT (Broad Panoramic Horizon Scan & Gliding Dihedral, 144 frames)
# =============================================================
def author_scout():
    action = ensure_action_copy("scout", "scout_V2Candidate")
    bag = get_channel_bag(action)
    total_frames = 144
    slow_omega = 2.0 * math.pi / total_frames
    frames = get_stepped_frames(total_frames, 2)

    # 1. JAW: Natural closed resting posture, zeroed location
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    for f in frames:
        breath = math.sin(slow_omega * 2.0 * f) * math.radians(0.3)
        q = Quaternion((math.cos(breath / 2.0), math.sin(breath / 2.0), 0.0, 0.0))
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_curves[i].keyframe_points.insert(f, val)
    for f in [0, total_frames]:
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(f, 0.0)

    # 2. BODY & SPINE: Stable cruising flight posture with subtle counter-bank
    remove_bone_rot_curves(bag, "Body")
    body_curves = create_quaternion_curves(bag, "Body")
    base_pitch = math.radians(1.5)
    for f in frames:
        counter_roll = -math.sin(slow_omega * f) * math.radians(1.8)
        thermal_bob = math.sin(slow_omega * 2.0 * f) * math.radians(0.4)
        e = Euler((base_pitch + thermal_bob, counter_roll, 0.0), "XYZ")
        q = e.to_quaternion()
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            body_curves[i].keyframe_points.insert(f, val)

    # 3. HEAD & NECK: Broad Panoramic Horizon Scanning (Primary Scout Signature)
    neck_scan_defs = [
        ("Spine3", 0.0,                0.0,                 math.radians(3.5), 0.15),
        ("Neck1",  math.radians(2.0),  math.radians(1.2),  math.radians(7.5), 0.30),
        ("Neck2",  math.radians(2.5),  math.radians(1.8),  math.radians(11.0), 0.45),
        ("Head",   math.radians(0.0),  math.radians(2.5),  math.radians(15.0), 0.60),
    ]
    for bone_name, base_p, p_amp, y_amp, lag in neck_scan_defs:
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        for f in frames:
            yaw = math.sin(slow_omega * f - lag) * y_amp
            pitch = base_p + math.cos(slow_omega * 2.0 * f) * p_amp
            e = Euler((pitch, yaw, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(f, val)

    # 4. WINGS: Steady Aerodynamic Dihedral Carriage (Wide Soaring Camber)
    for digit in range(6):
        for part in [0, 1, 2]:
            bone_l = f"L_WingD{digit}P{part}"
            bone_r = f"R_WingD{digit}P{part}"
            remove_bone_rot_curves(bag, bone_l)
            remove_bone_rot_curves(bag, bone_r)

    wing_bones_euler = {
        "L_WingShoulder": (math.radians(6.0), math.radians(0.0), math.radians(0.0)),
        "L_WingElbow":    (math.radians(2.8), math.radians(0.0), math.radians(0.0)),
        "L_WingWrist":    (math.radians(0.0), math.radians(0.0), math.radians(-3.5)),
        "L_WingHand":     (math.radians(0.0), math.radians(0.0), math.radians(1.2)),
    }
    for digit in range(6):
        wing_bones_euler[f"L_WingD{digit}P0"] = (math.radians(-1.0), 0.0, 0.0)
        wing_bones_euler[f"L_WingD{digit}P1"] = (math.radians(1.5), 0.0, 0.0)
        wing_bones_euler[f"L_WingD{digit}P2"] = (math.radians(1.0), 0.0, 0.0)

    for bone_l, base_e in wing_bones_euler.items():
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for f in frames:
            thermal_ripple = math.sin(slow_omega * 2.0 * f) * math.radians(0.5)
            e_l = Euler((base_e[0] + thermal_ripple, base_e[1], base_e[2]), "XYZ")
            q_l = e_l.to_quaternion()
            q_r = mirror_quaternion(q_l)

            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(f, val)

    # 5. LEGS: Clean Cruise Belly Tuck
    leg_bones = ["L_Thigh", "L_Calf", "L_Foot", "L_Toes"]
    for bone_l in leg_bones:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)
        for f in frames:
            if bone_l == "L_Thigh":
                e = Euler((math.radians(20.0), 0.0, 0.0), "XYZ")
            elif bone_l == "L_Calf":
                e = Euler((math.radians(15.0), 0.0, 0.0), "XYZ")
            elif bone_l == "L_Foot":
                e = Euler((0.0, 0.0, 0.0), "XYZ")
            else:
                e = Euler((0.0, 0.0, 0.0), "XYZ")
            q_l = e.to_quaternion()
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(f, val)

    # 6. TAIL: Aerodynamic Rudder Trim
    tail_bones = [f"Tail{i}" for i in range(1, 11)]
    for idx, bone_name in enumerate(tail_bones):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        progression = idx / 9.0
        pitch_amp = math.radians(0.6 + 1.2 * progression)
        yaw_amp = math.radians(0.8 + 2.2 * progression)
        phase_lag = idx * 0.25

        for f in frames:
            yaw = -math.sin(slow_omega * f - phase_lag) * yaw_amp
            pitch = math.sin(slow_omega * 2.0 * f - phase_lag) * pitch_amp
            e = Euler((pitch, 0.0, yaw), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(f, val)

    print("Author scout complete")
    return action


# =============================================================
# 3. AUTHOR SPEED (High-Speed Penetration & Swept Wing Tuck, 120 frames)
# =============================================================
def author_speed():
    action = ensure_action_copy("speed", "speed_V2Candidate")
    bag = get_channel_bag(action)
    total_frames = 120
    fast_period = 24.0
    fast_omega = 2.0 * math.pi / fast_period
    frames = get_stepped_frames(total_frames, 2)

    # 1. JAW: Clamped tightly shut
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    for f in [0, total_frames]:
        q = Quaternion((1.0, 0.0, 0.0, 0.0))
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_curves[i].keyframe_points.insert(f, val)
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(f, 0.0)

    # 2. BODY & SPINE: Forward Thrust Penetration Pitch (+16° forward tilt)
    remove_bone_rot_curves(bag, "Body")
    body_curves = create_quaternion_curves(bag, "Body")
    base_speed_pitch = math.radians(16.0)
    for f in frames:
        buffet = math.sin(fast_omega * f) * math.radians(0.8)
        pitch = base_speed_pitch + buffet
        e = Euler((pitch, 0.0, 0.0), "XYZ")
        q = e.to_quaternion()
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            body_curves[i].keyframe_points.insert(f, val)

    # 3. HEAD & NECK: Forward Laser Eyeline Lock along slipstream vector
    neck_bones = [
        ("Neck1", -math.radians(5.0),  math.radians(0.3)),
        ("Neck2", -math.radians(7.0),  math.radians(0.4)),
        ("Head",  -math.radians(8.0),  math.radians(0.4)),
    ]
    for bone_name, base_p, amp in neck_bones:
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        for f in frames:
            pitch = base_p + math.sin(fast_omega * f) * amp
            e = Euler((pitch, 0.0, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(f, val)

    # 4. WINGS: Swept-Back Low-Drag Tucked Wing Profile
    for digit in range(6):
        for part in [0, 1, 2]:
            bone_l = f"L_WingD{digit}P{part}"
            bone_r = f"R_WingD{digit}P{part}"
            remove_bone_rot_curves(bag, bone_l)
            remove_bone_rot_curves(bag, bone_r)

    wing_joints = ["L_WingShoulder", "L_WingElbow", "L_WingWrist", "L_WingHand"]
    curves_dict = {}
    for bone_l in wing_joints:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_dict[bone_l] = create_quaternion_curves(bag, bone_l)
        curves_dict[bone_r] = create_quaternion_curves(bag, bone_r)

    digit_curves = {}
    for digit in range(6):
        for part in [0, 1, 2]:
            bone_l = f"L_WingD{digit}P{part}"
            bone_r = f"R_WingD{digit}P{part}"
            digit_curves[bone_l] = create_quaternion_curves(bag, bone_l)
            digit_curves[bone_r] = create_quaternion_curves(bag, bone_r)

    for f in frames:
        stroke = math.sin(fast_omega * f)
        sh_p = math.radians(-8.0) + stroke * math.radians(10.0)
        sh_y = math.radians(4.0)
        sh_r = math.radians(-32.0)

        el_p = math.radians(8.0)
        el_y = math.radians(16.0)
        el_r = math.radians(22.0)

        wr_r = math.radians(-30.0)
        hd_r = math.radians(-24.0)

        q_sh_l = Euler((sh_p, sh_y, sh_r), "XYZ").to_quaternion()
        q_el_l = Euler((el_p, el_y, el_r), "XYZ").to_quaternion()
        q_wr_l = Euler((0.0, 0.0, wr_r), "XYZ").to_quaternion()
        q_hd_l = Euler((0.0, 0.0, hd_r), "XYZ").to_quaternion()

        for q_l, bone_l in [(q_sh_l, "L_WingShoulder"), (q_el_l, "L_WingElbow"), (q_wr_l, "L_WingWrist"), (q_hd_l, "L_WingHand")]:
            bone_r = bone_l.replace("L_", "R_")
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_dict[bone_l][i].keyframe_points.insert(f, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_dict[bone_r][i].keyframe_points.insert(f, val)

        for digit in range(6):
            q_d0 = Euler((-math.radians(3.0), 0.0, -math.radians(10.0)), "XYZ").to_quaternion()
            q_d1 = Euler((math.radians(1.0), 0.0, -math.radians(12.0)), "XYZ").to_quaternion()
            q_d2 = Euler((math.radians(0.5), 0.0, -math.radians(14.0)), "XYZ").to_quaternion()
            for part, q_l in [(0, q_d0), (1, q_d1), (2, q_d2)]:
                b_l = f"L_WingD{digit}P{part}"
                b_r = f"R_WingD{digit}P{part}"
                q_r = mirror_quaternion(q_l)
                for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                    digit_curves[b_l][i].keyframe_points.insert(f, val)
                for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                    digit_curves[b_r][i].keyframe_points.insert(f, val)

    # 5. LEGS: Tight Aerodynamic Slipstream Tuck
    leg_bones = ["L_Thigh", "L_Calf", "L_Foot", "L_Toes"]
    for bone_l in leg_bones:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)
        for f in frames:
            if bone_l == "L_Thigh":
                e = Euler((math.radians(20.0), 0.0, 0.0), "XYZ")
            elif bone_l == "L_Calf":
                e = Euler((math.radians(15.0), 0.0, 0.0), "XYZ")
            elif bone_l == "L_Foot":
                e = Euler((0.0, 0.0, 0.0), "XYZ")
            else:
                e = Euler((0.0, 0.0, 0.0), "XYZ")
            q_l = e.to_quaternion()
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(f, val)

    # 6. TAIL: Taut Caudal Wake
    tail_bones = [f"Tail{i}" for i in range(1, 11)]
    for idx, bone_name in enumerate(tail_bones):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        progression = idx / 9.0
        pitch_amp = math.radians(0.3 + 0.6 * progression)
        phase_lag = idx * 0.2

        for f in frames:
            pitch = math.sin(fast_omega * f - phase_lag) * pitch_amp
            e = Euler((pitch, 0.0, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(f, val)

    print("Author speed complete")
    return action


# =============================================================
# 4. AUTHOR REST (Low Supported Ground Posture & Folded Flank Wings, 144 frames)
# =============================================================
def author_rest():
    action = ensure_action_copy("rest", "rest_V2Candidate")
    bag = get_channel_bag(action)
    total_frames = 144
    breath_omega = 2.0 * math.pi / 72.0
    frames = get_stepped_frames(total_frames, 2)

    # 1. JAW: Natural closed resting posture, zeroed location
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    for f in frames:
        breath = math.sin(breath_omega * f) * math.radians(0.2)
        q = Quaternion((math.cos(breath / 2.0), math.sin(breath / 2.0), 0.0, 0.0))
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_curves[i].keyframe_points.insert(f, val)
    for f in [0, total_frames]:
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(f, 0.0)

    # 2. BODY & SPINE: Low Ground Stance (Settled Resting Elevation)
    remove_bone_rot_curves(bag, "Body")
    remove_bone_loc_curves(bag, "Body")
    body_rot_curves = create_quaternion_curves(bag, "Body")
    body_loc_curves = create_location_curves(bag, "Body")
    base_rest_pitch = math.radians(12.5)

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

    # Calm respiratory expansion on Spine1-3
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

    # 3. HEAD & NECK: Relaxed resting neck arch and gentle breathing nod
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

    # 4. WINGS: Compact Flank-Folded Knuckle Rest (Wingspan strictly < 1800 units)
    for digit in range(6):
        for part in [0, 1, 2]:
            bone_l = f"L_WingD{digit}P{part}"
            bone_r = f"R_WingD{digit}P{part}"
            remove_bone_rot_curves(bag, bone_l)
            remove_bone_rot_curves(bag, bone_r)

    wing_rest_euler = {
        "L_WingShoulder": (math.radians(9.1),  math.radians(20.9),  math.radians(-16.1)),
        "L_WingElbow":    (math.radians(-27.0), math.radians(12.5),  math.radians(26.5)),
        "L_WingWrist":    (math.radians(-27.1), math.radians(-1.8),  math.radians(-46.0)),
        "L_WingHand":     (math.radians(-21.9), math.radians(-53.5), math.radians(55.9)),
    }
    for digit in range(6):
        wing_rest_euler[f"L_WingD{digit}P0"] = (math.radians(-5.0), 0.0, math.radians(-10.0))
        wing_rest_euler[f"L_WingD{digit}P1"] = (math.radians(-8.0), 0.0, math.radians(-12.0))
        wing_rest_euler[f"L_WingD{digit}P2"] = (math.radians(-6.0), 0.0, math.radians(-15.0))

    for bone_l, base_e in wing_rest_euler.items():
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for f in frames:
            chest_pulse = math.sin(breath_omega * f) * math.radians(0.3)
            e_l = Euler((base_e[0] + chest_pulse, base_e[1], base_e[2]), "XYZ")
            q_l = e_l.to_quaternion()
            q_r = mirror_quaternion(q_l)

            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(f, val)

    # 5. LEGS: Quadrupedal Ground Stance
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

    # 6. TAIL: Relaxed Floor Drape and Gentle Tip Curl
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

    print("Author rest complete")
    return action

# Execute all 4 action authoring passes
author_hover()
author_scout()
author_speed()
author_rest()

# Export all 4 candidate actions to single-action GLBs
rig = bpy.data.objects[RIG_NAME]
mesh = bpy.data.objects[MESH_NAME]

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = rig

candidate_exports = [
    ("hover_V2Candidate", "hover-v2-shape-candidate.glb"),
    ("scout_V2Candidate", "scout-v2-shape-candidate.glb"),
    ("speed_V2Candidate", "speed-v2-shape-candidate.glb"),
    ("rest_V2Candidate", "rest-v2-shape-candidate.glb"),
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
"""

def send_blender_code(code: str):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect(("127.0.0.1", 9876))
    payload = json.dumps({"type": "execute", "code": code, "strict_json": True}).encode("utf-8") + b"\0"
    s.sendall(payload)
    data = b""
    while not data.endswith(b"\0"):
        chunk = s.recv(4096)
        if not chunk:
            break
        data += chunk
    s.close()
    return json.loads(data.rstrip(b"\0").decode("utf-8"))

if __name__ == "__main__":
    res = send_blender_code(BLENDER_SCRIPT)
    print("Blender response:", res.get("stdout", res))
