import bpy,json
from pathlib import Path
from collections import deque
from mathutils.kdtree import KDTree
out=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
scene=bpy.data.scenes['V2 Harvested Bank Correction'];bpy.context.window.scene=scene
rig=bpy.data.objects['WyvernRig.005'];base=bpy.data.objects['V2_HarvestedBank_Corrective'];obj=base.copy();obj.data=base.data.copy();obj.name='V2_LocalBankRoot_Corrective';scene.collection.objects.link(obj);obj.hide_render=True
seeds={3381,3390,6323,6326,1414,1415,6314,4780,4783};tree=KDTree(len(obj.data.vertices))
for v in obj.data.vertices:tree.insert(v.co,v.index)
tree.balance();mirror=[]
for index in list(seeds):
 p=obj.data.vertices[index].co.copy();p.x=-p.x;co,other,distance=tree.find(p);seeds.add(other);mirror.append({'vertex':index,'mirror':other,'distance':distance})
adj=[set() for _ in obj.data.vertices]
for e in obj.data.edges:a,b=e.vertices;adj[a].add(b);adj[b].add(a)
groups={}
for v in obj.data.vertices:groups.setdefault(tuple(v.co),[]).append(v.index)
for ids in groups.values():
 for i in ids:adj[i].update(ids)
distances={i:0 for i in seeds};queue=deque(seeds)
while queue:
 i=queue.popleft()
 if distances[i]>=4:continue
 for j in adj[i]:
  if j not in distances:distances[j]=distances[i]+1;queue.append(j)
mask=obj.vertex_groups.new(name='Measured inner bank folds')
for i,d in distances.items():mask.add([i],1-d/5,'REPLACE')
mod=obj.modifiers.new('Local inner-fold correction','CORRECTIVE_SMOOTH');mod.factor=.9;mod.iterations=20;mod.smooth_type='LENGTH_WEIGHTED';mod.use_pin_boundary=True;mod.vertex_group=mask.name
bpy.context.view_layer.objects.active=obj
bpy.ops.object.modifier_move_up(modifier=mod.name)
curve=mod.driver_add('factor');curve.driver.expression='strength*0.9';variable=curve.driver.variables.new();variable.name='strength';variable.type='SINGLE_PROP';variable.targets[0].id=rig;variable.targets[0].data_path='["bank_corrective_strength"]'
report={'object':obj.name,'seeds':sorted(seeds),'mirror_matches':mirror,'patch_vertices':len(distances),'graph_rings':4,'samples':[]}
for clip in ['bankLeft','bankRight']:
 action=bpy.data.actions['V2HarvestBankReview_'+clip];rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
 for frame in range(0,144,18):
  scene.frame_set(frame);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();entry={'clip':clip,'frame':frame}
  for label,meshobj in [('baseline',base),('corrective',obj)]:
   evaluated=meshobj.evaluated_get(dg);mesh=evaluated.to_mesh();mesh.calc_loop_triangles();entry[label]={'positions':[list(v.co) for v in mesh.vertices],'indices':[i for t in mesh.loop_triangles for i in t.vertices]};evaluated.to_mesh_clear()
  report['samples'].append(entry)
(out/'local-bank-fold-surfaces.json').write_text(json.dumps(report))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'v2-local-bank-fold-study.blend'),copy=True)
result={'object':obj.name,'patch_vertices':len(distances),'samples':16,'mirror_matches':mirror}
