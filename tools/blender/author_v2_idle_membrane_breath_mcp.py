import bpy
import json
import math
from pathlib import Path
from mathutils import Euler, Quaternion

SOURCE = Path("/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0/idle-v2-fold-candidate.glb")
OUTPUT = Path("/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-08/v2-idle-walk/panel-breath-curves.json")
FRAME_END = 144
AMPLITUDE = math.radians(0.35)
SAMPLE_STEP = 2

original_scene = bpy.context.window.scene if bpy.context.window else bpy.context.scene
original_file = bpy.data.filepath
original_active = bpy.context.view_layer.objects.active
original_selected = list(bpy.context.selected_objects)
before = {kind: set(getattr(bpy.data, kind)) for kind in ("objects", "actions", "collections", "meshes", "armatures", "materials", "images", "cameras")}
review_scene = bpy.data.scenes.new("__V2IdlePanelResponseReview")

try:
    if bpy.context.window:
        bpy.context.window.scene = review_scene
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    rigs = [obj for obj in review_scene.objects if obj.type == "ARMATURE"]
    assert len(rigs) == 1, f"Expected one imported armature, found {len(rigs)}"
    rig = rigs[0]
    assert len(rig.data.bones) == 92, "Idle donor does not use the reviewed V2 92-bone rig"
    assert rig.animation_data and rig.animation_data.action, "Imported Idle action is missing"
    action = rig.animation_data.action
    bag = action.layers[0].strips[0].channelbags[0] if hasattr(action, "layers") and action.layers else action

    panel_bones = [f"{side}_WingPanel{panel}_{segment}" for side in ("L", "R") for panel in range(4) for segment in range(2)]
    frames = list(range(0, FRAME_END + 1, SAMPLE_STEP))
    if frames[-1] != FRAME_END:
        frames.append(FRAME_END)

    authored = []
    panel_curves = {}
    for bone in panel_bones:
        assert rig.data.bones.get(bone), f"Missing V2 membrane panel bone {bone}"
        path = f'pose.bones["{bone}"].rotation_quaternion'
        for curve in list(bag.fcurves):
            if curve.data_path == path:
                bag.fcurves.remove(curve)
        curves = [bag.fcurves.new(data_path=path, index=axis) for axis in range(4)]
        panel_curves[bone] = curves
        panel = int(bone.split("Panel", 1)[1].split("_", 1)[0])
        segment = int(bone.rsplit("_", 1)[1])
        phase = panel * 0.26 + segment * 0.13
        is_right = bone.startswith("R_")
        for frame in frames:
            angle = AMPLITUDE * math.sin((2.0 * math.pi * 2.0 * frame / FRAME_END) + phase)
            q = Euler((angle, 0.0, 0.0), "XYZ").to_quaternion()
            if is_right:
                q = Quaternion((q.w, q.x, -q.y, -q.z))
            for curve, value in zip(curves, (q.w, q.x, q.y, q.z)):
                point = curve.keyframe_points.insert(frame, value, options={"FAST"})
                point.interpolation = "BEZIER"
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"
            for curve in curves:
                curve.update()
        authored.append(bone)

    times = list(range(FRAME_END + 1))
    channel_data = {
        bone: [
            [float(curve.evaluate(frame)) for curve in curves]
            for frame in times
        ]
        for bone, curves in panel_curves.items()
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "format": "blender-v2-idle-panel-curves-v1",
        "source": str(SOURCE),
        "frameRate": 24,
        "frameEnd": FRAME_END,
        "times": [frame / 24.0 for frame in times],
        "channels": channel_data,
    }, separators=(",", ":")))
    result = {
        "status": "curves_extracted",
        "blender": bpy.app.version_string,
        "sourceBlendPreserved": bpy.data.filepath == original_file,
        "originalScenePreserved": original_scene.name,
        "source": str(SOURCE),
        "output": str(OUTPUT),
        "action": action.name,
        "durationFrames": FRAME_END,
        "breathCycles": 2,
        "panelBonesAuthored": authored,
        "samplesPerBone": len(times),
        "amplitudeDegrees": 0.35,
        "amplitudeProvenance": "above scripts/validate-wyvern-clips.mjs MEMBRANE_MOTION_MIN 0.005 rad while keeping local movement below the existing 0.8 degree shoulder pulse",
        "bytes": OUTPUT.stat().st_size,
    }
finally:
    if bpy.context.window:
        bpy.context.window.scene = original_scene
    for obj in list(bpy.data.objects):
        if obj not in before["objects"]:
            bpy.data.objects.remove(obj, do_unlink=True)
    if review_scene.name in bpy.data.scenes:
        bpy.data.scenes.remove(review_scene)
    for kind in ("actions", "collections", "meshes", "armatures", "materials", "images", "cameras"):
        collection = getattr(bpy.data, kind)
        for datablock in list(collection):
            if datablock not in before[kind] and datablock.users == 0:
                collection.remove(datablock)
    bpy.context.view_layer.objects.active = original_active if original_active and original_active.name in bpy.data.objects else None
    for obj in list(bpy.context.selected_objects):
        obj.select_set(False)
    for obj in original_selected:
        if obj.name in bpy.data.objects:
            obj.select_set(True)
