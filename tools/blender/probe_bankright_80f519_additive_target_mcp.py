import bpy
import json
import math
import numpy as np
from pathlib import Path

ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v43-bankRight-turn-followup-cubic-fit.blend'
REPORT = OUT / 'bankRight-v43-80f519-additive-target-sweep.json'
FRAME = 80.51953125
T0, T1 = 80.5, 80.53125
PEAK_U = (FRAME - T0) / (T1 - T0)
GLOBAL_SPEED_CEILING = 1185.997690028085
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.data.scenes['V2 Harvested Bank Correction']
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['BankRight_FullIndependentActionProbe']
basis_target = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted_target = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
shape_action, shape_slot = keys.animation_data.action, keys.animation_data.action_slot
bank_action = bpy.data.actions['bankRight.005']
schedule = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
blocks = {key.name: key for key in keys.key_blocks}
basis = blocks['Basis']


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
                    name = fc.data_path.split('key_blocks["', 1)[1].split('"]', 1)[0]
                    assert name not in found, name
                    found[name] = fc
    return found


def mix_at(frame):
    lo = int(math.floor(frame)); sub = frame - lo
    return schedule[lo] * (1.0 - sub) + schedule[(lo + 1) % 144] * sub


def current_pre_shape(frame, curves):
    result = np.asarray([[v.co.x, v.co.y, v.co.z] for v in basis.data], dtype=np.float64)
    weights = {}
    for name, curve in curves.items():
        value = float(curve.evaluate(frame))
        if abs(value) < 1e-12:
            continue
        key = blocks[name]
        relative = key.relative_key
        relative_coords = np.asarray([[v.co.x, v.co.y, v.co.z] for v in relative.data], dtype=np.float64)
        key_coords = np.asarray([[v.co.x, v.co.y, v.co.z] for v in key.data], dtype=np.float64)
        result += value * (key_coords - relative_coords)
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
            m = pose.get(name)
            if m is None:
                continue
            w = float(group_weight.weight)
            matrices[vertex.index] += w * np.asarray(m, dtype=np.float64)
            weight_sums[vertex.index] += w
    return matrices, weight_sums


def desired_at(frame):
    lo = int(math.floor(frame)); sub = frame - lo
    alpha = mix_at(frame)
    base = positions(basis_target)
    weighted = positions(weighted_target)
    return base + alpha * (weighted - base), alpha


def q_bump(u, amplitude):
    if u <= PEAK_U:
        x = max(0.0, min(1.0, u / PEAK_U))
    else:
        x = max(0.0, min(1.0, (1.0 - u) / (1.0 - PEAK_U)))
    return amplitude * x * x * (3.0 - 2.0 * x)


def post_shape(matrix, coords):
    homogeneous = np.column_stack((coords, np.ones(len(coords), dtype=np.float64)))
    return np.einsum('nij,nj->ni', matrix, homogeneous)[:, :3]


curves = action_curves()
ticks = range(int(round(T0 * 256)), int(round(T1 * 256)) + 1)
frames = [tick / 256.0 for tick in ticks]
rows = []
desireds = []
current_posts = []
current_pres = []
matrices_by_frame = []
weight_rows = []
center_target = None
center_alpha = None
center_matrix = None
current_action_center = None
for frame in frames:
    lo = int(math.floor(frame))
    scene.frame_set(lo, subframe=frame - lo)
    rig.animation_data.action = bank_action
    rig.animation_data.action_slot = bank_action.slots[0]
    keys.animation_data.action = shape_action
    keys.animation_data.action_slot = shape_slot
    bpy.context.view_layer.update()
    desired, alpha = desired_at(frame)
    desireds.append(desired)
    pre, weights = current_pre_shape(frame, curves)
    matrices, sums = skin_matrices()
    post = post_shape(matrices, pre)
    error = np.linalg.norm(post - desired, axis=1)
    current_pres.append(pre)
    current_posts.append(post)
    matrices_by_frame.append(matrices)
    weight_rows.append(weights)
    rows.append({'frame': frame, 'max_error': float(error.max()), 'rms_error': float(np.sqrt(np.mean(error * error))), 'worst_vertex': int(error.argmax()), 'weight_sum_max_error': float(np.max(np.abs(sums - 1.0)))})
    if abs(frame - FRAME) < 1e-10:
        center_target, center_alpha, center_matrix = desired.copy(), alpha, matrices.copy()
        current_action_center = positions(obj)
assert center_target is not None

rest_target = np.linalg.solve(center_matrix, np.column_stack((center_target, np.ones(len(center_target))))[:, :, None])[:, :, 0][:, :3]
basis_coords = np.asarray([[v.co.x, v.co.y, v.co.z] for v in basis.data], dtype=np.float64)
delta_from_current = rest_target - current_pres[frames.index(FRAME)]
roundtrip = post_shape(center_matrix, rest_target)
current_formula_error = np.linalg.norm(current_posts[frames.index(FRAME)] - current_action_center, axis=1)

baseline_speed = []
for i in range(len(frames) - 1):
    delta = np.linalg.norm(current_posts[i + 1] - current_posts[i], axis=1)
    baseline_speed.append(float(delta.max() * 256.0))
baseline_window = {
    'max_error': max(r['max_error'] for r in rows),
    'samples_over_2_333': sum(r['max_error'] > 2.333 for r in rows),
    'max_rms': max(r['rms_error'] for r in rows),
    'max_speed': max(baseline_speed),
}
results = []
for step in range(31):
    amplitude = 0.15 + step * 0.005
    candidate_posts = []
    candidate_rows = []
    for i, frame in enumerate(frames):
        u = (frame - T0) / (T1 - T0)
        q = q_bump(u, amplitude)
        coords = (1.0 - q) * current_pres[i] + q * rest_target
        post = post_shape(matrices_by_frame[i], coords)
        error = np.linalg.norm(post - desireds[i], axis=1)
        candidate_posts.append(post)
        candidate_rows.append({'frame': frame, 'q': q, 'max_error': float(error.max()), 'rms_error': float(np.sqrt(np.mean(error * error)))})
    speeds = [float(np.linalg.norm(candidate_posts[i+1] - candidate_posts[i], axis=1).max() * 256.0) for i in range(len(frames)-1)]
    row = {
        'amplitude': amplitude,
        'max_error': max(r['max_error'] for r in candidate_rows),
        'samples_over_2_333': sum(r['max_error'] > 2.333 for r in candidate_rows),
        'max_rms': max(r['rms_error'] for r in candidate_rows),
        'max_speed': max(speeds),
        'speed_ceiling': GLOBAL_SPEED_CEILING,
        'improves_guard_max': max(r['max_error'] for r in candidate_rows) < baseline_window['max_error'],
        'within_speed_ceiling': max(speeds) <= GLOBAL_SPEED_CEILING + 1e-8,
        'samples': candidate_rows,
    }
    results.append(row)
feasible = [r for r in results if r['improves_guard_max'] and r['within_speed_ceiling']]
feasible.sort(key=lambda r: (r['max_error'], r['samples_over_2_333'], r['max_speed']))
report = {
    'schema': 'bankright_v43_80f519_additive_target_sweep.v1',
    'source': SOURCE.name,
    'frame': FRAME,
    'support': [T0, T1],
    'samples': len(frames),
    'step_frames': 1/256,
    'peak_parameter': PEAK_U,
    'target_mix_at_peak': center_alpha,
    'existing_active_weights_at_peak': weight_rows[frames.index(FRAME)],
    'current_action_mesh_formula_max_error_at_peak': float(current_formula_error.max()),
    'inverse_target_roundtrip_max_error': float(np.linalg.norm(roundtrip-center_target,axis=1).max()),
    'corrective_delta_from_current': {'max': float(np.linalg.norm(delta_from_current,axis=1).max()), 'rms': float(np.sqrt(np.mean(np.sum(delta_from_current**2,axis=1)))), 'p95': float(np.percentile(np.linalg.norm(delta_from_current,axis=1),95))},
    'baseline_guard': baseline_window,
    'speed_ceiling_source': 'V43 full-cycle fine audit: maximum 1/256 sampled speed across the loop',
    'amplitude_search': results,
    'best_feasible': feasible[0] if feasible else None,
    'status': 'feasible measured blend found' if feasible else 'no amplitude improves the local guard while staying under the measured speed ceiling',
}
REPORT.write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
result = {'status': report['status'], 'report': str(REPORT), 'baseline': baseline_window, 'best_feasible': feasible[0] if feasible else None, 'source_reopened_clean': bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty, 'delta': report['corrective_delta_from_current']}
