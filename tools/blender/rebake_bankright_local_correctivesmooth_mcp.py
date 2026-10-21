import bpy
import json
import numpy as np
from pathlib import Path

OUT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/bank-corrective-study')
SOURCE = OUT / 'v9-bankRight-adaptive-refinement-5.blend'
DEST = OUT / 'v11-bankRight-local-correctivesmooth-mask075-rebake.blend'
REPORT = OUT / 'bankRight-v11-local-correctivesmooth-mask075-rebake-report.json'
assert bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty

scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
rig = bpy.data.objects['WyvernRig.005']
obj = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
original = bpy.data.objects['WyvernMembrane_ExportSafe.005']
targets = [
    bpy.data.objects['V2_HarvestedBank_Corrective'],
    bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe'],
]
keys = obj.data.shape_keys
shape_action = keys.animation_data.action
shape_slot = keys.animation_data.action_slot
assert shape_action.name == 'V2BankShapes_bankRightAdaptiveRefinement5'
assert rig.animation_data.action.name == 'bankRight.005'

centers = {}
for layer in shape_action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            if bag.slot != shape_slot:
                continue
            for curve in bag.fcurves:
                name = curve.data_path.split('key_blocks["', 1)[1].split('"].value', 1)[0]
                peaks = [float(point.co[0]) for point in curve.keyframe_points if abs(point.co[1] - 1.0) < 1e-6]
                if peaks:
                    centers[name] = peaks[0]
centers.pop('bankRightDense_144', None)
assert len(centers) == 446

for target in targets:
    group = target.vertex_groups.new(name='V11 center vertex factor 0.75')
    group.add(list(range(len(target.data.vertices))), 1.0, 'REPLACE')
    group.add([5795], 0.75, 'REPLACE')
    target.modifiers['Harvested bank membrane correction'].vertex_group = group.name

sequence = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']
bones = [group.name for group in original.vertex_groups]
weights = np.zeros((len(original.data.vertices), len(bones)), dtype=np.float64)
for vertex in original.data.vertices:
    for assignment in vertex.groups:
        weights[vertex.index, assignment.group] = assignment.weight
weights /= weights.sum(axis=1)[:, None]
rest_inverse = np.asarray([np.linalg.inv(np.asarray(rig.data.bones[name].matrix_local)) for name in bones])
raw = np.asarray([vertex.co[:] for vertex in original.data.vertices], dtype=np.float64)

def evaluated_positions(source):
    bpy.context.view_layer.update()
    evaluated = source.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    positions = np.asarray([vertex.co[:] for vertex in mesh.vertices], dtype=np.float64)
    evaluated.to_mesh_clear()
    return positions

def direct_target(time):
    frame = int(np.floor(time))
    fraction = time - frame
    alpha = sequence[frame] * (1.0 - fraction) + sequence[(frame + 1) % 144] * fraction
    action = bpy.data.actions['bankRight.005']
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    scene.frame_set(frame, subframe=fraction)
    first = evaluated_positions(targets[0])
    second = evaluated_positions(targets[1])
    return first + alpha * (second - first)

rig.animation_data.action = bpy.data.actions['bankRight.005']
rig.animation_data.action_slot = rig.animation_data.action.slots[0]
shape_key_names = [key.name for key in keys.key_blocks[1:]]
center_errors = []
for name, time in sorted(centers.items(), key=lambda item: item[1]):
    if name == 'bankRightDense_144':
        continue
    rig.animation_data.action = bpy.data.actions['bankRight.005']
    rig.animation_data.action_slot = rig.animation_data.action.slots[0]
    scene.frame_set(int(time), subframe=time - int(time))
    desired = direct_target(time)
    actual = evaluated_positions(original)
    matrices = np.asarray([np.asarray(rig.pose.bones[bone].matrix) for bone in bones]) @ rest_inverse
    linear = np.einsum('vb,bij->vij', weights, matrices[:, :3, :3])
    delta = np.linalg.solve(linear, (desired - actual)[..., None])[..., 0]
    key = keys.key_blocks[name]
    key.data.foreach_set('co', (raw + delta).astype('<f4').ravel())
    rebuilt = evaluated_positions(obj)
    error = np.linalg.norm(rebuilt - desired, axis=1)
    center_errors.append({'shape': name, 'frame': time, 'max_error': float(error.max()), 'rms_error': float(np.sqrt(np.mean(error * error)))})

assert set(shape_key_names) == set(centers) | {'bankRightDense_144'}
scene.frame_set(0)
weights0 = np.asarray([key.value for key in keys.key_blocks])
scene.frame_set(144)
weights144 = np.asarray([key.value for key in keys.key_blocks])
seam_delta = float(np.max(np.abs(weights0 - weights144)))
assert seam_delta == 0.0

report = {
    'scope': 'Separate V11 re-bake with a 0.75 Corrective Smooth vertex-group factor at vertex 5795',
    'source_blend': SOURCE.name,
    'candidate_blend': DEST.name,
    'mask_vertex': 5795,
    'mask_weight': 0.75,
    'shape_centers_rebaked': len(center_errors),
    'max_center_reconstruction_error': max(sample['max_error'] for sample in center_errors),
    'max_center_rms_error': max(sample['rms_error'] for sample in center_errors),
    'loop_weight_delta_0_144': seam_delta,
    'center_samples': center_errors,
    'status': 'diagnostic; fine-subframe, surface-safety and visual playback qualification pending',
}
REPORT.write_text(json.dumps(report, indent=2) + '\n')
obj.hide_render = True
scene.frame_set(80)
bpy.ops.wm.save_as_mainfile(filepath=str(DEST), copy=True)
result = {key: report[key] for key in ['shape_centers_rebaked', 'max_center_reconstruction_error', 'max_center_rms_error', 'loop_weight_delta_0_144', 'candidate_blend']}
