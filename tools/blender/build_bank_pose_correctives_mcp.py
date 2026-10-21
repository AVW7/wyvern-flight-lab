import bpy,json,numpy as np
from pathlib import Path
out=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene;rig=bpy.data.objects['WyvernRig.005'];original=bpy.data.objects['WyvernMembrane_ExportSafe.005']
data=json.loads((out/'bank-root-weight-seamsafe-surfaces.json').read_text());obj=original.copy();obj.data=original.data.copy();obj.name='V2_OriginalSkin_BankPoseCorrectives';scene.collection.objects.link(obj);obj.hide_render=True;obj.shape_key_add(name='Basis')
obj.data.calc_loop_triangles();tri=np.asarray([list(t.vertices) for t in obj.data.loop_triangles]);edges={}
for face,indices in enumerate(tri):
 for a,b in zip(indices,np.roll(indices,-1)):edges.setdefault(tuple(sorted((int(a),int(b)))),[]).append(face)
pairs=np.asarray([v for v in edges.values() if len(v)==2]);target=edges[(3381,3390)]
def metrics(p):
 n=np.cross(p[tri[:,1]]-p[tri[:,0]],p[tri[:,2]]-p[tri[:,0]]);length=np.linalg.norm(n,axis=1)
 if np.any(length==0):return (float('inf'),float('inf'))
 n/=length[:,None];angles=np.degrees(np.arccos(np.clip(np.sum(n[pairs[:,0]]*n[pairs[:,1]],axis=1),-1,1)));angles.sort();return (float(angles[int((len(angles)-1)*.95)]),float(np.degrees(np.arccos(np.clip(np.dot(n[target[0]],n[target[1]]),-1,1)))))
bones=[g.name for g in original.vertex_groups];weights=np.zeros((len(original.data.vertices),len(bones)))
for v in original.data.vertices:
 for g in v.groups:weights[v.index,g.group]=g.weight
weights/=weights.sum(axis=1)[:,None];rest_inverse=np.asarray([np.linalg.inv(np.asarray(rig.data.bones[name].matrix_local)) for name in bones]);report={'object':obj.name,'samples':[],'scope':'Discrete pose correctives; no interpolated playback or automatic clip activation'}
for sample in data['samples']:
 baseline=np.asarray(sample['baseline']['positions']);weighted=np.asarray(sample['corrective']['positions']);reference=metrics(baseline);choices=[]
 for alpha in [0,.125,.25,.5,.75,1]:
  positions=baseline+alpha*(weighted-baseline);m=metrics(positions)
  if m[0]<=reference[0] and m[1]<=reference[1]:choices.append((alpha,positions,m))
 alpha,desired,measured=max(choices,key=lambda choice:choice[0]);action=bpy.data.actions['V2HarvestBankReview_'+sample['clip']];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0];scene.frame_set(sample['frame']);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();e=original.evaluated_get(dg);mesh=e.to_mesh();actual=np.asarray([list(v.co) for v in mesh.vertices]);e.to_mesh_clear()
 matrices=np.asarray([np.asarray(rig.pose.bones[name].matrix) for name in bones])@rest_inverse;linear=np.einsum('vb,bij->vij',weights,matrices[:,:3,:3]);delta=np.linalg.solve(linear,(desired-actual)[...,None])[...,0]
 key=obj.shape_key_add(name=f"{sample['clip']}_{sample['frame']:03}");raw=np.asarray([list(v.co) for v in original.data.vertices]);key.data.foreach_set('co',(raw+delta).ravel());key.value=1;bpy.context.view_layer.update();e=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=e.to_mesh();posed=np.asarray([list(v.co) for v in mesh.vertices]);e.to_mesh_clear();error=float(np.linalg.norm(posed-desired,axis=1).max());bound=float(np.finfo(np.float32).eps*np.max(np.abs(desired))*64);assert error<=bound
 report['samples'].append({'clip':sample['clip'],'frame':sample['frame'],'local_weight_pose_mix':alpha,'baseline_p95':reference[0],'baseline_target_angle':reference[1],'desired_p95':measured[0],'desired_target_angle':measured[1],'original_skin_reconstruction_error':error,'float32_bound':bound});key.value=0
(out/'bank-pose-corrective-report.json').write_text(json.dumps(report,indent=2));obj['scope']=report['scope'];bpy.ops.wm.save_as_mainfile(filepath=str(out/'v2-original-skin-bank-pose-study.blend'),copy=True)
result={'object':obj.name,'shape_keys':len(obj.data.shape_keys.key_blocks)-1,'max_reconstruction_error':max(s['original_skin_reconstruction_error'] for s in report['samples']),'local_weight_mix':[s['local_weight_pose_mix'] for s in report['samples']]}
