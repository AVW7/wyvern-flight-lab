import bpy
import json
import math
import numpy as np
from pathlib import Path

ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v43-bankRight-turn-followup-cubic-fit.blend'
REPORT = OUT / 'bankRight-v43-80f519-nearby-pair-reachability.json'
FRAME = 80.51953125
CANDIDATES = [
    'bankRightMask05V21_mid805156',
    'bankRightAdaptive5_0002',
    'bankRightAdaptive_0644',
    'bankRightAdaptive4_0011',
    'bankRightAdaptive3_0031',
]
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.data.scenes['V2 Harvested Bank Correction']
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['BankRight_FullIndependentActionProbe']
basis_target = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted_target = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
shape_action, shape_slot = keys.animation_data.action, keys.animation_data.action_slot
rig_action, rig_slot = rig.animation_data.action, rig.animation_data.action_slot
bank_action = bpy.data.actions['bankRight.005']
sequence = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']


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
bpy.context.view_layer.update()
current = positions(obj)
base = positions(basis_target)
blend = positions(weighted_target)
alpha = sequence[lo] * (1.0 - (FRAME - lo)) + sequence[(lo + 1) % 144] * (FRAME - lo)
target = base + alpha * (blend - base)
current_error = np.linalg.norm(current - target, axis=1)
current_weights = {name: float(keys.key_blocks[name].value) for name in CANDIDATES}

# Unbind the action so explicit one-hot values survive dependency-graph evaluation.
keys.animation_data.action = None
surfaces = {}
for name in CANDIDATES:
    for key in keys.key_blocks:
        key.value = 0.0
    keys.key_blocks[name].value = 1.0
    bpy.context.view_layer.update()
    assert abs(float(keys.key_blocks[name].value) - 1.0) < 1e-7
    surfaces[name] = positions(obj)

rows = []
for i, name_a in enumerate(CANDIDATES):
    for name_b in CANDIDATES[i + 1:]:
        best = None
        for step in range(41):
            weight_a = step / 40.0
            candidate = weight_a * surfaces[name_a] + (1.0 - weight_a) * surfaces[name_b]
            error = np.linalg.norm(candidate - target, axis=1)
            row = {
                'shape_a': name_a,
                'shape_b': name_b,
                'weight_a': weight_a,
                'weight_b': 1.0 - weight_a,
                'max_error': float(error.max()),
                'rms_error': float(np.sqrt(np.mean(error * error))),
                'worst_vertex': int(error.argmax()),
            }
            if best is None or (row['max_error'], row['rms_error']) < (best['max_error'], best['rms_error']):
                best = row
        rows.append(best)

rows.sort(key=lambda row: (row['max_error'], row['rms_error']))
report = {
    'schema': 'bankright_v43_80f519_alternative_pair_probe.v1',
    'source': SOURCE.name,
    'frame': FRAME,
    'target_mix': alpha,
    'current_active_weights': current_weights,
    'current_max_error': float(current_error.max()),
    'candidate_shapes': CANDIDATES,
    'pair_search': 'At this fixed frame, test all pairs among nearby timed corrective shapes at 0.025 weight increments; action unbound for one-hot surface capture.',
    'best_pairs': rows,
    'best_alternative_max_error': min((r['max_error'] for r in rows if {r['shape_a'], r['shape_b']} != set(CANDIDATES[:2])), default=None),
}
REPORT.write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
result = {'status': 'complete', 'report': str(REPORT), 'best_pairs': rows[:5], 'current_max_error': report['current_max_error'], 'restored_clean': bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty}
