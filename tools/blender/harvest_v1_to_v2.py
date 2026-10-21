#!/usr/bin/env python3
"""Bake measured V1 wing rotations onto a V2 candidate, preserving other tracks.

blender -b --python-exit-code 1 --python tools/blender/harvest_v1_to_v2.py -- \
  --v1-source public/models/player-wyvern.glb --v2-source target.glb --clip cruise \
  --performance player-cruise --wing-only --out candidate.glb
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import bpy
    from mathutils import Matrix, Quaternion, Vector
except ImportError:
    bpy = None

# Import-normalized heads measured in 18-v1-harvest-gap-audit.md: max 0.419
# for arm + D0..D4; 1 rig unit is the original documented matching bound.
MAX_PAIR_DISTANCE = 1.0
CLIP_RECIPES = {
    'cruise': {'source': 'Battle_Down02', 'window': (40, 66), 'frames': 144, 'cycles': 3},
    'bankLeft': {'source': 'BankLeft', 'window': None, 'frames': 144, 'cycles': 1},
    'bankRight': {'source': 'BankRight', 'window': None, 'frames': 144, 'cycles': 1},
}


def transfer_bone_names():
    return [f'{side}_Wing{part}' for side in ('L', 'R')
            for part in (['Shoulder', 'Elbow', 'Wrist', 'Hand'] +
                         [f'D{digit}P{phalanx}' for digit in range(5) for phalanx in range(3)])]


def get_recipe(clip):
    if clip not in CLIP_RECIPES:
        raise ValueError(f'{clip}: no measured recipe; ground contact and other performances require qualification')
    return CLIP_RECIPES[clip]


def select_source_action(names, source):
    matches = [name for name in names if name == source or name.rsplit('|', 1)[-1] == f'DaenerysDragon_{source}']
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one imported action for {source}, found {matches}')
    return matches[0]


def pair_positions(targets, sources, limit=MAX_PAIR_DISTANCE):
    mapping, report, used = {}, [], set()
    for name, point in targets.items():
        distances = sorted((math.dist(point, position), donor) for donor, position in sources.items())
        if not distances or distances[0][0] > limit:
            raise ValueError(f'{name}: nearest donor outside {limit} rig-unit bound')
        distance, donor = distances[0]
        if len(distances) > 1 and distances[1][0] <= limit:
            raise ValueError(f'{name}: ambiguous donors inside matching bound')
        if donor in used:
            raise ValueError(f'{name}: donor {donor} reused')
        mapping[name] = donor
        used.add(donor)
        report.append({'target': name, 'source': donor, 'residual_rig_units': distance,
                       'next_residual_rig_units': distances[1][0] if len(distances) > 1 else None})
    return mapping, report


def action_curves(action):
    if action.layers:
        return action.layers[0].strips[0].channelbags[0].fcurves
    return action.fcurves


def import_rig(path):
    objects, actions = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [o for o in bpy.data.objects if o not in objects]
    rigs = [o for o in imported if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise ValueError(f'{path}: expected one imported armature, got {len(rigs)}')
    return rigs[0], imported, [a for a in bpy.data.actions if a not in actions]


def seek(frame):
    bpy.context.scene.frame_set(math.floor(frame), subframe=frame - math.floor(frame))
    bpy.context.view_layer.update()


def relative_rotation(bone, anchor, posed):
    return ((anchor.matrix if posed else anchor.bone.matrix_local).inverted() @
            (bone.matrix if posed else bone.bone.matrix_local)).to_quaternion().normalized()


def run_harvest(v1_path, v2_path, clip, out_path, wing_only=False, performance='player-cruise'):
    recipe = get_recipe(clip)
    if clip.startswith('bank') and performance != 'player-bank':
        raise ValueError('Banks require explicit player-bank performance')
    if not clip.startswith('bank') and performance == 'player-bank':
        raise ValueError('player-bank requires bankLeft or bankRight')
    if performance == 'player-cruise':
        recipe = {'source': 'FlightCruise', 'window': None, 'frames': 144, 'cycles': 1}
    if bpy is None:
        raise RuntimeError('Run inside headless Blender')
    if not wing_only:
        raise ValueError('Only measured --wing-only transfer is supported; body and ground performance remain authored V2')
    v1_path, v2_path, out_path = (Path(p).resolve() for p in (v1_path, v2_path, out_path))
    if out_path in (v1_path, v2_path) or out_path.exists():
        raise ValueError('Output must be a new candidate path, separate from both inputs')
    for path in (v1_path, v2_path):
        if path.suffix.lower() != '.glb' or not path.is_file():
            raise ValueError(f'Expected an existing GLB input: {path}')
    if len(bpy.data.objects):
        raise ValueError('Use an empty isolated Blender process, not an existing study scene')
    hashes = {label: hashlib.sha256(path.read_bytes()).hexdigest() for label, path in [('v1', v1_path), ('v2', v2_path)]}
    decoder = Path(__file__).with_name('decode_meshopt_glb.mjs')
    with tempfile.TemporaryDirectory(prefix='wyvern-harvest-') as scratch:
        inputs = []
        for index, path in enumerate((v2_path, v1_path)):
            decoded = Path(scratch) / f'import-{index}.glb'
            subprocess.run(['node', str(decoder), str(path), str(decoded)], check=True)
            inputs.append(decoded)
        v2, v2_objects, v2_actions = import_rig(inputs[0])
        v1, _, v1_actions = import_rig(inputs[1])
        if len(v2.data.bones) != 92:
            raise ValueError('Target must have the canonical 92-bone rig')
        source_name = select_source_action([a.name for a in v1_actions], recipe['source'])
        source = next(a for a in v1_actions if a.name == source_name)
        bases = [a for a in v2_actions if a.name == clip]
        if len(bases) != 1:
            raise ValueError(f'Target must have exactly one {clip} action')
        base = bases[0]
        names = transfer_bone_names()
        if any(name not in v2.data.bones for name in names):
            raise ValueError('Target lacks required wing joints')
        mapping, pairs = pair_positions(
            {name: tuple(v2.data.bones[name].head_local) for name in names},
            {b.name: tuple(b.head_local) for b in v1.data.bones})
        for name, donor in mapping.items():
            side = name[0]
            if f'-{side}-' not in donor:
                raise ValueError(f'{name}: donor has wrong anatomical side: {donor}')
            parent = v2.data.bones[name].parent
            if parent and parent.name in mapping:
                ancestor = v1.data.bones[donor].parent
                while ancestor and ancestor.name != mapping[parent.name]:
                    ancestor = ancestor.parent
                if ancestor is None:
                    raise ValueError(f'{name}: donor chain contradicts target hierarchy')
        v1.animation_data.action = source
        v1.animation_data.use_nla = False
        v2.animation_data.action = base
        v2.animation_data.use_nla = False
        start, end = recipe['window'] or tuple(source.frame_range)
        if start < source.frame_range[0] or end > source.frame_range[1]:
            raise ValueError('Recipe window is outside imported action')
        anchors1 = {name: v1.pose.bones[mapping[v2.data.bones[name].parent.name]] if v2.data.bones[name].parent.name in mapping else v1.pose.bones[mapping[name]].parent for name in names}
        anchors2 = {name: v2.pose.bones[name].parent for name in names}
        rest1 = {name: relative_rotation(v1.pose.bones[mapping[name]], anchors1[name], False) for name in names}
        rest2 = {name: relative_rotation(v2.pose.bones[name], anchors2[name], False) for name in names}
        def source_delta(frame):
            seek(frame)
            return {name: relative_rotation(v1.pose.bones[mapping[name]], anchors1[name], True) @ rest1[name].inverted() for name in names}
        def elevation(rig, shoulder_name, elbow_name, anchor):
            inverse = anchor.matrix.inverted()
            vector = inverse.to_3x3() @ (rig.pose.bones[elbow_name].head - rig.pose.bones[shoulder_name].head)
            up = anchor.bone.matrix_local.to_quaternion().inverted() @ Vector((0, 0, 1))
            return vector.normalized().dot(up)
        source_elevation, target_elevation = [], []
        for sample in range(48):
            seek(start + (end - start) * sample / 48)
            source_elevation.append(elevation(v1, mapping['L_WingShoulder'], mapping['L_WingElbow'], anchors1['L_WingShoulder']))
            seek(sample * recipe['frames'] / recipe['cycles'] / 48)
            target_elevation.append(elevation(v2, 'L_WingShoulder', 'L_WingElbow', anchors2['L_WingShoulder']))
        source_mean, target_mean = sum(source_elevation) / 48, sum(target_elevation) / 48
        correlations = [sum((source_elevation[(i + shift) % 48] - source_mean) * (target_elevation[i] - target_mean)
                            for i in range(48)) for shift in range(48)]
        phase_offset = max(range(48), key=lambda shift: correlations[shift]) / 48
        first, last = source_delta(start), source_delta(end)
        corrections = {name: first[name] @ last[name].inverted() for name in names}
        frames = recipe['frames']
        samples = {name: [] for name in names}
        seek(0)
        target_reference = {name: v2.pose.bones[name].rotation_quaternion.copy() for name in names}
        donor_reference = {}
        raw_samples = []
        identity = Quaternion()
        for frame in range(frames + 1):
            cycle = (frame * recipe['cycles'] / frames + phase_offset) % 1
            raw = source_delta(start + (end - start) * cycle)
            eased = cycle * cycle * (3 - 2 * cycle)
            adjusted = {name: identity.slerp(corrections[name], eased) @ raw[name] for name in names}
            raw_samples.append({'frame': frame, 'source_frame': start + (end - start) * cycle,
                                'shoulder_delta_wxyz': list(raw['L_WingShoulder'])})
            seek(frame)
            for name in names:
                bone = v2.pose.bones[name]
                anchor = anchors2[name].matrix.to_quaternion()
                delta = adjusted[name]
                if clip == 'cruise' and name.startswith('R_'):
                    left_anchor = anchors2['L_' + name[2:]].matrix.to_quaternion()
                    body_rotation = v2.pose.bones['Body'].matrix.to_quaternion()
                    left_delta = left_anchor @ adjusted['L_' + name[2:]] @ left_anchor.inverted()
                    body_delta = body_rotation.inverted() @ left_delta @ body_rotation
                    reflection = Matrix.Diagonal((-1.0, 1.0, 1.0))
                    mirrored = (reflection @ body_delta.to_matrix() @ reflection).to_quaternion()
                    world_delta = body_rotation @ mirrored @ body_rotation.inverted()
                    delta = anchor.inverted() @ world_delta @ anchor
                desired = anchor @ delta @ rest2[name]
                matrix = desired.to_matrix().to_4x4()
                matrix.translation = bone.matrix.translation
                basis = bone.bone.convert_local_to_pose(matrix, bone.bone.matrix_local,
                    parent_matrix=bone.parent.matrix, parent_matrix_local=bone.parent.bone.matrix_local, invert=True)
                q = basis.to_quaternion().normalized()
                if not any(f'D{digit}P' in name for digit in range(1, 5)):
                    q = bone.rotation_quaternion.copy()
                else:
                    donor_reference.setdefault(name, q.copy())
                    q = donor_reference[name].inverted() @ q
                    # Reuse the qualified distal recovery repair from author_v2_bank_clips.py.
                    repair_weights = {'Elbow': 0.18, 'Wrist': 0.35, 'Hand': 0.45}
                    weight = next((value for part, value in repair_weights.items() if part in name), None)
                    if weight is None:
                        weight = [0.52, 0.60, 0.66][int(name[-1])]
                    angle = math.degrees(q.angle if q.w >= 0 else 2 * math.pi - q.angle)
                    t = max(0, min(1, (angle - 24) / (82 - 24)))
                    q = target_reference[name] @ Quaternion().slerp(q, 1 - weight * t * t * (3 - 2 * t))
                if samples[name] and q.dot(samples[name][-1]) < 0:
                    q.negate()
                samples[name].append(q.copy())
                bone.rotation_mode = 'QUATERNION'
                bone.rotation_quaternion = q
                bpy.context.view_layer.update()
        candidate = base.copy()
        candidate.name = f'{clip}_harvest_candidate'
        curves = action_curves(candidate)
        paths = {f'pose.bones["{name}"].rotation_quaternion' for name in names}
        for curve in list(curves):
            if curve.data_path in paths:
                curves.remove(curve)
        for name in names:
            for component in range(4):
                curve = curves.new(data_path=f'pose.bones["{name}"].rotation_quaternion', index=component)
                curve.keyframe_points.add(frames + 1)
                for frame, point in enumerate(curve.keyframe_points):
                    point.co = (frame, samples[name][frame][component])
                    point.interpolation = 'LINEAR'
        v2.animation_data.action = candidate
        for track in v2.animation_data.nla_tracks:
            track.mute = True
        bpy.context.scene.render.fps = 24
        bpy.context.scene.frame_start = 0
        bpy.context.scene.frame_end = frames
        for obj in bpy.context.scene.objects:
            obj.select_set(obj in v2_objects)
        bpy.context.view_layer.objects.active = v2
        out_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(out_path), export_format='GLB', use_selection=True,
            export_animations=True, export_animation_mode='ACTIVE_ACTIONS', export_frame_range=True,
            export_force_sampling=True, export_optimize_animation_size=False, export_skins=True)
        if not out_path.is_file():
            raise RuntimeError('Exporter did not produce a GLB')
        report = {'version': 1, 'status': 'candidate-unreviewed', 'clip': clip,
                  'source_action': source_name, 'source_paths': {'v1': str(v1_path), 'v2': str(v2_path)},
                  'source_sha256': hashes, 'output_sha256': hashlib.sha256(out_path.read_bytes()).hexdigest(),
                  'target_reference_wxyz': {name: list(q) for name, q in target_reference.items()},
                  'donor_reference_wxyz': {name: list(q) for name, q in donor_reference.items()},
                  'pose_calibration': 'Transfer cyclic deviations around the V2 phase-zero pose, excluding donor static fold bias',
                  'mirror_policy': 'reflect left cruise only; preserve independent native bilateral bank performance',
                  'phase_offset_cycles': phase_offset, 'source_elevation': source_elevation, 'target_elevation': target_elevation,
                  'recipe': recipe, 'fps': 24, 'sample_count': frames + 1,
                  'coordinate_frame': 'Blender GLTF importer-normalized armature space; no extra 100x conversion',
                  'pair_limit_rig_units': MAX_PAIR_DISTANCE, 'pairs': pairs,
                  'transferred_bones': [name for name in names if any(f'D{digit}P' in name for digit in range(1, 5))],
                  'preserved': 'V2 arm chain/leading D0/body/root/legs/jaw/wing roots/panels/D5; all non-rotation tracks',
                  'distal_repair_reference': 'tools/blender/author_v2_bank_clips.py wing_weights and 24..82 degree recovery blend',
                  'loop_correction_rad': {name: corrections[name].angle for name in names},
                  'raw_samples': raw_samples}
        out_path.with_suffix('.harvest.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f'[HARVEST] Baked {len(names)} verified joints into {out_path}; candidate requires visual qualification')
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--v1-source', type=Path, required=True)
    parser.add_argument('--v2-source', type=Path, required=True)
    parser.add_argument('--clip', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--wing-only', action='store_true')
    parser.add_argument('--performance', choices=['landing-window', 'player-cruise', 'player-bank'], required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    if bpy is None or not bpy.app.background:
        raise RuntimeError('CLI requires a dedicated headless Blender process')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    run_harvest(args.v1_source, args.v2_source, args.clip, args.out, args.wing_only, args.performance)


if __name__ == '__main__':
    main()
