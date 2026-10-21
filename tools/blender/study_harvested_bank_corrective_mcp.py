import bpy,json
from pathlib import Path
folder=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene
rig=bpy.data.objects['WyvernRig.005'];original=bpy.data.objects['WyvernMembrane_ExportSafe.005']
obj=original.copy();obj.data=original.data.copy();obj.name='V2_HarvestedBank_Corrective';scene.collection.objects.link(obj)
mod=obj.modifiers.new('Harvested bank membrane correction','CORRECTIVE_SMOOTH');mod.factor=.9;mod.iterations=20;mod.smooth_type='LENGTH_WEIGHTED';mod.use_pin_boundary=True
normal=obj.modifiers.new('Preserve harvested authored normals','DATA_TRANSFER');normal.object=original;normal.use_loop_data=True;normal.data_types_loops={'CUSTOM_NORMAL'};normal.loop_mapping='TOPOLOGY';normal.mix_mode='REPLACE';normal.mix_factor=1
source=bpy.data.scenes['V2 Corrective Cruise Review'];scene.world=source.world;scene.render.engine='CYCLES';scene.cycles.samples=16
for field in ['view_transform','look','exposure','gamma']:setattr(scene.view_settings,field,getattr(source.view_settings,field))
for old in source.objects:
 if old.type in ['CAMERA','LIGHT']:
  copy=old.copy();copy.data=old.data.copy();scene.collection.objects.link(copy)
  if copy.type=='CAMERA':scene.camera=copy
clay=bpy.data.materials['V2 panel inspection clay']
for meshobj in [original,obj,bpy.data.objects['WyvernBody_Rebuild.005']]:meshobj.data.materials.clear();meshobj.data.materials.append(clay)
bpy.data.objects['Icosphere.004'].hide_render=True
report={'object':obj.name,'scope':'V1-harvested opposed bank digit motion plus independent post-skin correction','samples':[],'harvested_candidate_sha256':'34ca702f5812b821b138a8047cbc8a6bf6ac4da74b45d8bdf289c812a29ccc4d'}
for clip in ['bankLeft','bankRight']:
 action=bpy.data.actions[clip+'.005'];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];rig.animation_data.use_nla=False
 for f in range(0,144,18):
  scene.frame_set(f);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();entry={'clip':clip,'frame':f}
  for label,meshobj in [('baseline',original),('corrective',obj)]:
   evaluated=meshobj.evaluated_get(dg);mesh=evaluated.to_mesh();mesh.calc_loop_triangles();entry[label]={'positions':[list(v.co) for v in mesh.vertices],'indices':[i for t in mesh.loop_triangles for i in t.vertices]};evaluated.to_mesh_clear()
  report['samples'].append(entry)
  if f in [18,54]:
   for label,meshobj in [('baseline',original),('corrective',obj)]:
    original.hide_render=True;obj.hide_render=True;meshobj.hide_render=False
    for ratio,res in [('16x9',(960,540)),('3x2',(900,600))]:
     scene.render.resolution_x,scene.render.resolution_y=res;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(folder/f'harvested-{clip}-{f:03}-{label}-{ratio}.png');bpy.ops.render.render(write_still=True)
original.hide_render=True;obj.hide_render=False
(folder/'harvested-bank-corrective-surfaces.json').write_text(json.dumps(report))
bpy.ops.wm.save_as_mainfile(filepath=str(folder/'v2-harvested-bank-corrective-study.blend'),copy=True)
result={'object':obj.name,'samples':len(report['samples']),'renders':16,'blend':str(folder/'v2-harvested-bank-corrective-study.blend')}
