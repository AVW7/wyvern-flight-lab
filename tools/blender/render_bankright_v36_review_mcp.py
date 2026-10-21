import bpy
import json
from pathlib import Path
from mathutils import Vector


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study/v36-review'
SOURCE = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study/v36-bankRight-fourth-cluster-fit.blend'

assert bpy.data.filepath == str(SOURCE)
assert not bpy.data.is_dirty
OUT.mkdir(parents=True, exist_ok=True)

scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
rig = bpy.data.objects['WyvernRig.005']
body = bpy.data.objects['WyvernBody_Rebuild.005']
baseline = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
candidate = bpy.data.objects['BankRight_FullIndependentActionProbe']
camera = scene.camera
assert camera is not None

saved_frame = scene.frame_current
saved_action, saved_slot = rig.animation_data.action, rig.animation_data.action_slot
saved_camera = (camera.data.type, camera.data.ortho_scale, camera.location.copy(), camera.rotation_euler.copy())
saved_resolution = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage)
saved_filepath = scene.render.filepath
saved_format = scene.render.image_settings.file_format
saved_color_mode = scene.render.image_settings.color_mode
saved_samples = scene.cycles.samples if scene.render.engine == 'CYCLES' else None
saved_visibility = {obj.name: obj.hide_render for obj in scene.objects if obj.type == 'MESH'}
clay = bpy.data.materials['V2 panel inspection clay']
added_candidate_material = len(candidate.data.materials) == 0
if added_candidate_material:
    candidate.data.materials.append(clay)

bank_action = bpy.data.actions['bankRight.005']
baseline_action = bpy.data.actions['V2BankShapes_bankRightAdaptiveRefinement5']
candidate_action = bpy.data.actions['V2BankRightFullIndependentActionProbe']
baseline_keys = baseline.data.shape_keys
candidate_keys = candidate.data.shape_keys
baseline_keys.animation_data.action = baseline_action
baseline_keys.animation_data.action_slot = baseline_action.slots[0]
candidate_keys.animation_data.action = candidate_action
candidate_keys.animation_data.action_slot = candidate_action.slots[0]
rig.animation_data.action = bank_action
rig.animation_data.action_slot = bank_action.slots[0]

camera.data.type = 'ORTHO'
camera.data.ortho_scale = 10000
camera.location = (0, -4200, 2300)
camera.rotation_euler = (Vector((0, 100, 1000)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.resolution_percentage = 100
if scene.render.engine == 'CYCLES':
    scene.cycles.samples = 16

frames = [88.03125, 88.15625, 88.171875, 88.17578125,
          88.1875, 88.19921875, 88.203125, 88.21875, 88.34375]
ratios = {'16x9': (960, 540), '3x2': (900, 600)}
renders = []


def frame_label(value):
    return f'{value:.8f}'.rstrip('0').rstrip('.').replace('-', 'm').replace('.', 'p')


def render_pose(obj, frame, label, ratio, resolution):
    for mesh in scene.objects:
        if mesh.type == 'MESH':
            mesh.hide_render = mesh not in (body, obj)
    lo = int(frame)
    scene.frame_set(lo, subframe=frame - lo)
    scene.render.resolution_x, scene.render.resolution_y = resolution
    path = OUT / f'{label}-{frame_label(frame)}-{ratio}.png'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    renders.append(str(path))


try:
    for ratio, resolution in ratios.items():
        for frame in frames:
            render_pose(baseline, frame, 'local-v21', ratio, resolution)
            render_pose(candidate, frame, 'local-v36', ratio, resolution)
finally:
    for name, state in saved_visibility.items():
        bpy.data.objects[name].hide_render = state
    if added_candidate_material:
        candidate.data.materials.clear()
    rig.animation_data.action = saved_action
    rig.animation_data.action_slot = saved_slot
    camera.data.type, camera.data.ortho_scale = saved_camera[:2]
    camera.location, camera.rotation_euler = saved_camera[2:]
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = saved_resolution
    scene.render.filepath = saved_filepath
    scene.render.image_settings.file_format = saved_format
    scene.render.image_settings.color_mode = saved_color_mode
    if saved_samples is not None:
        scene.cycles.samples = saved_samples
    scene.frame_set(saved_frame)

manifest = {
    'source_blend': str(SOURCE),
    'baseline_action': baseline_action.name,
    'candidate_action': candidate_action.name,
    'rig_action': bank_action.name,
    'camera': {'ortho_scale': 10000, 'location': [0, -4200, 2300], 'target': [0, 100, 1000]},
    'cycles_samples': 16 if saved_samples is not None else None,
    'frames': frames,
    'ratios': {key: list(value) for key, value in ratios.items()},
    'render_count': len(renders),
    'renders': renders,
    'note': 'Matched V21/V36 diagnostic subframes; no bank-specific visual or motion acceptance limit is defined.'
}
(OUT / 'render-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
result = {'status': 'rendered', 'render_count': len(renders), 'output': str(OUT), 'blend_reopened_clean': bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty}
