"""Author refined jaw closure, head gaze stabilization + turn lead, and 10-segment
caudal rudder wave for bankLeft and bankRight on the V2 Wyvern in Blender.
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

TOTAL_FRAMES = 144  # 6 seconds @ 24 fps (3 wingbeats of 48 frames each)
WINGBEAT_PERIOD = 48.0
OMEGA = 2.0 * math.pi / WINGBEAT_PERIOD

BANK_LEFT_BASE_EULER_Z = {
    "Tail1":   +1.5,
    "Tail2":   +3.0,
    "Tail3":   +4.2,
    "Tail4":   +4.8,
    "Tail5":   +5.2,
    "Tail6":   +4.6,
    "Tail7":   +3.8,
    "Tail8":   +3.0,
    "Tail9":   +2.2,
    "Tail10":  +1.8,
}
BANK_LEFT_BASE_EULER_X = {
    "Tail1":   +8.0,
    "Tail2":   -6.0,
    "Tail3":   -4.0,
    "Tail4":   -2.0,
    "Tail5":   -1.0,
    "Tail6":   -2.0,
    "Tail7":   -1.5,
    "Tail8":   +3.0,
    "Tail9":   +2.0,
    "Tail10":  +1.5,
}

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

def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if value <= edge0:
        return 0.0
    if value >= edge1:
        return 1.0
    t = (value - edge0) / (edge1 - edge0)
    return t * t * (3.0 - 2.0 * t)

def point_at(curve, frame: float):
    for point in curve.keyframe_points:
        if abs(point.co.x - frame) < 0.0001:
            return point
    return None

def author_bank_clip(source_action_name, target_action_name, side):
    action = ensure_action_copy(source_action_name, target_action_name)
    bag = get_channel_bag(action)
    turn_sign = +1.0 if side == "L" else -1.0
    z_sign = +1.0 if side == "L" else -1.0

    # 1. WING SHAPE REPAIR (Correct wing shaping on downward flap and recovery)
    # Eases acute folding of downstream elbow, wrist, hand, and digit joints toward rest
    wing_weights = {}
    for w_side in ("L", "R"):
        wing_weights[f"{w_side}_WingElbow"] = 0.18
        wing_weights[f"{w_side}_WingWrist"] = 0.35
        wing_weights[f"{w_side}_WingHand"] = 0.45
        for digit in range(6):
            wing_weights[f"{w_side}_WingD{digit}P0"] = 0.52
            wing_weights[f"{w_side}_WingD{digit}P1"] = 0.60
            wing_weights[f"{w_side}_WingD{digit}P2"] = 0.66

    identity = Quaternion((1.0, 0.0, 0.0, 0.0))
    for bone_name, max_blend in wing_weights.items():
        prefix = f'pose.bones["{bone_name}"].rotation_quaternion'
        curves = [c for c in bag.fcurves if c.data_path == prefix]
        if len(curves) != 4:
            continue
        curves = sorted(curves, key=lambda c: c.array_index)
        frames = sorted({round(p.co.x, 4) for c in curves for p in c.keyframe_points})

        previous = None
        for frame in frames:
            q = Quaternion([c.evaluate(frame) for c in curves])
            if q.magnitude == 0:
                continue
            q.normalize()
            if previous is not None and q.dot(previous) < 0:
                q.negate()
            angle = math.degrees(2.0 * math.acos(min(1.0, abs(q.w))))
            blend = max_blend * smoothstep(24.0, 82.0, angle)
            repaired = identity.slerp(q, 1.0 - blend)
            if previous is not None and repaired.dot(previous) < 0:
                repaired.negate()
            for index, curve in enumerate(curves):
                pt = point_at(curve, frame)
                if pt:
                    pt.co.y = repaired[index]
                    pt.handle_left_type = "AUTO_CLAMPED"
                    pt.handle_right_type = "AUTO_CLAMPED"
                    curve.update()
            previous = repaired

    # 2. JAW CORRECTION (Closed rest + subtle breathing modulation + ZEROED LOCATION)
    remove_bone_rot_curves(bag, "Jaw")
    remove_bone_loc_curves(bag, "Jaw")
    jaw_curves = create_quaternion_curves(bag, "Jaw")
    jaw_loc_curves = create_location_curves(bag, "Jaw")
    base_jaw_pitch = math.radians(0.0)
    for frame in range(TOTAL_FRAMES + 1):
        t = frame
        breath = math.sin(OMEGA * t) * math.radians(0.3)
        pitch = base_jaw_pitch + breath
        q = Quaternion((math.cos(pitch / 2.0), math.sin(pitch / 2.0), 0.0, 0.0))
        for i, val in enumerate((q.w, q.x, q.y, q.z)):
            jaw_curves[i].keyframe_points.insert(frame, val)
        for i in range(3):
            jaw_loc_curves[i].keyframe_points.insert(frame, 0.0)

    # 3. HEAD & NECK GAZE STABILIZATION + TURN LEAD
    neck_bones = [
        ("Neck1", math.radians(2.5), math.radians(1.2), 0.00, 0.0),
        ("Neck2", math.radians(2.5), math.radians(1.5), 0.15, turn_sign * math.radians(4.0)),
        ("Head",  math.radians(0.0), math.radians(1.8), 0.30, turn_sign * math.radians(3.5)),
    ]

    for bone_name, base_pitch, amp, phase_offset, yaw in neck_bones:
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)
        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            pitch = base_pitch + math.sin(OMEGA * t - phase_offset) * amp
            e = Euler((pitch, yaw, 0.0), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(frame, val)

    # 4. 10-SEGMENT CAUDAL RUDDER WAVE PROPAGATION
    tail_bones = [f"Tail{i}" for i in range(1, 11)]
    for idx, bone_name in enumerate(tail_bones):
        remove_bone_rot_curves(bag, bone_name)
        curves = create_quaternion_curves(bag, bone_name)

        progression = idx / 9.0
        pitch_amp = math.radians(1.2 + 4.3 * progression)
        yaw_amp = math.radians(0.5 + 2.0 * progression)
        phase_lag = idx * 0.22

        base_x = math.radians(BANK_LEFT_BASE_EULER_X.get(bone_name, 0.0))
        base_z = math.radians(BANK_LEFT_BASE_EULER_Z.get(bone_name, 0.0))

        for frame in range(TOTAL_FRAMES + 1):
            t = frame
            pitch = base_x + math.sin(OMEGA * t - phase_lag) * pitch_amp
            yaw = z_sign * (base_z + math.cos(OMEGA * t - phase_lag) * yaw_amp)
            e = Euler((pitch, 0.0, yaw), "XYZ")
            q = e.to_quaternion()
            for i, val in enumerate((q.w, q.x, q.y, q.z)):
                curves[i].keyframe_points.insert(frame, val)

    print(f"Successfully authored {target_action_name} for side {side}")
    return action

rig = bpy.data.objects[RIG_NAME]
for pb in rig.pose.bones:
    pb.rotation_mode = "QUATERNION"

# Author both bankLeft and bankRight candidate actions
author_bank_clip("bankLeft", "bankLeft_FlightPolish_v2Candidate", "L")
author_bank_clip("bankRight", "bankRight_FlightPolish_v2Candidate", "R")

# Export both candidate actions to GLB
rig = bpy.data.objects[RIG_NAME]
mesh = bpy.data.objects[MESH_NAME]

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = rig

for act_name, glb_name in [
    ("bankLeft_FlightPolish_v2Candidate", "bankLeft-v1-shape-candidate.glb"),
    ("bankRight_FlightPolish_v2Candidate", "bankRight-v1-shape-candidate.glb"),
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
