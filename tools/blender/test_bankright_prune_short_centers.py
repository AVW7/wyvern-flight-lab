import bpy
import json
import math
import numpy as np
from pathlib import Path


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v21-bankRight-local-mask05-four-local-centers.blend'
DEST = OUT / 'v27-bankRight-pruned-five-short-centers.blend'
REPORT = OUT / 'bankRight-v21-v27-pruned-centers-report.json'
PRUNE = {16.421875, 70.890625, 70.921875, 80.515625, 116.515625}

assert bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty
scene = bpy.data.scenes['V2 Harvested Bank Correction']
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
original_action = keys.animation_data.action
original_slot = keys.animation_data.action_slot
action = original_action.copy()
slot = action.slots[0]
seq = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
v21_coarse = json.loads((OUT / 'bankRight-v22-smoothstep-handoff-report.json').read_text())['full_cycle_1of32']
v21_fine = json.loads((OUT / 'bankRight-v21-v23-partial-ease025-report.json').read_text())['linear_v21']

original_curves = [fc for layer in original_action.layers for strip in layer.strips
                   for bag in strip.channelbags if bag.slot == original_slot for fc in bag.fcurves]
center_by_name = {}
for fc in original_curves:
    name = fc.data_path.split('key_blocks["', 1)[1].split('"]', 1)[0]
    if name == 'bankRightDense_144':
        continue
    peaks = [float(p.co[0]) for p in fc.keyframe_points if abs(float(p.co[1]) - 1.0) < 1e-7]
    if peaks:
        center_by_name[name] = round(peaks[0] % 144.0, 9)
original_centers = sorted(set(center_by_name.values()))
assert len(original_centers) == 450
assert all(any(abs(t - drop) < 1e-7 for t in original_centers) for drop in PRUNE)
centers = sorted(t for t in original_centers if not any(abs(t - drop) < 1e-7 for drop in PRUNE))
assert len(centers) == 445
center_for_name = {name: t for name, t in center_by_name.items()
                   if not any(abs(t - drop) < 1e-7 for drop in PRUNE)}
curve_by_name = {fc.data_path.split('key_blocks["', 1)[1].split('"]', 1)[0]: fc
                 for layer in action.layers for strip in layer.strips
                 for bag in strip.channelbags if bag.slot == slot for fc in bag.fcurves}
assert len(curve_by_name) == len(original_curves)

# Preserve the V21 target deltas, but remove one interior correction at each
# pair of adjacent 1/64-frame intervals and rebuild all cyclic linear hats.
for name, fc in curve_by_name.items():
    fc.keyframe_points.clear()
    center = center_for_name.get(name)
    if name == 'bankRightDense_144' or center is None:
        for frame in (0.0, 144.0):
            fc.keyframe_points.insert(frame, 0.0, options={'FAST'})
        fc.update()
        for point in fc.keyframe_points:
            point.interpolation = 'LINEAR'
        continue
    index = centers.index(center)
    previous = centers[index - 1] if index else centers[-1] - 144.0
    following = centers[index + 1] if index + 1 < len(centers) else centers[0] + 144.0
    points = [(previous, 0.0), (center, 1.0), (following, 0.0)]
    if center == 0.0:
        points.extend([(previous + 144.0, 0.0), (144.0, 1.0), (following + 144.0, 0.0)])
    for frame, value in sorted(points):
        fc.keyframe_points.insert(frame, value, options={'FAST'})
    fc.update()
    for point in fc.keyframe_points:
        point.interpolation = 'LINEAR'


def positions(target):
    bpy.context.view_layer.update()
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    result = np.asarray([tuple(v.co) for v in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return result


def measure(t):
    lo = int(math.floor(t))
    u = t - lo
    rig.animation_data.action = bpy.data.actions['bankRight.005']
    rig.animation_data.action_slot = rig.animation_data.action.slots[0]
    keys.animation_data.action = action
    keys.animation_data.action_slot = slot
    scene.frame_set(lo, subframe=u)
    alpha = seq[lo] * (1.0 - u) + seq[(lo + 1) % 144] * u
    base, blend = positions(basis), positions(weighted)
    goal = base + alpha * (blend - base)
    actual = positions(obj)
    error = np.linalg.norm(actual - goal, axis=1)
    values = np.asarray([key.value for key in keys.key_blocks])
    row = {'frame': float(t), 'max_error': float(error.max()),
           'rms_error': float(np.sqrt(np.mean(error * error))),
           'worst_vertex': int(error.argmax()), 'weight_sum': float(values.sum()),
           'weight_min': float(values.min()), 'weight_max': float(values.max())}
    return row, actual


cycle_rows = [measure(i / 32.0)[0] for i in range(4608)]
# Sample the same V21 short-interval regions so the before/after comparison is matched.
ticks = set()
cyclic_original = original_centers + [original_centers[0] + 144.0]
short_intervals = 0
for left, right in zip(cyclic_original, cyclic_original[1:]):
    if right - left >= 1.0 / 16.0:
        continue
    short_intervals += 1
    first = math.ceil((left - 1.0 / 8.0) * 256.0 - 1e-8)
    last = math.floor((right + 1.0 / 8.0) * 256.0 + 1e-8)
    ticks.update(tick % (144 * 256) for tick in range(first, last + 1))
fine_frames = sorted(tick / 256.0 for tick in ticks)
assert short_intervals == 55 and len(fine_frames) == 1406
fine_rows, fine_meshes = [], []
for t in fine_frames:
    row, mesh = measure(t)
    fine_rows.append(row)
    fine_meshes.append(mesh)
speeds = []
for i in range(1, len(fine_frames)):
    dt = fine_frames[i] - fine_frames[i - 1]
    if abs(dt - 1.0 / 256.0) > 1e-8:
        continue
    step = np.linalg.norm(fine_meshes[i] - fine_meshes[i - 1], axis=1)
    speeds.append({'from': fine_frames[i - 1], 'to': fine_frames[i],
                   'speed_units_per_frame': float(step.max() / dt),
                   'max_step_units': float(step.max()), 'worst_vertex': int(step.argmax())})

scene.frame_set(0)
bpy.context.view_layer.update()
w0 = np.asarray([key.value for key in keys.key_blocks])
scene.frame_set(144)
bpy.context.view_layer.update()
w144 = np.asarray([key.value for key in keys.key_blocks])
report = {
    'candidate': DEST.name,
    'source': SOURCE.name,
    'removed_center_times': sorted(PRUNE),
    'original_centers': len(original_centers),
    'remaining_centers': len(centers),
    'short_intervals_in_matched_grid': short_intervals,
    'samples_full_cycle_1of32': len(cycle_rows),
    'samples_short_windows_1of256': len(fine_rows),
    'full_cycle_1of32': {
        'v21_max_error': v21_coarse['v21_max_error'],
        'candidate_max_error': max(r['max_error'] for r in cycle_rows),
        'v21_samples_over_2_333': v21_coarse['v21_samples_over_2_333'],
        'candidate_samples_over_2_333': sum(r['max_error'] > 2.333 for r in cycle_rows),
        'candidate_weight_sum_range': [min(r['weight_sum'] for r in cycle_rows), max(r['weight_sum'] for r in cycle_rows)],
        'worst_samples': sorted(cycle_rows, key=lambda r: r['max_error'], reverse=True)[:20],
    },
    'short_windows_1of256': {
        'v21_max_error': v21_fine['max_error'],
        'candidate_max_error': max(r['max_error'] for r in fine_rows),
        'v21_samples_over_2_333': v21_fine['samples_over_2_333'],
        'candidate_samples_over_2_333': sum(r['max_error'] > 2.333 for r in fine_rows),
        'v21_max_speed': v21_fine['max_evaluated_speed'],
        'candidate_max_speed': max(speeds, key=lambda r: r['speed_units_per_frame']),
        'candidate_weight_sum_range': [min(r['weight_sum'] for r in fine_rows), max(r['weight_sum'] for r in fine_rows)],
        'worst_samples': sorted(fine_rows, key=lambda r: r['max_error'], reverse=True)[:20],
    },
    'loop_coefficient_max_difference': float(np.max(np.abs(w0 - w144))),
    'status': 'diagnostic only; rendered playback and inter-clip gates remain open',
}
REPORT.write_text(json.dumps(report, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(DEST), copy=True)
keys.animation_data.action = original_action
keys.animation_data.action_slot = original_slot
rig.animation_data.action = bpy.data.actions['bankRight.005']
rig.animation_data.action_slot = rig.animation_data.action.slots[0]
scene.frame_set(0)
bpy.context.view_layer.update()
print(json.dumps({'report': str(REPORT), 'full_cycle': report['full_cycle_1of32'],
                  'fine': report['short_windows_1of256'],
                  'loop': report['loop_coefficient_max_difference']}, indent=2))
