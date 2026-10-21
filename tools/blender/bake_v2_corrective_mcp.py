import bpy
import json
import numpy as np
from pathlib import Path

OUT=Path(globals().get('bake_directory','/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/runtime-corrective'))
fps=globals().get('bake_fps',24)
frames=round(6*fps)+1
source=json.loads((OUT/'source-attributes.json').read_text())
calibration=json.loads((OUT/'bind-calibration.json').read_text())
assert source['source_sha256']==calibration['source_sha256']
rig=bpy.data.objects['WyvernRig']
original=bpy.data.objects['WyvernMembrane_ExportSafe.001']
corrective=bpy.data.objects[globals().get('bake_object','V2_CorrectiveSurface_Membrane')]
original.hide_set(False);corrective.hide_set(False)
rig.animation_data.action=bpy.data.actions['V2RigReview_cruise']
rest=np.asarray([list(v.co) for v in original.data.vertices])
count=len(rest)
assert count==len(source['positions'])==8249
indices=np.asarray(source['joints'],dtype=int)
weights=np.asarray(source['weights']);weights/=weights.sum(axis=1)[:,None]
for vertex in original.data.vertices:
    imported={original.vertex_groups[g.group].name:float(g.weight) for g in vertex.groups if g.weight>0}
    extracted={source['bone_names'][int(j)]:float(np.float32(w)) for j,w in zip(source['joints'][vertex.index],source['weights'][vertex.index]) if w>0}
    assert imported==extracted, 'Vertex correspondence or source weight identity changed'
transform=np.asarray(calibration['mesh_to_blender_affine'])[:3]
inverse=np.linalg.inv(transform)
base_normals=np.asarray(source['normals'])
rest_inverse=np.asarray([np.linalg.inv(np.asarray(rig.data.bones[n].matrix_local)) for n in source['bone_names']])
shape=(frames,count,3)
progress_path=OUT/'bake-progress.json'
if progress_path.exists():
    progress=json.loads(progress_path.read_text())
    assert progress['source_sha256']==source['source_sha256']
    assert progress.get('fps',24)==fps
else:
    assert bake_start==0
    progress={'source_sha256':source['source_sha256'],'completed_frames':[],'measurements':[],'fps':fps,'frames':frames,'object':corrective.name}
arrays={}
for name in ['position-deltas','normal-deltas','reference-positions','reference-normals']:
    path=OUT/(name+'.bin')
    if not path.exists():
        assert bake_start==0
        np.memmap(path,dtype='<f4',mode='w+',shape=shape).flush()
    arrays[name]=np.memmap(path,dtype='<f4',mode='r+',shape=shape)
for frame in range(bake_start,bake_end):
    if frame in progress['completed_frames']:
        continue
    time=frame*24/fps
    bpy.context.scene.frame_set(int(time),subframe=time%1)
    dg=bpy.context.evaluated_depsgraph_get()
    evaluated=original.evaluated_get(dg);mesh=evaluated.to_mesh()
    original_pose=np.asarray([list(v.co) for v in mesh.vertices]);evaluated.to_mesh_clear()
    evaluated=corrective.evaluated_get(dg);mesh=evaluated.to_mesh()
    desired=np.asarray([list(v.co) for v in mesh.vertices])
    if globals().get('bake_corner_normals',False):
        loops=np.asarray([l.vertex_index for l in mesh.loops]);corners=np.asarray([list(n.vector) for n in mesh.corner_normals])
        desired_normals=np.zeros((count,3));np.add.at(desired_normals,loops,corners)
        lengths=np.linalg.norm(desired_normals,axis=1)
        assert np.all(lengths>0), 'Evaluated membrane has an undefined corner normal'
        desired_normals/=lengths[:,None]
        assert np.linalg.norm(corners-desired_normals[loops],axis=1).max()<1/127, 'Split corner normals require duplicated vertices'
    else:
        desired_normals=np.asarray([list(v.normal) for v in mesh.vertices])
    evaluated.to_mesh_clear()
    matrices=np.asarray([np.asarray(rig.pose.bones[n].matrix) for n in source['bone_names']])@rest_inverse
    skin=np.sum(matrices[indices]*weights[:,:,None,None],axis=1)
    linear=skin[:,:3,:3]
    predicted=np.einsum('nij,nj->ni',linear,rest)+skin[:,:3,3]
    skin_error=float(np.linalg.norm(predicted-original_pose,axis=1).max())
    extent=max(float(np.max(np.abs(original_pose))),float(np.max(np.abs(rest))))
    rounding_bound=float(np.finfo(np.float32).eps*extent*64)
    assert skin_error<rounding_bound, 'Linear skin model does not reproduce Blender'
    local_delta=np.linalg.solve(linear,(desired-original_pose)[...,None])[...,0]
    local_normal=np.linalg.solve(linear,desired_normals[...,None])[...,0]
    raw_delta=local_delta@inverse
    raw_normal=local_normal@transform.T
    raw_normal/=np.linalg.norm(raw_normal,axis=1)[:,None]
    arrays['position-deltas'][frame]=raw_delta
    arrays['normal-deltas'][frame]=raw_normal-base_normals
    arrays['reference-positions'][frame]=desired
    arrays['reference-normals'][frame]=desired_normals
    progress['completed_frames'].append(frame)
    progress['measurements'].append({'frame':frame,'skin_max_error':skin_error,'float32_rounding_bound':rounding_bound,'max_matrix_condition':float(np.linalg.cond(linear).max())})
for array in arrays.values():
    array.flush()
progress_path.write_text(json.dumps(progress,indent=2))
result={'frames_completed':len(progress['completed_frames']),'last_frame':bake_end-1,'max_skin_error':max(m['skin_max_error'] for m in progress['measurements'])}
