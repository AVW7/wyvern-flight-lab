import bpy
import json
from pathlib import Path

OUT=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/mcp-study')
rig=bpy.data.objects['WyvernRig']
original=bpy.data.objects['WyvernMembrane_ExportSafe.001']
corrective=bpy.data.objects['V2_CorrectiveSurface_Membrane']
modifier=corrective.modifiers['Membrane pose correction']
original.hide_set(False);corrective.hide_set(False)

def gap(clip,frame):
    rig.animation_data.action=bpy.data.actions['V2RigReview_'+clip]
    bpy.context.scene.frame_set(frame)
    dg=bpy.context.evaluated_depsgraph_get()
    a=original.evaluated_get(dg);b=corrective.evaluated_get(dg)
    ma=a.to_mesh();mb=b.to_mesh()
    assert len(ma.vertices)==len(mb.vertices)==8249
    difference=max((v.co-mb.vertices[v.index].co).length for v in ma.vertices)
    a.to_mesh_clear();b.to_mesh_clear()
    return difference

results=[]
for action in sorted(a.name for a in bpy.data.actions if a.name.startswith('V2RigReview_')):
    clip=action.removeprefix('V2RigReview_')
    end=int(bpy.data.actions[action].frame_range[1])
    distances=[gap(clip,round(end*i/4)) for i in range(5)]
    if clip!='cruise':
        assert max(distances)==0, f'{clip}: correction leaks into an unqualified pose'
    results.append({'clip':clip,'max_deformation_delta':max(distances),'modifier_factor':modifier.factor})

curve=corrective.animation_data.drivers.find('modifiers["Membrane pose correction"].factor')
assert curve is not None
expression=curve.driver.expression
try:
    curve.driver.expression='1.0'
    mutant_gap=gap('walk',15)
    assert mutant_gap>0, 'The ground protection mutation must produce a measured failure'
finally:
    curve.driver.expression=expression
assert gap('walk',15)==0
report={'status':'cruise authoring prototype','actions':results,'ground_mutant_delta':mutant_gap,
        'restored_walk_delta':gap('walk',15),'export_limitation':'Corrective Smooth and its driver require a runtime-compatible corrective morph bake'}
(OUT/'corrective-gate-audit.json').write_text(json.dumps(report,indent=2))
original.hide_render=True;original.hide_set(True)
corrective.hide_render=False;corrective.hide_set(False)
rig.animation_data.action=bpy.data.actions['V2RigReview_cruise']
bpy.context.scene.frame_set(36)
corrective['review_status']='Cruise authoring prototype; runtime morph bake pending'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'v2-corrective-cruise-mcp.blend'))
result={'actions_checked':len(results),'ground_mutant_delta':mutant_gap,'restored_walk_delta':0,'saved':str(OUT/'v2-corrective-cruise-mcp.blend')}
