"""
add_upper_body_motion.py
------------------------
Adds natural upper-body / neck / head secondary animation to the Wyvern V2 rig.

Problem diagnosed:
  • Spine1-3:  only 2 CONSTANT keyframes at 0° — completely frozen.
  • Neck1:     145 BEZIER keys but only ±1.2° range.
  • Neck2:     145 BEZIER keys but only ±1.5° range.
  • Head:      145 BEZIER keys but only ±1.8° range.

Solution:
  Replace those channels with biologically-motivated sinusoidal motion
  synced to the wingbeat cycle (period=48 fr in cruise/hover/bankLeft/bankRight).
  Idle uses its own period. All use BEZIER AUTO handles for smooth curves.

Biomechanical model (bird/pterosaur flight mechanics):
  - DOWNSTROKE (wings push down): Body pitches nose-DOWN (reaction force + gravity).
  - Neck counterbalance: as body pitches down, neck/head PITCH UP (inertia + active stabilization).
  - Phase cascade: Spine1→Spine2→Spine3→Neck1→Neck2→Head, each ~6fr lag (follow-through).
  - Lateral sway: slow sinusoidal yaw on head/neck at 2× the clip period (very subtle).

Run via:
    python3 tools/blender/add_upper_body_motion.py   (calls Blender over socket)
"""

import json
import math
import socket

# ---------------------------------------------------------------------------
# Blender socket helpers
# ---------------------------------------------------------------------------

def send_blender(code: str, timeout: int = 60) -> dict:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect(("127.0.0.1", 9876))
    payload = json.dumps({"type": "execute", "code": code, "strict_json": True}).encode("utf-8") + b"\0"
    s.sendall(payload)
    data = b""
    while not data.endswith(b"\0"):
        chunk = s.recv(8192)
        if not chunk:
            break
        data += chunk
    s.close()
    return json.loads(data.rstrip(b"\0").decode("utf-8"))


# ---------------------------------------------------------------------------
# Read base quaternion values from existing constant keyframes
# ---------------------------------------------------------------------------

READ_BASE_CODE = r"""
import bpy, json

rig = bpy.data.objects.get("WyvernRig.001")
targets = ["Spine1", "Spine2", "Spine3", "Neck1", "Neck2", "Head"]
BASE_ACTIONS = ["cruise", "idle.001", "hover.001", "bankLeft.001", "bankRight.001", "glide.001"]
out = {}

for action_name in BASE_ACTIONS:
    act = bpy.data.actions.get(action_name)
    if not act:
        continue
    slot = act.slots[0]
    cb = act.layers[0].strips[0].channelbag(slot)
    bone_bases = {}
    for bone in targets:
        dp = f'pose.bones["{bone}"].rotation_quaternion'
        qvals = {}
        for fc in cb.fcurves:
            if fc.data_path != dp:
                continue
            kps = list(fc.keyframe_points)
            if not kps:
                continue
            vals = [kp.co[1] for kp in kps]
            qvals[fc.array_index] = sum(vals) / len(vals)  # mean = rest-pose base
        bone_bases[bone] = qvals
    out[action_name] = bone_bases

print("BASE:" + json.dumps(out))
"""


# ---------------------------------------------------------------------------
# Core: generate + write quaternion keyframes for one bone/action
# ---------------------------------------------------------------------------

WRITE_MOTION_CODE = r"""
import bpy, json, math

def quat_pitch_yaw(theta_x, theta_z):
    """Small-angle quaternion for rotation around local X then Z."""
    # Use full trig for correctness (angles up to ~15 deg)
    cx = math.cos(theta_x / 2)
    sx = math.sin(theta_x / 2)
    cz = math.cos(theta_z / 2)
    sz = math.sin(theta_z / 2)
    # q_x_rot * q_z_rot (in local space)
    w =  cx * cz
    x =  sx * cz
    y = -sx * sz
    z =  cx * sz
    return (w, x, y, z)

def get_or_create_fc(cb, dp, idx, fc_map):
    key = (dp, idx)
    if key in fc_map:
        return fc_map[key]
    fc = cb.fcurves.new(dp, index=idx)
    fc_map[key] = fc
    return fc

# -----------------------------------------------------------------------
# Motion parameters per clip
# -----------------------------------------------------------------------
# Each entry: (action_name, wing_period_frames, down_peak_frame, total_frames)
CLIP_PARAMS = {
    "cruise":        (48, 24, 144),
    "idle.001":      (72, 36, 144),   # slower, more relaxed
    "hover.001":     (36, 18, 144),   # faster, more vigorous hover
    "bankLeft.001":  (48, 24, 144),
    "bankRight.001": (48, 24, 144),
    "glide.001":     (95,  0,  95),   # no wingbeat, just breath-like sway
}

# Bone motion definitions (per clip-param type)
# Format: (bone, amp_x_scale, phase_add_frames, amp_z_scale)
# amp_x_scale is multiplied by BASE_AMP_X to get actual amplitude
# Negative amp_x_scale = opposing phase (neck compensates for body)
BASE_AMP_X = 0.055  # baseline pitch amplitude in radians (~3.2 deg)
BASE_AMP_Z = 0.018  # baseline lateral sway amplitude in radians (~1.0 deg)

BONE_MOTIONS = [
    # bone         ax_scale  phase+  az_scale  sway_period_mult
    ("Spine1",     +0.70,    0,      0.30,     2.0),
    ("Spine2",     +0.60,   +5,      0.25,     2.0),
    ("Spine3",     +0.50,  +10,      0.20,     2.0),
    ("Neck1",      -1.50,  +12,     -0.60,     1.5),
    ("Neck2",      -2.00,  +16,     -0.90,     1.5),
    ("Head",       -1.70,  +20,     -1.20,     1.0),
]

# -----------------------------------------------------------------------
# For glide: no wingbeat, use gentle breath-like motion
# -----------------------------------------------------------------------
GLIDE_AMP_X = 0.020  # very subtle
GLIDE_AMP_Z = 0.012

results = []

for action_name, (period, down_peak, total_frames) in CLIP_PARAMS.items():
    act = bpy.data.actions.get(action_name)
    if not act:
        results.append(f"SKIP {action_name} (not found)")
        continue

    slot = act.slots[0]
    cb = act.layers[0].strips[0].channelbag(slot)

    # Build fcurve lookup
    fc_map = {}
    for fc in cb.fcurves:
        fc_map[(fc.data_path, fc.array_index)] = fc

    is_glide = action_name == "glide.001"
    FRAME_STEP = 2  # keyframe every 2 frames = 72 Hz at 24fps = very smooth

    for bone_name, ax_scale, phase_add, az_scale, sway_mult in BONE_MOTIONS:
        dp = f'pose.bones["{bone_name}"].rotation_quaternion'
        phase = down_peak + phase_add

        amp_x = (GLIDE_AMP_X if is_glide else BASE_AMP_X) * ax_scale
        amp_z = (GLIDE_AMP_Z if is_glide else BASE_AMP_Z) * az_scale
        sway_period = total_frames * sway_mult  # slow lateral drift period

        frames = list(range(0, total_frames + 1, FRAME_STEP))
        w_keys, x_keys, y_keys, z_keys = [], [], [], []

        for frame in frames:
            # Primary pitch (synced to wingbeat)
            theta_x = amp_x * math.sin(2 * math.pi * (frame - phase) / period)
            # Slow lateral sway (independent, very gentle)
            theta_z = amp_z * math.sin(2 * math.pi * frame / sway_period)

            w, x, y, z = quat_pitch_yaw(theta_x, theta_z)
            w_keys.append((frame, w))
            x_keys.append((frame, x))
            y_keys.append((frame, y))
            z_keys.append((frame, z))

        for comp_idx, kdata in [(0, w_keys), (1, x_keys), (2, y_keys), (3, z_keys)]:
            fc = get_or_create_fc(cb, dp, comp_idx, fc_map)
            fc.keyframe_points.clear()
            for frame, val in kdata:
                kp = fc.keyframe_points.insert(frame, val, options={'FAST'})
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = 'AUTO'
                kp.handle_right_type = 'AUTO'
            fc.update()

    results.append(f"OK {action_name}")

print("DONE:" + json.dumps(results))
"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Writing upper-body motion to Blender actions...")

    res = send_blender(WRITE_MOTION_CODE, timeout=60)
    stdout = res.get("stdout", "")
    if "DONE:" in stdout:
        results = json.loads(stdout.split("DONE:")[1].strip())
        for r in results:
            print(" ", r)
        print("\nAll done. Now export the GLB:")
        print("  python3 tools/blender/export_v2_rig.py")
    else:
        print("Error:")
        print("  stdout:", stdout[:2000])
        print("  stderr:", res.get("stderr", "")[:1000])
        print("  message:", res.get("message", "")[:1000])
