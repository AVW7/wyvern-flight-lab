"""Author refined takeoff (explosive push-off compression, wing unfurl, flight tuck hand-off)
and land (air-brake flare, forward wing cup, touchdown reach, impact damping, knuckle fold settle)
for the V2 Wyvern rig.
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

TOTAL_FRAMES = 72  # 3.0 seconds @ 24 fps

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
    # Left to right wing quaternion mirror: (w, x, -y, -z)
    return Quaternion((q.w, q.x, -q.y, -q.z))

def smoothstep(edge0, edge1, x):
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)

def lerp(a, b, t):
    return a + (b - a) * t

def lerp_tuple(t1, t2, t):
    return tuple(lerp(a, b, t) for a, b in zip(t1, t2))

# -------------------------------------------------------------
# 1. AUTHOR TAKEOFF
# -------------------------------------------------------------
def author_takeoff():
    action = ensure_action_copy("takeoff.001", "takeoff_V2Candidate")
    bag = get_channel_bag(action)

    # 1. JAW: Natural closed resting orientation (0 deg pitch), ZEROED location
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_rot_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    for frame in range(TOTAL_FRAMES + 1):
        breath = math.sin(frame * 0.15) * math.radians(0.2)
        q = Quaternion((math.cos(breath / 2.0), math.sin(breath / 2.0), 0.0, 0.0))
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_rot_curves[i].keyframe_points.insert(frame, val)
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(frame, 0.0)

    # 2. BODY & SPINE:
    # Phase A (0..18): Crouch compression dip (Z -25 units, pitch +4 deg)
    # Phase B (18..36): Explosive upward leap thrust (Z +60 units, pitch -14 deg)
    # Phase C (36..72): Flight trim leveling into cruise (Z 0 units, pitch 0 deg)
    remove_bone_rot_curves(bag, "Body")
    remove_bone_loc_curves(bag, "Body")
    body_rot_curves = create_quaternion_curves(bag, "Body")
    body_loc_curves = create_location_curves(bag, "Body")

    for frame in range(TOTAL_FRAMES + 1):
        if frame <= 18:
            # Compression
            t = frame / 18.0
            z_off = -25.0 * math.sin(t * math.pi * 0.5)
            pitch = math.radians(12.9 * (1.0 - t) + 4.0 * t)
        elif frame <= 36:
            # Leap thrust
            t = (frame - 18.0) / 18.0
            z_off = -25.0 * (1.0 - t) + 60.0 * math.sin(t * math.pi * 0.5)
            pitch = math.radians(4.0 * (1.0 - t) - 14.0 * math.sin(t * math.pi))
        else:
            # Climb & level out to cruise (pitch 0, z 0)
            t = (frame - 36.0) / 36.0
            s = smoothstep(0.0, 1.0, t)
            z_off = 60.0 * (1.0 - s)
            pitch = math.radians(-14.0 * (1.0 - s) * (1.0 - t))

        q_body = Euler((pitch, 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((q_body.w, q_body.x, q_body.y, q_body.z)):
            body_rot_curves[i].keyframe_points.insert(frame, val)
        for i, val in enumerate((0.0, 0.0, z_off)):
            body_loc_curves[i].keyframe_points.insert(frame, val)

    # 3. HIND LIMBS (Legs):
    # Phase A (0..18): Crouch compression (Thigh, Calf, Foot flex to store energy)
    # Phase B (18..32): Powerful extension push-off downward
    # Phase C (32..72): Aerodynamic flight tuck matching CRUISE exactly!
    # Cruise leg tuck: Thigh +20°, Calf +15°, Foot 0°, Toes 0°
    # Crouch pose: Thigh -35°, Calf +65°, Foot +10°, Toes 0°
    # Extended push-off pose: Thigh -10°, Calf +10°, Foot -35°, Toes -20°
    leg_bones = ["L_Thigh", "L_Calf", "L_Foot", "L_Toes"]
    for bone_l in leg_bones:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for frame in range(TOTAL_FRAMES + 1):
            if bone_l == "L_Thigh":
                if frame <= 18:
                    t = frame / 18.0
                    pitch = lerp(-27.4, -38.0, smoothstep(0.0, 1.0, t))
                elif frame <= 32:
                    t = (frame - 18.0) / 14.0
                    pitch = lerp(-38.0, -10.0, smoothstep(0.0, 1.0, t))
                else:
                    t = (frame - 32.0) / 40.0
                    pitch = lerp(-10.0, 20.0, smoothstep(0.0, 1.0, t))
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Calf":
                if frame <= 18:
                    t = frame / 18.0
                    pitch = lerp(52.1, 75.0, smoothstep(0.0, 1.0, t))
                elif frame <= 32:
                    t = (frame - 18.0) / 14.0
                    pitch = lerp(75.0, 12.0, smoothstep(0.0, 1.0, t))
                else:
                    t = (frame - 32.0) / 40.0
                    pitch = lerp(12.0, 15.0, smoothstep(0.0, 1.0, t))
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Foot":
                if frame <= 18:
                    t = frame / 18.0
                    pitch = lerp(2.4, 15.0, smoothstep(0.0, 1.0, t))
                elif frame <= 32:
                    t = (frame - 18.0) / 14.0
                    pitch = lerp(15.0, -40.0, smoothstep(0.0, 1.0, t))
                else:
                    t = (frame - 32.0) / 40.0
                    pitch = lerp(-40.0, 0.0, smoothstep(0.0, 1.0, t))
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Toes":
                if frame <= 18:
                    euler = (0.0, 0.0, 0.0)
                elif frame <= 32:
                    t = (frame - 18.0) / 14.0
                    euler = (math.radians(lerp(0.0, -25.0, t)), 0.0, 0.0)
                else:
                    t = (frame - 32.0) / 40.0
                    euler = (math.radians(lerp(-25.0, 0.0, t)), 0.0, 0.0)

            q_l = Euler(euler, "XYZ").to_quaternion()
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(frame, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(frame, val)

    # 4. WINGS (Unfurl from knuckle ground rest to full flight downstroke, then cruise):
    wing_configs = {
        "L_WingShoulder": {
            "rest": (math.radians(9.1), math.radians(20.9), math.radians(-16.1)),
            "downstroke": (math.radians(-35.0), math.radians(0.0), math.radians(-10.0)),
            "cruise": (math.radians(-10.4), math.radians(0.7), math.radians(-5.5)),
        },
        "L_WingElbow": {
            "rest": (math.radians(-27.0), math.radians(12.5), math.radians(26.5)),
            "downstroke": (math.radians(-5.0), math.radians(0.0), math.radians(15.0)),
            "cruise": (math.radians(-14.0), math.radians(-3.5), math.radians(36.6)),
        },
        "L_WingWrist": {
            "rest": (math.radians(-27.1), math.radians(-1.8), math.radians(-46.0)),
            "downstroke": (math.radians(0.0), math.radians(0.0), math.radians(-5.0)),
            "cruise": (math.radians(-8.9), math.radians(1.8), math.radians(-15.1)),
        },
        "L_WingHand": {
            "rest": (math.radians(-21.9), math.radians(-53.5), math.radians(55.9)),
            "downstroke": (math.radians(0.0), math.radians(-15.0), math.radians(0.0)),
            "cruise": (math.radians(-0.8), math.radians(-36.2), math.radians(-15.3)),
        },
    }

    for bone_l, cfg in wing_configs.items():
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for frame in range(TOTAL_FRAMES + 1):
            if frame <= 14:
                # Knuckle rest
                euler = cfg["rest"]
            elif frame <= 28:
                # Unfurl to flight span
                t = (frame - 14.0) / 14.0
                euler = lerp_tuple(cfg["rest"], cfg["downstroke"], smoothstep(0.0, 1.0, t))
            elif frame <= 46:
                # Power downstroke into climb
                t = (frame - 28.0) / 18.0
                euler = lerp_tuple(cfg["downstroke"], cfg["cruise"], smoothstep(0.0, 1.0, t))
            else:
                # Settle into cruise flight dihedral
                t = (frame - 46.0) / 26.0
                euler = lerp_tuple(cfg["downstroke"], cfg["cruise"], smoothstep(0.0, 1.0, t))

            q_l = Euler(euler, "XYZ").to_quaternion()
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(frame, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(frame, val)

    # 5. TAIL:
    for idx, bone_name in enumerate([f"Tail{i}" for i in range(1, 11)]):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        for frame in range(TOTAL_FRAMES + 1):
            if frame <= 18:
                # Ground balance: slight tail lift
                t = frame / 18.0
                pitch = math.radians(2.0 + idx * 0.5) * (1.0 - t)
            elif frame <= 36:
                # Launch counter-whip
                t = (frame - 18.0) / 18.0
                pitch = math.radians(-4.0 - idx * 1.0) * math.sin(t * math.pi)
            else:
                # Horizontal aerodynamic stabilizer trailing clean
                t = (frame - 36.0) / 36.0
                pitch = math.sin(t * math.pi * 2.0 - idx * 0.2) * math.radians(0.4 + idx * 0.2)
            euler = (pitch, 0.0, 0.0)
            q = Euler(euler, "XYZ").to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(frame, val)

    # 6. HEAD & NECK:
    remove_bone_rot_curves(bag, "Head")
    remove_bone_rot_curves(bag, "Neck1")
    head_curves = create_quaternion_curves(bag, "Head")
    neck_curves = create_quaternion_curves(bag, "Neck1")
    for frame in range(TOTAL_FRAMES + 1):
        # Counter-pitch head to stay level with horizon
        if frame <= 18:
            pitch_h = math.radians(17.8 * (1.0 - frame / 18.0) + 5.0)
        elif frame <= 36:
            pitch_h = math.radians(5.0 + 8.0 * math.sin((frame - 18.0) / 18.0 * math.pi))
        else:
            t = (frame - 36.0) / 36.0
            pitch_h = math.radians(lerp(5.0, -0.5, smoothstep(0.0, 1.0, t)))
        q_h = Euler((pitch_h, 0.0, 0.0), "XYZ").to_quaternion()
        q_n = Euler((pitch_h * 0.3, 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((q_h.w, q_h.x, q_h.y, q_h.z)):
            head_curves[i].keyframe_points.insert(frame, val)
        for i, val in enumerate((q_n.w, q_n.x, q_n.y, q_n.z)):
            neck_curves[i].keyframe_points.insert(frame, val)

    print("Takeoff authoring complete")
    return action

# -------------------------------------------------------------
# 2. AUTHOR LAND
# -------------------------------------------------------------
def author_land():
    action = ensure_action_copy("land.001", "land_V2Candidate")
    bag = get_channel_bag(action)

    # 1. JAW: Natural closed resting orientation (0 deg pitch), ZEROED location
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_rot_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    for frame in range(TOTAL_FRAMES + 1):
        breath = math.sin(frame * 0.15) * math.radians(0.2)
        q = Quaternion((math.cos(breath / 2.0), math.sin(breath / 2.0), 0.0, 0.0))
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_rot_curves[i].keyframe_points.insert(frame, val)
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(frame, 0.0)

    # 2. BODY & SPINE:
    # Phase A (0..24): Aerodynamic air-brake flare: pitch nose-up -28 deg (in Blender local X)
    # Phase B (24..48): Descent leveling and sink (Z sinks, pitch levels toward horizontal)
    # Phase C (48..72): Touchdown impact absorption and settle into idle height (pitch +12.9 deg)
    remove_bone_rot_curves(bag, "Body")
    remove_bone_loc_curves(bag, "Body")
    body_rot_curves = create_quaternion_curves(bag, "Body")
    body_loc_curves = create_location_curves(bag, "Body")

    for frame in range(TOTAL_FRAMES + 1):
        if frame <= 24:
            # Flare: pitch nose-up
            t = frame / 24.0
            pitch = math.radians(lerp(0.0, -28.0, smoothstep(0.0, 1.0, t)))
            z_off = 30.0 * math.sin(t * math.pi * 0.5)
        elif frame <= 48:
            # Descent sink and leveling
            t = (frame - 24.0) / 24.0
            pitch = math.radians(lerp(-28.0, 5.0, smoothstep(0.0, 1.0, t)))
            z_off = 30.0 * (1.0 - t) - 35.0 * t
        else:
            # Impact compression and quadrupedal settle
            t = (frame - 48.0) / 24.0
            bounce = math.sin(t * math.pi) * 12.0
            z_off = -35.0 + bounce * (1.0 - t)
            pitch = math.radians(lerp(5.0, 12.9, smoothstep(0.0, 1.0, t)))

        q_body = Euler((pitch, 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((q_body.w, q_body.x, q_body.y, q_body.z)):
            body_rot_curves[i].keyframe_points.insert(frame, val)
        for i, val in enumerate((0.0, 0.0, z_off)):
            body_loc_curves[i].keyframe_points.insert(frame, val)

    # 3. HIND LIMBS (Legs):
    # Phase A (0..20): Starts from cruise tuck (Thigh +20, Calf +15, Foot 0)
    # Phase B (20..44): Full downward reaching stroke to meet ground (Reach > 50 units)
    # Phase C (44..58): Impact compression as feet contact ground plane
    # Phase D (58..72): Settle into stable idle ground quadrupedal stance
    leg_bones = ["L_Thigh", "L_Calf", "L_Foot", "L_Toes"]
    for bone_l in leg_bones:
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for frame in range(TOTAL_FRAMES + 1):
            if bone_l == "L_Thigh":
                if frame <= 20:
                    t = frame / 20.0
                    pitch = lerp(20.0, -10.0, smoothstep(0.0, 1.0, t))
                elif frame <= 44:
                    t = (frame - 20.0) / 24.0
                    pitch = lerp(-10.0, -42.0, smoothstep(0.0, 1.0, t)) # reach forward/down
                elif frame <= 58:
                    t = (frame - 44.0) / 14.0
                    pitch = lerp(-42.0, -32.0, smoothstep(0.0, 1.0, t)) # impact flexion
                else:
                    t = (frame - 58.0) / 14.0
                    pitch = lerp(-32.0, -27.4, smoothstep(0.0, 1.0, t)) # idle rest
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Calf":
                if frame <= 20:
                    t = frame / 20.0
                    pitch = lerp(15.0, 30.0, smoothstep(0.0, 1.0, t))
                elif frame <= 44:
                    t = (frame - 20.0) / 24.0
                    pitch = lerp(30.0, 10.0, smoothstep(0.0, 1.0, t)) # open reach
                elif frame <= 58:
                    t = (frame - 44.0) / 14.0
                    pitch = lerp(10.0, 68.0, smoothstep(0.0, 1.0, t)) # impact absorb
                else:
                    t = (frame - 58.0) / 14.0
                    pitch = lerp(68.0, 52.1, smoothstep(0.0, 1.0, t)) # idle rest
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Foot":
                if frame <= 20:
                    t = frame / 20.0
                    pitch = lerp(0.0, -20.0, smoothstep(0.0, 1.0, t))
                elif frame <= 44:
                    t = (frame - 20.0) / 24.0
                    pitch = lerp(-20.0, -45.0, smoothstep(0.0, 1.0, t)) # toes down to touch first
                elif frame <= 58:
                    t = (frame - 44.0) / 14.0
                    pitch = lerp(-45.0, 10.0, smoothstep(0.0, 1.0, t)) # heel plant
                else:
                    t = (frame - 58.0) / 14.0
                    pitch = lerp(10.0, 2.4, smoothstep(0.0, 1.0, t)) # idle rest
                euler = (math.radians(pitch), 0.0, 0.0)
            elif bone_l == "L_Toes":
                if frame <= 20:
                    euler = (0.0, 0.0, 0.0)
                elif frame <= 44:
                    t = (frame - 20.0) / 24.0
                    euler = (math.radians(lerp(0.0, -30.0, t)), 0.0, 0.0)
                elif frame <= 58:
                    t = (frame - 44.0) / 14.0
                    euler = (math.radians(lerp(-30.0, 5.0, t)), 0.0, 0.0)
                else:
                    euler = (0.0, 0.0, 0.0)

            q_l = Euler(euler, "XYZ").to_quaternion()
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(frame, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(frame, val)

    # 4. WINGS (Air-brake forward cup, cushioning flap, fold into quadrupedal rest):
    wing_configs_land = {
        "L_WingShoulder": {
            "cruise": (math.radians(-10.4), math.radians(0.7), math.radians(-5.5)),
            "flare": (math.radians(-42.0), math.radians(-15.0), math.radians(-15.0)),
            "rest": (math.radians(9.1), math.radians(20.9), math.radians(-16.1)),
        },
        "L_WingElbow": {
            "cruise": (math.radians(-14.0), math.radians(-3.5), math.radians(36.6)),
            "flare": (math.radians(-8.0), math.radians(-5.0), math.radians(20.0)),
            "rest": (math.radians(-27.0), math.radians(12.5), math.radians(26.5)),
        },
        "L_WingWrist": {
            "cruise": (math.radians(-8.9), math.radians(1.8), math.radians(-15.1)),
            "flare": (math.radians(5.0), math.radians(0.0), math.radians(-10.0)),
            "rest": (math.radians(-27.1), math.radians(-1.8), math.radians(-46.0)),
        },
        "L_WingHand": {
            "cruise": (math.radians(-0.8), math.radians(-36.2), math.radians(-15.3)),
            "flare": (math.radians(5.0), math.radians(-15.0), math.radians(0.0)),
            "rest": (math.radians(-21.9), math.radians(-53.5), math.radians(55.9)),
        },
    }

    for bone_l, cfg in wing_configs_land.items():
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for frame in range(TOTAL_FRAMES + 1):
            if frame <= 24:
                # Flare: cup wings forward into aerodynamic drag shape
                t = frame / 24.0
                euler = lerp_tuple(cfg["cruise"], cfg["flare"], smoothstep(0.0, 1.0, t))
            elif frame <= 48:
                # Descent braking flap
                t = (frame - 24.0) / 24.0
                euler = lerp_tuple(cfg["flare"], cfg["rest"], smoothstep(0.0, 1.0, t))
            else:
                # Complete fold into quadrupedal resting knuckle stance
                t = (frame - 48.0) / 24.0
                euler = lerp_tuple(cfg["flare"], cfg["rest"], smoothstep(0.0, 1.0, t))

            q_l = Euler(euler, "XYZ").to_quaternion()
            q_r = mirror_quaternion(q_l)
            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(frame, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(frame, val)

    # 5. TAIL:
    for idx, bone_name in enumerate([f"Tail{i}" for i in range(1, 11)]):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        for frame in range(TOTAL_FRAMES + 1):
            if frame <= 24:
                # Flap down as air brake during flare
                t = frame / 24.0
                pitch = math.radians(lerp(0.0, 6.0 + idx * 1.2, smoothstep(0.0, 1.0, t)))
            elif frame <= 48:
                # Level out as body descends
                t = (frame - 24.0) / 24.0
                pitch = math.radians(lerp(6.0 + idx * 1.2, -1.0 - idx * 0.3, smoothstep(0.0, 1.0, t)))
            else:
                # Settle into safe ground clearance (no clipping)
                t = (frame - 48.0) / 24.0
                pitch = math.radians(lerp(-1.0 - idx * 0.3, 0.0, smoothstep(0.0, 1.0, t)))
            euler = (pitch, 0.0, 0.0)
            q = Euler(euler, "XYZ").to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(frame, val)

    # 6. HEAD & NECK:
    remove_bone_rot_curves(bag, "Head")
    remove_bone_rot_curves(bag, "Neck1")
    head_curves = create_quaternion_curves(bag, "Head")
    neck_curves = create_quaternion_curves(bag, "Neck1")
    for frame in range(TOTAL_FRAMES + 1):
        if frame <= 24:
            # Counter-pitch downward to look at landing spot during nose-up flare
            t = frame / 24.0
            pitch_h = math.radians(lerp(-0.5, 24.0, smoothstep(0.0, 1.0, t)))
        elif frame <= 48:
            t = (frame - 24.0) / 24.0
            pitch_h = math.radians(lerp(24.0, 10.0, smoothstep(0.0, 1.0, t)))
        else:
            t = (frame - 48.0) / 24.0
            pitch_h = math.radians(lerp(10.0, 17.8, smoothstep(0.0, 1.0, t)))
        q_h = Euler((pitch_h, 0.0, 0.0), "XYZ").to_quaternion()
        q_n = Euler((pitch_h * 0.4, 0.0, 0.0), "XYZ").to_quaternion()
        for i, val in enumerate((q_h.w, q_h.x, q_h.y, q_h.z)):
            head_curves[i].keyframe_points.insert(frame, val)
        for i, val in enumerate((q_n.w, q_n.x, q_n.y, q_n.z)):
            neck_curves[i].keyframe_points.insert(frame, val)

    print("Land authoring complete")
    return action

author_takeoff()
author_land()

# Export both candidate actions to GLB
rig = bpy.data.objects[RIG_NAME]
mesh = bpy.data.objects[MESH_NAME]

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = rig

for act_name, glb_name in [
    ("takeoff_V2Candidate", "takeoff-v2-shape-candidate.glb"),
    ("land_V2Candidate", "land-v2-shape-candidate.glb"),
]:
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
