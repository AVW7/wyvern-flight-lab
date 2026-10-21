import bpy
import json
import numpy as np
from pathlib import Path


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v21-bankRight-local-mask05-four-local-centers.blend'
DEST = OUT / 'v22-bankRight-local-mask05-smoothstep-handoffs.blend'
REPORT = OUT / 'bankRight-v22-smoothstep-handoff-report.json'

assert bpy.data.filepath == str(SOURCE), bpy.data.filepath
assert not bpy.data.is_dirty
scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
original = bpy.data.objects['WyvernMembrane_ExportSafe.005']
keys = obj.data.shape_keys
action = keys.animation_data.action
slot = keys.animation_data.action_slot

seq = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']

curves = [fc for layer in action.layers for strip in layer.strips
          for bag in strip.channelbags if bag.slot == slot for fc in bag.fcurves]
assert curves

# Rebuild the V21 diagnostic grid: 1/256-frame points around all intervals
# shorter than 1/32 frame, with a 1/32-frame guard band on either side.
center_times = set()
for fc in curves:
    name = fc.data_path.split('key_blocks["', 1)[1].split('"]', 1)[0]
    if name == 'bankRightDense_144':
        continue
    for point in fc.keyframe_points:
        if abs(float(point.co[1]) - 1.0) < 1e-7:
            center_times.add(round(float(point.co[0]) % 144.0, 9))
centers = sorted(center_times)
assert centers
fine_ticks = set()
cyclic_centers = centers + [centers[0] + 144.0]
for left, right in zip(cyclic_centers, cyclic_centers[1:]):
    if right - left >= 1.0 / 32.0:
        continue
    first = int(np.ceil((left - 1.0 / 32.0) * 256.0 - 1e-8))
    last = int(np.floor((right + 1.0 / 32.0) * 256.0 + 1e-8))
    fine_ticks.update(tick % (144 * 256) for tick in range(first, last + 1))
fine_frames = sorted(tick / 256.0 for tick in fine_ticks)
assert fine_frames


def mesh_positions(target):
    bpy.context.view_layer.update()
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    result = np.asarray([tuple(v.co) for v in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return result


def direct_target(t):
    lo = int(np.floor(t))
    u = t - lo
    alpha = seq[lo] * (1.0 - u) + seq[(lo + 1) % 144] * u
    rig.animation_data.action = bpy.data.actions['bankRight.005']
    rig.animation_data.action_slot = rig.animation_data.action.slots[0]
    scene.frame_set(lo, subframe=u)
    a = mesh_positions(basis)
    b = mesh_positions(weighted)
    return a + alpha * (b - a)


def set_candidate_time(t, track_action, track_slot):
    rig.animation_data.action = bpy.data.actions['bankRight.005']
    rig.animation_data.action_slot = rig.animation_data.action.slots[0]
    keys.animation_data.action = track_action
    keys.animation_data.action_slot = track_slot
    scene.frame_set(int(np.floor(t)), subframe=t - np.floor(t))


def measure(frames, track_action, track_slot):
    rows = []
    positions = []
    for t in frames:
        set_candidate_time(t, track_action, track_slot)
        actual = mesh_positions(obj)
        target = direct_target(t)
        errors = np.linalg.norm(actual - target, axis=1)
        rows.append({'frame': float(t), 'max_error': float(errors.max()),
                     'rms_error': float(np.sqrt(np.mean(errors * errors))),
                     'worst_vertex': int(errors.argmax())})
        positions.append(actual)
    return rows, positions


# Measure V21 first so the eased candidate is compared on the same samples.
cycle_frames = [i / 32.0 for i in range(4608)]
linear_cycle_rows, _ = measure(cycle_frames, action, slot)
linear_fine_rows, linear_fine_positions = measure(fine_frames, action, slot)

smooth_action = action.copy()
smooth_slot = smooth_action.slots[0]
keys.animation_data.action = smooth_action
keys.animation_data.action_slot = smooth_slot
smooth_curves = [fc for layer in smooth_action.layers for strip in layer.strips
                 for bag in strip.channelbags if bag.slot == smooth_slot for fc in bag.fcurves]
point_count = 0
for fc in smooth_curves:
    points = sorted(fc.keyframe_points, key=lambda p: float(p.co[0]))
    for i, point in enumerate(points):
        x, y = float(point.co[0]), float(point.co[1])
        left_span = x - float(points[i - 1].co[0]) if i else 0.0
        right_span = float(points[i + 1].co[0]) - x if i + 1 < len(points) else 0.0
        point.interpolation = 'BEZIER'
        point.handle_left_type = 'FREE'
        point.handle_right_type = 'FREE'
        if left_span:
            point.handle_left = (x - left_span / 3.0, y)
        if right_span:
            point.handle_right = (x + right_span / 3.0, y)
        point_count += 1
    fc.update()

smooth_cycle_rows, _ = measure(cycle_frames, smooth_action, smooth_slot)
smooth_fine_rows, smooth_fine_positions = measure(fine_frames, smooth_action, smooth_slot)


def speed_peak(positions):
    rows = []
    for i in range(1, len(fine_frames)):
        dt = fine_frames[i] - fine_frames[i - 1]
        if dt <= 0 or dt > 1.0 / 256.0 + 1e-8:
            continue
        delta = np.linalg.norm(positions[i] - positions[i - 1], axis=1)
        rows.append({'from': fine_frames[i - 1], 'to': fine_frames[i],
                     'speed': float(delta.max() / dt), 'worst_vertex': int(delta.argmax())})
    return max(rows, key=lambda x: x['speed'])

# Keep center poses and cyclic coefficients as hard controls of this experiment.
center_errors = []
for t in centers:
    set_candidate_time(t, smooth_action, smooth_slot)
    center_errors.append(float(np.max(np.abs(mesh_positions(obj) - direct_target(t)))))
keys.animation_data.action = smooth_action
keys.animation_data.action_slot = smooth_slot
scene.frame_set(0)
bpy.context.view_layer.update()
w0 = np.asarray([key.value for key in keys.key_blocks])
scene.frame_set(144)
bpy.context.view_layer.update()
w144 = np.asarray([key.value for key in keys.key_blocks])
seam = float(np.max(np.abs(w0 - w144)))

report = {
    'candidate': DEST.name,
    'source': SOURCE.name,
    'experiment': 'Replace piecewise-linear triangular coefficient segments with exact cubic smoothstep segments using horizontal one-third handles.',
    'scope': 'Diagnostic comparison only; does not qualify rendered playback or transitions.',
    'fcurves': len(smooth_curves),
    'key_points_retimed': point_count,
    'unique_center_times': len(centers),
    'full_cycle_1of32': {
        'samples': len(smooth_cycle_rows),
        'v21_max_error': max(x['max_error'] for x in linear_cycle_rows),
        'smoothstep_max_error': max(x['max_error'] for x in smooth_cycle_rows),
        'v21_max_rms': max(x['rms_error'] for x in linear_cycle_rows),
        'smoothstep_max_rms': max(x['rms_error'] for x in smooth_cycle_rows),
        'v21_samples_over_2_333': sum(x['max_error'] > 2.333 for x in linear_cycle_rows),
        'smoothstep_samples_over_2_333': sum(x['max_error'] > 2.333 for x in smooth_cycle_rows),
        'smoothstep_worst_samples': sorted(smooth_cycle_rows, key=lambda x: x['max_error'], reverse=True)[:20],
    },
    'short_windows_1of256': {
        'samples': len(smooth_fine_rows),
        'v21_max_error': max(x['max_error'] for x in linear_fine_rows),
        'smoothstep_max_error': max(x['max_error'] for x in smooth_fine_rows),
        'v21_samples_over_2_333': sum(x['max_error'] > 2.333 for x in linear_fine_rows),
        'smoothstep_samples_over_2_333': sum(x['max_error'] > 2.333 for x in smooth_fine_rows),
        'v21_max_evaluated_speed': speed_peak(linear_fine_positions),
        'smoothstep_max_evaluated_speed': speed_peak(smooth_fine_positions),
        'smoothstep_worst_samples': sorted(smooth_fine_rows, key=lambda x: x['max_error'], reverse=True)[:20],
    },
    'center_pose_max_error': max(center_errors, default=None),
    'loop_coefficient_max_difference': seam,
    'acceptance_note': '2.333 units is a separate cruise comparison, not a bank motion acceptance limit. Compare these results directly with V21; retain V21 if smoothstep worsens source reconstruction or evaluated motion.',
}
REPORT.write_text(json.dumps(report, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(DEST), copy=True)
print(json.dumps({'report': str(REPORT), 'candidate': str(DEST),
                  'cycle_max_error': report['full_cycle_1of32']['smoothstep_max_error'],
                  'fine_max_error': report['short_windows_1of256']['smoothstep_max_error'],
                  'fine_max_speed': report['short_windows_1of256']['smoothstep_max_evaluated_speed'],
                  'loop_coefficient_max_difference': seam}, indent=2))
