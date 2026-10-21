import bpy
import json
import math
import numpy as np
from pathlib import Path

ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v43-bankRight-turn-followup-cubic-fit.blend'
REPORT = OUT / 'bankRight-v43-reload-verification.json'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.data.scenes['V2 Harvested Bank Correction']
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['BankRight_FullIndependentActionProbe']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
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

def alpha_at(frame):
    lo = int(math.floor(frame)); sub = frame - lo
    return sequence[lo] * (1.0 - sub) + sequence[(lo + 1) % 144] * sub

frames = [tick / 256.0 for tick in range(int(70.8125 * 256), int(71.09375 * 256) + 1)]
rows = []; speed_peak = None
previous = None
for frame in frames:
    lo = int(math.floor(frame))
    scene.frame_set(lo, subframe=frame - lo)
    base = positions(basis); blend = positions(weighted); actual = positions(obj)
    error = np.linalg.norm(actual - (base + alpha_at(frame) * (blend - base)), axis=1)
    weights = np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)
    rows.append({'frame': frame, 'max_error': float(error.max()), 'rms_error': float(np.sqrt(np.mean(error * error))), 'worst_vertex': int(error.argmax()), 'weight_sum': float(weights.sum()), 'weight_min': float(weights.min()), 'weight_max': float(weights.max())})
    if previous is not None:
        delta = np.linalg.norm(actual - previous, axis=1)
        current = {'from': frame - 1/256, 'to': frame, 'speed_units_per_frame': float(delta.max() * 256), 'max_step_units': float(delta.max()), 'worst_vertex': int(delta.argmax())}
        if speed_peak is None or current['speed_units_per_frame'] > speed_peak['speed_units_per_frame']:
            speed_peak = current
    previous = actual
report = {
  'schema': 'bankright_v43_reload_verification.v1', 'candidate': SOURCE.name,
  'rig_action': rig_action.name, 'rig_slot': rig_slot.identifier,
  'rig_bone_count': len(rig.data.bones), 'shape_action': shape_action.name,
  'shape_slot': shape_slot.identifier, 'shape_key_count': len(keys.key_blocks),
  'sample_count': len(rows), 'frame_range': [frames[0], frames[-1]],
  'guarded_max_error': max(r['max_error'] for r in rows),
  'samples_over_2_333': sum(r['max_error'] > 2.333 for r in rows),
  'weight_sum_range': [min(r['weight_sum'] for r in rows), max(r['weight_sum'] for r in rows)],
  'max_evaluated_speed': speed_peak,
  'worst_samples': sorted(rows, key=lambda r: r['max_error'], reverse=True)[:10],
  'filepath': bpy.data.filepath, 'dirty': bpy.data.is_dirty,
}
REPORT.write_text(json.dumps(report, indent=2) + '\n')
result = report
