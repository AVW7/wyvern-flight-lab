import json
import socket

BLENDER_SCRIPT = """
import bpy

out = {"actions_promoted": [], "objects_removed": []}

# 1. Promote validated candidate actions to canonical names
candidate_map = {
    "cruise": "Cruise_FlightPolish_v2Candidate",
    "bankLeft": "bankLeft_FlightPolish_v2Candidate",
    "bankRight": "bankRight_FlightPolish_v2Candidate",
    "glide": "glide_FlightPolish_v2Candidate",
    "dive": "dive_FlightPolish_v2Candidate"
}

for canonical_name, cand_name in candidate_map.items():
    cand_act = bpy.data.actions.get(cand_name)
    if not cand_act:
        continue
    old_act = bpy.data.actions.get(canonical_name)
    if old_act:
        # Transfer name to candidate: rename old_act to archive, then rename cand_act to canonical
        old_act.name = f"{canonical_name}_archived_vendor"
    cand_act.name = canonical_name
    out["actions_promoted"].append({
        "canonical": canonical_name,
        "source_candidate": cand_name,
        "frame_range": [cand_act.frame_range[0], cand_act.frame_range[1]]
    })

# Assign cruise to active rig
rig = bpy.data.objects.get("WyvernRig.001")
if rig and rig.animation_data:
    cruise_act = bpy.data.actions.get("cruise")
    if cruise_act:
        rig.animation_data.action = cruise_act

# 2. Purge inactive duplicate objects
purge_targets = [
    "WyvernRig.002",
    "WyvernBody_Rebuild",
    "WyvernMembrane_ExportSafe",
    "Icosphere"
]

for name in purge_targets:
    obj = bpy.data.objects.get(name)
    if obj:
        # Unlink from all collections
        for col in list(obj.users_collection):
            col.objects.unlink(obj)
        bpy.data.objects.remove(obj, do_unlink=True)
        out["objects_removed"].append(name)

# 3. Clean orphan data
bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

# 4. Save mainfile
bpy.ops.wm.save_mainfile()
out["saved"] = True
print(json.dumps(out))
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
