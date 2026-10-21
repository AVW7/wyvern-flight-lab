import bpy


SOURCE = '/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study/v21-bankRight-local-mask05-four-local-centers.blend'
assert bpy.data.filepath == SOURCE and not bpy.data.is_dirty
scene = bpy.data.scenes['V2 Harvested Bank Correction']
source = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
source_action = source.data.shape_keys.animation_data.action
source_count = len(source.data.shape_keys.key_blocks)

mesh = bpy.data.meshes.new('BankRightMultiHatProbeMesh')
mesh.from_pydata([tuple(v.co) for v in source.data.vertices], [],
                 [tuple(p.vertices) for p in source.data.polygons])
mesh.update()
probe = bpy.data.objects.new('BankRightMultiHatProbe', mesh)
scene.collection.objects.link(probe)
basis = probe.shape_key_add(name='Basis')
basis.value = 0.0
for name in ('HatA', 'HatB', 'HatC'):
    key = probe.shape_key_add(name=name)
    key.value = 0.0

keys = mesh.shape_keys
keys.animation_data_create()
action = bpy.data.actions.new('BankRightMultiHatProbeAction')
keys.animation_data.action = action
slot = action.slots.new(id_type='KEY', name='MultiHatProbe')
action.layers.new('Layer')
action.slots.active = slot
keys.animation_data.action = action
keys.animation_data.action_slot = slot

centers = {'HatA': 1.0, 'HatB': 2.0, 'HatC': 3.0}
curve_points = {}
for name, center in centers.items():
    curve = action.fcurve_ensure_for_datablock(keys, f'key_blocks["{name}"].value', index=0)
    points = [(center - 0.125, 0.0), (center, 1.0), (center + 0.125, 0.0)]
    for frame, value in points:
        curve.keyframe_points.insert(frame, value, options={'FAST'})
    curve.update()
    for point in curve.keyframe_points:
        point.interpolation = 'LINEAR'
    curve_points[name] = [(float(p.co[0]), float(p.co[1])) for p in curve.keyframe_points]
    assert len(curve_points[name]) == 3

samples = []
for frame in [0.0, 0.875, 0.9375, 1.0, 1.5, 1.875, 2.0, 2.5, 3.0, 3.125, 4.0]:
    scene.frame_set(int(frame), subframe=frame - int(frame))
    bpy.context.view_layer.update()
    values = {name: float(keys.key_blocks[name].value) for name in centers}
    samples.append({'frame': frame, 'basis': float(basis.value), 'values': values,
                    'sum': float(sum(values.values()))})
assert all(row['basis'] == 0.0 for row in samples)
assert all(abs(row['values']['HatA'] - (1.0 if row['frame'] == 1.0 else 0.5 if row['frame'] in (0.9375, 1.0625) else 0.0)) < 1e-7
           for row in samples if row['frame'] in (0.0, 0.875, 0.9375, 1.0, 1.5, 4.0))
assert source.data.shape_keys.animation_data.action == source_action
assert len(source.data.shape_keys.key_blocks) == source_count
result = {'probe_action': action.name, 'slot': slot.identifier,
          'curve_points': curve_points, 'samples': samples,
          'source_action_unchanged': source.data.shape_keys.animation_data.action == source_action,
          'source_key_count_unchanged': len(source.data.shape_keys.key_blocks) == source_count}
