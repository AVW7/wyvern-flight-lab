"""Author refined jaw closure, head gaze stabilization, and 10-segment tail wave
for the V2 Wyvern in Blender.
"""

import json
import socket

BLENDER_SCRIPT = """
import math
from pathlib import Path
import bpy
from mathutils import Quaternion, Euler

OUT = Path("/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0")
SOURCE_ACTION_NAME = "Cruise_WingShapeRepair_v1Reference"
TARGET_ACTION_NAME = "Cruise_FlightPolish_v2Candidate"
RIG_NAME = "WyvernRig.001"
MESH_NAME = "WyvernMembrane_ExportSafe.001"

TOTAL_FRAMES = 144  # 6 seconds @ 24 fps (3 wingbeats of 48 frames each)
WINGBEAT_PERIOD = 48.0  # frames per beat
OMEGA = 2.0 * math.pi / WINGBEAT_PERIOD


def ensure_action_copy():
    source = bpy.data.actions.get(SOURCE_ACTION_NAME)
    if not source:
        raise RuntimeError(f"Source action '{SOURCE_ACTION_NAME}' not found")

    target = bpy.data.actions.get(TARGET_ACTION_NAME)
    if target:
        bpy.data.actions.remove(target)

    target = source.copy()
    target.name = TARGET_ACTION_NAME
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


def apply_refinements():
    action = ensure_action_copy()
    bag = get_channel_bag(action)
    rig = bpy.data.objects.get(RIG_NAME)
    if not rig:
        raise RuntimeError(f"Rig '{RIG_NAME}' not found")

    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"

    # 1. JAW CORRECTION (Closed rest + subtle breathing modulation + ZEROED LOCATION)
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_rot_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")

    base_jaw_pitch = math.radians(0.0)
    for frame in range(TOTAL_FRAMES + 1):
        t = frame
        breath = math.sin(OMEGA * t) * math.radians(0.3)
        pitch = base_jaw_pitch + breath
        q = Quaternion((math.cos(pitch / 2.0), math.sin(pitch / 2.0), 0.0, 0.0))

        jaw_rot_curves[0].keyframe_points.insert(frame, q.w)
        jaw_rot_curves[1].keyframe_points.insert(frame, q.x)
        jaw_rot_curves[2].keyframe_points.insert(frame, q.y)
        jaw_rot_curves[3].keyframe_points.insert(frame, q.z)
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(frame, 0.0)

    # 2. HEAD & NECK GAZE STABILIZATION
    neck_bones = [
        ("Neck1", math.radians(2.5), math.radians(1.2), 0.0),
        ("Neck2", math.radians(2.5), math.radians(1.5), 0.15),
        ("Head", math.radians(0.0), math.radians(1.8), 0.3),
    ]

    for bone_name, base_pitch, amp, phase_offset in neck_bones:
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)

        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            mod = math.sin(OMEGA * t - phase_offset) * amp
            pitch = base_pitch + mod
            q = Quaternion((math.cos(pitch / 2.0), math.sin(pitch / 2.0), 0.0, 0.0))

            curves[0].keyframe_points.insert(frame, q.w)
            curves[1].keyframe_points.insert(frame, q.x)
            curves[2].keyframe_points.insert(frame, q.y)
            curves[3].keyframe_points.insert(frame, q.z)

    # 3. 10-SEGMENT TAIL WAVE PROPAGATION
    tail_bones = [f"Tail{i}" for i in range(1, 11)]

    for idx, bone_name in enumerate(tail_bones):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)

        progression = idx / 9.0
        pitch_amp = math.radians(1.2 + 4.3 * progression)
        yaw_amp = math.radians(0.5 + 2.5 * progression)
        phase_lag = idx * 0.22

        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            pitch = math.sin(OMEGA * t - phase_lag) * pitch_amp
            yaw = math.sin((2.0 * math.pi / 72.0) * t - phase_lag) * yaw_amp

            e = Euler((pitch, yaw, 0.0), "XYZ")
            q = e.to_quaternion()

            curves[0].keyframe_points.insert(frame, q.w)
            curves[1].keyframe_points.insert(frame, q.x)
            curves[2].keyframe_points.insert(frame, q.y)
            curves[3].keyframe_points.insert(frame, q.z)

    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    if hasattr(rig.animation_data, "action_suitable_slots") and rig.animation_data.action_suitable_slots:
        rig.animation_data.action_slot = rig.animation_data.action_suitable_slots[0]

    mesh = bpy.data.objects[MESH_NAME]
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig

    destination = OUT / "cruise-v1-shape-candidate.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_nla_strips=False,
        export_force_sampling=True,
    )
    print(f"Successfully authored and exported {TARGET_ACTION_NAME} to {destination}")
    return action

apply_refinements()
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
