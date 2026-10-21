import bpy
import json
from pathlib import Path
from mathutils import Vector


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study/v44-review'
SOURCE = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study/v44-bankRight-additive-target-80519-corrective.blend'
NEW_NAME = 'bankRightTarget_80p51953125'
FRAMES = [80.46875, 80.5, 80.5078125, 80.515625, 80.51953125, 80.5234375, 80.53125, 80.5625]
RATIOS = {'16x9': (960, 540), '3x2': (900, 600)}

assert bpy.data.filepath == str(SOURCE)
assert not bpy.data.is_dirty
OUT.mkdir(parents=True, exist_ok=True)

scene = bpy.data.scenes['V2 Harvested Bank Correction']
rig = bpy.data.objects['WyvernRig.005']
body = bpy.data.objects['WyvernBody_Rebuild.005']
candidate = bpy.data.objects['BankRight_FullIndependentActionProbe']
keys = candidate.data.shape_keys
shape_action, shape_slot = keys.animation_data.action, keys.animation_data.action_slot
bank_action = bpy.data.actions['bankRight.005']
candidate_curve = None
for layer in shape_action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            if bag.slot != shape_slot:
                continue
            for curve in bag.fcurves:
                if curve.data_path == f'key_blocks["{NEW_NAME}"].value':
                    candidate_curve = curve
assert candidate_curve is not None
assert len(candidate_curve.keyframe_points) == 3
assert scene.camera is not None

camera = scene.camera
saved_frame = scene.frame_current
saved_action, saved_slot = rig.animation_data.action, rig.animation_data.action_slot
saved_key_action, saved_key_slot = keys.animation_data.action, keys.animation_data.action_slot
saved_curve_mute = candidate_curve.mute
saved_camera = (camera.data.type, camera.data.ortho_scale, camera.location.copy(), camera.rotation_euler.copy())
saved_resolution = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage)
saved_filepath = scene.render.filepath
saved_format = scene.render.image_settings.file_format
saved_color_mode = scene.render.image_settings.color_mode
saved_samples = scene.cycles.samples if scene.render.engine == 'CYCLES' else None
saved_visibility = {obj.name: obj.hide_render for obj in scene.objects if obj.type == 'MESH'}
added_material = len(candidate.data.materials) == 0
if added_material:
    candidate.data.materials.append(bpy.data.materials['V2 panel inspection clay'])

camera.data.type = 'ORTHO'
camera.data.ortho_scale = 10000
camera.location = (0, -4200, 2300)
camera.rotation_euler = (Vector((0, 100, 1000)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.resolution_percentage = 100
if scene.render.engine == 'CYCLES':
    scene.cycles.samples = 16

renders = []


def frame_label(value):
    return f'{value:.8f}'.rstrip('0').rstrip('.').replace('-', 'm').replace('.', 'p')


try:
    rig.animation_data.action = bank_action
    rig.animation_data.action_slot = bank_action.slots[0]
    keys.animation_data.action = shape_action
    keys.animation_data.action_slot = shape_slot
    for mesh in scene.objects:
        if mesh.type == 'MESH':
            mesh.hide_render = mesh not in (body, candidate)
    for ratio, resolution in RATIOS.items():
        for frame in FRAMES:
            lo = int(frame)
            scene.frame_set(lo, subframe=frame - lo)
            for label, muted in [('v43-equivalent', True), ('v44', False)]:
                candidate_curve.mute = muted
                bpy.context.view_layer.update()
                scene.render.resolution_x, scene.render.resolution_y = resolution
                path = OUT / f'{label}-{frame_label(frame)}-{ratio}.png'
                scene.render.filepath = str(path)
                bpy.ops.render.render(write_still=True)
                renders.append(str(path))
finally:
    candidate_curve.mute = saved_curve_mute
    for name, state in saved_visibility.items():
        bpy.data.objects[name].hide_render = state
    if added_material:
        candidate.data.materials.clear()
    rig.animation_data.action = saved_action
    rig.animation_data.action_slot = saved_slot
    keys.animation_data.action = saved_key_action
    keys.animation_data.action_slot = saved_key_slot
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
    'candidate_curve': candidate_curve.data_path,
    'comparison': 'V43-equivalent is the same saved V44 scene with only the new corrective FCurve muted; V44 uses it unmuted.',
    'camera': {'ortho_scale': 10000, 'location': [0, -4200, 2300], 'target': [0, 100, 1000]},
    'cycles_samples': 16 if saved_samples is not None else None,
    'frames': FRAMES,
    'ratios': {key: list(value) for key, value in RATIOS.items()},
    'render_count': len(renders),
    'renders': renders,
    'note': 'Static hotspot review only; continuous playback, crease/normals and inter-clip transitions remain unqualified.'
}
(OUT / 'render-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
result = {'status': 'rendered', 'render_count': len(renders), 'output': str(OUT), 'blend_clean': not bpy.data.is_dirty}
