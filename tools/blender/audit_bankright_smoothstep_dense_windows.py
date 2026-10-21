import bpy
import json
import math
import numpy as np
from pathlib import Path


ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v21-bankRight-local-mask05-four-local-centers.blend'
V22 = OUT / 'v22-bankRight-local-mask05-smoothstep-handoffs.blend'
REPORT = OUT / 'bankRight-v21-v22-short-windows-1of256-motion.json'

assert bpy.data.filepath == str(SOURCE)
scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
keys = obj.data.shape_keys
linear_action = bpy.data.actions['V2BankShapes_bankRightAdaptiveRefinement5']
smooth_action = keys.animation_data.action
assert smooth_action.name.endswith('.001'), smooth_action.name
linear_slot = linear_action.slots[0]
smooth_slot = smooth_action.slots[0]
seq = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']

curves = [fc for layer in linear_action.layers for strip in layer.strips
          for bag in strip.channelbags if bag.slot == linear_slot for fc in bag.fcurves]
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
for left, right in zip(cyclic, cyclic[1:]):
    if right - left >= 1.0 / 16.0:
        continue
    first = math.ceil((left - 1.0 / 8.0) * 256.0 - 1e-8)
    last = math.floor((right + 1.0 / 8.0) * 256.0 + 1e-8)
    ticks.update(tick % (144 * 256) for tick in range(first, last + 1))
frames = sorted(tick / 256.0 for tick in ticks)
assert len(centers) == 450
assert len(frames) == 1406, len(frames)


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


motion = {'linear': [], 'smoothstep': []}
rows = {'linear': [], 'smoothstep': []}
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
    for name, action, slot in [('linear', linear_action, linear_slot),
                               ('smoothstep', smooth_action, smooth_slot)]:
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


report = {
    'source': SOURCE.name,
    'smoothstep_candidate': V22.name,
    'grid': '1/256 frame samples within 1/8 frame of every cyclic center interval shorter than 1/16 frame',
    'unique_centers': len(centers),
    'short_intervals': sum(b - a < 1.0 / 16.0 for a, b in zip(cyclic, cyclic[1:])),
    'sample_frames': len(frames),
    'linear_v21': summarize('linear'),
    'smoothstep_v22': summarize('smoothstep'),
    'note': '2.333 units remains a cruise comparison only. This audit compares V21 and V22 on identical local subframe windows; it does not qualify rendered playback or inter-clip transitions.',
}
REPORT.write_text(json.dumps(report, indent=2))

# Restore the running Blender session to the saved V21 source state.
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
print(json.dumps({'report': str(REPORT), 'linear': report['linear_v21'],
                  'smoothstep': report['smoothstep_v22']}, indent=2))
