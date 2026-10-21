"""Author refined combat and reaction actions for the V2 Wyvern rig:
1. attack: Ground melee bite with coiling anticipation, jaw unhinge, lunging bite clamp, and dynamic skull recoil.
2. attack2: Ground melee tail sweep with upright quadrupedal orientation fix, lateral caudal whip, and jaw clamp.
3. attackAir2: Aerial talon strike with upright flight orientation fix, aerodynamic lift wingspan, and downward talon rake.
4. breath: Channeled cone with chest expansion respiratory pump on Spine1-3, neck snaking, wide jaw unhinge (> 45°), and clamp cutoff.
5. death: Fatal impact recoil, dramatic gravitational collapse (drop > 200 units), floor impact splay, and held terminal rest adhering to ground plane.
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
        raise RuntimeError(f"Source action '{source_name}' not found")
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

# =============================================================
# 1. AUTHOR ATTACK (Ground Melee Bite, 36 frames / 1.5s)
# =============================================================
def author_attack():
    action = ensure_action_copy("attack.001", "attack_V2Candidate")
    bag = get_channel_bag(action)
    frames = 36

    # 1. JAW: Anticipation open wide (-32°), clamp tightly shut to 0.0° at f=14
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_rot = create_quaternion_curves(bag, "Jaw")
    jaw_loc = create_location_curves(bag, "Jaw")

    for f in range(frames + 1):
        if f <= 8:
            t = f / 8.0
            pitch = lerp(0.0, -32.0, smoothstep(0.0, 1.0, t))
        elif f <= 14:
            t = (f - 8.0) / 6.0
            # Explosive snap shut
            pitch = lerp(-32.0, 0.0, t * t)
        else:
            # Clamped shut tightly at rest
            pitch = 0.0

        q = Euler((math.radians(pitch), 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_rot[i].keyframe_points.insert(f, val)
        for i in range(3):
            jaw_loc[i].keyframe_points.insert(f, 0.0)

    # 2. HEAD & NECK: Coiling back (+14°), lunging downward strike (-18°), dynamic skull recoil (+18°)
    remove_bone_rot_curves(bag, "Head")
    remove_bone_rot_curves(bag, "Neck1")
    remove_bone_rot_curves(bag, "Neck2")
    head_rot = create_quaternion_curves(bag, "Head")
    neck1_rot = create_quaternion_curves(bag, "Neck1")
    neck2_rot = create_quaternion_curves(bag, "Neck2")

    for f in range(frames + 1):
        if f <= 8:
            t = f / 8.0
            hp = lerp(0.0, 14.0, smoothstep(0.0, 1.0, t))
            np = lerp(0.0, 6.0, smoothstep(0.0, 1.0, t))
        elif f <= 14:
            t = (f - 8.0) / 6.0
            hp = lerp(14.0, -18.0, t * t)
            np = lerp(6.0, -8.0, t * t)
        elif f <= 20:
            # Skull recoil vibration!
            t = (f - 14.0) / 6.0
            hp = lerp(-18.0, 18.0, smoothstep(0.0, 1.0, t))
            np = lerp(-8.0, 8.0, smoothstep(0.0, 1.0, t))
        elif f <= 28:
            t = (f - 20.0) / 8.0
            hp = lerp(18.0, -2.0, smoothstep(0.0, 1.0, t))
            np = lerp(8.0, -1.0, smoothstep(0.0, 1.0, t))
        else:
            t = (f - 28.0) / 8.0
            hp = lerp(-2.0, 0.0, smoothstep(0.0, 1.0, t))
            np = lerp(-1.0, 0.0, smoothstep(0.0, 1.0, t))

        qh = Euler((math.radians(hp), 0.0, 0.0), "XYZ").to_quaternion()
        qn = Euler((math.radians(np), 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qh.w, qh.x, qh.y, qh.z)):
            head_rot[i].keyframe_points.insert(f, val)
        for i, val in enumerate((qn.w, qn.x, qn.y, qn.z)):
            neck1_rot[i].keyframe_points.insert(f, val)
            neck2_rot[i].keyframe_points.insert(f, val)

    # 3. BODY: Subtle lunging thrust forward and recoil
    remove_bone_rot_curves(bag, "Body")
    remove_bone_loc_curves(bag, "Body")
    body_rot = create_quaternion_curves(bag, "Body")
    body_loc = create_location_curves(bag, "Body")

    for f in range(frames + 1):
        if f <= 8:
            t = f / 8.0
            bp = lerp(0.0, 3.0, smoothstep(0.0, 1.0, t))
            z_off = lerp(0.0, -8.0, smoothstep(0.0, 1.0, t))
        elif f <= 14:
            t = (f - 8.0) / 6.0
            bp = lerp(3.0, -6.0, t * t)
            z_off = lerp(-8.0, 18.0, t * t)
        elif f <= 22:
            t = (f - 14.0) / 8.0
            bp = lerp(-6.0, 4.0, smoothstep(0.0, 1.0, t))
            z_off = lerp(18.0, -4.0, smoothstep(0.0, 1.0, t))
        else:
            t = (f - 22.0) / 14.0
            bp = lerp(4.0, 0.0, smoothstep(0.0, 1.0, t))
            z_off = lerp(-4.0, 0.0, smoothstep(0.0, 1.0, t))

        qb = Euler((math.radians(bp), 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qb.w, qb.x, qb.y, qb.z)):
            body_rot[i].keyframe_points.insert(f, val)
        for i, val in enumerate((0.0, 0.0, z_off)):
            body_loc[i].keyframe_points.insert(f, val)

    print("Author attack complete")
    return action

# =============================================================
# 2. AUTHOR ATTACK2 (Ground Melee Tail Sweep, 80 frames / 3.33s)
# =============================================================
def author_attack2():
    action = ensure_action_copy("attack2.001", "attack2_V2Candidate")
    bag = get_channel_bag(action)
    frames = 80

    # 1. FIX BODY & ROOT: Inverted vendor pose -> Upright quadrupedal ground stance!
    remove_bone_rot_curves(bag, "Root")
    remove_bone_loc_curves(bag, "Root")
    remove_bone_rot_curves(bag, "RootMotion")
    remove_bone_loc_curves(bag, "RootMotion")
    remove_bone_rot_curves(bag, "Body")
    remove_bone_loc_curves(bag, "Body")

    body_rot = create_quaternion_curves(bag, "Body")
    body_loc = create_location_curves(bag, "Body")

    for f in range(frames + 1):
        if f <= 20:
            t = f / 20.0
            yaw = lerp(0.0, 12.0, smoothstep(0.0, 1.0, t))
            pitch = lerp(0.0, 4.0, smoothstep(0.0, 1.0, t))
        elif f <= 48:
            t = (f - 20.0) / 28.0
            yaw = lerp(12.0, -28.0, smoothstep(0.0, 1.0, t))
            pitch = lerp(4.0, -6.0, smoothstep(0.0, 1.0, t))
        else:
            t = (f - 48.0) / 32.0
            yaw = lerp(-28.0, 0.0, smoothstep(0.0, 1.0, t))
            pitch = lerp(-6.0, 0.0, smoothstep(0.0, 1.0, t))

        qb = Euler((math.radians(pitch), math.radians(yaw), 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qb.w, qb.x, qb.y, qb.z)):
            body_rot[i].keyframe_points.insert(f, val)
        for i in range(3):
            body_loc[i].keyframe_points.insert(f, 0.0)

    # 2. JAW: Threat snarl open (-24°), clamp shut at f=30 with dynamic skull recoil
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_rot = create_quaternion_curves(bag, "Jaw")
    jaw_loc = create_location_curves(bag, "Jaw")

    for f in range(frames + 1):
        if f <= 18:
            t = f / 18.0
            jp = lerp(0.0, -24.0, smoothstep(0.0, 1.0, t))
        elif f <= 30:
            t = (f - 18.0) / 12.0
            jp = lerp(-24.0, 0.0, t * t)
        else:
            jp = 0.0

        qj = Euler((math.radians(jp), 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qj.w, qj.x, qj.y, qj.z)):
            jaw_rot[i].keyframe_points.insert(f, val)
        for i in range(3):
            jaw_loc[i].keyframe_points.insert(f, 0.0)

    # 3. HEAD & NECK: Follows torso rotation with counter-pitch recoil
    remove_bone_rot_curves(bag, "Head")
    remove_bone_rot_curves(bag, "Neck1")
    remove_bone_rot_curves(bag, "Neck2")
    head_rot = create_quaternion_curves(bag, "Head")
    neck1_rot = create_quaternion_curves(bag, "Neck1")
    neck2_rot = create_quaternion_curves(bag, "Neck2")

    for f in range(frames + 1):
        if f <= 18:
            t = f / 18.0
            hp = lerp(0.0, 8.0, smoothstep(0.0, 1.0, t))
            hy = lerp(0.0, 10.0, smoothstep(0.0, 1.0, t))
        elif f <= 30:
            t = (f - 18.0) / 12.0
            hp = lerp(8.0, -14.0, t * t)
            hy = lerp(10.0, -18.0, smoothstep(0.0, 1.0, t))
        elif f <= 44:
            # Skull recoil
            t = (f - 30.0) / 14.0
            hp = lerp(-14.0, 16.0, smoothstep(0.0, 1.0, t))
            hy = lerp(-18.0, -8.0, smoothstep(0.0, 1.0, t))
        else:
            t = (f - 44.0) / 36.0
            hp = lerp(16.0, 0.0, smoothstep(0.0, 1.0, t))
            hy = lerp(-8.0, 0.0, smoothstep(0.0, 1.0, t))

        qh = Euler((math.radians(hp), math.radians(hy), 0.0), "XYZ").to_quaternion()
        qn = Euler((math.radians(hp * 0.5), math.radians(hy * 0.5), 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qh.w, qh.x, qh.y, qh.z)):
            head_rot[i].keyframe_points.insert(f, val)
        for i, val in enumerate((qn.w, qn.x, qn.y, qn.z)):
            neck1_rot[i].keyframe_points.insert(f, val)
            neck2_rot[i].keyframe_points.insert(f, val)

    # 4. TAIL: Full progressive caudal traveling whip through Tail1..Tail10
    for seg in range(1, 11):
        bname = f"Tail{seg}"
        remove_bone_rot_curves(bag, bname)
        rot_curves = create_quaternion_curves(bag, bname)

        amp = 5.0 + seg * 4.5  # Tail1: ~9.5°, Tail10: ~50°
        lag = (seg - 1) * 1.5

        for f in range(frames + 1):
            if f <= 15:
                # Coil opposite
                t = f / 15.0
                yaw = lerp(0.0, -amp * 0.4, smoothstep(0.0, 1.0, t))
            elif f <= 50:
                # Explosive whip stroke
                eff_f = max(0.0, min(35.0, (f - 15.0) - lag))
                t = eff_f / 35.0
                yaw = lerp(-amp * 0.4, amp, smoothstep(0.0, 1.0, t))
            else:
                # Recovery
                eff_f = max(0.0, min(30.0, (f - 50.0) - lag))
                t = eff_f / 30.0
                yaw = lerp(amp, 0.0, smoothstep(0.0, 1.0, t))

            q = Euler((0.0, math.radians(yaw), 0.0), "XYZ").to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                rot_curves[i].keyframe_points.insert(f, val)

    # 5. HIND LEGS & KNUCKLES: Quadrupedal ground contact
    for bone_l in ["L_Thigh", "L_Calf", "L_Foot", "L_Toes"]:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        base_angles = {
            "L_Thigh": -27.4,
            "L_Calf": 52.1,
            "L_Foot": 2.4,
            "L_Toes": 0.0,
        }[bone_l]

        for f in range(frames + 1):
            ql = Euler((math.radians(base_angles), 0.0, 0.0), "XYZ").to_quaternion()
            qr = mirror_quaternion(ql)
            for i, val in enumerate((ql.w, ql.x, ql.y, ql.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((qr.w, qr.x, qr.y, qr.z)):
                curves_r[i].keyframe_points.insert(f, val)

    print("Author attack2 complete")
    return action

# =============================================================
# 3. AUTHOR ATTACKAIR2 (Aerial Talon Strike & Rake, 80 frames / 3.33s)
# =============================================================
def author_attackAir2():
    action = ensure_action_copy("attackAir2.001", "attackAir2_V2Candidate")
    bag = get_channel_bag(action)
    frames = 80

    # 1. FIX BODY & ROOT: Flight coordinate orientation (no 167° flip, no translation offset)
    remove_bone_rot_curves(bag, "Root")
    remove_bone_loc_curves(bag, "Root")
    remove_bone_rot_curves(bag, "RootMotion")
    remove_bone_loc_curves(bag, "RootMotion")
    remove_bone_rot_curves(bag, "Body")
    remove_bone_loc_curves(bag, "Body")

    body_rot = create_quaternion_curves(bag, "Body")
    body_loc = create_location_curves(bag, "Body")

    for f in range(frames + 1):
        if f <= 20:
            t = f / 20.0
            bp = lerp(0.0, 6.0, smoothstep(0.0, 1.0, t))
            z_off = 0.0
        elif f <= 45:
            # Stoop plunge into strike
            t = (f - 20.0) / 25.0
            bp = lerp(6.0, 24.0, smoothstep(0.0, 1.0, t))
            z_off = lerp(0.0, -20.0, smoothstep(0.0, 1.0, t))
        elif f <= 60:
            # Flare pull-out as talons rake
            t = (f - 45.0) / 15.0
            bp = lerp(24.0, -16.0, smoothstep(0.0, 1.0, t))
            z_off = lerp(-20.0, 15.0, smoothstep(0.0, 1.0, t))
        else:
            # Level out to cruise
            t = (f - 60.0) / 20.0
            bp = lerp(-16.0, 0.0, smoothstep(0.0, 1.0, t))
            z_off = lerp(15.0, 0.0, smoothstep(0.0, 1.0, t))

        qb = Euler((math.radians(bp), 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qb.w, qb.x, qb.y, qb.z)):
            body_rot[i].keyframe_points.insert(f, val)
        for i, val in enumerate((0.0, 0.0, z_off)):
            body_loc[i].keyframe_points.insert(f, val)

    # 2. WINGS: Sustained aerodynamic wingspan (> 1400 units), flapping pull-out
    wing_configs = {
        "L_WingShoulder": {
            "glide": (math.radians(-10.4), math.radians(0.7), math.radians(-5.5)),
            "strike": (math.radians(-15.0), math.radians(5.0), math.radians(-10.0)),
            "downstroke": (math.radians(-32.0), math.radians(0.0), math.radians(-8.0)),
        },
        "L_WingElbow": {
            "glide": (math.radians(-14.0), math.radians(-3.5), math.radians(36.6)),
            "strike": (math.radians(-8.0), math.radians(0.0), math.radians(25.0)),
            "downstroke": (math.radians(-5.0), math.radians(0.0), math.radians(15.0)),
        },
        "L_WingWrist": {
            "glide": (math.radians(-8.9), math.radians(1.8), math.radians(-15.1)),
            "strike": (math.radians(-5.0), math.radians(0.0), math.radians(-10.0)),
            "downstroke": (math.radians(0.0), math.radians(0.0), math.radians(-5.0)),
        },
        "L_WingHand": {
            "glide": (math.radians(-0.8), math.radians(-36.2), math.radians(-15.3)),
            "strike": (math.radians(0.0), math.radians(-25.0), math.radians(-10.0)),
            "downstroke": (math.radians(0.0), math.radians(-15.0), math.radians(0.0)),
        },
    }

    for bone_l, cfg in wing_configs.items():
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for f in range(frames + 1):
            if f <= 35:
                euler = cfg["glide"]
            elif f <= 50:
                t = (f - 35.0) / 15.0
                euler = lerp_tuple(cfg["glide"], cfg["strike"], smoothstep(0.0, 1.0, t))
            elif f <= 65:
                t = (f - 50.0) / 15.0
                euler = lerp_tuple(cfg["strike"], cfg["downstroke"], smoothstep(0.0, 1.0, t))
            else:
                t = (f - 65.0) / 15.0
                euler = lerp_tuple(cfg["downstroke"], cfg["glide"], smoothstep(0.0, 1.0, t))

            ql = Euler(euler, "XYZ").to_quaternion()
            qr = mirror_quaternion(ql)
            for i, val in enumerate((ql.w, ql.x, ql.y, ql.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((qr.w, qr.x, qr.y, qr.z)):
                curves_r[i].keyframe_points.insert(f, val)

    # 3. HIND LIMBS: Downward reach strike & slashing rake
    leg_bones = ["L_Thigh", "L_Calf", "L_Foot", "L_Toes"]
    for bone_l in leg_bones:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for f in range(frames + 1):
            if bone_l == "L_Thigh":
                if f <= 15:
                    # Flight tuck
                    pitch = 20.0
                elif f <= 38:
                    # Extended reach forward & downward
                    t = (f - 15.0) / 23.0
                    pitch = lerp(20.0, -38.0, smoothstep(0.0, 1.0, t))
                elif f <= 55:
                    # Backward slashing rake
                    t = (f - 38.0) / 17.0
                    pitch = lerp(-38.0, 42.0, smoothstep(0.0, 1.0, t))
                else:
                    # Settle back to cruise tuck
                    t = (f - 55.0) / 25.0
                    pitch = lerp(42.0, 20.0, smoothstep(0.0, 1.0, t))
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Calf":
                if f <= 15:
                    pitch = 15.0
                elif f <= 38:
                    t = (f - 15.0) / 23.0
                    pitch = lerp(15.0, -20.0, smoothstep(0.0, 1.0, t))
                elif f <= 55:
                    t = (f - 38.0) / 17.0
                    pitch = lerp(-20.0, 50.0, smoothstep(0.0, 1.0, t))
                else:
                    t = (f - 55.0) / 25.0
                    pitch = lerp(50.0, 15.0, smoothstep(0.0, 1.0, t))
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Foot":
                if f <= 15:
                    pitch = 0.0
                elif f <= 38:
                    # Claws forward & down
                    t = (f - 15.0) / 23.0
                    pitch = lerp(0.0, 45.0, smoothstep(0.0, 1.0, t))
                elif f <= 55:
                    # Rake backward
                    t = (f - 38.0) / 17.0
                    pitch = lerp(45.0, -50.0, smoothstep(0.0, 1.0, t))
                else:
                    t = (f - 55.0) / 25.0
                    pitch = lerp(-50.0, 0.0, smoothstep(0.0, 1.0, t))
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Toes":
                if f <= 15:
                    pitch = 0.0
                elif f <= 38:
                    t = (f - 15.0) / 23.0
                    pitch = lerp(0.0, 25.0, smoothstep(0.0, 1.0, t))
                elif f <= 55:
                    t = (f - 38.0) / 17.0
                    pitch = lerp(25.0, -40.0, smoothstep(0.0, 1.0, t))
                else:
                    t = (f - 55.0) / 25.0
                    pitch = lerp(-40.0, 0.0, smoothstep(0.0, 1.0, t))
                euler = (math.radians(pitch), 0.0, 0.0)

            ql = Euler(euler, "XYZ").to_quaternion()
            qr = mirror_quaternion(ql)
            for i, val in enumerate((ql.w, ql.x, ql.y, ql.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((qr.w, qr.x, qr.y, qr.z)):
                curves_r[i].keyframe_points.insert(f, val)

    # 4. JAW & HEAD: Predatory shriek & skull recoil
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_rot = create_quaternion_curves(bag, "Jaw")
    jaw_loc = create_location_curves(bag, "Jaw")

    remove_bone_rot_curves(bag, "Head")
    head_rot = create_quaternion_curves(bag, "Head")

    for f in range(frames + 1):
        if f <= 15:
            jp = 0.0
            hp = 0.0
        elif f <= 35:
            t = (f - 15.0) / 20.0
            jp = lerp(0.0, -32.0, smoothstep(0.0, 1.0, t))
            hp = lerp(0.0, -12.0, smoothstep(0.0, 1.0, t))
        elif f <= 48:
            t = (f - 35.0) / 13.0
            jp = lerp(-32.0, 0.0, t * t)
            hp = lerp(-12.0, 18.0, smoothstep(0.0, 1.0, t))
        else:
            t = (f - 48.0) / 32.0
            jp = 0.0
            hp = lerp(18.0, 0.0, smoothstep(0.0, 1.0, t))

        qj = Euler((math.radians(jp), 0.0, 0.0), "XYZ").to_quaternion()
        qh = Euler((math.radians(hp), 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qj.w, qj.x, qj.y, qj.z)):
            jaw_rot[i].keyframe_points.insert(f, val)
        for i in range(3):
            jaw_loc[i].keyframe_points.insert(f, 0.0)
        for i, val in enumerate((qh.w, qh.x, qh.y, qh.z)):
            head_rot[i].keyframe_points.insert(f, val)

    print("Author attackAir2 complete")
    return action

# =============================================================
# 4. AUTHOR BREATH (Channeled Breath Cone, 48 frames / 2.0s)
# =============================================================
def author_breath():
    action = ensure_action_copy("breath.001", "breath_V2Candidate")
    bag = get_channel_bag(action)
    frames = 48

    # 1. JAW: Wide unhinge (> 45° in glTF, -65° in Blender), sustained emission, tight clamp cutoff
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_rot = create_quaternion_curves(bag, "Jaw")
    jaw_loc = create_location_curves(bag, "Jaw")

    for f in range(frames + 1):
        if f <= 8:
            jp = 0.0
        elif f <= 16:
            # Wide unhinge: -65° in Blender brings glTF pitch to (13.56 - 65) = -51.44°
            t = (f - 8.0) / 8.0
            jp = lerp(0.0, -65.0, smoothstep(0.0, 1.0, t))
        elif f <= 36:
            # Channeled emission with respiratory pump oscillation
            osc = math.sin((f - 16.0) * 0.8) * 2.5
            jp = -65.0 + osc
        elif f <= 42:
            # Sharp cutoff clamp
            t = (f - 36.0) / 6.0
            jp = lerp(-65.0, 0.0, t * t)
        else:
            jp = 0.0

        qj = Euler((math.radians(jp), 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qj.w, qj.x, qj.y, qj.z)):
            jaw_rot[i].keyframe_points.insert(f, val)
        for i in range(3):
            jaw_loc[i].keyframe_points.insert(f, 0.0)

    # 2. CHEST / SPINE: Respiratory expansion pump
    for spine_name in ["Spine1", "Spine2", "Spine3"]:
        remove_bone_rot_curves(bag, spine_name)
        spine_rot = create_quaternion_curves(bag, spine_name)

        for f in range(frames + 1):
            if f <= 14:
                # Deep inhale expansion
                t = f / 14.0
                sp = lerp(0.0, 6.0, smoothstep(0.0, 1.0, t))
            elif f <= 36:
                # Channeled respiratory contractions
                osc = math.sin((f - 14.0) * 0.8) * 3.0
                sp = 2.0 + osc
            else:
                # Settle
                t = (f - 36.0) / 12.0
                sp = lerp(2.0, 0.0, smoothstep(0.0, 1.0, t))

            qs = Euler((math.radians(sp), 0.0, 0.0), "XYZ").to_quaternion()
            for i, val in enumerate((qs.w, qs.x, qs.y, qs.z)):
                spine_rot[i].keyframe_points.insert(f, val)

    # 3. HEAD & NECK: Arches up on inhale, snakes forward on emission, recoils on cutoff
    remove_bone_rot_curves(bag, "Head")
    remove_bone_rot_curves(bag, "Neck1")
    remove_bone_rot_curves(bag, "Neck2")
    head_rot = create_quaternion_curves(bag, "Head")
    neck1_rot = create_quaternion_curves(bag, "Neck1")
    neck2_rot = create_quaternion_curves(bag, "Neck2")

    for f in range(frames + 1):
        if f <= 12:
            t = f / 12.0
            hp = lerp(0.0, 14.0, smoothstep(0.0, 1.0, t))
            hy = 0.0
        elif f <= 36:
            # Snakes forward, sweeping channeled cone
            t = (f - 12.0) / 24.0
            hp = lerp(14.0, -10.0, smoothstep(0.0, 1.0, t))
            hy = math.sin(t * math.pi * 2.0) * 8.0
        elif f <= 42:
            # Cutoff skull recoil
            t = (f - 36.0) / 6.0
            hp = lerp(-10.0, 18.0, smoothstep(0.0, 1.0, t))
            hy = lerp(hy, 0.0, t)
        else:
            t = (f - 42.0) / 6.0
            hp = lerp(18.0, 0.0, smoothstep(0.0, 1.0, t))
            hy = 0.0

        qh = Euler((math.radians(hp), math.radians(hy), 0.0), "XYZ").to_quaternion()
        qn = Euler((math.radians(hp * 0.5), math.radians(hy * 0.5), 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qh.w, qh.x, qh.y, qh.z)):
            head_rot[i].keyframe_points.insert(f, val)
        for i, val in enumerate((qn.w, qn.x, qn.y, qn.z)):
            neck1_rot[i].keyframe_points.insert(f, val)
            neck2_rot[i].keyframe_points.insert(f, val)

    print("Author breath complete")
    return action

# =============================================================
# 5. AUTHOR DEATH (Dramatic Collapse & Impact Settle, 96 frames / 4.0s)
# =============================================================
def author_death():
    action = ensure_action_copy("death.001", "death_V2Candidate")
    bag = get_channel_bag(action)
    frames = 96

    # 1. BODY: Fatal hit recoil, dramatic gravitational drop (> 200 units), floor impact, and flat terminal hold
    # In Blender rig coordinates, +Z translates downward in world elevation
    remove_bone_rot_curves(bag, "Body")
    remove_bone_loc_curves(bag, "Body")
    body_rot = create_quaternion_curves(bag, "Body")
    body_loc = create_location_curves(bag, "Body")

    for f in range(frames + 1):
        if f <= 16:
            # Phase 1: Fatal impact recoil
            t = f / 16.0
            pitch = lerp(0.0, -12.0, smoothstep(0.0, 1.0, t))
            roll = 0.0
            yaw = 0.0
            z_off = lerp(0.0, -20.0, smoothstep(0.0, 1.0, t))
        elif f <= 58:
            # Phase 2: Dramatic gravitational collapse! (Drop down 520 units toward floor)
            t = (f - 16.0) / 42.0
            fall = t * t
            pitch = lerp(-12.0, 15.0, smoothstep(0.0, 1.0, t))
            roll = lerp(0.0, 12.0, smoothstep(0.0, 1.0, t))
            yaw = lerp(0.0, 18.0, smoothstep(0.0, 1.0, t))
            z_off = lerp(-20.0, 520.0, fall)
        elif f <= 72:
            # Phase 3: Impact thud with subtle ground compression bounce
            t = (f - 58.0) / 14.0
            bounce = math.sin(t * math.pi) * 15.0
            pitch = 15.0
            roll = 12.0
            yaw = 18.0
            z_off = 520.0 - bounce
        else:
            # Phase 4: Final flat resting settle adhering to ground plane
            pitch = 15.0
            roll = 12.0
            yaw = 18.0
            z_off = 520.0

        qb = Euler((math.radians(pitch), math.radians(yaw), math.radians(roll)), "XYZ").to_quaternion()
        for i, val in enumerate((qb.w, qb.x, qb.y, qb.z)):
            body_rot[i].keyframe_points.insert(f, val)
        for i, val in enumerate((0.0, 0.0, z_off)):
            body_loc[i].keyframe_points.insert(f, val)

    # 2. HIND LIMBS: Buckle under falling weight, splay outward on ground plane
    for bone_l in ["L_Thigh", "L_Calf", "L_Foot", "L_Toes"]:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for f in range(frames + 1):
            if bone_l == "L_Thigh":
                if f <= 16:
                    pitch = 0.0
                elif f <= 60:
                    t = (f - 16.0) / 44.0
                    pitch = lerp(0.0, -50.0, smoothstep(0.0, 1.0, t))
                else:
                    pitch = -50.0
                euler = (math.radians(pitch), 0.0, math.radians(10.0))
            elif bone_l == "L_Calf":
                if f <= 16:
                    pitch = 0.0
                elif f <= 60:
                    t = (f - 16.0) / 44.0
                    pitch = lerp(0.0, 60.0, smoothstep(0.0, 1.0, t))
                else:
                    pitch = 60.0
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Foot":
                if f <= 16:
                    pitch = 0.0
                elif f <= 60:
                    t = (f - 16.0) / 44.0
                    pitch = lerp(0.0, -10.0, smoothstep(0.0, 1.0, t))
                else:
                    pitch = -10.0
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Toes":
                euler = (0.0, 0.0, 0.0)

            ql = Euler(euler, "XYZ").to_quaternion()
            qr = mirror_quaternion(ql)
            for i, val in enumerate((ql.w, ql.x, ql.y, ql.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((qr.w, qr.x, qr.y, qr.z)):
                curves_r[i].keyframe_points.insert(f, val)

    # 3. JAW & HEAD: Death snarl/gasp, collapses to floor plane
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_rot = create_quaternion_curves(bag, "Jaw")
    jaw_loc = create_location_curves(bag, "Jaw")

    remove_bone_rot_curves(bag, "Head")
    head_rot = create_quaternion_curves(bag, "Head")

    for f in range(frames + 1):
        if f <= 16:
            t = f / 16.0
            jp = lerp(0.0, -50.0, smoothstep(0.0, 1.0, t))
            hp = lerp(0.0, -18.0, smoothstep(0.0, 1.0, t))
        elif f <= 60:
            t = (f - 16.0) / 44.0
            jp = lerp(-50.0, -18.0, smoothstep(0.0, 1.0, t))
            hp = lerp(-18.0, 12.0, smoothstep(0.0, 1.0, t))
        else:
            jp = -18.0
            hp = 12.0

        qj = Euler((math.radians(jp), 0.0, 0.0), "XYZ").to_quaternion()
        qh = Euler((math.radians(hp), 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qj.w, qj.x, qj.y, qj.z)):
            jaw_rot[i].keyframe_points.insert(f, val)
        for i in range(3):
            jaw_loc[i].keyframe_points.insert(f, 0.0)
        for i, val in enumerate((qh.w, qh.x, qh.y, qh.z)):
            head_rot[i].keyframe_points.insert(f, val)

    # 4. WINGS: Tension release, splay and drape flat along floor
    wing_configs = {
        "L_WingShoulder": (math.radians(25.0), math.radians(35.0), math.radians(-30.0)),
        "L_WingElbow": (math.radians(-15.0), math.radians(20.0), math.radians(45.0)),
        "L_WingWrist": (math.radians(-20.0), math.radians(0.0), math.radians(-30.0)),
        "L_WingHand": (math.radians(-10.0), math.radians(-45.0), math.radians(20.0)),
    }
    for bone_l, flat_euler in wing_configs.items():
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for f in range(frames + 1):
            if f <= 20:
                euler = (0.0, 0.0, 0.0)
            elif f <= 65:
                t = (f - 20.0) / 45.0
                euler = lerp_tuple((0.0, 0.0, 0.0), flat_euler, smoothstep(0.0, 1.0, t))
            else:
                euler = flat_euler

            ql = Euler(euler, "XYZ").to_quaternion()
            qr = mirror_quaternion(ql)
            for i, val in enumerate((ql.w, ql.x, ql.y, ql.z)):
                curves_l[i].keyframe_points.insert(f, val)
            for i, val in enumerate((qr.w, qr.x, qr.y, qr.z)):
                curves_r[i].keyframe_points.insert(f, val)

    print("Author death complete")
    return action

# Execute all 5 action authoring passes
author_attack()
author_attack2()
author_attackAir2()
author_breath()
author_death()

# Export all 5 candidate actions to GLB
rig = bpy.data.objects[RIG_NAME]
mesh = bpy.data.objects[MESH_NAME]

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = rig

candidate_exports = [
    ("attack_V2Candidate", "attack-v2-shape-candidate.glb"),
    ("attack2_V2Candidate", "attack2-v2-shape-candidate.glb"),
    ("attackAir2_V2Candidate", "attackAir2-v2-shape-candidate.glb"),
    ("breath_V2Candidate", "breath-v2-shape-candidate.glb"),
    ("death_V2Candidate", "death-v2-shape-candidate.glb"),
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
