import bpy,json,numpy as np
from pathlib import Path
out=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene;rig=bpy.data.objects['WyvernRig.005'];obj=bpy.data.objects['V2_OriginalSkin_BankPoseCorrectives'];original=bpy.data.objects['WyvernMembrane_ExportSafe.005'];baseline=bpy.data.objects['V2_HarvestedBank_Corrective'];weighted=bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys=obj.data.shape_keys;keys.animation_data_create();clips=['attack','attack2','attackAir2','bankLeft','bankRight','breath','cruise','death','dive','glide','hover','idle','land','rest','scout','speed','takeoff','walk'];actions={}
for clip in clips:
 action=bpy.data.actions.new('V2BankShapes_'+clip);keys.animation_data.action=action
 end=float(bpy.data.actions['V2HarvestBankReview_'+clip].frame_range[1])
 for key in list(keys.key_blocks)[1:]:
  if key.name.startswith(clip+'_'):
   center=int(key.name.rsplit('_',1)[1]);frames=sorted({0,144,center,max(0,center-18),min(144,center+18),126 if center==0 else 0})
   for frame in frames:
    key.value=1 if frame==center or center==0 and frame==144 else 0;key.keyframe_insert(data_path='value',frame=frame)
  else:
   key.value=0
   for frame in [0,end]:key.keyframe_insert(data_path='value',frame=frame)
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for curve in bag.fcurves:
     for point in curve.keyframe_points:point.interpolation='LINEAR'
 actions[clip]=action
obj.data.calc_loop_triangles();tri=np.asarray([list(t.vertices) for t in obj.data.loop_triangles]);edges={}
for face,indices in enumerate(tri):
 for a,b in zip(indices,np.roll(indices,-1)):edges.setdefault(tuple(sorted((int(a),int(b)))),[]).append(face)
pairs=np.asarray([v for v in edges.values() if len(v)==2]);target=edges[(3381,3390)];groups={}
for v in obj.data.vertices:groups.setdefault(tuple(v.co),[]).append(v.index)
paired=[ids for ids in groups.values() if len(ids)>1]
def positions(meshobj):
 bpy.context.view_layer.update();e=meshobj.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh();p=np.asarray([list(v.co) for v in m.vertices]);e.to_mesh_clear();return p

def metrics(p):
 n=np.cross(p[tri[:,1]]-p[tri[:,0]],p[tri[:,2]]-p[tri[:,0]]);length=np.linalg.norm(n,axis=1)
 if np.any(length==0):return (float('inf'),float('inf'))
 n/=length[:,None];a=np.degrees(np.arccos(np.clip(np.sum(n[pairs[:,0]]*n[pairs[:,1]],axis=1),-1,1)));a.sort();return (float(a[int((len(a)-1)*.95)]),float(np.degrees(np.arccos(np.clip(np.dot(n[target[0]],n[target[1]]),-1,1)))))
def seek(clip,frame):
 a=bpy.data.actions['V2HarvestBankReview_'+clip];rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0];keys.animation_data.action=actions[clip];keys.animation_data.action_slot=actions[clip].slots[0];scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()
report={'shape_actions':18,'nonbank_resets':[],'heldout':[],'loop_weights':[]}
for clip in clips:
 if clip.startswith('bank'):
  seek(clip,0);start=[key.value for key in keys.key_blocks];seek(clip,144);end=[key.value for key in keys.key_blocks];assert start==end;report['loop_weights'].append({'clip':clip,'exact':True})
  for frame in range(9,144,18):
   seek(clip,frame);p=positions(obj);a=positions(baseline);b=positions(weighted);reference=metrics(a);choices=[]
   for alpha in [0,.125,.25,.5,.75,1]:
    desired=a+alpha*(b-a);m=metrics(desired)
    if m[0]<=reference[0] and m[1]<=reference[1]:choices.append((alpha,desired,m))
   alpha,desired,m=max(choices,key=lambda c:c[0]);error=float(np.linalg.norm(p-desired,axis=1).max());actual=metrics(p);gap=max((float(np.linalg.norm(p[ids[0]]-p[i])) for ids in paired for i in ids[1:]),default=0)
   report['heldout'].append({'clip':clip,'frame':frame,'desired_local_mix':alpha,'max_position_error':error,'baseline_p95':reference[0],'actual_p95':actual[0],'baseline_target_angle':reference[1],'actual_target_angle':actual[1],'max_seam_gap':gap,'protects_crease_metrics':actual[0]<=reference[0] and actual[1]<=reference[1]})
 else:
  end=bpy.data.actions['V2HarvestBankReview_'+clip].frame_range[1];drift=0
  for frame in [end*i/4 for i in range(5)]:
   seek(clip,frame);assert all(key.value==0 for key in keys.key_blocks);drift=max(drift,float(np.linalg.norm(positions(obj)-positions(original),axis=1).max()))
  assert drift==0;report['nonbank_resets'].append({'clip':clip,'max_drift':drift})
report['max_heldout_position_error']=max(s['max_position_error'] for s in report['heldout']);report['crease_protected_samples']=sum(s['protects_crease_metrics'] for s in report['heldout']);(out/'bank-shape-animation-audit.json').write_text(json.dumps(report,indent=2));seek('bankLeft',18);obj.hide_render=True
bpy.ops.wm.save_as_mainfile(filepath=str(out/'v2-bank-shape-animation-study.blend'),copy=True)
result={'actions':18,'nonbank_resets':len(report['nonbank_resets']),'heldout_samples':16,'max_position_error':report['max_heldout_position_error'],'crease_protected_samples':report['crease_protected_samples'],'loop_weights_exact':True}
