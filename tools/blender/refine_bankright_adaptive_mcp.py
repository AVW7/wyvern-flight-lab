import bpy,json,numpy as np
from pathlib import Path
out=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
plan=json.loads((out/'bankRight-adaptive-refinement-5-key-plan.json').read_text())
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene
rig=bpy.data.objects['WyvernRig.005'];obj=bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
original=bpy.data.objects['WyvernMembrane_ExportSafe.005'];basis=bpy.data.objects['V2_HarvestedBank_Corrective'];weighted=bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
assert bpy.data.filepath.endswith('v8-bankRight-adaptive-refinement-4.blend') and not bpy.data.is_dirty
assert not bpy.data.actions.get('V2BankShapes_bankRightAdaptiveRefinement5')
seq=json.loads((out/'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
new_times=plan['new_times']
bones=[g.name for g in original.vertex_groups];weights=np.zeros((len(original.data.vertices),len(bones)))
for v in original.data.vertices:
 for g in v.groups:weights[v.index,g.group]=g.weight
weights/=weights.sum(axis=1)[:,None];rest_inverse=np.asarray([np.linalg.inv(np.asarray(rig.data.bones[n].matrix_local)) for n in bones])
def posed(o):
 bpy.context.view_layer.update();e=o.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh();p=np.asarray([list(v.co) for v in m.vertices]);e.to_mesh_clear();return p
def source_target(t):
 lo=int(np.floor(t));u=t-lo;alpha=seq[lo]*(1-u)+seq[(lo+1)%144]*u
 action=bpy.data.actions['bankRight.005'];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 scene.frame_set(int(t),subframe=t-int(t));a=posed(basis);b=posed(weighted);return a+alpha*(b-a)
# Make only the added midpoint targets. Their names preserve each refinement pass.
for i,t in enumerate(new_times):
 rig.animation_data.action=bpy.data.actions['bankRight.005'];rig.animation_data.action_slot=rig.animation_data.action.slots[0]
 scene.frame_set(int(t),subframe=t-int(t));desired=source_target(t);actual=posed(original)
 matrices=np.asarray([np.asarray(rig.pose.bones[n].matrix) for n in bones])@rest_inverse
 linear=np.einsum('vb,bij->vij',weights,matrices[:,:3,:3]);delta=np.linalg.solve(linear,(desired-actual)[...,None])[...,0]
 name=f'bankRightAdaptive5_{i:04d}';key=obj.shape_key_add(name=name);raw=np.asarray([list(v.co) for v in original.data.vertices]);key.data.foreach_set('co',(raw+delta).astype('<f4').ravel());key.value=0
# Rebuild an explicit cyclic hat track for every integer and adaptive target.
keys=obj.data.shape_keys;action=bpy.data.actions.new('V2BankShapes_bankRightAdaptiveRefinement5');keys.animation_data_create();slot=action.slots.new(id_type='KEY',name='KEKey.001');action.layers.new('Layer');action.slots.active=slot;keys.animation_data.action=action;keys.animation_data.action_slot=slot
# Recover every V8 key center directly from the saved V8 action curves.
a4=bpy.data.actions['V2BankShapes_bankRightAdaptiveRefinement4'];slot4=a4.slots[0];key_times={}
for strip in a4.layers[0].strips:
 for bag in strip.channelbags:
  if bag.slot==slot4:
   for fc in bag.fcurves:
    name=fc.data_path.split('key_blocks[\"',1)[1].split('\"]',1)[0]
    centers=[float(point.co[0]) for point in fc.keyframe_points if abs(point.co[1]-1)<1e-6]
    if centers:key_times[name]=centers[0]
# bankRightDense_144 is an explicit zero reset; frame 144 is represented by bankRightDense_000.
key_times['bankRightDense_144']=0.0
assert len(set(t for n,t in key_times.items() if n!='bankRightDense_144'))==439
for i,t in enumerate(new_times):key_times[f'bankRightAdaptive5_{i:04d}']=t
all_times=sorted(set(key_times.values()));assert len(all_times)==446 and len(key_times)==447
for key in list(keys.key_blocks)[1:]:
 if key.name=='bankRightDense_144':
  for frame in [0.0,144.0]:key.value=0.0;key.keyframe_insert(data_path='value',frame=frame)
  continue
 t=key_times[key.name];ordered=all_times;idx=ordered.index(t);prev=ordered[idx-1] if idx else ordered[-1]-144; nxt=ordered[idx+1] if idx+1<len(ordered) else ordered[0]+144
 points=[(prev,0.0),(t,1.0),(nxt,0.0)]
 if t==0.0:points=[(prev+144,0.0),(144.0,1.0),(nxt+144,0.0)]
 for frame,value in points:key.value=value;key.keyframe_insert(data_path='value',frame=frame)
for layer in action.layers:
 for strip in layer.strips:
  for bag in strip.channelbags:
   for curve in bag.fcurves:
    for point in curve.keyframe_points:point.interpolation='LINEAR'
# Dense 1/32 reference check against direct source geometry; evaluate actual shape action.
keys.animation_data.action=action;keys.animation_data.action_slot=slot
rig.animation_data.action=bpy.data.actions['bankRight.005'];rig.animation_data.action_slot=rig.animation_data.action.slots[0]
errors=[]
for j in range(4608):
 t=j/32;scene.frame_set(int(t),subframe=t-int(t));desired=source_target(t);actual=posed(obj);v=np.linalg.norm(actual-desired,axis=1);errors.append((float(v.max()),float(np.sqrt(np.mean(v*v))),t))
errors.sort(reverse=True);report={'scope':'Fifth adaptive bankRight shape refinement at 1/32-frame samples','shape_action':action.name,'rig_action':'bankRight.005','rig_slot':'OBWyvernRig.005','integer_shapes':145,'adaptive_keys_added':len(all_times)-145,'new_keys_this_pass':len(new_times),'total_unique_times':len(all_times),'samples':4608,'max_error':errors[0][0],'max_rms':max(x[1] for x in errors),'samples_over_2_333':sum(e>2.333 for e,_,_ in errors),'new_key_times':new_times,'worst_samples':[{'frame':t,'max_error':e,'rms':r} for e,r,t in errors[:20]],'limits':['2.333 units is a cruise comparison point, not a bank threshold','normal, visual full-cycle, transition and runtime cost gates remain unqualified']}
# Duplicate the frame-zero peak at the loop boundary; Dense_144 remains a zero reset.
loop_curve=next(fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags if bag.slot==slot for fc in bag.fcurves if 'bankRightDense_000' in fc.data_path)
# The periodic repeat maps frame 144 to frame 0; the ordinary hat endpoints already supply 0.25 and 143.875.
if not any(abs(point.co[0])<1e-7 and abs(point.co[1]-1)<1e-7 for point in loop_curve.keyframe_points):
 loop_curve.keyframe_points.insert(0.0,1.0,options={'FAST'})
 loop_curve.update()
for point in loop_curve.keyframe_points:point.interpolation='LINEAR'
# Confirm matching loop coefficients after the seam repair.
keys.animation_data.action=action;keys.animation_data.action_slot=slot
scene.frame_set(0);bpy.context.view_layer.update();weights0=np.asarray([key.value for key in keys.key_blocks])
scene.frame_set(144);bpy.context.view_layer.update();weights144=np.asarray([key.value for key in keys.key_blocks])
loop_delta=float(np.max(np.abs(weights0-weights144)));assert loop_delta==0.0
report['seam_fix']='bankRightDense_000 peaks at frames 0 and 144; bankRightDense_144 remains zero'
report['loop_coefficient_check']={'frame_0_vs_144_max_difference':loop_delta,'nonzero_shape_weights_frame0':int(np.count_nonzero(np.abs(weights0)>1e-7)),'nonzero_shape_weights_frame144':int(np.count_nonzero(np.abs(weights144)>1e-7))}
# Recheck the complete loop with the seam repair in place.
errors=[]
for j in range(4608):
 t=j/32;scene.frame_set(int(t),subframe=t-int(t));goal=source_target(t);actual=posed(obj);d=np.linalg.norm(actual-goal,axis=1);errors.append((float(d.max()),float(np.sqrt(np.mean(d*d))),t))
errors.sort(reverse=True);report.update({'max_error':errors[0][0],'max_rms':max(x[1] for x in errors),'samples_over_2_333':sum(e>2.333 for e,_,_ in errors),'worst_samples':[{'frame':t,'max_error':e,'rms':r} for e,r,t in errors[:20]]})
(out/'bankRight-adaptive-refinement-5-report.json').write_text(json.dumps(report,indent=2));obj.hide_render=True;scene.frame_set(80);bpy.ops.wm.save_as_mainfile(filepath=str(out/'v9-bankRight-adaptive-refinement-5.blend'),copy=True)
result={k:report[k] for k in ['samples','max_error','max_rms','samples_over_2_333','new_keys_this_pass','total_unique_times']}
