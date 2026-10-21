import bpy,json,numpy as np
from pathlib import Path
folder=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene;rig=bpy.data.objects['WyvernRig.005'];base=bpy.data.objects['V2_HarvestedBank_Corrective'];full=bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
obj=base.copy();obj.data=base.data.copy();obj.name='V2_BankRoot_StrengthScan';scene.collection.objects.link(obj);obj.hide_render=True

def weights(mesh):
 result=np.zeros((len(mesh.data.vertices),len(mesh.vertex_groups)))
 for v in mesh.data.vertices:
  for g in v.groups:result[v.index,g.group]=g.weight
 return result
original=weights(base);smoothed=weights(full);affected=np.where(np.max(np.abs(original-smoothed),axis=1)>0)[0]
duplicate={}
for v in obj.data.vertices:duplicate.setdefault(tuple(v.co),[]).append(v.index)
obj.data.calc_loop_triangles();triangles=np.asarray([list(t.vertices) for t in obj.data.loop_triangles]);edges={}
for f,indices in enumerate(triangles):
 for a,b in zip(indices,np.roll(indices,-1)):edges.setdefault(tuple(sorted((int(a),int(b)))),[]).append(f)
facepairs=np.asarray([faces for faces in edges.values() if len(faces)==2]);target=edges[(3381,3390)]

def metric(meshobj):
 bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();e=meshobj.evaluated_get(dg);m=e.to_mesh();p=np.asarray([list(v.co) for v in m.vertices]);e.to_mesh_clear();a=p[triangles[:,1]]-p[triangles[:,0]];b=p[triangles[:,2]]-p[triangles[:,0]];n=np.cross(a,b);length=np.linalg.norm(n,axis=1);assert np.all(length>0);n/=length[:,None];angles=np.degrees(np.arccos(np.clip(np.sum(n[facepairs[:,0]]*n[facepairs[:,1]],axis=1),-1,1)));angles.sort();target_angle=float(np.degrees(np.arccos(np.clip(np.dot(n[target[0]],n[target[1]]),-1,1))));return {'p95':float(angles[int((len(angles)-1)*.95)]),'target_angle':target_angle}
report={'affected_vertices':len(affected),'trials':[]}
for alpha in [.125,.25,.5,.75]:
 blended=(1-alpha)*original+alpha*smoothed
 for ids in duplicate.values():
  if any(i in affected for i in ids):
   w=np.mean(blended[ids],axis=0);top=np.argsort(w)[-4:];limited=np.zeros_like(w);limited[top]=w[top];limited/=limited.sum();blended[ids]=limited
 for i in affected:
  for g in obj.vertex_groups:g.remove([int(i)])
  for index,value in enumerate(blended[i]):
   if value>0:obj.vertex_groups[index].add([int(i)],float(value),'REPLACE')
 trial={'alpha':alpha,'samples':[]}
 for clip in ['bankLeft','bankRight']:
  action=bpy.data.actions['V2HarvestBankReview_'+clip];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
  for frame in range(0,144,18):
   scene.frame_set(frame);a=metric(base);b=metric(obj);trial['samples'].append({'clip':clip,'frame':frame,'baseline':a,'corrective':b,'passes_both':b['p95']<=a['p95'] and b['target_angle']<=a['target_angle']})
 trial['protected_samples']=sum(s['passes_both'] for s in trial['samples']);report['trials'].append(trial)
(folder/'bank-root-strength-scan.json').write_text(json.dumps(report,indent=2))
result={'affected_vertices':len(affected),'trials':[{'alpha':t['alpha'],'protected_samples':t['protected_samples']} for t in report['trials']]}
