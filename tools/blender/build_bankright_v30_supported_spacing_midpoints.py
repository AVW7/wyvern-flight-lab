import bpy
import json
import math
import numpy as np
from pathlib import Path

ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v21-bankRight-local-mask05-four-local-centers.blend'
DEST = OUT / 'v30-bankRight-supported-spacing-midpoints.blend'
REPORT = OUT / 'bankRight-v21-v30-supported-midpoints-report.json'

assert bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty
scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
source = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
rig = bpy.data.objects['WyvernRig.005']
original = bpy.data.objects['WyvernMembrane_ExportSafe.005']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
source_keys = source.data.shape_keys
source_action = source_keys.animation_data.action
source_slot = source_keys.animation_data.action_slot
rig_action = bpy.data.actions['bankRight.005']
rig_slot = rig_action.slots[0]
assert source_action.name == 'V2BankShapes_bankRightAdaptiveRefinement5'
seq = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
v21_coarse = json.loads((OUT / 'bankRight-v22-smoothstep-handoff-report.json').read_text())['full_cycle_1of32']
v21_fine = json.loads((OUT / 'bankRight-v21-mask05-four-centers-fine-audit.json').read_text())

bones = [g.name for g in original.vertex_groups]
weights = np.zeros((len(original.data.vertices), len(bones)), dtype=np.float64)
for vertex in original.data.vertices:
    for assignment in vertex.groups:
        weights[vertex.index, assignment.group] = assignment.weight
weights /= weights.sum(axis=1)[:, None]
rest_inverse = np.asarray([np.linalg.inv(np.asarray(rig.data.bones[name].matrix_local)) for name in bones])
raw = np.asarray([vertex.co[:] for vertex in original.data.vertices], dtype=np.float64)

def local_positions(obj):
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    result = np.asarray([vertex.co[:] for vertex in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return result

def set_rig_time(t):
    lo = math.floor(t)
    rig.animation_data.action = rig_action
    rig.animation_data.action_slot = rig_slot
    scene.frame_set(lo, subframe=t - lo)

def direct_target(t):
    set_rig_time(t)
    lo = math.floor(t)
    u = t - lo
    alpha = seq[lo] * (1.0 - u) + seq[(lo + 1) % 144] * u
    return local_positions(basis) + alpha * (local_positions(weighted) - local_positions(basis))

# Only subdivide 1/32- and 1/16-frame intervals: each new neighbor is at least 1/64 frame away.
source_curves = [fc for layer in source_action.layers for strip in layer.strips
                 for bag in strip.channelbags if bag.slot == source_slot for fc in bag.fcurves]
center_by_name = {}
for fc in source_curves:
    name = fc.data_path.split('key_blocks["', 1)[1].split('"].value', 1)[0]
    if name == 'bankRightDense_144':
        continue
    peak = next((float(point.co[0]) for point in fc.keyframe_points
                 if abs(float(point.co[1]) - 1.0) < 1e-7), None)
    if peak is not None:
        center_by_name[name] = round(peak % 144.0, 9)
source_centers = sorted(set(center_by_name.values()))
assert len(source_centers) == 450
cyclic_source = source_centers + [source_centers[0] + 144.0]
gaps = [(left, right, right - left) for left, right in zip(cyclic_source, cyclic_source[1:])]
insertions = [(left + gap / 2.0) % 144.0 for left, right, gap in gaps
              if gap in (1.0 / 32.0, 1.0 / 16.0)]
assert len(insertions) == 104 and len(set(insertions)) == 104
assert all(min(min(abs(t - center), 144.0 - abs(t - center)) for center in source_centers)
           >= 1.0 / 64.0 - 1e-9 for t in insertions)

# Create a fresh mesh and Key datablock, copying the exact V21 shape coordinates by name.
candidate = source.copy()
candidate.name = 'V2_BankRight_SupportedMidpoints_V30'
mesh = bpy.data.meshes.new('V2_BankRight_SupportedMidpoints_V30_Mesh')
mesh.from_pydata([tuple(vertex.co) for vertex in source.data.vertices], [],
                 [tuple(poly.vertices) for poly in source.data.polygons])
mesh.update()
for material in source.data.materials:
    mesh.materials.append(material)
candidate.data = mesh
scene.collection.objects.link(candidate)
basis_key = candidate.shape_key_add(name='Basis')
basis_key.value = 0.0
for source_key in list(source_keys.key_blocks)[1:]:
    new_key = candidate.shape_key_add(name=source_key.name)
    coords = np.asarray([vertex.co[:] for vertex in source_key.data], dtype='<f4')
    new_key.data.foreach_set('co', coords.ravel())
    new_key.slider_min = source_key.slider_min
    new_key.slider_max = source_key.slider_max
for source_key in list(source_keys.key_blocks)[1:]:
    candidate.data.shape_keys.key_blocks[source_key.name].relative_key = candidate.data.shape_keys.key_blocks[source_key.relative_key.name]
keys = candidate.data.shape_keys
assert keys is not source_keys and len(keys.key_blocks) == len(source_keys.key_blocks)
assert len(candidate.data.vertices) == len(source.data.vertices)

new_names = []
for index, t in enumerate(insertions):
    set_rig_time(t)
    target = direct_target(t)
    actual_base = local_positions(original)
    matrices = np.asarray([np.asarray(rig.pose.bones[name].matrix) for name in bones]) @ rest_inverse
    linear = np.einsum('vb,bij->vij', weights, matrices[:, :3, :3])
    delta = np.linalg.solve(linear, (target - actual_base)[..., None])[..., 0]
    key = candidate.shape_key_add(name=f'bankRightV30_{index:03d}')
    key.data.foreach_set('co', (raw + delta).astype('<f4').ravel())
    key.value = 0.0
    new_names.append(key.name)

centers_by_name = dict(center_by_name)
for name, t in zip(new_names, insertions):
    centers_by_name[name] = t
centers_by_name['bankRightDense_144'] = None
all_centers = sorted(set(t for t in centers_by_name.values() if t is not None))
assert len(all_centers) == 554

# Build exact cyclic triangular hats in a new Action Slot.
action = bpy.data.actions.new('V2BankShapes_bankRightSupportedMidpointsV30')
keys.animation_data_create()
keys.animation_data.action = action
slot = action.slots.new(id_type='KEY', name='KEBankRightV30')
action.layers.new('Layer')
action.slots.active = slot
keys.animation_data.action = action
keys.animation_data.action_slot = slot
assert set(centers_by_name) == {key.name for key in list(keys.key_blocks)[1:]}
curve_points = {}
for name, center in centers_by_name.items():
    curve = action.fcurve_ensure_for_datablock(keys, f'key_blocks["{name}"].value', index=0)
    if center is None:
        expected = [(0.0, 0.0), (144.0, 0.0)]
    else:
        index = all_centers.index(center)
        previous = all_centers[index - 1] if index else all_centers[-1] - 144.0
        following = all_centers[index + 1] if index + 1 < len(all_centers) else all_centers[0] + 144.0
        expected = [(previous, 0.0), (center, 1.0), (following, 0.0)]
        if center == 0.0:
            expected.extend([(previous + 144.0, 0.0), (144.0, 1.0), (following + 144.0, 0.0)])
    expected = sorted((float(frame), float(value)) for frame, value in expected)
    for frame, value in expected:
        curve.keyframe_points.insert(frame, value, options={'FAST'})
    curve.update()
    actual_points = [(float(point.co[0]), float(point.co[1])) for point in curve.keyframe_points]
    assert len(actual_points) == len(expected) and all(
        abs(ax - ex) < 1e-7 and abs(ay - ey) < 1e-7
        for (ax, ay), (ex, ey) in zip(actual_points, expected)), {
            'key': name, 'center': center, 'expected': expected, 'actual': actual_points}
    for point in curve.keyframe_points:
        point.interpolation = 'LINEAR'
    curve_points[name] = actual_points

def coefficient_row(t):
    lo = math.floor(t)
    scene.frame_set(lo, subframe=t - lo)
    bpy.context.view_layer.update()
    return np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)

partition_checks = []
for t in [0.0, 144.0] + [i / 32.0 for i in range(4608)] + insertions:
    row = coefficient_row(t)
    partition_checks.append((float(row.sum()), float(row.min()), float(row.max())))
max_partition_error = max(abs(total - 1.0) for total, _, _ in partition_checks)
assert max_partition_error < 1e-6, max_partition_error
w0, w144 = coefficient_row(0.0), coefficient_row(144.0)
seam_error = float(np.max(np.abs(w0 - w144)))
assert seam_error == 0.0

# Exact reconstruction is required at every newly baked center before playback scans.
center_rows = []
for name, t in zip(new_names, insertions):
    set_rig_time(t)
    target = direct_target(t)
    actual = local_positions(candidate)
    error = np.linalg.norm(actual - target, axis=1)
    center_rows.append({'frame': t, 'max_error': float(error.max()),
                        'rms_error': float(np.sqrt(np.mean(error * error)))})
assert max(row['max_error'] for row in center_rows) < 0.01

def measure(t):
    set_rig_time(t)
    lo = math.floor(t)
    u = t - lo
    alpha = seq[lo] * (1.0 - u) + seq[(lo + 1) % 144] * u
    target = local_positions(basis) + alpha * (local_positions(weighted) - local_positions(basis))
    actual = local_positions(candidate)
    error = np.linalg.norm(actual - target, axis=1)
    values = np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)
    return {'frame': float(t), 'max_error': float(error.max()),
            'rms_error': float(np.sqrt(np.mean(error * error))),
            'worst_vertex': int(error.argmax()), 'weight_sum': float(values.sum())}, actual

coarse_rows = [measure(i / 32.0)[0] for i in range(4608)]
candidate_centers = all_centers
cyclic_candidate = candidate_centers + [candidate_centers[0] + 144.0]
ticks = set()
fine_intervals = []
for left, right in zip(cyclic_candidate, cyclic_candidate[1:]):
    if right - left >= 1.0 / 16.0:
        continue
    fine_intervals.append((left, right))
    first = math.ceil((left - 1.0 / 8.0) * 256.0 - 1e-8)
    last = math.floor((right + 1.0 / 8.0) * 256.0 + 1e-8)
    ticks.update(tick % (144 * 256) for tick in range(first, last + 1))
fine_frames = sorted(tick / 256.0 for tick in ticks)
fine_rows, fine_meshes = [], []
for t in fine_frames:
    row, mesh_positions = measure(t)
    fine_rows.append(row)
    fine_meshes.append(mesh_positions)
speeds = []
for index in range(1, len(fine_frames)):
    dt = fine_frames[index] - fine_frames[index - 1]
    if abs(dt - 1.0 / 256.0) > 1e-8:
        continue
    step = np.linalg.norm(fine_meshes[index] - fine_meshes[index - 1], axis=1)
    speeds.append({'from': fine_frames[index - 1], 'to': fine_frames[index],
                   'speed_units_per_frame': float(step.max() / dt),
                   'max_step_units': float(step.max()), 'worst_vertex': int(step.argmax())})

report = {
    'candidate': DEST.name, 'source': SOURCE.name,
    'candidate_object': candidate.name, 'action': action.name, 'action_slot': slot.identifier,
    'source_centers': len(source_centers), 'added_centers': len(insertions),
    'added_center_times': insertions, 'candidate_centers': len(all_centers),
    'minimum_center_spacing': min(right-left for left, right in zip(cyclic_candidate, cyclic_candidate[1:])),
    'full_cycle_1of32': {
        'samples': len(coarse_rows), 'v21_max_error': v21_coarse['v21_max_error'],
        'candidate_max_error': max(row['max_error'] for row in coarse_rows),
        'v21_samples_over_2_333': v21_coarse['v21_samples_over_2_333'],
        'candidate_samples_over_2_333': sum(row['max_error'] > 2.333 for row in coarse_rows),
        'weight_sum_range': [min(row['weight_sum'] for row in coarse_rows), max(row['weight_sum'] for row in coarse_rows)],
    },
    'short_windows_1of256': {
        'samples': len(fine_rows), 'v21_max_error': v21_fine['fine_max_error'],
        'candidate_max_error': max(row['max_error'] for row in fine_rows),
        'v21_samples_over_2_333': v21_fine['fine_samples_over_2_333'],
        'candidate_samples_over_2_333': sum(row['max_error'] > 2.333 for row in fine_rows),
        'v21_max_speed': 1185.997690028085,
        'candidate_max_speed': max(speeds, key=lambda row: row['speed_units_per_frame']),
        'worst_samples': sorted(fine_rows, key=lambda row: row['max_error'], reverse=True)[:20],
    },
    'new_center_reconstruction': {
        'samples': len(center_rows), 'max_error': max(row['max_error'] for row in center_rows),
        'max_rms_error': max(row['rms_error'] for row in center_rows),
    },
    'max_partition_error': max_partition_error,
    'loop_coefficient_max_difference': seam_error,
    'status': 'diagnostic only; surface-safety, rendered playback and inter-clip gates remain open',
}
REPORT.write_text(json.dumps(report, indent=2))
candidate.hide_render = False
candidate.hide_viewport = False
source.hide_render = True
source.hide_viewport = True
bpy.ops.wm.save_as_mainfile(filepath=str(DEST), copy=True)
# Restore the exact source file and original action pair in the live Blender session.
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
result = {'report': str(REPORT), 'added_centers': len(insertions),
          'full_cycle': report['full_cycle_1of32'],
          'fine': report['short_windows_1of256'],
          'center_reconstruction': report['new_center_reconstruction'],
          'partition_error': max_partition_error, 'loop_seam': seam_error}
