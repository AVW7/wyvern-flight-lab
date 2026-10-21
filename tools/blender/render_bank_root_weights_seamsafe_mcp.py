import bpy
from pathlib import Path
from mathutils import Vector
folder=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene
rig=bpy.data.objects['WyvernRig.005'];original=bpy.data.objects['V2_HarvestedBank_Corrective'];corrective=bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
visibility={o.name:o.hide_render for o in scene.objects if o.type=='MESH'};action=rig.animation_data.action;slot=rig.animation_data.action_slot;frame=scene.frame_current
camera=scene.camera;camera.data.ortho_scale=10000;camera.location=(0,-4200,2300);camera.rotation_euler=(Vector((0,100,1000))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.cycles.samples=16;scene.render.image_settings.file_format='PNG';scene.render.resolution_percentage=100
try:
 for o in scene.objects:
  if o.type=='MESH':o.hide_render=o.name!='WyvernBody_Rebuild.005'
 for clip in ['bankLeft','bankRight']:
  a=bpy.data.actions['V2HarvestBankReview_'+clip];rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0]
  for f in [18,54]:
   scene.frame_set(f)
   for label,obj in [('baseline',original),('corrective',corrective)]:
    original.hide_render=True;corrective.hide_render=True;obj.hide_render=False
    for ratio,res in [('16x9',(960,540)),('3x2',(900,600))]:
     scene.render.resolution_x,scene.render.resolution_y=res;scene.render.filepath=str(folder/f'weights-seamsafe-{clip}-{f:03}-{label}-{ratio}.png');bpy.ops.render.render(write_still=True)
finally:
 for name,state in visibility.items():bpy.data.objects[name].hide_render=state
 rig.animation_data.action=action;rig.animation_data.action_slot=slot;scene.frame_set(frame)
result={'renders':16,'folder':str(folder)}
