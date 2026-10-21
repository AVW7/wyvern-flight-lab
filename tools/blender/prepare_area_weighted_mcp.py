import bpy
import json
from pathlib import Path

OUT=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/runtime-area-weighted')
qualification=json.loads((OUT/'strength-qualification.json').read_text())
passing=[row['strength'] for row in qualification if not row['undefined_normal_samples']]
strength=max(passing)
assert strength==0.9
scene=bpy.data.scenes['V2 Corrective Cruise Review']
bpy.context.window.scene=scene
obj=bpy.data.objects['V2_AreaWeighted_Corrective_Membrane']
fc=next(f for f in obj.animation_data.drivers if f.data_path.endswith('.factor'))
fc.driver.expression=f'strength*{strength}'
mod=obj.modifiers['Area weighted membrane normals']
for property_name in ['show_viewport','show_render']:
    curve=mod.driver_add(property_name)
    curve.driver.type='SCRIPTED';curve.driver.expression='strength > 0'
    for existing in list(curve.driver.variables): curve.driver.variables.remove(existing)
    variable=curve.driver.variables.new();variable.name='strength';variable.type='SINGLE_PROP'
    variable.targets[0].id=bpy.data.objects['WyvernRig']
    variable.targets[0].data_path='["membrane_corrective_strength"]'
bpy.data.objects['V2_CorrectiveSurface_Membrane'].hide_render=True
obj.hide_render=False
scene.frame_set(36)
result={'strength':strength,'choice_reference':'strength-qualification.json: largest measured setting with no undefined normals in 288 halfway samples','ground_gate':'weighted-normal modifier disabled when rig correction strength is zero'}
