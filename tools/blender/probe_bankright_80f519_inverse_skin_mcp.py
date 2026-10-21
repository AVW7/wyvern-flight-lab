import bpy
import json
import math
import numpy as np
from pathlib import Path

ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v43-bankRight-turn-followup-cubic-fit.blend'
REPORT = OUT / 'bankRight-v43-80f519-inverse-skin-probe.json'
FRAME = 80.51953125
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


def positions(target):
    bpy.context.view_layer.update()
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    values = np.asarray([tuple(vertex.co) for vertex in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return values


lo = int(math.floor(FRAME))
scene.frame_set(lo, subframe=FRAME - lo)
rig.animation_data.action = bank_action
rig.animation_data.action_slot = bank_action.slots[0]
keys.animation_data.action = shape_action
keys.animation_data.action_slot = shape_slot
bpy.context.view_layer.update()
current = positions(obj)
base_target = positions(basis_target)
weighted = positions(weighted_target)
frac = FRAME - lo
alpha = schedule[lo] * (1.0 - frac) + schedule[(lo + 1) % 144] * frac
desired = base_target + alpha * (weighted - base_target)
current_error = np.linalg.norm(current - desired, axis=1)

# Unbind the shape action so explicit basis evaluation is not overwritten.
keys.animation_data.action = None
for key in keys.key_blocks:
    key.value = 0.0
bpy.context.view_layer.update()
basis_post = positions(obj)
rest = np.asarray([[v.co.x, v.co.y, v.co.z, 1.0] for v in keys.reference_key.data], dtype=np.float64)
obj_to_world = obj.matrix_world.copy()
world_to_obj = obj_to_world.inverted()
arm_to_world = rig.matrix_world.copy()
world_to_arm = arm_to_world.inverted()
pose_matrices = {}
for bone in rig.data.bones:
    if not bone.use_deform:
        continue
    pose_bone = rig.pose.bones[bone.name]
    pose_matrices[bone.name] = world_to_obj @ arm_to_world @ pose_bone.matrix @ bone.matrix_local.inverted() @ world_to_arm @ obj_to_world

transforms = np.zeros((len(obj.data.vertices), 4, 4), dtype=np.float64)
weight_sums = np.zeros(len(obj.data.vertices), dtype=np.float64)
for vertex in obj.data.vertices:
    for group_weight in vertex.groups:
        name = obj.vertex_groups[group_weight.group].name
        matrix = pose_matrices.get(name)
        if matrix is None:
            continue
        weight = float(group_weight.weight)
        transforms[vertex.index] += weight * np.asarray(matrix, dtype=np.float64)
        weight_sums[vertex.index] += weight

predicted_basis = np.einsum('nij,nj->ni', transforms, rest)[:, :3]
forward_error = np.linalg.norm(predicted_basis - basis_post, axis=1)
condition = np.linalg.cond(transforms[:, :3, :3])
singular = np.flatnonzero(~np.isfinite(condition) | (condition > 1e12))
valid = np.flatnonzero(np.isfinite(condition) & (condition <= 1e12))
rest_target = np.zeros_like(rest)
rest_target[:, 3] = 1.0
for i in valid:
    rest_target[i, :3] = np.linalg.solve(transforms[i], np.asarray([*desired[i], 1.0]))[:3]
inverse_roundtrip = np.einsum('nij,nj->ni', transforms[valid], rest_target[valid])[:, :3]
inverse_error = np.linalg.norm(inverse_roundtrip - desired[valid], axis=1)
delta = rest_target[valid, :3] - rest[valid, :3]
delta_magnitudes = np.linalg.norm(delta, axis=1)
armature_mod = next(m for m in obj.modifiers if m.type == 'ARMATURE')
report = {
    'schema': 'bankright_v43_80f519_inverse_skin_probe.v1',
    'source': SOURCE.name,
    'frame': FRAME,
    'target_mix': alpha,
    'current_action_max_error': float(current_error.max()),
    'current_action_rms_error': float(np.sqrt(np.mean(current_error * current_error))),
    'vertex_count': len(obj.data.vertices),
    'armature_modifier': {'use_vertex_groups': armature_mod.use_vertex_groups, 'use_bone_envelopes': armature_mod.use_bone_envelopes, 'use_deform_preserve_volume': armature_mod.use_deform_preserve_volume},
    'influences_per_vertex': {'max': max(len(v.groups) for v in obj.data.vertices), 'weight_sum_range': [float(weight_sums.min()), float(weight_sums.max())]},
    'bone_matrix_model': 'mesh local -> armature pose -> mesh local; blended by current normalized deform-bone vertex-group weights',
    'forward_basis_prediction_max_error': float(forward_error.max()),
    'inverse_target_roundtrip_max_error': float(inverse_error.max()) if len(inverse_error) else None,
    'matrix_condition_number': {'max': float(np.nanmax(condition)), 'p95': float(np.nanpercentile(condition, 95)), 'singular_or_over_1e12': int(len(singular))},
    'rest_corrective_delta': {'max': float(delta_magnitudes.max()) if len(delta_magnitudes) else None, 'rms': float(np.sqrt(np.mean(delta_magnitudes * delta_magnitudes))) if len(delta_magnitudes) else None, 'p95': float(np.percentile(delta_magnitudes, 95)) if len(delta_magnitudes) else None},
    'inverse_vertices_solved': int(len(valid)),
}
REPORT.write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
result = {'status': 'complete', 'report': str(REPORT), **{k: report[k] for k in ('current_action_max_error', 'forward_basis_prediction_max_error', 'inverse_target_roundtrip_max_error', 'matrix_condition_number', 'rest_corrective_delta', 'influences_per_vertex','armature_modifier')}, 'restored_clean': bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty}
