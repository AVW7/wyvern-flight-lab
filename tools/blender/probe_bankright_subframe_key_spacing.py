import bpy


SOURCE = '/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study/v21-bankRight-local-mask05-four-local-centers.blend'
assert bpy.data.filepath == SOURCE and not bpy.data.is_dirty
scene = bpy.data.scenes['V2 Harvested Bank Correction']
source = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
source_action = source.data.shape_keys.animation_data.action

def probe(name, points):
    mesh = bpy.data.meshes.new(f'{name}Mesh')
    mesh.from_pydata([tuple(v.co) for v in source.data.vertices], [],
                     [tuple(p.vertices) for p in source.data.polygons])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.shape_key_add(name='Basis').value = 0.0
    key = obj.shape_key_add(name='ProbeHat')
    keys = mesh.shape_keys
    keys.animation_data_create()
    action = bpy.data.actions.new(f'{name}Action')
    keys.animation_data.action = action
    slot = action.slots.new(id_type='KEY', name=name)
    action.layers.new('Layer')
    action.slots.active = slot
    keys.animation_data.action = action
    keys.animation_data.action_slot = slot
    curve = action.fcurve_ensure_for_datablock(keys, 'key_blocks["ProbeHat"].value', index=0)
    for frame, value in points:
        curve.keyframe_points.insert(frame, value, options={'FAST'})
    curve.update()
    return [(float(point.co[0]), float(point.co[1])) for point in curve.keyframe_points]


retained = probe('BankRightGapAtOne64', [(116.46875, 0.0), (116.5, 1.0), (116.515625, 0.0)])
collapsed = probe('BankRightGapAtOne128', [(116.46875, 0.0), (116.5, 1.0), (116.5078125, 0.0)])
assert retained == [(116.46875, 0.0), (116.5, 1.0), (116.515625, 0.0)]
assert len(collapsed) == 2
assert source.data.shape_keys.animation_data.action == source_action
result = {'one_64_frame_spacing': retained,
          'one_128_frame_spacing': collapsed,
          'source_action_unchanged': source.data.shape_keys.animation_data.action == source_action,
          'source_key_count': len(source.data.shape_keys.key_blocks)}
