import bpy,json,numpy as np
from pathlib import Path
out=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene;rig=bpy.data.objects['WyvernRig.005'];original=bpy.data.objects['WyvernMembrane_ExportSafe.005']
data=json.loads((out/'bank-root-weight-seamsafe-surfaces.json').read_text());obj=original
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
weights/=weights.sum(axis=1)[:,None];rest_inverse=np.asarray([np.linalg.inv(np.asarray(rig.data.bones[name].matrix_local)) for name in bones]);
baseline_object=bpy.data.objects['V2_HarvestedBank_Corrective'];weighted_object=bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
def posed(meshobj):
 bpy.context.view_layer.update();evaluated=meshobj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh();p=np.asarray([list(v.co) for v in mesh.vertices]);evaluated.to_mesh_clear();return p
report={'scope':'Dense original-skin bank corrective targets; no fitted basis or runtime export','clips':[]}
for clip in ['bankLeft','bankRight']:
 action=bpy.data.actions['V2HarvestBankReview_'+clip];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 targets=[];deltas=[];samples=[]
 for frame in range(145):
  scene.frame_set(frame);baseline=posed(baseline_object);weighted=posed(weighted_object);reference=metrics(baseline);choices=[]
  for alpha in [0,.125,.25,.5,.75,1]:
   positions=baseline+alpha*(weighted-baseline);m=metrics(positions)
   if m[0]<=reference[0] and m[1]<=reference[1]:choices.append((alpha,positions,m))
  alpha,desired,m=max(choices,key=lambda choice:choice[0]);actual=posed(original);matrices=np.asarray([np.asarray(rig.pose.bones[name].matrix) for name in bones])@rest_inverse;linear=np.einsum('vb,bij->vij',weights,matrices[:,:3,:3]);delta=np.linalg.solve(linear,(desired-actual)[...,None])[...,0];targets.append(desired);deltas.append(delta);samples.append({'frame':frame,'local_mix':alpha,'baseline_p95':reference[0],'desired_p95':m[0],'baseline_target_angle':reference[1],'desired_target_angle':m[1]})
 np.asarray(targets,dtype='<f4').tofile(out/f'{clip}-dense24-targets.bin');np.asarray(deltas,dtype='<f4').tofile(out/f'{clip}-dense24-original-skin-deltas.bin')
 switches=sum(samples[i]['local_mix']!=samples[i-1]['local_mix'] for i in range(1,len(samples)));report['clips'].append({'clip':clip,'frames':145,'fps':24,'mix_switches':switches,'max_mix_step':max(abs(samples[i]['local_mix']-samples[i-1]['local_mix']) for i in range(1,len(samples))),'samples':samples})
(out/'bank-dense24-target-report.json').write_text(json.dumps(report,indent=2));result={'clips':[{'clip':c['clip'],'frames':c['frames'],'mix_switches':c['mix_switches'],'max_mix_step':c['max_mix_step']} for c in report['clips']]}
