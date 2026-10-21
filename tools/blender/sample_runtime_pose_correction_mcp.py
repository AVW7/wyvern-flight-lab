import bpy
import json
import numpy as np
from pathlib import Path
from mathutils import Matrix

OUT=Path(globals().get('bake_directory','/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/runtime-authored-normals-090'))
data=json.loads((OUT/'runtime-pose-samples.json').read_text())
source=json.loads((OUT/'source-attributes.json').read_text())
assert data['source_sha256']==source['source_sha256']
scene=bpy.data.scenes['V2 Corrective Cruise Review'];bpy.context.window.scene=scene
rig=bpy.data.objects['WyvernRig'];original=bpy.data.objects['WyvernMembrane_ExportSafe.001'];corrective=bpy.data.objects['V2_AuthoredNormal_Corrective_Membrane']
original.hide_set(False);corrective.hide_set(False)
convert=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
def matrix(values): return Matrix(np.asarray(values).reshape(4,4).T.tolist())
rest={name:matrix(value) for name,value in zip(data['bone_names'],data['rest'])}
expected=np.fromfile(OUT/'runtime-baseline-positions.bin',dtype='<f4').reshape(len(data['frames']),8249,3)
saved_action=rig.animation_data.action;saved_nla=rig.animation_data.use_nla
positions=[];deltas=[];max_error=0
calibration=json.loads((OUT/'bind-calibration.json').read_text())
transform_inverse=np.linalg.inv(np.asarray(calibration['mesh_to_blender_affine'])[:3])
indices=np.asarray(source['joints'],dtype=int);weights=np.asarray(source['weights']);weights/=weights.sum(axis=1)[:,None]
rest_inverse=np.asarray([np.linalg.inv(np.asarray(rig.data.bones[n].matrix_local)) for n in source['bone_names']])
try:
    rig.animation_data.action=None;rig.animation_data.use_nla=False;rig['membrane_corrective_strength']=1
    for index,pose in enumerate(data['poses']):
        targets={name:convert@matrix(value)@rest[name].inverted()@convert.inverted()@rig.data.bones[name].matrix_local for name,value in zip(data['bone_names'],pose)}
        for name,target in targets.items():
            bone=rig.pose.bones[name]
            if bone.parent:
                bone.matrix_basis=bone.bone.convert_local_to_pose(target,bone.bone.matrix_local,parent_matrix=targets[bone.parent.name],parent_matrix_local=bone.parent.bone.matrix_local,invert=True)
            else:
                bone.matrix_basis=bone.bone.convert_local_to_pose(target,bone.bone.matrix_local,invert=True)
        bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
        evaluated=original.evaluated_get(dg);mesh=evaluated.to_mesh();actual=np.asarray([list(v.co) for v in mesh.vertices]);evaluated.to_mesh_clear()
        error=float(np.linalg.norm(actual-expected[index],axis=1).max());max_error=max(max_error,error)
        bound=float(np.finfo(np.float32).eps*max(np.abs(actual).max(),np.abs(expected[index]).max())*64)
        assert error<bound, f'Runtime pose correspondence failed: {error} > {bound}'
        evaluated=corrective.evaluated_get(dg);mesh=evaluated.to_mesh();desired=np.asarray([list(v.co) for v in mesh.vertices]);positions.append(desired);evaluated.to_mesh_clear()
        matrices=np.asarray([np.asarray(rig.pose.bones[n].matrix) for n in source['bone_names']])@rest_inverse
        linear=np.sum(matrices[indices]*weights[:,:,None,None],axis=1)[:,:3,:3]
        deltas.append(np.linalg.solve(linear,(desired-actual)[...,None])[...,0]@transform_inverse)
finally:
    rig.animation_data.action=saved_action;rig.animation_data.use_nla=saved_nla;scene.frame_set(36)
np.asarray(positions,dtype='<f4').tofile(OUT/'runtime-pose-reference-positions.bin')
np.asarray(positions,dtype='<f4').tofile(OUT/'reference-positions.bin')
np.asarray(deltas,dtype='<f4').tofile(OUT/'position-deltas.bin')
(OUT/'bake-progress.json').write_text(json.dumps({'completed_frames':list(range(len(positions))),'frames':len(positions),'fps':data['fps'],'source_sha256':data['source_sha256'],'pose_reference':'runtime source bone world transforms'},indent=2))
report={'source_sha256':data['source_sha256'],'frames':data['frames'],'fps':data['fps'],'baseline_max_position_error':max_error,'pose_reference':'Three.js source bone world transforms; Blender action interpolation bypassed without changing actions'}
(OUT/'runtime-pose-reference.json').write_text(json.dumps(report,indent=2))
result={k:v for k,v in report.items() if k!='frames'}
