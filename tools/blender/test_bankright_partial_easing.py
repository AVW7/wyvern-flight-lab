import bpy
import json
import math
import numpy as np
from pathlib import Path


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v21-bankRight-local-mask05-four-local-centers.blend'
DEST = OUT / 'v23-bankRight-mask05-partial-ease025.blend'
REPORT = OUT / 'bankRight-v21-v23-partial-ease025-report.json'
EASE = 0.25

assert bpy.data.filepath == str(SOURCE)
assert not bpy.data.is_dirty
scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
linear_action = keys.animation_data.action
linear_slot = keys.animation_data.action_slot
smooth_action = linear_action.copy()
smooth_slot = smooth_action.slots[0]
seq = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']

linear_curves = [fc for layer in linear_action.layers for strip in layer.strips
                 for bag in strip.channelbags if bag.slot == linear_slot for fc in bag.fcurves]
center_times = set()
for fc in linear_curves:
    name = fc.data_path.split('key_blocks["', 1)[1].split('"]', 1)[0]
    if name == 'bankRightDense_144':
        continue
    for point in fc.keyframe_points:
        if abs(float(point.co[1]) - 1.0) < 1e-7:
            center_times.add(round(float(point.co[0]) % 144.0, 9))
centers = sorted(center_times)
cyclic = centers + [centers[0] + 144.0]
ticks = set()
short_intervals = 0
for left, right in zip(cyclic, cyclic[1:]):
    if right - left >= 1.0 / 16.0:
        continue
    short_intervals += 1
    first = math.ceil((left - 1.0 / 8.0) * 256.0 - 1e-8)
    last = math.floor((right + 1.0 / 8.0) * 256.0 + 1e-8)
    ticks.update(tick % (144 * 256) for tick in range(first, last + 1))
frames = sorted(tick / 256.0 for tick in ticks)
assert len(centers) == 450 and short_intervals == 55 and len(frames) == 1406

smooth_curves = [fc for layer in smooth_action.layers for strip in layer.strips
                 for bag in strip.channelbags if bag.slot == smooth_slot for fc in bag.fcurves]
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
            previous_y = float(points[i - 1].co[1])
            point.handle_left = (x - left_span / 3.0,
                                 y - (y - previous_y) * (1.0 - EASE) / 3.0)
        if right_span:
            next_y = float(points[i + 1].co[1])
            point.handle_right = (x + right_span / 3.0,
                                  y + (next_y - y) * (1.0 - EASE) / 3.0)
    fc.update()


def positions(target):
    bpy.context.view_layer.update()
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    result = np.asarray([tuple(v.co) for v in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return result


def activate_shape_action(action, slot):
    keys.animation_data.action = action
    keys.animation_data.action_slot = slot


rows = {'linear_v21': [], 'partial_ease_v23': []}
motion = {'linear_v21': [], 'partial_ease_v23': []}
for t in frames:
    lo = int(math.floor(t))
    u = t - lo
    rig.animation_data.action = bpy.data.actions['bankRight.005']
    rig.animation_data.action_slot = rig.animation_data.action.slots[0]
    scene.frame_set(lo, subframe=u)
    alpha = seq[lo] * (1.0 - u) + seq[(lo + 1) % 144] * u
    base = positions(basis)
    blend = positions(weighted)
    target = base + alpha * (blend - base)
    for name, action, slot in [('linear_v21', linear_action, linear_slot),
                               ('partial_ease_v23', smooth_action, smooth_slot)]:
        activate_shape_action(action, slot)
        actual = positions(obj)
        error = np.linalg.norm(actual - target, axis=1)
        rows[name].append({'frame': t, 'max_error': float(error.max()),
                           'rms_error': float(np.sqrt(np.mean(error * error))),
                           'worst_vertex': int(error.argmax())})
        motion[name].append(actual)


def summarize(name):
    speeds = []
    for i in range(1, len(frames)):
        dt = frames[i] - frames[i - 1]
        if abs(dt - 1.0 / 256.0) > 1e-8:
            continue
        step = np.linalg.norm(motion[name][i] - motion[name][i - 1], axis=1)
        speeds.append({'from': frames[i - 1], 'to': frames[i],
                       'speed_units_per_frame': float(step.max() / dt),
                       'max_step_units': float(step.max()),
                       'worst_vertex': int(step.argmax())})
    return {
        'samples': len(rows[name]),
        'max_error': max(r['max_error'] for r in rows[name]),
        'max_rms_error': max(r['rms_error'] for r in rows[name]),
        'samples_over_2_333': sum(r['max_error'] > 2.333 for r in rows[name]),
        'max_evaluated_speed': max(speeds, key=lambda s: s['speed_units_per_frame']),
        'max_step': max(speeds, key=lambda s: s['max_step_units']),
        'worst_reconstruction_samples': sorted(rows[name], key=lambda r: r['max_error'], reverse=True)[:20],
    }


keys.animation_data.action = smooth_action
keys.animation_data.action_slot = smooth_slot
scene.frame_set(0)
bpy.context.view_layer.update()
w0 = np.asarray([key.value for key in keys.key_blocks])
scene.frame_set(144)
bpy.context.view_layer.update()
w144 = np.asarray([key.value for key in keys.key_blocks])
report = {
    'candidate': DEST.name,
    'source': SOURCE.name,
    'ease_fraction': EASE,
    'method': 'Cubic Bezier blend between linear interpolation and smoothstep; horizontal-control proportion is the easing fraction.',
    'grid': '1/256 frame samples within 1/8 frame of every cyclic center interval shorter than 1/16 frame',
    'unique_centers': len(centers),
    'short_intervals': short_intervals,
    'sample_frames': len(frames),
    'linear_v21': summarize('linear_v21'),
    'partial_ease_v23': summarize('partial_ease_v23'),
    'loop_coefficient_max_difference': float(np.max(np.abs(w0 - w144))),
    'qualification': 'diagnostic only; full-cycle position and crease, rendered playback, and inter-clip transitions remain to be checked',
}
REPORT.write_text(json.dumps(report, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(DEST), copy=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
print(json.dumps({'report': str(REPORT), 'linear': report['linear_v21'],
                  'partial_ease': report['partial_ease_v23'],
                  'loop_difference': report['loop_coefficient_max_difference']}, indent=2))
