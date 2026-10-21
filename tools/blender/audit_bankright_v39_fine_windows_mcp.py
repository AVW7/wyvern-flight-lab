import bpy
import json
import math
import numpy as np
from pathlib import Path


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v39-bankRight-eighth-frame-hotspot-fit.blend'
REPORT = OUT / 'bankRight-v39-fine-window-audit.json'

assert bpy.data.filepath == str(SOURCE)
assert not bpy.data.is_dirty

scene = bpy.data.scenes['V2 Harvested Bank Correction']
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['BankRight_FullIndependentActionProbe']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
shape_action, shape_slot = keys.animation_data.action, keys.animation_data.action_slot
rig_action, rig_slot = rig.animation_data.action, rig.animation_data.action_slot
bank_action = bpy.data.actions['bankRight.005']
bank_slot = bank_action.slots[0]
sequence = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
saved_frame = scene.frame_current

curves = [fc for layer in shape_action.layers for strip in layer.strips
          for bag in strip.channelbags if bag.slot == shape_slot for fc in bag.fcurves]
center_times = set()
for fc in curves:
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


def positions(target):
    bpy.context.view_layer.update()
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    values = np.asarray([tuple(vertex.co) for vertex in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return values


def measure(frame):
    rig.animation_data.action = bank_action
    rig.animation_data.action_slot = bank_slot
    keys.animation_data.action = shape_action
    keys.animation_data.action_slot = shape_slot
    lo = int(math.floor(frame))
    subframe = frame - lo
    scene.frame_set(lo, subframe=subframe)
    alpha = sequence[lo] * (1.0 - subframe) + sequence[(lo + 1) % 144] * subframe
    base = positions(basis)
    blend = positions(weighted)
    goal = base + alpha * (blend - base)
    actual = positions(obj)
    error = np.linalg.norm(actual - goal, axis=1)
    weights = np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)
    return {
        'frame': float(frame),
        'max_error': float(error.max()),
        'rms_error': float(np.sqrt(np.mean(error * error))),
        'worst_vertex': int(error.argmax()),
        'weight_sum': float(weights.sum()),
        'weight_min': float(weights.min()),
        'weight_max': float(weights.max()),
    }, actual


try:
    rows = []
    max_speed = None
    previous_frame = None
    previous_actual = None
    for frame in frames:
        row, actual = measure(frame)
        rows.append(row)
        if previous_actual is not None and abs(frame - previous_frame - 1.0 / 256.0) < 1e-8:
            delta = np.linalg.norm(actual - previous_actual, axis=1)
            current = {'from': previous_frame, 'to': frame,
                       'speed_units_per_frame': float(delta.max() * 256.0),
                       'max_step_units': float(delta.max()), 'worst_vertex': int(delta.argmax())}
            if max_speed is None or current['speed_units_per_frame'] > max_speed['speed_units_per_frame']:
                max_speed = current
        previous_frame, previous_actual = frame, actual

    scene.frame_set(0)
    bpy.context.view_layer.update()
    weights_0 = np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)
    seam_start = positions(obj)
    scene.frame_set(144)
    bpy.context.view_layer.update()
    weights_144 = np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)
    surface_seam = float(np.linalg.norm(positions(obj) - seam_start, axis=1).max())

    v38 = json.loads((OUT / 'bankRight-v38-full-cycle-fine-audit.json').read_text())['short_windows_1of256']
    report = {
        'schema': 'bankright_v39_fine_window_audit.v1',
        'candidate': SOURCE.name,
        'rig_action': bank_action.name,
        'rig_slot': bank_slot.identifier,
        'shape_action': shape_action.name,
        'shape_slot': shape_slot.identifier,
        'shape_key_count': len(keys.key_blocks),
        'grid': '1/256 frame samples within 1/8 frame of each cyclic center interval shorter than 1/16 frame',
        'center_count': len(centers),
        'short_intervals': short_intervals,
        'samples': len(rows),
        'max_error': max(row['max_error'] for row in rows),
        'max_rms_error': max(row['rms_error'] for row in rows),
        'samples_over_2_333': sum(row['max_error'] > 2.333 for row in rows),
        'weight_sum_range': [min(row['weight_sum'] for row in rows), max(row['weight_sum'] for row in rows)],
        'weight_value_range': [min(row['weight_min'] for row in rows), max(row['weight_max'] for row in rows)],
        'max_evaluated_speed': max_speed,
        'surface_loop_seam_max': surface_seam,
        'loop_coefficient_max_difference': float(np.max(np.abs(weights_0 - weights_144))),
        'reference_v38': {
            'max_error': v38['max_error'],
            'samples_over_2_333': v38['samples_over_2_333'],
            'max_speed': v38['max_evaluated_speed']['speed_units_per_frame'],
        },
        'worst_samples': sorted(rows, key=lambda row: row['max_error'], reverse=True)[:20],
        'status': 'diagnostic; bank-specific error/rate gate and inter-clip transitions remain unqualified',
    }
    REPORT.write_text(json.dumps(report, indent=2) + '\n')
finally:
    keys.animation_data.action = shape_action
    keys.animation_data.action_slot = shape_slot
    rig.animation_data.action = rig_action
    rig.animation_data.action_slot = rig_slot
    scene.frame_set(saved_frame)
    bpy.context.view_layer.update()

result = {'status': 'complete', 'report': str(REPORT), 'filepath': bpy.data.filepath,
          'dirty': bpy.data.is_dirty,'max_error': report['max_error'],
          'samples_over_2_333': report['samples_over_2_333'],
          'max_speed': report['max_evaluated_speed'], 'seam': report['surface_loop_seam_max'],
          'worst_samples': report['worst_samples'][:10]}
