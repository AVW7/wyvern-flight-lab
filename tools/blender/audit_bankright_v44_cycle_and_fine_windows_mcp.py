import bpy
import json
import math
import numpy as np
from pathlib import Path


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v44-bankRight-additive-target-80519-corrective.blend'
REPORT = OUT / 'bankRight-v44-full-cycle-fine-audit.json'

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
fine_frames = sorted(tick / 256.0 for tick in ticks)
assert len(centers) == 450 and short_intervals == 55 and len(fine_frames) == 1406


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
    values = np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)
    row = {
        'frame': float(frame),
        'max_error': float(error.max()),
        'rms_error': float(np.sqrt(np.mean(error * error))),
        'worst_vertex': int(error.argmax()),
        'weight_sum': float(values.sum()),
        'weight_min': float(values.min()),
        'weight_max': float(values.max()),
    }
    return row, actual


try:
    cycle_rows = []
    cycle_step = None
    previous = None
    for index in range(4608):
        frame = index / 32.0
        row, actual = measure(frame)
        cycle_rows.append(row)
        if previous is not None:
            delta = np.linalg.norm(actual - previous, axis=1)
            step = float(delta.max())
            if cycle_step is None or step > cycle_step['max_step_units']:
                cycle_step = {'from': (index - 1) / 32.0, 'to': frame,
                              'max_step_units': step, 'worst_vertex': int(delta.argmax())}
        previous = actual

    fine_rows = []
    fine_speed = None
    previous_frame = None
    previous_actual = None
    for frame in fine_frames:
        row, actual = measure(frame)
        fine_rows.append(row)
        if previous_actual is not None and abs(frame - previous_frame - 1.0 / 256.0) < 1e-8:
            delta = np.linalg.norm(actual - previous_actual, axis=1)
            current = {'from': previous_frame, 'to': frame,
                       'speed_units_per_frame': float(delta.max() * 256.0),
                       'max_step_units': float(delta.max()), 'worst_vertex': int(delta.argmax())}
            if fine_speed is None or current['speed_units_per_frame'] > fine_speed['speed_units_per_frame']:
                fine_speed = current
        previous_frame, previous_actual = frame, actual

    scene.frame_set(0)
    bpy.context.view_layer.update()
    weights_0 = np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)
    seam_start = positions(obj)
    scene.frame_set(144)
    bpy.context.view_layer.update()
    weights_144 = np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)
    seam_end = positions(obj)
    seam_error = float(np.linalg.norm(seam_end - seam_start, axis=1).max())

    v31 = json.loads((OUT / 'bankRight-v21-v31-local-cubic-weight-fit-report.json').read_text())
    v42_audit = json.loads((OUT / 'bankRight-v42-full-cycle-fine-audit.json').read_text())
    authoring = json.loads((OUT / 'bankRight-v44-additive-target-authoring.json').read_text())
    report = {
        'schema': 'bankright_v44_full_cycle_fine_audit.v1',
        'candidate': SOURCE.name,
        'rig_action': bank_action.name,
        'rig_slot': bank_slot.identifier,
        'shape_action': shape_action.name,
        'shape_slot': shape_slot.identifier,
        'shape_key_count': len(keys.key_blocks),
        'weight_sum_interpretation': {
            'reported_weight_sum_includes_additive_target': True,
            'original_mix_curve_sum_max_error': authoring['existing_mix_weight_sum_max_error'],
            'separate_additive_target': authoring['new_shape_key'],
            'additive_target_weight_peak': authoring['additive_weight_peak'],
        },
        'fine_grid': '1/256 frame samples within 1/8 frame of each cyclic center interval shorter than 1/16 frame',
        'center_count': len(centers),
        'short_intervals': short_intervals,
        'samples_short_windows_1of256': len(fine_rows),
        'samples_full_cycle_1of32': len(cycle_rows),
        'full_cycle_1of32': {
            'max_error': max(row['max_error'] for row in cycle_rows),
            'max_rms_error': max(row['rms_error'] for row in cycle_rows),
            'samples_over_2_333': sum(row['max_error'] > 2.333 for row in cycle_rows),
            'weight_sum_range': [min(row['weight_sum'] for row in cycle_rows), max(row['weight_sum'] for row in cycle_rows)],
            'total_shape_key_weight_sum_range': [min(row['weight_sum'] for row in cycle_rows), max(row['weight_sum'] for row in cycle_rows)],
            'max_consecutive_surface_step': cycle_step,
            'worst_samples': sorted(cycle_rows, key=lambda row: row['max_error'], reverse=True)[:20],
        },
        'short_windows_1of256': {
            'max_error': max(row['max_error'] for row in fine_rows),
            'max_rms_error': max(row['rms_error'] for row in fine_rows),
            'samples_over_2_333': sum(row['max_error'] > 2.333 for row in fine_rows),
            'weight_sum_range': [min(row['weight_sum'] for row in fine_rows), max(row['weight_sum'] for row in fine_rows)],
            'total_shape_key_weight_sum_range': [min(row['weight_sum'] for row in fine_rows), max(row['weight_sum'] for row in fine_rows)],
            'additive_target_weight_peak': authoring['additive_weight_peak'],
            'weight_value_range': [min(row['weight_min'] for row in fine_rows), max(row['weight_max'] for row in fine_rows)],
            'max_evaluated_speed': fine_speed,
            'worst_samples': sorted(fine_rows, key=lambda row: row['max_error'], reverse=True)[:20],
        },
        'surface_loop_seam_max': seam_error,
        'loop_coefficient_max_difference': float(np.max(np.abs(weights_0 - weights_144))),
        'reference_v31': {
            'full_cycle_max_error': v31['full_cycle']['candidate_max_error'],
            'fine_max_error': v31['fine']['candidate_max_error'],
            'fine_samples_over_2_333': v31['fine']['candidate_samples_over_2_333'],
            'fine_max_speed': v31['fine']['candidate_max_speed']['speed'],
        },
        'reference_v42_fine': {
            'max_error': v42_audit['short_windows_1of256']['max_error'],
            'samples_over_2_333': v42_audit['short_windows_1of256']['samples_over_2_333'],
            'max_speed': v42_audit['short_windows_1of256']['max_evaluated_speed']['speed_units_per_frame'],
        },
        'status': 'diagnostic; bank-specific error/rate gate, rendered continuous playback and inter-clip transitions remain unqualified',
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
          'dirty': bpy.data.is_dirty, 'full_cycle': report['full_cycle_1of32'],
          'fine': report['short_windows_1of256'], 'loop': report['loop_coefficient_max_difference']}
