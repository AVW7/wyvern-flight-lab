import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

V1_SOURCE = Path("/tmp/player-wyvern-blender-review.glb")
V2_IDLE_SOURCE = Path("/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0/idle-v2-fold-candidate.glb")
V2_WALK_SOURCE = Path("/Users/ajadvanwyk/.codex/visualizations/2026/09/09/01a08509-1dea-76c0-8707-83856dc9d32c/v2-rig/walk-candidate.glb")
CURVES_SOURCE = Path("/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-08/v2-idle-walk/panel-breath-curves.json")
OUTPUT_DIR = Path("/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-08/v2-idle-walk/render-review")
TARGET_SIZE = 8.4
ASPECTS = ((1152, 648, "16x9"), (960, 640, "3x2"))
PHASES = (0.0, 0.25, 0.5, 0.75)

original_scene = bpy.context.window.scene if bpy.context.window else bpy.context.scene
original_file = bpy.data.filepath
original_active = bpy.context.view_layer.objects.active
original_selected = list(bpy.context.selected_objects)
before = {kind: set(getattr(bpy.data, kind)) for kind in ("objects", "actions", "collections", "meshes", "armatures", "materials", "images", "cameras", "lights", "worlds")}
review_scene = bpy.data.scenes.new("__V2IdleWalkCandidateReview")


def new_scene_objects(before_objects):
    return [obj for obj in bpy.data.objects if obj not in before_objects]


def import_rig(path):
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = new_scene_objects(before_objects)
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    assert len(armatures) == 1, f"{path} imported {len(armatures)} armatures"
    actions = [action for action in bpy.data.actions if action not in before_actions]
    roots = [obj for obj in objects if obj.parent not in objects]
    container = bpy.data.objects.new(f"{armatures[0].name}_ReviewRoot", None)
    review_scene.collection.objects.link(container)
    for obj in roots:
        world = obj.matrix_world.copy()
        obj.parent = container
        obj.matrix_world = world
    return {"armature": armatures[0], "objects": objects + [container], "root": container, "actions": actions}


def assign_action(rig, action):
    rig.animation_data.action = action
    if hasattr(rig.animation_data, "action_suitable_slots") and rig.animation_data.action_suitable_slots:
        rig.animation_data.action_slot = rig.animation_data.action_suitable_slots[0]


def mesh_bounds(model):
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in model["objects"]:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        evaluated.to_mesh_clear()
    assert points, "Model has no evaluated mesh vertices"
    low = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    high = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return low, high


def normalize_model(model):
    root = model["root"]
    root.rotation_euler.z += math.pi
    low, high = mesh_bounds(model)
    largest = max(high - low)
    factor = TARGET_SIZE / largest
    root.scale = Vector(root.scale) * factor
    low, high = mesh_bounds(model)
    root.location += Vector((-((low.x + high.x) * 0.5), -((low.y + high.y) * 0.5), -low.z))
    return mesh_bounds(model)


def set_model_visible(model, visible):
    for obj in model["objects"]:
        obj.hide_render = not visible


def sample_frame(action, phase):
    start, end = action.frame_range
    return int(round(start + (end - start) * phase))


def render(path, width, height, frame):
    review_scene.frame_set(frame)
    review_scene.render.resolution_x = width
    review_scene.render.resolution_y = height
    review_scene.render.resolution_percentage = 100
    review_scene.render.image_settings.file_format = "PNG"
    review_scene.render.filepath = str(path)
    with bpy.context.temp_override(scene=review_scene, view_layer=review_scene.view_layers[0]):
        bpy.ops.render.render(write_still=True, scene=review_scene.name)


try:
    assert V1_SOURCE.exists() and V2_IDLE_SOURCE.exists() and V2_WALK_SOURCE.exists() and CURVES_SOURCE.exists()
    if bpy.context.window:
        bpy.context.window.scene = review_scene

    v1 = import_rig(V1_SOURCE)
    v1_idle = next(action for action in v1["actions"] if action.name.lower() == "idle")
    assign_action(v1["armature"], v1_idle)
    normalize_model(v1)

    v2_idle = import_rig(V2_IDLE_SOURCE)
    v2_idle_action = v2_idle["armature"].animation_data.action
    curves = json.loads(CURVES_SOURCE.read_text())
    bag = v2_idle_action.layers[0].strips[0].channelbags[0] if hasattr(v2_idle_action, "layers") and v2_idle_action.layers else v2_idle_action
    for bone, samples in curves["channels"].items():
        path = f'pose.bones["{bone}"].rotation_quaternion'
        for curve in list(bag.fcurves):
            if curve.data_path == path:
                bag.fcurves.remove(curve)
        components = [bag.fcurves.new(data_path=path, index=axis) for axis in range(4)]
        for frame, sample in enumerate(samples):
            for curve, value in zip(components, sample):
                point = curve.keyframe_points.insert(frame, value, options={"FAST"})
                point.interpolation = "LINEAR"
            for curve in components:
                curve.update()
    assign_action(v2_idle["armature"], v2_idle_action)
    normalize_model(v2_idle)

    walk = import_rig(V2_WALK_SOURCE)
    walk_action = walk["armature"].animation_data.action
    assign_action(walk["armature"], walk_action)
    normalize_model(walk)

    review_scene.render.engine = "BLENDER_WORKBENCH"
    review_scene.display.shading.light = "STUDIO"
    review_scene.display.shading.color_type = "SINGLE"
    review_scene.display.shading.single_color = (0.78, 0.82, 0.88)
    review_scene.display.shading.background_type = "WORLD"
    review_scene.display.shading.show_shadows = True
    review_scene.display.shading.show_cavity = True
    review_scene.display.shading.cavity_type = "BOTH"
    review_scene.display.shading.cavity_ridge_factor = 1.0
    review_scene.display.shading.cavity_valley_factor = 1.0
    world = bpy.data.worlds.new("__V2ReviewWorld")
    world.color = (0.025, 0.03, 0.04)
    review_scene.world = world

    camera_data = bpy.data.cameras.new("__V2ReviewCameraData")
    camera = bpy.data.objects.new("__V2ReviewCamera", camera_data)
    review_scene.collection.objects.link(camera)
    camera.location = Vector((13.0, 20.0, 10.2))
    target = Vector((0.0, 0.0, TARGET_SIZE * 0.46))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 18.5
    camera_data.clip_end = 1000.0
    review_scene.camera = camera

    floor_mesh = bpy.data.meshes.new("__V2ReviewFloorMesh")
    floor_mesh.from_pydata([(-40, -40, -0.025), (40, -40, -0.025), (40, 40, -0.025), (-40, 40, -0.025)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new("__V2ReviewFloor", floor_mesh)
    review_scene.collection.objects.link(floor)
    floor_mat = bpy.data.materials.new("__V2ReviewFloorMaterial")
    floor_mat.diffuse_color = (0.16, 0.18, 0.2, 1.0)
    floor.data.materials.append(floor_mat)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs = []

    set_model_visible(v1, False)
    set_model_visible(v2_idle, True)
    set_model_visible(walk, False)
    for width, height, aspect in ASPECTS:
        for phase in PHASES:
            frame = sample_frame(v2_idle_action, phase)
            path = OUTPUT_DIR / f"v2-idle-p{int(phase * 100):02d}-{aspect}.png"
            render(path, width, height, frame)
            outputs.append({"clip": "V2 Idle candidate", "phase": phase, "frame": frame, "aspect": aspect, "path": str(path)})

    set_model_visible(v2_idle, False)
    set_model_visible(v1, True)
    for width, height, aspect in ASPECTS:
        for phase in PHASES:
            frame = sample_frame(v1_idle, phase)
            path = OUTPUT_DIR / f"v1-idle-p{int(phase * 100):02d}-{aspect}.png"
            render(path, width, height, frame)
            outputs.append({"clip": "V1 Idle reference", "phase": phase, "frame": frame, "aspect": aspect, "path": str(path)})

    set_model_visible(v1, False)
    set_model_visible(walk, True)
    for width, height, aspect in ASPECTS:
        for phase in PHASES:
            frame = sample_frame(walk_action, phase)
            path = OUTPUT_DIR / f"v2-walk-p{int(phase * 100):02d}-{aspect}.png"
            render(path, width, height, frame)
            outputs.append({"clip": "V2 Walk candidate", "phase": phase, "frame": frame, "aspect": aspect, "path": str(path)})

    result = {
        "status": "rendered",
        "blender": bpy.app.version_string,
        "originalScenePreserved": original_scene.name,
        "originalBlendPreserved": bpy.data.filepath == original_file,
        "v1IdleFrames": [sample_frame(v1_idle, phase) for phase in PHASES],
        "v2IdleFrames": [sample_frame(v2_idle_action, phase) for phase in PHASES],
        "v2WalkFrames": [sample_frame(walk_action, phase) for phase in PHASES],
        "outputs": outputs,
    }
finally:
    if bpy.context.window:
        bpy.context.window.scene = original_scene
    for obj in list(bpy.data.objects):
        if obj not in before["objects"]:
            bpy.data.objects.remove(obj, do_unlink=True)
    if review_scene.name in bpy.data.scenes:
        bpy.data.scenes.remove(review_scene)
    for kind in ("actions", "collections", "meshes", "armatures", "materials", "images", "cameras", "lights", "worlds"):
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
