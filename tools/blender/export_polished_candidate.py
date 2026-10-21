import json
import socket

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

blender_code = """
from pathlib import Path
import bpy

OUT = Path("/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0")
RIG = bpy.data.objects["WyvernRig.001"]
MESH = bpy.data.objects["WyvernMembrane_ExportSafe.001"]
ACTION = bpy.data.actions["Cruise_FlightPolish_v2Candidate"]

if RIG.animation_data is None:
    RIG.animation_data_create()
RIG.animation_data.action = ACTION

bpy.ops.object.select_all(action="DESELECT")
RIG.select_set(True)
MESH.select_set(True)
bpy.context.view_layer.objects.active = RIG

destination = OUT / "cruise-v1-shape-candidate.glb"
bpy.ops.export_scene.gltf(
    filepath=str(destination),
    export_format="GLB",
    use_selection=True,
    export_animation_mode="ACTIVE_ACTIONS",
    export_nla_strips=False,
    export_force_sampling=True,
)
print("SUCCESS: Exported polished candidate to", destination)
"""

res = send_blender_code(blender_code)
print("Response from Blender:", res)
