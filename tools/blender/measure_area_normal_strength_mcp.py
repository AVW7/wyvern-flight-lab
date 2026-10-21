import bpy
import json
import numpy as np
from pathlib import Path

scene=bpy.data.scenes['V2 Corrective Cruise Review']
bpy.context.window.scene=scene
obj=bpy.data.objects['V2_AreaWeighted_Corrective_Membrane']
rig=bpy.data.objects['WyvernRig']
rig.animation_data.action=bpy.data.actions['V2RigReview_cruise']
curve=next(f for f in obj.animation_data.drivers if f.data_path.endswith('.factor'))
previous=curve.driver.expression
rows=[]
try:
    for strength in [1,0.9,0.8]:
        curve.driver.expression=f'strength*{strength}'
        failures=[]
        for index in range(288):
            time=(index+0.5)/2
            scene.frame_set(int(time),subframe=time%1)
            evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
            values=np.empty(len(mesh.corner_normals)*3,dtype=np.float32)
            mesh.corner_normals.foreach_get('vector',values)
            zero=np.where(np.linalg.norm(values.reshape(-1,3),axis=1)==0)[0]
            if len(zero): failures.append({'frame':time,'vertices':sorted(set(mesh.loops[int(i)].vertex_index for i in zero))})
            evaluated.to_mesh_clear()
        rows.append({'strength':strength,'samples':288,'undefined_normal_samples':failures})
finally:
    curve.driver.expression=previous
assert rows[0]['undefined_normal_samples'], 'Full-strength regression must bite'
assert not rows[1]['undefined_normal_samples']
OUT=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/runtime-area-weighted')
(OUT/'strength-qualification.json').write_text(json.dumps(rows,indent=2))
result={'measurements':rows}
