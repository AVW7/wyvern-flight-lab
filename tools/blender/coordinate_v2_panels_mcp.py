import bpy
import json
import math
from pathlib import Path
from mathutils import Quaternion

ROOT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next')
OUT = ROOT / 'assets/harvest-candidates/2026-10-07/mcp-study'
rig = bpy.data.objects['WyvernRig']
scene = bpy.context.scene
assert scene.name == 'V2 runtime panel coordination'
source = bpy.data.actions['cruise.001']
assert not bpy.data.actions.get('Cruise_PanelCoordination_MCP')
rig.animation_data.action = source
rig.animation_data.use_nla = False
names = [f'{side}_WingPanel{panel}_{segment}' for side in ['L', 'R'] for panel in range(4) for segment in range(2)]
samples = {n: [] for n in names}
measurements = []
for frame in range(145):
    scene.frame_set(frame)
    original = {n: b.matrix.copy() for n, b in rig.pose.bones.items()}
    desired = {}
    errors = []
    for name in names:
        side = name[0]
        panel, segment = map(int, name.split('Panel')[1].split('_'))
        adjacent = [f'{side}_WingD{digit}P{segment + 1}' for digit in [panel, panel + 1]]
        deltas = [original[n] @ rig.data.bones[n].matrix_local.inverted() for n in adjacent]
        average = deltas[0].to_quaternion().slerp(deltas[1].to_quaternion(), 0.5)
        bone = rig.data.bones[name]
        target = average.to_matrix().to_4x4() @ bone.matrix_local
        target.translation = (deltas[0] @ bone.head_local + deltas[1] @ bone.head_local) * 0.5
        desired[name] = target
        parent_pose = desired.get(bone.parent.name, original[bone.parent.name])
        basis = bone.convert_local_to_pose(target, bone.matrix_local, parent_matrix=parent_pose,
                                          parent_matrix_local=bone.parent.matrix_local, invert=True)
        location, rotation, scale = basis.decompose()
        if samples[name] and rotation.dot(samples[name][-1][1]) < 0:
            rotation.negate()
        samples[name].append((location.copy(), rotation.copy()))
        actual = (original[name] @ bone.matrix_local.inverted()).to_quaternion()
        errors.append(actual.rotation_difference(average).angle * 180 / math.pi)
    if frame % 18 == 0:
        measurements.append({'frame': frame, 'mean_neighbor_delta_degrees': sum(errors) / len(errors), 'max_neighbor_delta_degrees': max(errors)})

candidate = source.copy()
candidate.name = 'Cruise_PanelCoordination_MCP'
curves = candidate.layers[0].strips[0].channelbags[0].fcurves
paths = {f'pose.bones["{n}"].{property}' for n in names for property in ['location', 'rotation_quaternion', 'scale']}
for curve in list(curves):
    if curve.data_path in paths:
        curves.remove(curve)
for name in names:
    rig.pose.bones[name].rotation_mode = 'QUATERNION'
    for property, count, sample_index in [('location', 3, 0), ('rotation_quaternion', 4, 1)]:
        for component in range(count):
            curve = curves.new(data_path=f'pose.bones["{name}"].{property}', index=component)
            curve.keyframe_points.add(145)
            for frame, point in enumerate(curve.keyframe_points):
                point.co = (frame, samples[name][frame][sample_index][component])
                point.interpolation = 'LINEAR'
rig.animation_data.action = candidate
scene.render.fps = 24
scene.frame_start = 0
scene.frame_end = 144
scene.frame_set(18)
for obj in scene.objects:
    obj.select_set(obj.type in {'ARMATURE', 'MESH'})
bpy.context.view_layer.objects.active = rig
OUT.mkdir(parents=True, exist_ok=True)
report = {'status': 'experiment', 'source_action': source.name, 'candidate_action': candidate.name,
          'method': 'average neighboring digit segment skin transforms; solve panel local translation and rotation',
          'source': 'public/models/wyvern-v2-rig.glb', 'changed_bones': names, 'baseline_neighbor_delta': measurements,
          'preserved': 'finger/body/root/leg performance, geometry, skin weights, skeleton'}
(OUT / 'panel-coordination.json').write_text(json.dumps(report, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'v2-panel-coordination-mcp.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT / 'cruise-panel-donor.glb'), export_format='GLB', use_selection=True, use_active_scene=True,
                         export_animations=True, export_animation_mode='ACTIVE_ACTIONS', export_frame_range=True,
                         export_force_sampling=True, export_optimize_animation_size=False, export_skins=True)
result = report
