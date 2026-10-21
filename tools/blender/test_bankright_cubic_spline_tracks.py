import bpy
import json
import math
import numpy as np
from pathlib import Path


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v21-bankRight-local-mask05-four-local-centers.blend'
DEST = OUT / 'v24-bankRight-cardinal-cubic-tracks.blend'
REPORT = OUT / 'bankRight-v24-cardinal-cubic-report.json'

assert bpy.data.filepath == str(SOURCE)
assert not bpy.data.is_dirty
scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
initial_frame = scene.frame_current
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
linear_action = keys.animation_data.action
linear_slot = keys.animation_data.action_slot
action = linear_action.copy()
slot = action.slots[0]
seq = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
v21_v22 = json.loads((OUT / 'bankRight-v22-smoothstep-handoff-report.json').read_text())
v21_v23 = json.loads((OUT / 'bankRight-v21-v23-partial-ease025-report.json').read_text())

curves = [fc for layer in linear_action.layers for strip in layer.strips
          for bag in strip.channelbags if bag.slot == linear_slot for fc in bag.fcurves]
center_by_name = {}
for fc in curves:
    name = fc.data_path.split('key_blocks["', 1)[1].split('"]', 1)[0]
    if name == 'bankRightDense_144':
        continue
    peaks = [float(p.co[0]) for p in fc.keyframe_points if abs(float(p.co[1]) - 1.0) < 1e-7]
    if peaks:
        center_by_name[name] = round(peaks[0] % 144.0, 9)
centers = sorted(set(center_by_name.values()))
assert len(centers) == 450
center_index = {round(t, 9): i for i, t in enumerate(centers)}
n_centers = len(centers)


def center_time(index):
    cycle, local = divmod(index, n_centers)
    return centers[local] + cycle * 144.0


def spline_value_slope(key_index, segment_index, u):
    """Nonuniform Catmull-Rom basis coefficient and derivative per frame."""
    rel = key_index - segment_index
    if rel not in (-1, 0, 1, 2):
        return 0.0, 0.0
    t0, t1 = center_time(segment_index), center_time(segment_index + 1)
    dt = t1 - t0
    s0 = center_time(segment_index + 1) - center_time(segment_index - 1)
    s1 = center_time(segment_index + 2) - center_time(segment_index)
    h00 = 2*u**3 - 3*u**2 + 1
    h10 = u**3 - 2*u**2 + u
    h01 = -2*u**3 + 3*u**2
    h11 = u**3 - u**2
    d00 = 6*u**2 - 6*u
    d10 = 3*u**2 - 4*u + 1
    d01 = -6*u**2 + 6*u
    d11 = 3*u**2 - 2*u
    if rel == -1:
        return -h10 * dt / s0, -d10 / s0
    if rel == 0:
        return h00 - h11 * dt / s1, d00 / dt - d11 / s1
    if rel == 1:
        return h01 + h10 * dt / s0, d01 / dt + d10 / s0
    return h11 * dt / s1, d11 / s1


curve_by_name = {fc.data_path.split('key_blocks["', 1)[1].split('"]', 1)[0]: fc
                 for layer in action.layers for strip in layer.strips
                 for bag in strip.channelbags if bag.slot == slot for fc in bag.fcurves}
assert len(curve_by_name) == len(curves)

# Each correction delta is a knot. The four surrounding Catmull-Rom basis
# functions provide a C1 trajectory through the exact one-hot center poses.
for name, fc in curve_by_name.items():
    fc.keyframe_points.clear()
    if name == 'bankRightDense_144' or name not in center_by_name:
        fc.keyframe_points.insert(0.0, 0.0, options={'FAST'})
        fc.keyframe_points.insert(144.0, 0.0, options={'FAST'})
        fc.update()
        for p in fc.keyframe_points:
            p.interpolation = 'BEZIER'
            p.handle_left_type = 'FREE'
            p.handle_right_type = 'FREE'
            p.handle_left = (float(p.co[0]) - 48.0, 0.0)
            p.handle_right = (float(p.co[0]) + 48.0, 0.0)
        continue

    q = center_index[center_by_name[name]]
    nodes = []
    for cycle in (-1, 0, 1):
        qc = q + cycle * n_centers
        for offset in range(-2, 3):
            node = qc + offset
            frame = center_time(node)
            value = 1.0 if offset == 0 else 0.0
            incoming = 0.0
            outgoing = 0.0
            if -1 <= offset <= 2:
                incoming = spline_value_slope(qc, node - 1, 1.0)[1]
            if -2 <= offset <= 1:
                outgoing = spline_value_slope(qc, node, 0.0)[1]
            nodes.append((frame, value, incoming, outgoing))
    nodes.sort(key=lambda row: row[0])
    inserted = []
    for frame, value, incoming, outgoing in nodes:
        inserted.append((frame, value, incoming, outgoing))
        fc.keyframe_points.insert(frame, value, options={'FAST'})
    fc.update()
    points = sorted(fc.keyframe_points, key=lambda p: float(p.co[0]))
    for i, (point, data) in enumerate(zip(points, inserted)):
        frame, value, incoming, outgoing = data
        prev_frame = float(points[i - 1].co[0]) if i else frame - 1.0
        next_frame = float(points[i + 1].co[0]) if i + 1 < len(points) else frame + 1.0
        point.interpolation = 'BEZIER'
        point.handle_left_type = 'FREE'
        point.handle_right_type = 'FREE'
        point.handle_left = (frame - (frame - prev_frame) / 3.0,
                             value - incoming * (frame - prev_frame) / 3.0)
        point.handle_right = (frame + (next_frame - frame) / 3.0,
                              value + outgoing * (next_frame - frame) / 3.0)


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


def desired(t):
    lo = int(math.floor(t))
    u = t - lo
    alpha = seq[lo] * (1.0 - u) + seq[(lo + 1) % 144] * u
    base = positions(basis)
    blend = positions(weighted)
    return base + alpha * (blend - base)


cycle_rows = []
for i in range(4608):
    t = i / 32.0
    set_time(t)
    goal = desired(t)
    actual = positions(obj)
    error = np.linalg.norm(actual - goal, axis=1)
    cycle_rows.append({'frame': t, 'max_error': float(error.max()),
                       'rms_error': float(np.sqrt(np.mean(error * error))),
                       'worst_vertex': int(error.argmax())})

# Match the verified V21 short-interval diagnostic grid: 55 gaps <1/16 frame,
# sampled every 1/256 frame with 1/8 frame of guard on either side.
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
fine_rows = []
fine_positions = []
for t in fine_frames:
    set_time(t)
    goal = desired(t)
    actual = positions(obj)
    error = np.linalg.norm(actual - goal, axis=1)
    fine_rows.append({'frame': t, 'max_error': float(error.max()),
                      'rms_error': float(np.sqrt(np.mean(error * error))),
                      'worst_vertex': int(error.argmax())})
    fine_positions.append(actual)
speeds = []
for i in range(1, len(fine_frames)):
    dt = fine_frames[i] - fine_frames[i - 1]
    if abs(dt - 1.0 / 256.0) > 1e-8:
        continue
    step = np.linalg.norm(fine_positions[i] - fine_positions[i - 1], axis=1)
    speeds.append({'from': fine_frames[i - 1], 'to': fine_frames[i],
                   'speed_units_per_frame': float(step.max() / dt),
                   'max_step_units': float(step.max()), 'worst_vertex': int(step.argmax())})

scene.frame_set(0)
bpy.context.view_layer.update()
w0 = np.asarray([key.value for key in keys.key_blocks])
scene.frame_set(144)
bpy.context.view_layer.update()
w144 = np.asarray([key.value for key in keys.key_blocks])
v21_coarse = v21_v22['full_cycle_1of32']
v21_fine = v21_v23['linear_v21']
report = {
    'candidate': DEST.name,
    'source': SOURCE.name,
    'interpolation': 'Nonuniform Catmull-Rom cubic Hermite basis between all measured correction-center deltas, encoded as exact cubic Bezier F-curves.',
    'centers': len(centers),
    'fcurves': len(curves),
    'full_cycle_1of32': {
        'samples': len(cycle_rows),
        'v21_max_error': v21_coarse['v21_max_error'],
        'candidate_max_error': max(r['max_error'] for r in cycle_rows),
        'v21_max_rms': v21_coarse['v21_max_rms'],
        'candidate_max_rms': max(r['rms_error'] for r in cycle_rows),
        'v21_samples_over_2_333': v21_coarse['v21_samples_over_2_333'],
        'candidate_samples_over_2_333': sum(r['max_error'] > 2.333 for r in cycle_rows),
        'worst_candidate_samples': sorted(cycle_rows, key=lambda r: r['max_error'], reverse=True)[:20],
    },
    'short_windows_1of256': {
        'samples': len(fine_rows),
        'v21_max_error': v21_fine['max_error'],
        'candidate_max_error': max(r['max_error'] for r in fine_rows),
        'v21_samples_over_2_333': v21_fine['samples_over_2_333'],
        'candidate_samples_over_2_333': sum(r['max_error'] > 2.333 for r in fine_rows),
        'v21_max_speed': v21_fine['max_evaluated_speed'],
        'candidate_max_speed': max(speeds, key=lambda s: s['speed_units_per_frame']),
        'worst_candidate_samples': sorted(fine_rows, key=lambda r: r['max_error'], reverse=True)[:20],
    },
    'loop_coefficient_max_difference': float(np.max(np.abs(w0 - w144))),
    'note': '2.333 units is a cruise comparison, not a bank threshold. Candidate is diagnostic until visual playback and inter-clip transition gates pass.',
}
REPORT.write_text(json.dumps(report, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(DEST), copy=True)
keys.animation_data.action = linear_action
keys.animation_data.action_slot = linear_slot
rig.animation_data.action = bpy.data.actions['bankRight.005']
rig.animation_data.action_slot = rig.animation_data.action.slots[0]
scene.frame_set(initial_frame)
bpy.context.view_layer.update()
print(json.dumps({'report': str(REPORT),
                  'full_cycle': report['full_cycle_1of32'],
                  'fine': report['short_windows_1of256'],
                  'loop': report['loop_coefficient_max_difference']}, indent=2))
