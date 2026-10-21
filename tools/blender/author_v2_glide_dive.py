"""Author refined glide (aerodynamic dihedral, horizon hold, caudal trim) and dive
(streamlined stoop plunge, wing tuck, target-locked gaze, trailing tail) for the V2 Wyvern.
"""

import json
import math
import socket
from pathlib import Path

BLENDER_SCRIPT = """
import math
from pathlib import Path
import bpy
from mathutils import Quaternion, Euler

OUT = Path("/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0")
RIG_NAME = "WyvernRig.001"
MESH_NAME = "WyvernMembrane_ExportSafe.001"

rig = bpy.data.objects[RIG_NAME]
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"

TOTAL_FRAMES = 144  # 6 seconds @ 24 fps
SLOW_OMEGA = 2.0 * math.pi / 144.0
FAST_OMEGA = 2.0 * math.pi / 48.0  # 3 cycles per clip

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

def author_glide():
    action = ensure_action_copy("glide", "glide_FlightPolish_v2Candidate")
    bag = get_channel_bag(action)

    # 1. JAW (Closed rest + subtle breathing + ZEROED LOCATION)
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    base_jaw_pitch = math.radians(0.0)
    for frame in range(TOTAL_FRAMES + 1):
        t = frame
        breath = math.sin(SLOW_OMEGA * 2.0 * t) * math.radians(0.4)
        pitch = base_jaw_pitch + breath
        q = Quaternion((math.cos(pitch / 2.0), math.sin(pitch / 2.0), 0.0, 0.0))
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_curves[i].keyframe_points.insert(frame, val)
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(frame, 0.0)

    # 2. BODY & SPINE (Streamlined neutral flight angle)
    remove_bone_rot_curves(bag, "Body")
    body_curves = create_quaternion_curves(bag, "Body")
    for frame in range(TOTAL_FRAMES + 1):
        t = frame
        pitch = math.radians(1.5) + math.sin(SLOW_OMEGA * t) * math.radians(0.4)
        e = Euler((pitch, 0.0, 0.0), "XYZ")
        q = e.to_quaternion()
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            body_curves[i].keyframe_points.insert(frame, val)

    # 3. HEAD & NECK (Horizon hold + slow scanning)
    neck_bones = [
        ("Neck1", math.radians(2.5), math.radians(0.5), math.radians(1.5)),
        ("Neck2", math.radians(2.5), math.radians(0.6), math.radians(2.0)),
        ("Head",  math.radians(0.0), math.radians(0.8), math.radians(2.5)),
    ]
    for bone_name, base_pitch, pitch_amp, yaw_amp in neck_bones:
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            pitch = base_pitch + math.sin(SLOW_OMEGA * 2.0 * t) * pitch_amp
            yaw = math.sin(SLOW_OMEGA * t) * yaw_amp
            e = Euler((pitch, yaw, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(frame, val)

    # 4. WINGS (Steady dihedral camber with gentle thermal lift ripple)
    # Left wing definitions
    wing_bones_euler = {
        "L_WingShoulder": (math.radians(5.5), math.radians(0.0), math.radians(0.0)),
        "L_WingElbow":    (math.radians(2.5), math.radians(0.0), math.radians(0.0)),
        "L_WingWrist":    (math.radians(0.0), math.radians(0.0), math.radians(-4.0)),
        "L_WingHand":     (math.radians(0.0), math.radians(0.0), math.radians(1.0)),
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

        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            thermal_ripple = math.sin(SLOW_OMEGA * 2.0 * t) * math.radians(0.6)
            e_l = Euler((base_e[0] + thermal_ripple, base_e[1], base_e[2]), "XYZ")
            q_l = e_l.to_quaternion()
            q_r = mirror_quaternion(q_l)

            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(frame, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(frame, val)

    # 5. TAIL (Caudal horizontal trim wave)
    tail_bones = [f"Tail{i}" for i in range(1, 11)]
    for idx, bone_name in enumerate(tail_bones):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        progression = idx / 9.0
        pitch_amp = math.radians(0.5 + 1.5 * progression)
        yaw_amp = math.radians(0.4 + 1.2 * progression)
        phase_lag = idx * 0.25

        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            pitch = math.sin(SLOW_OMEGA * 2.0 * t - phase_lag) * pitch_amp
            yaw = math.cos(SLOW_OMEGA * t - phase_lag) * yaw_amp
            e = Euler((pitch, 0.0, yaw), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(frame, val)

    print("Glide authoring complete")
    return action

def author_dive():
    action = ensure_action_copy("dive", "dive_FlightPolish_v2Candidate")
    bag = get_channel_bag(action)

    # 1. JAW (Closed rest + ZEROED LOCATION)
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    base_jaw_pitch = math.radians(0.0)
    for frame in range(TOTAL_FRAMES + 1):
        t = frame
        breath = math.sin(FAST_OMEGA * t) * math.radians(0.3)
        pitch = base_jaw_pitch + breath
        q = Quaternion((math.cos(pitch / 2.0), math.sin(pitch / 2.0), 0.0, 0.0))
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_curves[i].keyframe_points.insert(frame, val)
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(frame, 0.0)

    # 2. BODY & SPINE (Steep nose-down dive stoop: +28 deg in local X)
    remove_bone_rot_curves(bag, "Body")
    body_curves = create_quaternion_curves(bag, "Body")
    base_dive_pitch = math.radians(28.0)
    for frame in range(TOTAL_FRAMES + 1):
        t = frame
        buffet = math.sin(FAST_OMEGA * t) * math.radians(0.8)
        pitch = base_dive_pitch + buffet
        e = Euler((pitch, 0.0, 0.0), "XYZ")
        q = e.to_quaternion()
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            body_curves[i].keyframe_points.insert(frame, val)

    # 3. HEAD & NECK (Predatory forward/down gaze lock: counteracting body plunge)
    neck_bones = [
        ("Neck1", math.radians(-8.0),  math.radians(0.4)),
        ("Neck2", math.radians(-12.0), math.radians(0.5)),
        ("Head",  math.radians(-14.0), math.radians(0.5)),
    ]
    for bone_name, base_pitch, pitch_amp in neck_bones:
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            pitch = base_pitch + math.sin(FAST_OMEGA * t) * pitch_amp
            e = Euler((pitch, 0.0, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(frame, val)

    # 4. WINGS (High-speed stoop tuck: swept back & folded tight)
    wing_bones_dive = {
        "L_WingShoulder": (math.radians(-12.0), math.radians(5.0), math.radians(-42.0)),
        "L_WingElbow":    (math.radians(10.0), math.radians(18.0), math.radians(28.0)),
        "L_WingWrist":    (math.radians(5.0), math.radians(0.0), math.radians(-38.0)),
        "L_WingHand":     (math.radians(0.0), math.radians(0.0), math.radians(-30.0)),
    }
    for digit in range(6):
        wing_bones_dive[f"L_WingD{digit}P0"] = (math.radians(-5.0), 0.0, math.radians(-15.0))
        wing_bones_dive[f"L_WingD{digit}P1"] = (math.radians(2.0), 0.0, math.radians(-18.0))
        wing_bones_dive[f"L_WingD{digit}P2"] = (math.radians(1.0), 0.0, math.radians(-20.0))

    for bone_l, base_e in wing_bones_dive.items():
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            high_speed_flutter = math.sin(FAST_OMEGA * t) * math.radians(0.4)
            e_l = Euler((base_e[0] + high_speed_flutter, base_e[1], base_e[2]), "XYZ")
            q_l = e_l.to_quaternion()
            q_r = mirror_quaternion(q_l)

            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(frame, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(frame, val)

    # 5. TAIL (Stoop line trailing streamline: upward trim to stream behind plunge)
    tail_base_x = {
        "Tail1": -16.0,
        "Tail2": -6.0,
        "Tail3": -2.0,
        "Tail4": -1.0,
        "Tail5": 0.0,
        "Tail6": 0.0,
        "Tail7": 0.0,
        "Tail8": 0.0,
        "Tail9": 0.0,
        "Tail10": 0.0,
    }
    for idx, bone_name in enumerate([f"Tail{i}" for i in range(1, 11)]):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        progression = idx / 9.0
        pitch_amp = math.radians(0.6 + 1.8 * progression)
        base_x = math.radians(tail_base_x.get(bone_name, 0.0))

        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            pitch = base_x + math.sin(FAST_OMEGA * t - idx * 0.18) * pitch_amp
            e = Euler((pitch, 0.0, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(frame, val)

    # 6. LEGS (Aerodynamic belly tuck)
    leg_bones = {
        "L_Thigh": (math.radians(-18.0), 0.0, math.radians(10.0)),
        "L_Calf":  (math.radians(35.0), 0.0, 0.0),
        "L_Foot":  (math.radians(-20.0), 0.0, 0.0),
        "L_Toes":  (math.radians(-15.0), 0.0, 0.0),
    }
    for bone_l, base_e in leg_bones.items():
        bone_r = bone_l.replace("L_", "R_")
        remove_bone_rot_curves(bag, bone_l)
        remove_bone_rot_curves(bag, bone_r)
        curves_l = create_quaternion_curves(bag, bone_l)
        curves_r = create_quaternion_curves(bag, bone_r)

        for frame in range(TOTAL_FRAMES + 1):
            e_l = Euler(base_e, "XYZ")
            q_l = e_l.to_quaternion()
            q_r = mirror_quaternion(q_l)

            for i, val in enumerate((q_l.w, q_l.x, q_l.y, q_l.z)):
                curves_l[i].keyframe_points.insert(frame, val)
            for i, val in enumerate((q_r.w, q_r.x, q_r.y, q_r.z)):
                curves_r[i].keyframe_points.insert(frame, val)

    print("Dive authoring complete")
    return action

author_glide()
author_dive()

# Export both candidate actions to GLB
rig = bpy.data.objects[RIG_NAME]
mesh = bpy.data.objects[MESH_NAME]

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = rig

for act_name, glb_name in [
    ("glide_FlightPolish_v2Candidate", "glide-v1-shape-candidate.glb"),
    ("dive_FlightPolish_v2Candidate", "dive-v1-shape-candidate.glb"),
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
