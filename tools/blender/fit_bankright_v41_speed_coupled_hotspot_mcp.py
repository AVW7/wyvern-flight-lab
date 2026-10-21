import bpy
import json
import math
import numpy as np
from pathlib import Path


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v40-bankRight-midflight-hotspot-cubic-fit.blend'
DEST = OUT / 'v41-bankRight-speed-coupled-hotspot-fit.blend'
REPORT = OUT / 'bankRight-v40-v41-speed-coupled-hotspot-fit-report.json'
SCHEDULE = OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json'

assert bpy.data.filepath == str(SOURCE)
assert not bpy.data.is_dirty

scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
rig = bpy.data.objects['WyvernRig.005']
candidate = bpy.data.objects['BankRight_FullIndependentActionProbe']
target = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = candidate.data.shape_keys
action = keys.animation_data.action
slot = keys.animation_data.action_slot
t0, t1 = 70.875, 70.890625
shape_a, shape_b = 'bankRightAdaptive2_0039', 'bankRightAdaptive3_0022'
dt = t1 - t0

curves = {}
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            if bag.slot != slot:
                continue
            for curve in bag.fcurves:
                if 'key_blocks["' not in curve.data_path:
                    continue
                name = curve.data_path.split('key_blocks["', 1)[1].split('"]', 1)[0]
                curves[name] = curve
curve_a, curve_b = curves[shape_a], curves[shape_b]


def point_at(curve, frame):
    found = [point for point in curve.keyframe_points if abs(float(point.co[0]) - frame) < 1e-7]
    assert len(found) == 1, (curve.data_path, frame, len(found))
    return found[0]


a0, a1 = point_at(curve_a, t0), point_at(curve_a, t1)
b0, b1 = point_at(curve_b, t0), point_at(curve_b, t1)
assert abs(float(a0.co[1]) - 1.0) < 1e-6 and abs(float(a1.co[1])) < 1e-6
assert abs(float(b0.co[1])) < 1e-6 and abs(float(b1.co[1]) - 1.0) < 1e-6

schedule_data = json.loads(SCHEDULE.read_text())
mix_sequence = schedule_data['solutions'][3]['solution']['mix_sequence']
frame_start, frame_end = t0 - 0.125, t1 + 0.125
times = np.asarray([tick / 256.0 for tick in range(int(frame_start * 256), int(frame_end * 256) + 1)], dtype=np.float64)
segment_rows = np.where((times >= t0 - 1e-9) & (times <= t1 + 1e-9))[0]
assert len(segment_rows) == int(round(dt * 256.0)) + 1

saved_frame = scene.frame_current
saved_rig_action, saved_rig_slot = rig.animation_data.action, rig.animation_data.action_slot
saved_key_action, saved_key_slot = keys.animation_data.action, keys.animation_data.action_slot


def positions(obj):
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    values = np.asarray([tuple(vertex.co) for vertex in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return values


def alpha_at(frame):
    lo = int(math.floor(frame))
    frac = frame - lo
    return mix_sequence[lo] * (1.0 - frac) + mix_sequence[(lo + 1) % 144] * frac


bank_action = bpy.data.actions['bankRight.005']
rig.animation_data.action = bank_action
rig.animation_data.action_slot = bank_action.slots[0]
current_a = np.asarray([float(curve_a.evaluate(float(t))) for t in times])
current_b = np.asarray([float(curve_b.evaluate(float(t))) for t in times])
baseline_positions, targets = [], []
for frame in times:
    lo = int(frame)
    scene.frame_set(lo, subframe=float(frame-lo))
    bpy.context.view_layer.update()
    baseline_positions.append(positions(candidate))
    mix = alpha_at(float(frame))
    base = positions(bpy.data.objects['V2_HarvestedBank_Corrective'])
    blend = positions(target)
    targets.append(base + mix * (blend - base))

assert float(np.max(np.abs(current_a[segment_rows] + current_b[segment_rows] - 1.0))) < 1e-6
surfaces_a, surfaces_b = [], []
try:
    keys.animation_data.action = None
    for row in segment_rows:
        frame = times[row]
        lo = int(frame)
        scene.frame_set(lo, subframe=float(frame - lo))
        for key in keys.key_blocks:
            key.value = 0.0
        keys.key_blocks[shape_a].value = 1.0
        surfaces_a.append(positions(candidate))
        keys.key_blocks[shape_a].value = 0.0
        keys.key_blocks[shape_b].value = 1.0
        surfaces_b.append(positions(candidate))
finally:
    keys.animation_data.action = saved_key_action
    keys.animation_data.action_slot = saved_key_slot
    rig.animation_data.action = saved_rig_action
    rig.animation_data.action_slot = saved_rig_slot
    scene.frame_set(saved_frame)

baseline_positions = np.asarray(baseline_positions)
targets = np.asarray(targets)
surfaces_a = np.asarray(surfaces_a)
surfaces_b = np.asarray(surfaces_b)
deltas = surfaces_a - surfaces_b
segment_a = current_a[segment_rows]
segment_positions = surfaces_b + segment_a[:, None, None] * deltas
segment_position_errors = [float(np.linalg.norm(segment_positions[i] - baseline_positions[row], axis=1).max())
                           for i, row in enumerate(segment_rows)]
assert max(segment_position_errors) <= 0.001, segment_position_errors

# Confirm the direct two-pose basis reproduces the active V35 Action around the
# chosen segment, within the previously measured 0.001-unit endpoint tolerance.
check_frames = [t0, t0 + 0.5 * dt, t1]
check_rows = []
for frame in check_frames:
    lo = int(frame)
    scene.frame_set(lo, subframe=frame-lo)
    actual = positions(candidate)
    index = int(np.argmin(np.abs(times - frame)))
    error = np.linalg.norm(actual - baseline_positions[index], axis=1)
    check_rows.append({'frame': frame, 'max_basis_reconstruction_error': float(error.max())})
    assert max(row['max_basis_reconstruction_error'] for row in check_rows) <= 0.001, check_rows

error_vectors = np.linalg.norm(baseline_positions - targets, axis=2)
baseline_error_by_frame = error_vectors.max(axis=1)
baseline_rms_by_frame = np.sqrt(np.mean(error_vectors * error_vectors, axis=1))
step = np.diff(baseline_positions, axis=0)
base_speed_by_step = np.linalg.norm(step, axis=2).max(axis=1) / (1.0 / 256.0)
outside_segment_steps = [i for i in range(len(times) - 1)
                         if not (times[i] >= t0 - 1e-9 and times[i + 1] <= t1 + 1e-9)]
outside_max_speed = float(max(base_speed_by_step[i] for i in outside_segment_steps))
segment_step_rows = [i for i in range(len(times) - 1)
                     if times[i] >= t0 - 1e-9 and times[i + 1] <= t1 + 1e-9]
baseline_segment_speed = float(max(base_speed_by_step[i] for i in segment_step_rows))
baseline_window_max = float(baseline_error_by_frame.max())
baseline_segment_max = float(baseline_error_by_frame[segment_rows].max())
baseline_window_rms = float(baseline_rms_by_frame.max())
baseline_over_2333 = int(np.count_nonzero(baseline_error_by_frame > 2.333))
global_speed_ceiling = 1185.997690028085


def cubic_weight(u, c1, c2):
    v = 1.0 - u
    return v*v*v + 3.0*v*v*u*c1 + 3.0*v*u*u*c2


grid = [i / 20.0 for i in range(21)]
feasible = []
pareto = []
u_segment = (times[segment_rows] - t0) / dt
for c1 in grid:
    for c2 in grid:
        if c1 + 1e-9 < c2:
            continue
        q = cubic_weight(u_segment, c1, c2)
        local_positions = surfaces_b + q[:, None, None] * deltas
        local_errors = np.linalg.norm(local_positions - targets[segment_rows], axis=2)
        local_max = float(local_errors.max())
        local_rms_max = float(np.sqrt(np.mean(local_errors * local_errors, axis=1)).max())
        candidate_error = baseline_error_by_frame.copy()
        candidate_error[segment_rows] = local_errors.max(axis=1)
        candidate_rms = baseline_rms_by_frame.copy()
        candidate_rms[segment_rows] = np.sqrt(np.mean(local_errors * local_errors, axis=1))
        local_steps = np.linalg.norm(np.diff(local_positions, axis=0), axis=2).max(axis=1) / (1.0 / 256.0)
        candidate_max_speed = max(outside_max_speed, float(local_steps.max()))
        row = {
            'control_1': c1,
            'control_2': c2,
            'window_max_error': float(candidate_error.max()),
            'segment_max_error': local_max,
            'window_max_rms': float(candidate_rms.max()),
            'window_samples_over_2_333': int(np.count_nonzero(candidate_error > 2.333)),
            'local_segment_max_speed': float(local_steps.max()),
            'window_max_speed': candidate_max_speed,
            'weight_sum_max_error': 0.0,
        }
        pareto.append(row)
        if candidate_max_speed <= global_speed_ceiling + 1e-8 and row['window_max_error'] < baseline_window_max:
            feasible.append(row)

feasible.sort(key=lambda row: (row['window_max_error'], row['window_samples_over_2_333'], row['window_max_speed']))
best = feasible[0] if feasible else None
pareto.sort(key=lambda row: (row['window_max_error'], row['window_max_speed']))

report = {
    'schema': 'bankright_v40_v41_hotspot_fit.v1',
    'source': SOURCE.name,
    'candidate': DEST.name if best else None,
    'status': 'candidate saved' if best else 'no fit improved position error without exceeding the existing full-window speed peak',
    'interval': {'start': t0, 'end': t1, 'shape_a': shape_a, 'shape_b': shape_b,
                 'samples': len(times), 'step_frames': 1/256, 'guard_frames_each_side': 0.125},
    'target_mix_range': [float(min(alpha_at(float(t)) for t in times)), float(max(alpha_at(float(t)) for t in times))],
    'baseline': {
        'window_max_error': baseline_window_max,
        'segment_max_error': baseline_segment_max,
        'window_max_rms': baseline_window_rms,
        'window_samples_over_2_333': baseline_over_2333,
        'segment_max_speed': baseline_segment_speed,
        'window_max_speed': max(outside_max_speed, baseline_segment_speed),
    },
    'speed_ceiling_source': 'V31 full fine-window measured maximum, bankRight-v21-v31-local-cubic-weight-fit-report.json',
    'speed_ceiling': global_speed_ceiling,
    'fixed_pair_basis_reconstruction': check_rows,
    'best_feasible': best,
    'best_by_position_error': pareto[0] if pareto else None,
    'feasible_count': len(feasible),
    'search': {'control_grid_step': 0.05, 'monotonic_constraint': '1 >= control_1 >= control_2 >= 0', 'pairs': len(pareto)},
}

if best:
    p_a0, p_a1 = point_at(curve_a, t0), point_at(curve_a, t1)
    p_b0, p_b1 = point_at(curve_b, t0), point_at(curve_b, t1)
    h1, h2 = float(best['control_1']), float(best['control_2'])
    for curve, start, end, c1, c2 in [
        (curve_a, p_a0, p_a1, h1, h2),
        (curve_b, p_b0, p_b1, 1.0-h1, 1.0-h2),
    ]:
        start.interpolation = 'BEZIER'
        start.handle_right_type = 'FREE'
        end.handle_left_type = 'FREE'
        start.handle_right = (t0 + dt / 3.0, c1)
        end.handle_left = (t1 - dt / 3.0, c2)
        curve.update()

    curve_sums = [float(curve_a.evaluate(float(t)) + curve_b.evaluate(float(t)))
                  for t in times[segment_rows]]
    assert max(abs(value - 1.0) for value in curve_sums) < 1e-6
    endpoint_errors = []
    for frame in (t0, t1):
        lo = int(frame)
        scene.frame_set(lo, subframe=frame-lo)
        actual = positions(candidate)
        index = int(np.argmin(np.abs(times-frame)))
        endpoint_errors.append(float(np.linalg.norm(actual-targets[index], axis=1).max()))
    report['candidate_weight_sum_error'] = max(abs(value - 1.0) for value in curve_sums)
    report['candidate_endpoint_reconstruction_errors'] = endpoint_errors
    assert max(endpoint_errors) <= 0.001
    scene.frame_set(saved_frame)
    REPORT.write_text(json.dumps(report, indent=2) + '\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(DEST))
else:
    REPORT.write_text(json.dumps(report, indent=2) + '\n')

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
result = {'status': report['status'], 'report': str(REPORT), 'candidate': str(DEST) if best else None,
          'baseline': report['baseline'], 'best_feasible': best,
          'best_by_position_error': report['best_by_position_error'], 'feasible_count': len(feasible),
          'source_reopened_clean': bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty}
