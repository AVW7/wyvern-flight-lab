"""Author refined takeoff animation for the V2 Wyvern rig with V1 standard parity.

Kinematic structure:
- f=0..6: Ground hold in qualified quadrupedal ground fold (matching idle_V2Candidate exactly:
  Body loc=(0.017, 1119.053, 366.411), knuckles planted, wings folded along flank, closed jaw, feet planted).
- f=6..18: Elastic anticipation crouch: body dips, hind legs compress, wings unfurl wide to high dihedral apex.
- f=18..36: Explosive push-off & primary power downstroke: hind limbs drive downward into full extension off the ground,
  toes flick off the floor, wings sweep down cupping air, chest heaves into climb vector.
- f=36..54: Flight tuck & upstroke recovery leading into second climb wingbeat; body location blends toward cruise origin.
- f=54..72: Second power stroke leveling into cruise entry; f=72 matches CRUISE_F0 exactly.
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
TOTAL_FRAMES = 72

rig = bpy.data.objects[RIG_NAME]
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"

def ensure_action_copy(source_name, target_name):
    source = bpy.data.actions.get(source_name)
    if not source:
        alt_name = f"{source_name}.001"
        source = bpy.data.actions.get(alt_name)
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

def remove_bone_curves(bag, bone_name):
    prefix = f'pose.bones["{bone_name}"].'
    curves_to_remove = [c for c in bag.fcurves if c.data_path.startswith(prefix)]
    for c in curves_to_remove:
        bag.fcurves.remove(c)

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
    # Left to right wing quaternion mirror: (w, x, -y, -z)
    return Quaternion((q.w, q.x, -q.y, -q.z))

def smoothstep(edge0, edge1, x):
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)

def lerp(a, b, t):
    return a + (b - a) * t

def quat_slerp(q1, q2, t):
    return q1.slerp(q2, t)

# Canonical Ground Fold (from author_v2_ground_wing_fold.py)
IDLE_LEFT_WING = {
    "L_WingRoot": Quaternion((0.9995, -0.01321, -0.02278, 0.01761)),
    "L_WingShoulder": Quaternion((0.98469, 0.09304, 0.13665, 0.05535)),
    "L_WingElbow": Quaternion((0.93568, -0.28954, 0.11355, 0.16668)),
    "L_WingWrist": Quaternion((0.92486, -0.19658, 0.06769, -0.31845)),
    "L_WingHand": Quaternion((0.56692, 0.1665, -0.39267, 0.70476)),
    "L_WingD0P0": Quaternion((1.0, 0.0, 0.0, 0.0)),
    "L_WingD1P0": Quaternion((0.98257, -0.18437, 0.0, 0.02362)),
    "L_WingD2P0": Quaternion((0.901, -0.43199, 0.0, 0.03986)),
    "L_WingD3P0": Quaternion((0.72308, -0.68375, 0.0, 0.0982)),
    "L_WingD4P0": Quaternion((0.52906, -0.8004, 0.0, 0.28188)),
    "L_WingD5P0": Quaternion((0.95125, 0.16773, 0.25489, -0.04494)),
}
for d in range(6):
    IDLE_LEFT_WING[f"L_WingD{d}P1"] = Quaternion((1.0, 0.0, 0.0, 0.0))
    IDLE_LEFT_WING[f"L_WingD{d}P2"] = Quaternion((1.0, 0.0, 0.0, 0.0))

# Canonical Cruise Frame 0 (Terminal Pose)
CRUISE_LEFT_WING = {
    "L_WingRoot": Quaternion((0.99968, -0.00135, -0.01771, 0.018)),
    "L_WingShoulder": Quaternion((0.99477, -0.08993, 0.01081, -0.04723)),
    "L_WingElbow": Quaternion((0.9431, -0.10663, -0.06689, 0.30778)),
    "L_WingWrist": Quaternion((0.98831, -0.07513, 0.02621, -0.13006)),
    "L_WingHand": Quaternion((0.94164, -0.048, -0.30732, -0.12867)),
    "L_WingD0P0": Quaternion((0.9609, -0.043, 0.247, -0.1176)),
    "L_WingD0P1": Quaternion((0.9742, -0.1206, -0.0532, -0.1834)),
    "L_WingD0P2": Quaternion((0.9831, -0.1136, -0.038, -0.1382)),
    "L_WingD1P0": Quaternion((0.9678, -0.0066, 0.2309, -0.1005)),
    "L_WingD1P1": Quaternion((0.9686, -0.1418, -0.0443, -0.1995)),
    "L_WingD1P2": Quaternion((0.9898, -0.0964, 0.0, -0.1045)),
    "L_WingD2P0": Quaternion((0.9572, -0.0286, 0.2697, 0.1015)),
    "L_WingD2P1": Quaternion((0.9674, -0.0826, 0.0045, -0.2394)),
    "L_WingD2P2": Quaternion((0.9808, -0.0813, 0.0508, -0.1699)),
    "L_WingD3P0": Quaternion((0.9429, -0.1104, 0.2628, 0.1725)),
    "L_WingD3P1": Quaternion((0.9693, 0.033, -0.0272, -0.2419)),
    "L_WingD3P2": Quaternion((0.9734, 0.1314, 0.0914, -0.1637)),
    "L_WingD4P0": Quaternion((0.9428, -0.1187, 0.2644, 0.1646)),
    "L_WingD4P1": Quaternion((0.9735, 0.1931, -0.0151, -0.1214)),
    "L_WingD4P2": Quaternion((0.9871, 0.1237, -0.022, -0.0997)),
    "L_WingD5P0": Quaternion((-0.8306, -0.0171, -0.5342, 0.1563)),
    "L_WingD5P1": Quaternion((0.9562, 0.2047, 0.0127, 0.2088)),
    "L_WingD5P2": Quaternion((0.9763, 0.1397, -0.0, 0.1651)),
}

# Unfurled High Dihedral Apex (Frame ~18)
APEX_LEFT_WING = {
    "L_WingRoot": Quaternion((0.9996, 0.0, 0.0, 0.028)),
    "L_WingShoulder": Euler((math.radians(22.0), math.radians(-10.0), math.radians(25.0)), "XYZ").to_quaternion(),
    "L_WingElbow": Euler((math.radians(10.0), math.radians(15.0), math.radians(-20.0)), "XYZ").to_quaternion(),
    "L_WingWrist": Euler((math.radians(5.0), math.radians(0.0), math.radians(15.0)), "XYZ").to_quaternion(),
    "L_WingHand": Euler((math.radians(5.0), math.radians(-25.0), math.radians(-10.0)), "XYZ").to_quaternion(),
}
for d in range(6):
    for p in range(3):
        key = f"L_WingD{d}P{p}"
        APEX_LEFT_WING[key] = CRUISE_LEFT_WING[key]

# Bottom Apex of Primary Downstroke (Frame ~32..36)
DOWNSTROKE_LEFT_WING = {
    "L_WingRoot": Quaternion((0.99968, -0.00135, -0.01771, 0.018)),
    "L_WingShoulder": Euler((math.radians(-24.0), math.radians(12.0), math.radians(-22.0)), "XYZ").to_quaternion(),
    "L_WingElbow": Euler((math.radians(-15.0), math.radians(-10.0), math.radians(18.0)), "XYZ").to_quaternion(),
    "L_WingWrist": Euler((math.radians(-8.0), math.radians(5.0), math.radians(-15.0)), "XYZ").to_quaternion(),
    "L_WingHand": Euler((math.radians(-8.0), math.radians(15.0), math.radians(10.0)), "XYZ").to_quaternion(),
}
for d in range(6):
    for p in range(3):
        key = f"L_WingD{d}P{p}"
        DOWNSTROKE_LEFT_WING[key] = CRUISE_LEFT_WING[key]

# Upstroke Apex of Second Wingbeat (Frame ~48)
UPSTROKE2_LEFT_WING = {
    "L_WingRoot": Quaternion((0.99968, -0.00135, -0.01771, 0.018)),
    "L_WingShoulder": Euler((math.radians(16.0), math.radians(-5.0), math.radians(18.0)), "XYZ").to_quaternion(),
    "L_WingElbow": Euler((math.radians(-5.0), math.radians(10.0), math.radians(-10.0)), "XYZ").to_quaternion(),
    "L_WingWrist": Euler((math.radians(0.0), math.radians(2.0), math.radians(5.0)), "XYZ").to_quaternion(),
    "L_WingHand": Euler((math.radians(0.0), math.radians(-20.0), math.radians(-8.0)), "XYZ").to_quaternion(),
}
for d in range(6):
    for p in range(3):
        key = f"L_WingD{d}P{p}"
        UPSTROKE2_LEFT_WING[key] = CRUISE_LEFT_WING[key]

def author_takeoff():
    action = ensure_action_copy("takeoff", "takeoff_V2Candidate")
    bag = get_channel_bag(action)

    # 1. JAW: Natural closed resting orientation (0 deg pitch), ZEROED location
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_rot_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    for frame in range(TOTAL_FRAMES + 1):
        for i, val in enumerate((1.0, 0.0, 0.0, 0.0)):
            jaw_rot_curves[i].keyframe_points.insert(frame, val)
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(frame, 0.0)

    # 2. BODY & SPINE:
    # f=0..6: Ground stance equilibrium at idle coordinates:
    # Body loc = (0.017, 1119.053, 366.411), pitch = +12.95 deg (0.226 rad)
    # f=6..18: Deep anticipation compression dip (Z sinks by -40 units, Y stays grounded)
    # f=18..36: Explosive upward leap thrust (Z surges upward, Y accelerates toward 0.0, pitch tilts forward to -14 deg into climb vector)
    # f=36..54: Flight heave oscillation (Z +60 units, Y arrives at 0.0, pitch -6 deg)
    # f=54..72: Flight trim leveling into cruise (loc = 0, 0, 0; rot = 1, 0, 0, 0)
    remove_bone_rot_curves(bag, "Body")
    remove_bone_loc_curves(bag, "Body")
    body_rot_curves = create_quaternion_curves(bag, "Body")
    body_loc_curves = create_location_curves(bag, "Body")

    base_idle_loc = (0.017, 1119.053, 366.411)
    base_idle_pitch = math.radians(12.95)

    for frame in range(TOTAL_FRAMES + 1):
        if frame <= 6:
            bx = base_idle_loc[0]
            by = base_idle_loc[1]
            bz = base_idle_loc[2]
            pitch = base_idle_pitch
        elif frame <= 18:
            t = (frame - 6.0) / 12.0
            s = smoothstep(0.0, 1.0, t)
            bx = base_idle_loc[0]
            by = base_idle_loc[1]
            bz = base_idle_loc[2] - 40.0 * math.sin(s * math.pi * 0.5)
            pitch = math.radians(lerp(12.95, 4.0, s))
        elif frame <= 36:
            t = (frame - 18.0) / 18.0
            s = smoothstep(0.0, 1.0, t)
            bx = base_idle_loc[0] * (1.0 - s)
            by = base_idle_loc[1] * (1.0 - s)
            start_z = base_idle_loc[2] - 40.0
            bz = start_z * (1.0 - s) + 120.0 * math.sin(s * math.pi * 0.5)
            pitch = math.radians(lerp(4.0, -14.0, s))
        elif frame <= 54:
            t = (frame - 36.0) / 18.0
            s = smoothstep(0.0, 1.0, t)
            bx = 0.0
            by = 0.0
            bz = 120.0 * (1.0 - s * 0.5) + 30.0 * math.sin(s * math.pi)
            pitch = math.radians(lerp(-14.0, -6.0, s))
        else:
            t = (frame - 54.0) / 18.0
            s = smoothstep(0.0, 1.0, t)
            bx = 0.0
            by = 0.0
            bz = 60.0 * (1.0 - s)
            pitch = math.radians(lerp(-6.0, 0.0, s))

        q_body = Euler((pitch, 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((q_body.w, q_body.x, q_body.y, q_body.z)):
            body_rot_curves[i].keyframe_points.insert(frame, val)
        for i, val in enumerate((bx, by, bz)):
            body_loc_curves[i].keyframe_points.insert(frame, val)

    # 3. HIND LIMBS (Legs):
    # f=0..6: Ground hold matching idle:
    # L_Thigh: Euler(-26.7°, 4.0°, -11.4°)
    # L_Calf: Euler(50.7°, -5.5°, 11.5°)
    # L_Foot: Euler(3.5°, -14.2°, -9.4°)
    # L_Toes: Euler(0, 0, 0)
    # f=6..18: Crouch compression: Thigh -42°, Calf +76°, Foot +16° (storing spring force)
    # f=18..30: Explosive downward thrust extension: Thigh -8°, Calf +10°, Foot -42°, Toes -28° (pushing off floor)
    # f=30..50: Transition into aerodynamic flight tuck matching CRUISE:
    # Cruise leg tuck: Thigh +20°, Calf +15°, Foot 0°, Toes 0°
    # f=50..72: Steady flight tuck held through cruise handoff
    leg_bones = ["L_Thigh", "L_Calf", "L_Foot", "L_Toes"]
    leg_standing_euler = {
        "L_Thigh": (math.radians(-26.7), math.radians(4.0), math.radians(-11.4)),
        "L_Calf":  (math.radians(50.7), math.radians(-5.5), math.radians(11.5)),
        "L_Foot":  (math.radians(3.5), math.radians(-14.2), math.radians(-9.4)),
        "L_Toes":  (0.0, 0.0, 0.0),
    }

    for bone_l in leg_bones:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_curves(bag, bone_l)
        remove_bone_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        standing_e = leg_standing_euler[bone_l]

        for frame in range(TOTAL_FRAMES + 1):
            if frame <= 6:
                euler = standing_e
            elif frame <= 18:
                t = (frame - 6.0) / 12.0
                s = smoothstep(0.0, 1.0, t)
                if bone_l == "L_Thigh":
                    euler = (lerp(standing_e[0], math.radians(-42.0), s), standing_e[1] * (1.0 - s), standing_e[2] * (1.0 - s))
                elif bone_l == "L_Calf":
                    euler = (lerp(standing_e[0], math.radians(76.0), s), standing_e[1] * (1.0 - s), standing_e[2] * (1.0 - s))
                elif bone_l == "L_Foot":
                    euler = (lerp(standing_e[0], math.radians(16.0), s), standing_e[1] * (1.0 - s), standing_e[2] * (1.0 - s))
                else:
                    euler = (0.0, 0.0, 0.0)
            elif frame <= 30:
                t = (frame - 18.0) / 12.0
                s = smoothstep(0.0, 1.0, t)
                if bone_l == "L_Thigh":
                    euler = (lerp(math.radians(-42.0), math.radians(-8.0), s), 0.0, 0.0)
                elif bone_l == "L_Calf":
                    euler = (lerp(math.radians(76.0), math.radians(10.0), s), 0.0, 0.0)
                elif bone_l == "L_Foot":
                    euler = (lerp(math.radians(16.0), math.radians(-42.0), s), 0.0, 0.0)
                else:
                    euler = (lerp(0.0, math.radians(-28.0), s), 0.0, 0.0)
            elif frame <= 50:
                t = (frame - 30.0) / 20.0
                s = smoothstep(0.0, 1.0, t)
                if bone_l == "L_Thigh":
                    euler = (lerp(math.radians(-8.0), math.radians(20.0), s), 0.0, 0.0)
                elif bone_l == "L_Calf":
                    euler = (lerp(math.radians(10.0), math.radians(15.0), s), 0.0, 0.0)
                elif bone_l == "L_Foot":
                    euler = (lerp(math.radians(-42.0), 0.0, s), 0.0, 0.0)
                else:
                    euler = (lerp(math.radians(-28.0), 0.0, s), 0.0, 0.0)
            else:
                if bone_l == "L_Thigh":
                    euler = (math.radians(20.0), 0.0, 0.0)
                elif bone_l == "L_Calf":
                    euler = (math.radians(15.0), 0.0, 0.0)
                else:
                    euler = (0.0, 0.0, 0.0)

            q_l = Euler(euler, "XYZ").to_quaternion()
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(frame, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(frame, val)

    # 4. WINGS (Dual-Cycle Climb Flight & Ground Fold Unfurl):
    wing_bone_names = list(IDLE_LEFT_WING.keys())

    # Panel chains: remove all curves, zero flat in fold and during flight
    panel_bone_names = [f"L_WingPanel{p}_{s}" for p in range(4) for s in (0, 1)]
    for p_name in panel_bone_names:
        remove_bone_curves(bag, p_name)
        remove_bone_curves(bag, p_name.replace("L_", "R_"))
        cp_l = create_quaternion_curves(bag, p_name)
        cp_r = create_quaternion_curves(bag, p_name.replace("L_", "R_"))
        for f in range(TOTAL_FRAMES + 1):
            q_p = Quaternion((1.0, 0.0, 0.0, 0.0))
            for i, val in enumerate((q_p.w, q_p.x, q_p.y, q_p.z)):
                cp_l[i].keyframe_points.insert(f, val)
                cp_r[i].keyframe_points.insert(f, val)

    for bone_l in wing_bone_names:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_curves(bag, bone_l)
        remove_bone_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        q_fold = IDLE_LEFT_WING[bone_l]
        q_apex = APEX_LEFT_WING[bone_l]
        q_down = DOWNSTROKE_LEFT_WING[bone_l]
        q_up2 = UPSTROKE2_LEFT_WING[bone_l]
        q_cruise = CRUISE_LEFT_WING[bone_l]

        for frame in range(TOTAL_FRAMES + 1):
            if frame <= 6:
                # Ground fold hold
                q = q_fold
            elif frame <= 18:
                # Unfurl from flank fold to high dihedral apex
                t = (frame - 6.0) / 12.0
                s = smoothstep(0.0, 1.0, t)
                q = quat_slerp(q_fold, q_apex, s)
            elif frame <= 34:
                # Primary power downstroke
                t = (frame - 18.0) / 16.0
                s = smoothstep(0.0, 1.0, t)
                q = quat_slerp(q_apex, q_down, s)
            elif frame <= 48:
                # Upstroke recovery leading into second climb wingbeat
                t = (frame - 34.0) / 14.0
                s = smoothstep(0.0, 1.0, t)
                q = quat_slerp(q_down, q_up2, s)
            elif frame <= 62:
                # Second downstroke drive
                t = (frame - 48.0) / 14.0
                s = smoothstep(0.0, 1.0, t)
                # Second downstroke slightly shallower than first
                q_down2 = quat_slerp(q_down, q_cruise, 0.2)
                q = quat_slerp(q_up2, q_down2, s)
            else:
                # Leveling into cruise entry
                t = (frame - 62.0) / 10.0
                s = smoothstep(0.0, 1.0, t)
                q_down2 = quat_slerp(q_down, q_cruise, 0.2)
                q = quat_slerp(q_down2, q_cruise, s)

            ql = q
            qr = mirror_quaternion(ql)
            for i, val in enumerate((ql.w, ql.x, ql.y, ql.z)):
                curves_l[i].keyframe_points.insert(frame, val)
            for i, val in enumerate((qr.w, qr.x, qr.y, qr.z)):
                curves_r[i].keyframe_points.insert(frame, val)

    # 5. TAIL:
    # Harmonic counter-balance wave
    tail_bones = [f"Tail{i}" for i in range(1, 11)]
    for idx, bone_name in enumerate(tail_bones):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        prog = idx / 9.0

        for frame in range(TOTAL_FRAMES + 1):
            if frame <= 18:
                t = frame / 18.0
                # Ground resting tail lifting into flight stream
                pitch = math.radians(lerp(idx * -0.5, 2.0 * prog, smoothstep(0.0, 1.0, t)))
            elif frame <= 36:
                # Counter-balance flip on leap thrust
                t = (frame - 18.0) / 18.0
                s = smoothstep(0.0, 1.0, t)
                pitch = math.radians(lerp(2.0 * prog, -4.0 * prog, s))
            else:
                t = (frame - 36.0) / 36.0
                wave = math.sin((frame - 36.0) * 0.35 - idx * 0.3)
                pitch = math.radians(-4.0 * prog * (1.0 - t) + wave * (1.5 + 2.0 * prog))

            q_tail = Euler((pitch, 0.0, 0.0), "XYZ").to_quaternion()
            for i, val in enumerate((q_tail.w, q_tail.x, q_tail.y, q_tail.z)):
                curves[i].keyframe_points.insert(frame, val)

    # 6. HEAD & NECK:
    remove_bone_rot_curves(bag, "Head")
    remove_bone_rot_curves(bag, "Neck1")
    remove_bone_rot_curves(bag, "Neck2")
    head_curves = create_quaternion_curves(bag, "Head")
    neck1_curves = create_quaternion_curves(bag, "Neck1")
    neck2_curves = create_quaternion_curves(bag, "Neck2")

    for frame in range(TOTAL_FRAMES + 1):
        if frame <= 6:
            pitch_h = math.radians(-5.3) # matching idle head pitch
            pitch_n1 = math.radians(-4.1)
            pitch_n2 = math.radians(-6.2)
        elif frame <= 18:
            t = (frame - 6.0) / 12.0
            s = smoothstep(0.0, 1.0, t)
            # Crouch: head stays fixed on horizon (counter-pitching upward relative to body)
            pitch_h = math.radians(lerp(-5.3, 14.0, s))
            pitch_n1 = math.radians(lerp(-4.1, 4.0, s))
            pitch_n2 = math.radians(lerp(-6.2, 5.0, s))
        elif frame <= 36:
            # Thrust leap: head focuses forward on climb path
            t = (frame - 18.0) / 18.0
            s = smoothstep(0.0, 1.0, t)
            pitch_h = math.radians(lerp(14.0, 8.0, s))
            pitch_n1 = math.radians(lerp(4.0, 2.0, s))
            pitch_n2 = math.radians(lerp(5.0, 2.5, s))
        else:
            t = (frame - 36.0) / 36.0
            s = smoothstep(0.0, 1.0, t)
            pitch_h = math.radians(lerp(8.0, -1.3, s))
            pitch_n1 = math.radians(lerp(2.0, -0.5, s))
            pitch_n2 = math.radians(lerp(2.5, -0.8, s))

        qh = Euler((pitch_h, 0.0, 0.0), "XYZ").to_quaternion()
        qn1 = Euler((pitch_n1, 0.0, 0.0), "XYZ").to_quaternion()
        qn2 = Euler((pitch_n2, 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((qh.w, qh.x, qh.y, qh.z)):
            head_curves[i].keyframe_points.insert(frame, val)
        for i, val in enumerate((qn1.w, qn1.x, qn1.y, qn1.z)):
            neck1_curves[i].keyframe_points.insert(frame, val)
        for i, val in enumerate((qn2.w, qn2.x, qn2.y, qn2.z)):
            neck2_curves[i].keyframe_points.insert(frame, val)

    print("Takeoff authoring complete with grounded quadrupedal stance, unfurl, dual wingbeats, and cruise tuck handoff.")
    return action

author_takeoff()

# Export candidate single-action GLB
rig = bpy.data.objects[RIG_NAME]
mesh = bpy.data.objects[MESH_NAME]

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = rig

rig.animation_data.action = bpy.data.actions["takeoff_V2Candidate"]
if hasattr(rig.animation_data, "action_suitable_slots") and rig.animation_data.action_suitable_slots:
    rig.animation_data.action_slot = rig.animation_data.action_suitable_slots[0]

destination = OUT / "takeoff-v2-shape-candidate.glb"
bpy.ops.export_scene.gltf(
    filepath=str(destination),
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="ACTIVE_ACTIONS",
    export_nla_strips=False,
    export_force_sampling=True,
)
print(f"Exported takeoff candidate to {destination}")
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
    print("Sending takeoff authoring script to Blender...")
    res = send_blender_code(BLENDER_SCRIPT)
    print("Blender response:", res.get("stdout", res))
    if res.get("stderr"):
        print("Blender stderr:", res.get("stderr"))
