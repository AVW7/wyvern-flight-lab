import bpy
import json
import math
import numpy as np
from pathlib import Path

ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v21-bankRight-local-mask05-four-local-centers.blend'
DEST = OUT / 'v28-bankRight-local-peak-refit.blend'
REPORT = OUT / 'bankRight-v21-v28-local-peak-refit-report.json'
FAILURE_REPORT = OUT / 'bankRight-v28-local-peak-refit-builder-failure.json'
ADDED = [80.5234375, 70.88671875, 70.89453125, 116.5078125]
assert bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty
scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
original = bpy.data.objects['WyvernMembrane_ExportSafe.005']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
base_action = keys.animation_data.action
base_slot = keys.animation_data.action_slot
rig_action = bpy.data.actions['bankRight.005']
rig_slot = rig_action.slots[0]
seq = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
fine_ref = json.loads((OUT / 'bankRight-v21-mask05-four-centers-fine-audit.json').read_text())
coarse_ref = json.loads((OUT / 'bankRight-v22-smoothstep-handoff-report.json').read_text())['full_cycle_1of32']
assert base_action.name == 'V2BankShapes_bankRightAdaptiveRefinement5'
bones = [g.name for g in original.vertex_groups]
weights = np.zeros((len(original.data.vertices), len(bones)), dtype=np.float64)
for vertex in original.data.vertices:
    for assignment in vertex.groups:
        weights[vertex.index, assignment.group] = assignment.weight
weights /= weights.sum(axis=1)[:, None]
rest_inverse = np.asarray([np.linalg.inv(np.asarray(rig.data.bones[name].matrix_local)) for name in bones])
raw = np.asarray([v.co[:] for v in original.data.vertices], dtype=np.float64)

def positions(source):
    bpy.context.view_layer.update()
    evaluated = source.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    result = np.asarray([v.co[:] for v in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return result

def set_rig_time(t):
    lo = math.floor(t)
    rig.animation_data.action = rig_action
    rig.animation_data.action_slot = rig_slot
    scene.frame_set(lo, subframe=t - lo)

def direct_target(t):
    set_rig_time(t)
    lo = math.floor(t)
    u = t - lo
    alpha = seq[lo] * (1.0 - u) + seq[(lo + 1) % 144] * u
    return positions(basis) + alpha * (positions(weighted) - positions(basis))

for i, t in enumerate(ADDED):
    set_rig_time(t)
    target = direct_target(t)
    actual = positions(original)
    matrices = np.asarray([np.asarray(rig.pose.bones[n].matrix) for n in bones]) @ rest_inverse
    linear = np.einsum('vb,bij->vij', weights, matrices[:, :3, :3])
    delta = np.linalg.solve(linear, (target - actual)[..., None])[..., 0]
    key = obj.shape_key_add(name=f'bankRightLocalPeak28_{i:02d}')
    key.data.foreach_set('co', (raw + delta).astype('<f4').ravel())
    key.value = 0.0

# Copy V21 tracks and insert each new target as a cyclic triangular basis function.
FAILURE_REPORT.write_text(json.dumps({
    'status': 'rejected builder attempt; no V28 candidate should be used',
    'source': SOURCE.name,
    'attempted_center_times': ADDED,
    'failure': 'Blender 5.1 temporary shape keys continued to bind keyframe_insert curves to the source action; curve creation through fcurve_ensure_for_datablock created curves outside the requested slot. Resulting action failed the weight-sum guard and showed up to 860.64 units error.',
    'required_next_step': 'Rebuild target keys and all tracks in a new shape-key datablock/action copied as a coherent pair, or use a fresh duplicate mesh whose animation data has no existing Action Slot binding.',
    'V21_preserved': True,
    'active_model_preserved': True,
}, indent=2))
keys.animation_data.action = base_action
keys.animation_data.action_slot = base_slot
rig.animation_data.action = rig_action
rig.animation_data.action_slot = rig_slot
scene.frame_set(0)
bpy.context.view_layer.update()
result = {'status': 'v28 builder rejected; V21 restored', 'failure_report': str(FAILURE_REPORT)}
