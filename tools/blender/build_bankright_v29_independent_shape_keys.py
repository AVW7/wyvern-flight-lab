import bpy
import json
import math
import numpy as np
from pathlib import Path

ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/bank-corrective-study'
SOURCE = OUT / 'v21-bankRight-local-mask05-four-local-centers.blend'
DEST = OUT / 'v29-bankRight-local-peak-refit-independent-keys.blend'
REPORT = OUT / 'bankRight-v21-v29-independent-key-refit-report.json'
ADDED = [80.5234375, 70.88671875, 70.89453125, 116.5078125]

assert bpy.data.filepath == str(SOURCE) and not bpy.data.is_dirty
scene = bpy.data.scenes['V2 Harvested Bank Correction']
bpy.context.window.scene = scene
source = bpy.data.objects['V2_OriginalSkin_BankRightDenseQuarterSafe']
rig = bpy.data.objects['WyvernRig.005']
original = bpy.data.objects['WyvernMembrane_ExportSafe.005']
basis = bpy.data.objects['V2_HarvestedBank_Corrective']
weighted = bpy.data.objects['V2_BankRoot_WeightBlend_SeamSafe']
source_keys = source.data.shape_keys
source_action = source_keys.animation_data.action
source_slot = source_keys.animation_data.action_slot
assert source_action.name == 'V2BankShapes_bankRightAdaptiveRefinement5'
rig_action = bpy.data.actions['bankRight.005']
rig_slot = rig_action.slots[0]
seq = json.loads((OUT / 'bankRight-slot-correct-quarter-continuity-schedule.json').read_text())['solutions'][3]['solution']['mix_sequence']

bones = [g.name for g in original.vertex_groups]
weights = np.zeros((len(original.data.vertices), len(bones)), dtype=np.float64)
for vertex in original.data.vertices:
    for assignment in vertex.groups:
        weights[vertex.index, assignment.group] = assignment.weight
weights /= weights.sum(axis=1)[:, None]
rest_inverse = np.asarray([np.linalg.inv(np.asarray(rig.data.bones[name].matrix_local)) for name in bones])
raw = np.asarray([v.co[:] for v in original.data.vertices], dtype=np.float64)

def positions(source_obj):
    bpy.context.view_layer.update()
    evaluated = source_obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
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

# Build new mesh and Key datablocks while preserving vertex and polygon order.
candidate = source.copy()
candidate.name = 'V2_BankRight_LocalPeakRefit_V29'
mesh = bpy.data.meshes.new('V2_BankRight_LocalPeakRefit_V29_Mesh')
mesh.from_pydata([tuple(v.co) for v in source.data.vertices], [],
                 [tuple(p.vertices) for p in source.data.polygons])
mesh.update()
for material in source.data.materials:
    mesh.materials.append(material)
candidate.data = mesh
scene.collection.objects.link(candidate)
basis_key = candidate.shape_key_add(name='Basis')
basis_key.value = 0.0
for source_key in list(source_keys.key_blocks)[1:]:
    key = candidate.shape_key_add(name=source_key.name)
    key.data.foreach_set('co', np.asarray([v.co[:] for v in source_key.data], dtype='<f4').ravel())
    key.slider_min = source_key.slider_min
    key.slider_max = source_key.slider_max
for source_key in list(source_keys.key_blocks)[1:]:
    candidate.data.shape_keys.key_blocks[source_key.name].relative_key = candidate.data.shape_keys.key_blocks[source_key.relative_key.name]
keys = candidate.data.shape_keys
assert keys is not source_keys and len(keys.key_blocks) == len(source_keys.key_blocks)
assert len(candidate.data.vertices) == len(source.data.vertices)
new_names = []
for i, t in enumerate(ADDED):
    set_rig_time(t)
    target = direct_target(t)
    actual = positions(original)
    matrices = np.asarray([np.asarray(rig.pose.bones[n].matrix) for n in bones]) @ rest_inverse
    linear = np.einsum('vb,bij->vij', weights, matrices[:, :3, :3])
    delta = np.linalg.solve(linear, (target - actual)[..., None])[..., 0]
    key = candidate.shape_key_add(name=f'bankRightLocalPeak29_{i:02d}')
    key.data.foreach_set('co', (raw + delta).astype('<f4').ravel())
    key.value = 0.0
    new_names.append(key.name)

# Read the V21 center assigned to each pre-existing key.
source_curves = [fc for layer in source_action.layers for strip in layer.strips
                 for bag in strip.channelbags if bag.slot == source_slot for fc in bag.fcurves]
centers_by_name = {}
for fc in source_curves:
    name = fc.data_path.split('key_blocks["', 1)[1].split('"].value', 1)[0]
    if name == 'bankRightDense_144':
        continue
    peak = next((float(p.co[0]) for p in fc.keyframe_points if abs(float(p.co[1]) - 1.0) < 1e-7), None)
    if peak is not None:
        centers_by_name[name] = peak % 144.0
base_centers = sorted(set(round(t, 9) for t in centers_by_name.values()))
assert len(base_centers) == 450 and all(round(t, 9) not in base_centers for t in ADDED)
for name, t in zip(new_names, ADDED):
    centers_by_name[name] = t
centers_by_name['bankRightDense_144'] = None
all_centers = sorted(set(t for t in centers_by_name.values() if t is not None))
assert len(all_centers) == 454

# New action and slot are made on the independent Key datablock only.
action = bpy.data.actions.new('V2BankShapes_bankRightLocalPeakRefit29')
keys.animation_data_create()
keys.animation_data.action = action
slot = action.slots.new(id_type='KEY', name='KEBankRightV29')
action.layers.new('Layer')
action.slots.active = slot
keys.animation_data.action = action
keys.animation_data.action_slot = slot
assert set(centers_by_name) == {key.name for key in list(keys.key_blocks)[1:]}
for name, center in centers_by_name.items():
    fc = action.fcurve_ensure_for_datablock(keys, f'key_blocks["{name}"].value', index=0)
    if center is None:
        for frame in (0.0, 144.0):
            fc.keyframe_points.insert(frame, 0.0, options={'FAST'})
        fc.update()
        continue
    idx = all_centers.index(center)
    prev = all_centers[idx - 1] if idx else all_centers[-1] - 144.0
    nxt = all_centers[idx + 1] if idx + 1 < len(all_centers) else all_centers[0] + 144.0
    points = [(prev, 0.0), (center, 1.0), (nxt, 0.0)]
    if center == 0.0:
        points.extend([(prev + 144.0, 0.0), (144.0, 1.0), (nxt + 144.0, 0.0)])
    for frame, value in sorted(points):
        fc.keyframe_points.insert(frame, value, options={'FAST'})
    fc.update()
    actual_points = [(float(p.co[0]), float(p.co[1])) for p in fc.keyframe_points]
    expected_points = sorted((float(frame), float(value)) for frame, value in points)
    assert len(actual_points) == len(expected_points) and all(
        abs(ax - ex) < 1e-7 and abs(ay - ey) < 1e-7
        for (ax, ay), (ex, ey) in zip(actual_points, expected_points)), {
            'key': name, 'center': center,
            'expected': expected_points, 'actual': actual_points}
    for point in fc.keyframe_points:
        point.interpolation = 'LINEAR'

def coefficient_row(t):
    lo = math.floor(t)
    scene.frame_set(lo, subframe=t - lo)
    bpy.context.view_layer.update()
    return np.asarray([key.value for key in keys.key_blocks], dtype=np.float64)

partition_checks = []
for t in [0.0, 144.0] + [i / 32.0 for i in range(4608)] + ADDED:
    row = coefficient_row(t)
    partition_checks.append((float(row.sum()), float(row.min()), float(row.max())))
max_partition_error = max(abs(s - 1.0) for s, _, _ in partition_checks)
assert max_partition_error < 1e-6, max_partition_error
assert max(abs(w0 - w144) for w0, w144 in [(coefficient_row(0.0), coefficient_row(144.0))]) == 0.0

# Confirm each added corrective center reconstructs its direct target before broad scans.
center_errors = []
for name, t in zip(new_names, ADDED):
    set_rig_time(t)
    # The center is one-hot; key evaluation comes from the candidate action.
    bpy.context.view_layer.update()
    actual = positions(candidate)
    target = direct_target(t)
    error = np.linalg.norm(actual - target, axis=1)
    center_errors.append({'frame': t, 'max_error': float(error.max()), 'rms_error': float(np.sqrt(np.mean(error * error)))})
assert max(row['max_error'] for row in center_errors) < 0.01

# Keep runtime object/action assignment out of scope; the candidate object remains separate.
candidate.hide_render = True
candidate.hide_viewport = True
report = {
    'candidate': DEST.name, 'source': SOURCE.name,
    'candidate_object': candidate.name, 'action': action.name,
    'action_slot': slot.identifier, 'added_center_times': ADDED,
    'unique_centers': len(all_centers),
    'max_partition_error': max_partition_error,
    'weight_range': [min(x[1] for x in partition_checks), max(x[2] for x in partition_checks)],
    'center_reconstruction': center_errors,
    'status': 'structurally valid candidate; playback and full-surface qualification pending',
}
REPORT.write_text(json.dumps(report, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(DEST), copy=True)
# Restore original scene exactly for continued authoring.
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
result = report
