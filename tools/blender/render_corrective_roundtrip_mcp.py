import bpy
from pathlib import Path
from mathutils import Vector

OUT=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/runtime-corrective/evidence-roundtrip')
OUT.mkdir(exist_ok=True)
scene=bpy.data.scenes['V2 Runtime Morph Exact Import']
bpy.context.window.scene=scene
rig=bpy.data.objects['WyvernRig.001']
membrane=bpy.data.objects['SKM_DaenerysDragon.007']
action=bpy.data.actions['cruise.002']
for owner in [rig,membrane.data.shape_keys]:
    owner.animation_data.use_nla=False
    owner.animation_data.action=action
    owner.animation_data.action_slot=next(s for s in action.slots if s.target_id_type==('OBJECT' if owner==rig else 'KEY'))
source=bpy.data.scenes['V2 Corrective Cruise Review']
for obj,reference in [(membrane,bpy.data.objects['V2_CorrectiveSurface_Membrane']),(bpy.data.objects['WyvernBody_Rebuild.002'],bpy.data.objects['WyvernBody_Rebuild.001'])]:
    obj.data.materials.clear()
    for material in reference.data.materials: obj.data.materials.append(material)
if scene.camera==source.camera:
    cam=source.camera.copy();cam.data=source.camera.data.copy();scene.collection.objects.link(cam);scene.camera=cam
cam=scene.camera
cam.data.ortho_scale=8000
cam.location=(0,-4200,2300)
cam.rotation_euler=(Vector((0,100,1200))-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x,scene.render.resolution_y={'3x2':(900,600),'16x9':(960,540)}[review_ratio]
scene.render.resolution_percentage=100
scene.view_settings.view_transform=source.view_settings.view_transform
scene.view_settings.look=source.view_settings.look
scene.view_settings.exposure=source.view_settings.exposure
scene.view_settings.gamma=source.view_settings.gamma
scene.render.image_settings.file_format='PNG'
for frame in review_frames:
    scene.frame_set(frame)
    scene.render.filepath=str(OUT/f'cruise-roundtrip-{review_ratio}-{frame:03}.png')
    bpy.ops.render.render(write_still=True)
result={'scene':scene.name,'ratio':review_ratio,'frames':review_frames,'shape_targets':len(membrane.data.shape_keys.key_blocks)-1}
