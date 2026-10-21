import bpy
from mathutils import Vector
from pathlib import Path

scene=bpy.data.scenes[review_scene]
bpy.context.window.scene=scene
source=bpy.data.scenes['V2 Corrective Cruise Review']
OUT=Path(review_directory);OUT.mkdir(exist_ok=True)
scene.camera.data.ortho_scale=8000
scene.camera.location=(0,-4200,2300)
scene.camera.rotation_euler=(Vector((0,100,1200))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x,scene.render.resolution_y={'3x2':(900,600),'16x9':(960,540)}[review_ratio]
scene.render.resolution_percentage=100
for field in ['view_transform','look','exposure','gamma']:setattr(scene.view_settings,field,getattr(source.view_settings,field))
scene.render.image_settings.file_format='PNG'
for frame in [0,18,36,54,72,90,108,126]:
    scene.frame_set(frame)
    scene.render.filepath=str(OUT/f'cruise-roundtrip-{review_ratio}-{frame:03}.png')
    bpy.ops.render.render(write_still=True)
result={'scene':scene.name,'ratio':review_ratio,'frames':8}
