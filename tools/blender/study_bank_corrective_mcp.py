import bpy,json
from pathlib import Path
out=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study');out.mkdir(exist_ok=True)
scene=bpy.data.scenes['V2 Corrective Cruise Review'];bpy.context.window.scene=scene
rig=bpy.data.objects['WyvernRig'];original=bpy.data.objects['WyvernMembrane_ExportSafe.001'];base=bpy.data.objects['V2_AuthoredNormal_Corrective_Membrane']
obj=base.copy();obj.data=base.data.copy();obj.name='V2_Bank_Corrective_Study';scene.collection.objects.link(obj)
for curve in list(obj.animation_data.drivers):obj.driver_remove(curve.data_path)
obj.modifiers['Membrane pose correction'].factor=.9
obj.hide_render=True;obj.hide_set(False);original.hide_set(False)
report={'samples':[],'object':obj.name,'factor':.9,'iterations':obj.modifiers['Membrane pose correction'].iterations,'scope':'Original bank skeleton motion with independent post-skin membrane correction'}
saved=rig.animation_data.action;savedslot=rig.animation_data.action_slot;frame=scene.frame_current
try:
 for clip in ['bankLeft','bankRight']:
  action=bpy.data.actions['V2RigReview_'+clip];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
  for f in range(0,144,18):
   scene.frame_set(f);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();entry={'clip':clip,'frame':f}
   for label,meshobj in [('baseline',original),('corrective',obj)]:
    evaluated=meshobj.evaluated_get(dg);mesh=evaluated.to_mesh();mesh.calc_loop_triangles()
    entry[label]={'positions':[list(v.co) for v in mesh.vertices],'indices':[i for t in mesh.loop_triangles for i in t.vertices]};evaluated.to_mesh_clear()
   report['samples'].append(entry)
finally:
 rig.animation_data.action=saved;rig.animation_data.action_slot=savedslot;scene.frame_set(frame)
(out/'bank-corrective-surfaces.json').write_text(json.dumps(report))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'v2-bank-corrective-study.blend'),copy=True)
result={'object':obj.name,'samples':len(report['samples']),'blend':str(out/'v2-bank-corrective-study.blend')}
