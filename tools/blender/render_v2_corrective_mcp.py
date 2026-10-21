import bpy
from pathlib import Path
from mathutils import Vector

OUT = Path(globals().get('review_directory','/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/mcp-study/evidence-corrective'))
OUT.mkdir(exist_ok=True)
scene = bpy.context.scene
rig = bpy.data.objects['WyvernRig']
original = bpy.data.objects['WyvernMembrane_ExportSafe.001']
corrective = bpy.data.objects[globals().get('review_object','V2_CorrectiveSurface_Membrane')]
assert review_label in ['baseline', 'corrective']
action_name = f'V2RigReview_{review_clip}' if review_label == 'corrective' else f'{review_clip}.001'
rig.animation_data.action = bpy.data.actions[action_name]
original.hide_render = review_label != 'baseline'
corrective.hide_render = review_label != 'corrective'
original.hide_set(review_label != 'baseline')
corrective.hide_set(review_label != 'corrective')
cam = scene.camera
cam.data.ortho_scale = 8000
cam.location = (0, -4200, 2300)
cam.rotation_euler = (Vector((0, 100, 1200)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.resolution_x, scene.render.resolution_y = {'3x2': (900, 600), '16x9': (960, 540)}[review_ratio]
end = int(rig.animation_data.action.frame_range[1])
frames = [round(end * i / 8) for i in range(8)]
for frame in frames:
    scene.frame_set(frame)
    scene.render.filepath = str(OUT / f'{review_clip}-{review_label}-{review_ratio}-{frame:03}.png')
    bpy.ops.render.render(write_still=True)
result = {'clip': review_clip, 'label': review_label, 'ratio': review_ratio, 'frames': frames}
