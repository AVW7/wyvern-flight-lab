import bpy
import json
import numpy as np
from pathlib import Path

OUT=Path(globals().get('bake_directory','/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/runtime-corrective'))
fps=globals().get('bake_fps',24)
samples=round(6*fps)
scene=bpy.data.scenes['V2 Corrective Cruise Review']
bpy.context.window.scene=scene
rig=bpy.data.objects['WyvernRig']
rig.animation_data.action=bpy.data.actions['V2RigReview_cruise']
obj=bpy.data.objects[globals().get('bake_object','V2_CorrectiveSurface_Membrane')]
obj.hide_set(False)
positions=[];normals=[]
for frame in range(samples):
    time=(frame+0.5)*24/fps
    scene.frame_set(int(time),subframe=time%1)
    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
    positions.append([list(v.co) for v in mesh.vertices])
    if globals().get('bake_corner_normals',False):
        loops=np.asarray([l.vertex_index for l in mesh.loops]);corners=np.asarray([list(n.vector) for n in mesh.corner_normals])
        ns=np.zeros((len(mesh.vertices),3));np.add.at(ns,loops,corners)
        lengths=np.linalg.norm(ns,axis=1)
        assert np.all(lengths>0), 'Evaluated membrane has an undefined corner normal'
        ns/=lengths[:,None]
        assert np.linalg.norm(corners-ns[loops],axis=1).max()<1/127
        normals.append(ns)
    else:
        normals.append([list(v.normal) for v in mesh.vertices])
    evaluated.to_mesh_clear()
np.asarray(positions,dtype='<f4').tofile(OUT/'subframe-reference-positions.bin')
np.asarray(normals,dtype='<f4').tofile(OUT/'subframe-reference-normals.bin')
(OUT/'subframe-samples.json').write_text(json.dumps({'frames':[i+0.5 for i in range(samples)],'fps':fps,'source_blend':bpy.data.filepath},indent=2))
result={'samples':samples,'vertices':len(positions[0])}
