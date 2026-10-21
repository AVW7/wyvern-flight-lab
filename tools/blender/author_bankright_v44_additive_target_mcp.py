import bpy
import json
import math
import numpy as np
from pathlib import Path

ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v43-bankRight-turn-followup-cubic-fit.blend'
DEST = OUT / 'v44-bankRight-additive-target-80519-corrective.blend'
REPORT = OUT / 'bankRight-v44-additive-target-authoring.json'
FRAME = 80.51953125
T0, T1 = 80.5, 80.53125
PEAK_U = (FRAME - T0) / (T1 - T0)
AMPLITUDE = 0.205
GLOBAL_SPEED_CEILING = 1185.997690028085
STEP = 1 / 1024
OLD_NAMES = [
    'bankRightAdaptive_0644',
    'bankRightMask05V21_mid805156',
    'bankRightAdaptive5_0002',
]
NEW_NAME = 'bankRightTarget_80p51953125'

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.data.scenes['V2 Harvested Bank Correction']
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['BankRight_FullIndependentActionProbe']
basis_target = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted_target = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
shape_action, shape_slot = keys.animation_data.action, keys.animation_data.action_slot
bank_action = bpy.data.actions['bankRight.005']
assert bpy.data.filepath == str(SOURCE)
assert not bpy.data.is_dirty
assert len(keys.key_blocks) == 452
blocks = {key.name: key for key in keys.key_blocks}
assert all(name in blocks for name in OLD_NAMES)
assert NEW_NAME not in blocks


def positions(target):
    bpy.context.view_layer.update()
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    values = np.asarray([tuple(vertex.co) for vertex in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return values


def action_curves():
    found = {}
    for layer in shape_action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                if bag.slot != shape_slot:
                    continue
                for fc in bag.fcurves:
                    if 'key_blocks["' not in fc.data_path:
                        continue
                    name = fc.data_path.split('key_blocks["', 1)[1].split('\"]', 1)[0]
                    assert name not in found, name
                    found[name] = fc
    return found


def set_frame(frame):
    lo = int(math.floor(frame))
    scene.frame_set(lo, subframe=frame - lo)
    rig.animation_data.action = bank_action
    rig.animation_data.action_slot = bank_action.slots[0]
    keys.animation_data.action = shape_action
    keys.animation_data.action_slot = shape_slot
    bpy.context.view_layer.update()


def mix_at(schedule, frame):
    lo = int(math.floor(frame))
    sub = frame - lo
    return schedule[lo] * (1.0 - sub) + schedule[(lo + 1) % 144] * sub


def pre_shape(frame, curves, basis_coords, relative_coords):
    result = basis_coords.copy()
    weights = {}
    for name, curve in curves.items():
        value = float(curve.evaluate(frame))
        if abs(value) < 1e-12:
            continue
        key = blocks[name]
        result += value * (key_coords[name] - relative_coords[name])
        weights[name] = value
    return result, weights


def skin_matrices():
    obj_to_world = obj.matrix_world.copy()
    world_to_obj = obj_to_world.inverted()
    arm_to_world = rig.matrix_world.copy()
    world_to_arm = arm_to_world.inverted()
    pose = {}
    for bone in rig.data.bones:
        if not bone.use_deform:
            continue
        pose_bone = rig.pose.bones[bone.name]
        pose[bone.name] = world_to_obj @ arm_to_world @ pose_bone.matrix @ bone.matrix_local.inverted() @ world_to_arm @ obj_to_world
    matrices = np.zeros((len(obj.data.vertices), 4, 4), dtype=np.float64)
    weight_sums = np.zeros(len(obj.data.vertices), dtype=np.float64)
    for vertex in obj.data.vertices:
        for group_weight in vertex.groups:
            name = obj.vertex_groups[group_weight.group].name
            matrix = pose.get(name)
            if matrix is None:
                continue
            weight = float(group_weight.weight)
            matrices[vertex.index] += weight * np.asarray(matrix, dtype=np.float64)
            weight_sums[vertex.index] += weight
    return matrices, weight_sums


def desired_at(frame, schedule):
    alpha = mix_at(schedule, frame)
    base = positions(basis_target)
    weighted = positions(weighted_target)
    return base + alpha * (weighted - base), alpha


def q_bump(u):
    if u <= PEAK_U:
        x = max(0.0, min(1.0, u / PEAK_U))
    else:
        x = max(0.0, min(1.0, (1.0 - u) / (1.0 - PEAK_U)))
    return AMPLITUDE * x * x * (3.0 - 2.0 * x)


def post_shape(matrix, coords):
    homogeneous = np.column_stack((coords, np.ones(len(coords), dtype=np.float64)))
    return np.einsum('nij,nj->ni', matrix, homogeneous)[:, :3]


curves = action_curves()
assert all(name in curves for name in OLD_NAMES)
schedule = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
basis = blocks['Basis']
basis_coords = np.asarray([tuple(v.co) for v in basis.data], dtype=np.float64)
key_coords = {name: np.asarray([tuple(v.co) for v in blocks[name].data], dtype=np.float64) for name in curves}
relative_coords = {name: np.asarray([tuple(v.co) for v in blocks[name].relative_key.data], dtype=np.float64) for name in curves}

# Keep a dense before snapshot so the edit must preserve all values outside its support.
outside_frames = [80.4 + index / 4096 for index in range(int(round((80.7 - 80.4) * 4096)) + 1) if not (T0 < 80.4 + index / 4096 < T1)]
outside_before = {name: np.asarray([curves[name].evaluate(frame) for frame in outside_frames], dtype=np.float64) for name in OLD_NAMES}
endpoint_before = {}
for frame in [T0, T1]:
    set_frame(frame)
    endpoint_before[frame] = positions(obj)

ticks = range(int(round(T0 / STEP)), int(round(T1 / STEP)) + 1)
frames = [tick * STEP for tick in ticks]
desireds, pres, matrices_by_frame, baseline_posts = [], [], [], []
baseline_rows = []
center_target = center_matrix = None
for frame in frames:
    set_frame(frame)
    desired, alpha = desired_at(frame, schedule)
    pre, weights = pre_shape(frame, curves, basis_coords, relative_coords)
    matrices, weight_sums = skin_matrices()
    post = post_shape(matrices, pre)
    error = np.linalg.norm(post - desired, axis=1)
    desireds.append(desired)
    pres.append(pre)
    matrices_by_frame.append(matrices)
    baseline_posts.append(post)
    baseline_rows.append({
        'frame': frame,
        'target_mix': alpha,
        'max_error': float(error.max()),
        'rms_error': float(np.sqrt(np.mean(error * error))),
        'worst_vertex': int(error.argmax()),
        'weight_sum_max_error': float(np.max(np.abs(weight_sums - 1.0))),
        'active_shape_weights': weights,
    })
    if abs(frame - FRAME) < 1e-10:
        center_target, center_matrix = desired.copy(), matrices.copy()
assert center_target is not None

rest_target = np.linalg.solve(center_matrix, np.column_stack((center_target, np.ones(len(center_target))))[:, :, None])[:, :, 0][:, :3]
inverse_roundtrip = post_shape(center_matrix, rest_target)
inverse_error = np.linalg.norm(inverse_roundtrip - center_target, axis=1)
assert float(inverse_error.max()) < 1e-3

baseline_speeds = [float(np.linalg.norm(baseline_posts[i + 1] - baseline_posts[i], axis=1).max() / STEP) for i in range(len(frames) - 1)]
baseline = {
    'max_error': max(row['max_error'] for row in baseline_rows),
    'samples_over_2_333': sum(row['max_error'] > 2.333 for row in baseline_rows),
    'max_rms': max(row['rms_error'] for row in baseline_rows),
    'max_speed': max(baseline_speeds),
}

# Add the inverse-skinned residual as a separate Basis-relative additive corrective.
center_index = frames.index(FRAME)
corrective_delta = rest_target - pres[center_index]
new_key = obj.shape_key_add(name=NEW_NAME, from_mix=False)
new_key.relative_key = basis
for index, coordinate in enumerate(basis_coords + corrective_delta):
    new_key.data[index].co = coordinate

new_curve = shape_action.fcurve_ensure_for_datablock(keys, f'key_blocks["{NEW_NAME}"].value', index=0)
assert new_curve is not None
curve_keys = [(T0, 0.0), (FRAME, AMPLITUDE), (T1, 0.0)]
new_curve.keyframe_points.add(len(curve_keys))
for index in reversed(range(len(curve_keys))):
    new_curve.keyframe_points[index].co = curve_keys[index]
for point in new_curve.keyframe_points:
    point.interpolation = 'BEZIER'
    point.handle_left_type = 'FREE'
    point.handle_right_type = 'FREE'
left_width = FRAME - T0
right_width = T1 - FRAME
new_curve.keyframe_points[0].handle_left = (T0 - left_width / 3.0, 0.0)
new_curve.keyframe_points[0].handle_right = (T0 + left_width / 3.0, 0.0)
new_curve.keyframe_points[1].handle_left = (FRAME - left_width / 3.0, AMPLITUDE)
new_curve.keyframe_points[1].handle_right = (FRAME + right_width / 3.0, AMPLITUDE)
new_curve.keyframe_points[2].handle_left = (T1 - right_width / 3.0, 0.0)
new_curve.keyframe_points[2].handle_right = (T1 + right_width / 3.0, 0.0)
new_curve.update()
assert len(new_curve.keyframe_points) == len(curve_keys)
assert abs(float(new_curve.evaluate(T0))) < 1e-7
assert abs(float(new_curve.evaluate(T1))) < 1e-7
curve_fit_error = max(abs(float(new_curve.evaluate(frame)) - q_bump((frame - T0) / (T1 - T0))) for frame in frames)
assert curve_fit_error < 1e-5, curve_fit_error

depsgraph = bpy.context.evaluated_depsgraph_get()
bpy.context.view_layer.update()

# Verify coefficient partition and unchanged outside values at 1/4096-frame spacing.
outside_after = {name: np.asarray([curves[name].evaluate(frame) for frame in outside_frames], dtype=np.float64) for name in OLD_NAMES}
outside_curve_drift = {name: float(np.max(np.abs(outside_after[name] - outside_before[name]))) for name in OLD_NAMES}
assert max(outside_curve_drift.values()) < 1e-6, outside_curve_drift
sum_errors = []
for index in range(int(round((T1 - T0) * 2048)) + 1):
    frame = T0 + index / 2048
    values = [float(curve.evaluate(frame)) for curve in curves.values()]
    sum_errors.append(abs(sum(values) - 1.0))
assert max(sum_errors) < 1e-5, max(sum_errors)

candidate_posts, candidate_rows = [], []
for index, frame in enumerate(frames):
    set_frame(frame)
    q = float(new_curve.evaluate(frame))
    pre = pres[index] + q * corrective_delta
    post = post_shape(matrices_by_frame[index], pre)
    error = np.linalg.norm(post - desireds[index], axis=1)
    candidate_posts.append(post)
    candidate_rows.append({
        'frame': frame,
        'q': q,
        'max_error': float(error.max()),
        'rms_error': float(np.sqrt(np.mean(error * error))),
        'worst_vertex': int(error.argmax()),
    })
candidate_speeds = [float(np.linalg.norm(candidate_posts[i + 1] - candidate_posts[i], axis=1).max() / STEP) for i in range(len(frames) - 1)]
candidate = {
    'max_error': max(row['max_error'] for row in candidate_rows),
    'samples_over_2_333': sum(row['max_error'] > 2.333 for row in candidate_rows),
    'max_rms': max(row['rms_error'] for row in candidate_rows),
    'max_speed': max(candidate_speeds),
    'speed_ceiling': GLOBAL_SPEED_CEILING,
}
assert candidate['max_error'] < baseline['max_error']
assert candidate['max_speed'] <= GLOBAL_SPEED_CEILING

# Since q is zero at both ends, the evaluated visible surface must be identical there.
endpoint_after = {}
endpoint_diagnostic = {}
for frame in [T0, T1]:
    set_frame(frame)
    endpoint_after[frame] = positions(obj)
    endpoint_diagnostic[str(frame)] = {
        'curve_evaluate': float(new_curve.evaluate(frame)),
        'shape_key_value': float(new_key.value),
        'action_slot': str(keys.animation_data.action_slot),
        'curve_path': new_curve.data_path,
    }
endpoint_drift = {str(frame): float(np.linalg.norm(endpoint_after[frame] - endpoint_before[frame], axis=1).max()) for frame in [T0, T1]}
assert max(endpoint_drift.values()) < 1e-4, {'drift': endpoint_drift, 'diagnostic': endpoint_diagnostic}

report = {
    'schema': 'bankright_v44_additive_target_authoring.v1',
    'source': SOURCE.name,
    'candidate': DEST.name,
    'frame': FRAME,
    'support': [T0, T1],
    'sample_step': STEP,
    'support_samples': len(frames),
    'amplitude': AMPLITUDE,
    'three_key_bezier_fit_max_error': curve_fit_error,
    'new_shape_key': NEW_NAME,
    'new_shape_vertices': len(rest_target),
    'corrective_delta_from_current_at_peak': {
        'max': float(np.linalg.norm(corrective_delta, axis=1).max()),
        'rms': float(np.sqrt(np.mean(np.sum(corrective_delta * corrective_delta, axis=1)))),
        'p95': float(np.percentile(np.linalg.norm(corrective_delta, axis=1), 95)),
    },
    'inverse_target_roundtrip_max_error': float(inverse_error.max()),
    'outside_curve_drift': outside_curve_drift,
    'existing_mix_weight_sum_max_error': max(sum_errors),
    'additive_weight_peak': AMPLITUDE,
    'endpoint_surface_max_drift': endpoint_drift,
    'baseline_guard': baseline,
    'candidate_guard': candidate,
    'speed_ceiling_source': 'V43 full-cycle fine audit: maximum 1/256 sampled speed across the loop',
    'baseline_samples': baseline_rows,
    'candidate_samples': candidate_rows,
    'status': 'authored; diagnostic candidate only',
}
REPORT.write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(DEST), check_existing=False)
assert bpy.data.filepath == str(DEST)
bpy.ops.wm.open_mainfile(filepath=str(DEST))
saved_keys = bpy.data.objects['BankRight_FullIndependentActionProbe'].data.shape_keys
assert len(saved_keys.key_blocks) == 453
assert not bpy.data.is_dirty
result = {
    'status': 'saved and reopened',
    'source_preserved': SOURCE.exists(),
    'candidate': str(DEST),
    'report': str(REPORT),
    'candidate_guard': candidate,
    'baseline_guard': baseline,
    'outside_curve_drift': outside_curve_drift,
    'endpoint_surface_max_drift': endpoint_drift,
    'weight_sum_max_error': max(sum_errors),
    'saved_shape_keys': len(saved_keys.key_blocks),
    'file_dirty_after_reload': bpy.data.is_dirty,
}
