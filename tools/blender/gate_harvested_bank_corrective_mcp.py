import bpy,json
from pathlib import Path
folder=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene
rig=bpy.data.objects['WyvernRig.005'];original=bpy.data.objects['WyvernMembrane_ExportSafe.005'];obj=bpy.data.objects['V2_HarvestedBank_Corrective'];original.hide_set(False);obj.hide_set(False)
rig['bank_corrective_strength']=0
mod=obj.modifiers['Harvested bank membrane correction'];curve=mod.driver_add('factor');curve.driver.expression='strength*0.9';variable=curve.driver.variables.new();variable.name='strength';variable.type='SINGLE_PROP';variable.targets[0].id=rig;variable.targets[0].data_path='["bank_corrective_strength"]'
clips=['attack','attack2','attackAir2','bankLeft','bankRight','breath','cruise','death','dive','glide','hover','idle','land','rest','scout','speed','takeoff','walk']
actions={}
for clip in clips:
 action=bpy.data.actions[clip+'.005'].copy();action.name='V2HarvestBankReview_'+clip
 rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];rig.animation_data.use_nla=False
 rig['bank_corrective_strength']=1 if clip.startswith('bank') else 0
 for frame in [0,float(action.frame_range[1])]:rig.keyframe_insert(data_path='["bank_corrective_strength"]',frame=frame)
 actions[clip]=action

def delta(clip,frame):
 action=actions[clip];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
 a=original.evaluated_get(dg);b=obj.evaluated_get(dg);ma=a.to_mesh();mb=b.to_mesh();difference=max((v.co-mb.vertices[v.index].co).length for v in ma.vertices);a.to_mesh_clear();b.to_mesh_clear();return difference
measurements=[]
for clip in clips:
 end=actions[clip].frame_range[1];values=[delta(clip,end*i/4) for i in range(5)]
 if not clip.startswith('bank'):assert max(values)==0,clip+' has unqualified deformation'
 else:assert max(values)>0
 measurements.append({'clip':clip,'max_deformation_delta':max(values)})
expression=curve.driver.expression
try:
 curve.driver.expression='0.9';mutant=delta('walk',15);assert mutant>0
finally:curve.driver.expression=expression
assert delta('walk',15)==0
report={'actions':measurements,'unqualified_actions_preserved':16,'walk_mutant_delta':mutant,'walk_restored_delta':0,'scope':'Blender authoring driver only; requires runtime-compatible morph bake'};(folder/'harvested-bank-gating-report.json').write_text(json.dumps(report,indent=2))
delta('bankLeft',18);original.hide_render=True;obj.hide_render=False
bpy.ops.wm.save_as_mainfile(filepath=str(folder/'v2-harvested-bank-gated-study.blend'),copy=True)
result={'actions':len(measurements),'ground_mutant_delta':mutant,'blend':str(folder/'v2-harvested-bank-gated-study.blend')}
