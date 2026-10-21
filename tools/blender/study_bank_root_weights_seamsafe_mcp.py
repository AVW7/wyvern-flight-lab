import bpy,json,numpy as np
from pathlib import Path
out=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene;rig=bpy.data.objects['WyvernRig.005'];base=bpy.data.objects['V2_HarvestedBank_Corrective'];patch=bpy.data.objects['V2_LocalBankRoot_Corrective']
obj=base.copy();obj.data=base.data.copy();obj.name='V2_BankRoot_WeightBlend_SeamSafe';scene.collection.objects.link(obj);obj.hide_render=True
maskgroup=patch.vertex_groups['Measured inner bank folds'].index;mask={v.index:next(g.weight for g in v.groups if g.group==maskgroup) for v in patch.data.vertices if any(g.group==maskgroup for g in v.groups)}
weights=np.zeros((len(obj.data.vertices),len(obj.vertex_groups)))
for v in obj.data.vertices:
 for g in v.groups:weights[v.index,g.group]=g.weight
adj=[set() for _ in obj.data.vertices]
for edge in obj.data.edges:a,b=edge.vertices;adj[a].add(b);adj[b].add(a)
groups={}
for v in obj.data.vertices:groups.setdefault(tuple(v.co),[]).append(v.index)
for ids in groups.values():
 strength=max((mask.get(i,0) for i in ids),default=0)
 if strength>0:
  for i in ids:mask[i]=strength
 neighbors=set().union(*(adj[i] for i in ids))
 for i in ids:adj[i]=neighbors.copy()
for iteration in range(5):
 nextweights=weights.copy()
 for i,strength in mask.items():
  if adj[i]:nextweights[i]=(1-.5*strength)*weights[i]+.5*strength*np.mean(weights[list(adj[i])],axis=0)
 for ids in groups.values():
  if any(i in mask for i in ids):
   averaged=np.mean(nextweights[ids],axis=0);top=np.argsort(averaged)[-4:];limited=np.zeros_like(averaged);limited[top]=averaged[top];limited/=limited.sum();nextweights[ids]=limited
 weights=nextweights
for i in mask:
 for group in obj.vertex_groups:group.remove([i])
 for group,value in enumerate(weights[i]):
  if value>0:obj.vertex_groups[group].add([i],float(value),'REPLACE')
report={'object':obj.name,'patch_vertices':len(mask),'scope':'Local bind weights changed in isolated experiment; ground motion is not protected','samples':[]}
for clip in ['bankLeft','bankRight']:
 action=bpy.data.actions['V2HarvestBankReview_'+clip];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 for frame in range(0,144,18):
  scene.frame_set(frame);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();entry={'clip':clip,'frame':frame}
  for label,meshobj in [('baseline',base),('corrective',obj)]:
   evaluated=meshobj.evaluated_get(dg);mesh=evaluated.to_mesh();mesh.calc_loop_triangles();entry[label]={'positions':[list(v.co) for v in mesh.vertices],'indices':[i for t in mesh.loop_triangles for i in t.vertices]};evaluated.to_mesh_clear()
  report['samples'].append(entry)
(out/'bank-root-weight-seamsafe-surfaces.json').write_text(json.dumps(report))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'v2-bank-root-weight-seamsafe-study.blend'),copy=True)
result={'object':obj.name,'samples':16,'patch_vertices':len(mask),'max_influences':max(sum(1 for g in v.groups if g.weight>0) for v in obj.data.vertices)}
