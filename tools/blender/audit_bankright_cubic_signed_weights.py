import bpy
import json
import math
import numpy as np
from pathlib import Path


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v21-bankRight-local-mask05-four-local-centers.blend'
CUBIC = OUT / 'v24-bankRight-cardinal-cubic-tracks.blend'
DEST = OUT / 'v25-bankRight-cardinal-cubic-signed-weights.blend'
REPORT = OUT / 'bankRight-v21-v25-signed-cubic-report.json'

assert bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty
bpy.ops.wm.open_mainfile(filepath=str(CUBIC))
scene = bpy.data.scenes['V2 Harvested Bank Correction']
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
action = keys.animation_data.action
slot = keys.animation_data.action_slot
seq = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
v21_coarse = json.loads((OUT / 'bankRight-v22-smoothstep-handoff-report.json').read_text())['full_cycle_1of32']
v21_fine = json.loads((OUT / 'bankRight-v21-v23-partial-ease025-report.json').read_text())['linear_v21']

for key in list(keys.key_blocks)[1:]:
    key.slider_min = -2.0
    key.slider_max = 2.0

curves = [fc for layer in action.layers for strip in layer.strips
          for bag in strip.channelbags if bag.slot == slot for fc in bag.fcurves]
center_times = set()
for fc in curves:
    name = fc.data_path.split('key_blocks["', 1)[1].split('"]', 1)[0]
    if name == 'bankRightDense_144':
        continue
    for point in fc.keyframe_points:
        if abs(float(point.co[1]) - 1.0) < 1e-7:
            center_times.add(round(float(point.co[0]) % 144.0, 9))
centers = sorted(center_times)
assert len(centers) == 450


def positions(target):
    bpy.context.view_layer.update()
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    result = np.asarray([tuple(v.co) for v in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return result


def set_time(t):
    rig.animation_data.action = bpy.data.actions['bankRight.005']
    rig.animation_data.action_slot = rig.animation_data.action.slots[0]
    keys.animation_data.action = action
    keys.animation_data.action_slot = slot
    lo = int(math.floor(t))
    scene.frame_set(lo, subframe=t - lo)


def measure(t):
    set_time(t)
    alpha = seq[int(math.floor(t))] * (1.0 - (t - math.floor(t))) + seq[(int(math.floor(t)) + 1) % 144] * (t - math.floor(t))
    base = positions(basis)
    blend = positions(weighted)
    goal = base + alpha * (blend - base)
    actual = positions(obj)
    error = np.linalg.norm(actual - goal, axis=1)
    values = np.asarray([key.value for key in keys.key_blocks])
    return {'frame': float(t), 'max_error': float(error.max()),
            'rms_error': float(np.sqrt(np.mean(error * error))),
            'worst_vertex': int(error.argmax()), 'weight_sum': float(values.sum()),
            'weight_min': float(values.min()), 'weight_max': float(values.max())}, actual


cycle_rows = [measure(i / 32.0)[0] for i in range(4608)]
ticks = set()
cyclic = centers + [centers[0] + 144.0]
short_intervals = 0
for left, right in zip(cyclic, cyclic[1:]):
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
    'source_cubic': CUBIC.name,
    'source_linear': SOURCE.name,
    'signed_slider_range': [-2.0, 2.0],
    'samples_full_cycle_1of32': len(cycle_rows),
    'centers': len(centers),
    'short_intervals': short_intervals,
    'samples_short_windows_1of256': len(fine_rows),
    'full_cycle_1of32': {
        'v21_max_error': v21_coarse['v21_max_error'],
        'candidate_max_error': max(r['max_error'] for r in cycle_rows),
        'v21_max_rms': v21_coarse['v21_max_rms'],
        'candidate_max_rms': max(r['rms_error'] for r in cycle_rows),
        'v21_samples_over_2_333': v21_coarse['v21_samples_over_2_333'],
        'candidate_samples_over_2_333': sum(r['max_error'] > 2.333 for r in cycle_rows),
        'candidate_weight_sum_range': [min(r['weight_sum'] for r in cycle_rows), max(r['weight_sum'] for r in cycle_rows)],
        'candidate_weight_value_range': [min(r['weight_min'] for r in cycle_rows), max(r['weight_max'] for r in cycle_rows)],
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
        'candidate_weight_value_range': [min(r['weight_min'] for r in fine_rows), max(r['weight_max'] for r in fine_rows)],
        'worst_samples': sorted(fine_rows, key=lambda r: r['max_error'], reverse=True)[:20],
    },
    'loop_coefficient_max_difference': float(np.max(np.abs(w0 - w144))),
    'status': 'diagnostic; render and transition gates remain open',
}
REPORT.write_text(json.dumps(report, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(DEST), copy=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
print(json.dumps({'report': str(REPORT), 'full_cycle': report['full_cycle_1of32'],
                  'fine': report['short_windows_1of256'],
                  'loop': report['loop_coefficient_max_difference']}, indent=2))
