"""Render side and perspective view frames of the new takeoff animation for visual verification."""

import json
import socket
from pathlib import Path

OUT_DIR = "/Users/ajadvanwyk/.gemini/antigravity-ide/brain/7c733b1b-512e-424a-9bb8-8af3a8e93ae5"

BLENDER_SCRIPT = f"""
import bpy
from pathlib import Path

out_dir = Path("{OUT_DIR}")
out_dir.mkdir(parents=True, exist_ok=True)

# 1. Hide V1 object if visible, show V2
v1_obj = bpy.data.objects.get("Object_5")
if v1_obj:
    v1_obj.hide_render = True
for name in ["Object_299", "Object_300"]:
    o = bpy.data.objects.get(name)
    if o:
        o.hide_render = True

rig = bpy.data.objects["WyvernRig.001"]
body = bpy.data.objects.get("WyvernBody_Rebuild.001")
membrane = bpy.data.objects.get("WyvernMembrane_ExportSafe.001")

rig.hide_render = False
if body:
    body.hide_render = False
if membrane:
    membrane.hide_render = False

action = bpy.data.actions["takeoff_V2Candidate"]
rig.animation_data.action = action
if hasattr(rig.animation_data, "action_suitable_slots") and rig.animation_data.action_suitable_slots:
    rig.animation_data.action_slot = rig.animation_data.action_suitable_slots[0]

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "SINGLE"
scene.render.resolution_x = 960
scene.render.resolution_y = 540

# Setup cameras
side_cam = bpy.data.objects.get("ProfileCam_Side_Proper")
if not side_cam:
    side_cam = bpy.data.objects.get("ProfileCam_Side")
if side_cam:
    side_cam.data.clip_end = 25000.0

persp_cam = bpy.data.objects.get("PerspectiveCam_Clean34")
if not persp_cam:
    persp_cam = bpy.data.objects.get("PerspectiveCam_34_Proper")
if persp_cam:
    persp_cam.data.clip_end = 25000.0

frames = [0, 18, 36, 48, 72]

# Render Side Profile
if side_cam:
    scene.camera = side_cam
    for f in frames:
        scene.frame_set(f)
        out_path = str(out_dir / f"v2_new_takeoff_side_f{{f}}.png")
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
        print(f"Rendered side frame {{f}} to {{out_path}}")

# Render Perspective 3/4
if persp_cam:
    scene.camera = persp_cam
    for f in frames:
        scene.frame_set(f)
        out_path = str(out_dir / f"v2_new_takeoff_persp_f{{f}}.png")
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
        print(f"Rendered perspective frame {{f}} to {{out_path}}")

print("All takeoff verification renders complete.")
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
    print("Rendering verification frames...")
    res = send_blender_code(BLENDER_SCRIPT)
    print("Blender response:", res.get("stdout", res))
    if res.get("stderr"):
        print("Blender stderr:", res.get("stderr"))
