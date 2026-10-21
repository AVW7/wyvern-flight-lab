import bpy

scene=bpy.data.scenes['V2 Corrective Cruise Review']
bpy.context.window.scene=scene
source=bpy.data.objects['WyvernMembrane_ExportSafe.001']
base=bpy.data.objects['V2_AreaWeighted_Corrective_Membrane']
obj=bpy.data.objects.get('V2_AuthoredNormal_Corrective_Membrane')
if obj is None:
    obj=base.copy();obj.data=base.data.copy();obj.name='V2_AuthoredNormal_Corrective_Membrane';scene.collection.objects.link(obj)
for curve in list(obj.animation_data.drivers):
    if 'Area weighted membrane normals' in curve.data_path: obj.driver_remove(curve.data_path)
weighted=obj.modifiers.get('Area weighted membrane normals')
if weighted: obj.modifiers.remove(weighted)
modifier=obj.modifiers.get('Preserve authored membrane normals') or obj.modifiers.new('Preserve authored membrane normals','DATA_TRANSFER')
modifier.object=source;modifier.use_loop_data=True;modifier.data_types_loops={'CUSTOM_NORMAL'};modifier.loop_mapping='TOPOLOGY';modifier.mix_mode='REPLACE';modifier.mix_factor=1
next(c for c in obj.animation_data.drivers if c.data_path.endswith('.factor')).driver.expression='strength*0.9'
source.hide_set(False)
for name in ['V2_CorrectiveSurface_Membrane','V2_AreaWeighted_Corrective_Membrane']: bpy.data.objects[name].hide_render=True
obj.hide_render=False
result={'object':obj.name,'normal_policy':'preserve source authored normals','geometry_correction_strength':0.9}
