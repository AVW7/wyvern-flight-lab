import bpy
import json
from pathlib import Path
from mathutils import Vector, geometry

OUT = Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/mcp-study')
rig = bpy.data.objects['WyvernRig']
original = bpy.data.objects['WyvernMembrane_ExportSafe.001']
assert not bpy.data.objects.get('V2_ContinuousDigitGrid_Membrane')
mesh = original.copy()
mesh.data = original.data.copy()
mesh.name = 'V2_ContinuousDigitGrid_Membrane'
bpy.context.scene.collection.objects.link(mesh)
original.hide_render = True
original.hide_set(True)

triangles = {'L': [], 'R': []}
for side in triangles:
    grid = []
    for digit in range(5):
        column = [(rig.data.bones[f'{side}_WingD{digit}P{segment}'].head_local.copy(), f'{side}_WingD{digit}P{segment}') for segment in range(3)]
        column.append((rig.data.bones[f'{side}_WingD{digit}P2'].tail_local.copy(), f'{side}_WingD{digit}P2'))
        grid.append(column)
    for digit in range(4):
        for segment in range(3):
            a, b, c, d = grid[digit][segment], grid[digit + 1][segment], grid[digit][segment + 1], grid[digit + 1][segment + 1]
            triangles[side].extend([(a, b, c), (b, d, c)])

names = {g.index: g.name for g in mesh.vertex_groups}
groups = {}
for v in mesh.data.vertices:
    groups.setdefault(tuple(v.co), []).append(v.index)
changed = []
records = []
for ids in groups.values():
    v = mesh.data.vertices[ids[0]]
    dominant = names[max(v.groups, key=lambda w: w.weight).group]
    if not ('WingPanel' in dominant or any(f'WingD{digit}P' in dominant for digit in range(5))):
        continue
    side = dominant[0]
    candidates = []
    for triangle in triangles[side]:
        a, b, c = [entry[0] for entry in triangle]
        if (b - a).cross(c - a).length_squared == 0:
            continue
        closest = geometry.closest_point_on_tri(v.co, a, b, c)
        candidates.append(((closest - v.co).length_squared, closest, triangle))
    distance, closest, triangle = min(candidates, key=lambda entry: entry[0])
    a, b, c = [entry[0] for entry in triangle]
    bary = geometry.barycentric_transform(closest, a, b, c, Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
    influence = {}
    for entry, weight in zip(triangle, bary):
        influence[entry[1]] = influence.get(entry[1], 0.0) + max(0.0, float(weight))
    total = sum(influence.values())
    influence = {name: weight / total for name, weight in influence.items() if weight > 0}
    assert len(influence) <= 3
    for index in ids:
        vertex = mesh.data.vertices[index]
        for weight in list(vertex.groups):
            mesh.vertex_groups[weight.group].remove([index])
        for name, weight in influence.items():
            mesh.vertex_groups[name].add([index], weight, 'REPLACE')
        changed.append(index)
    records.append({'vertex_indices': ids, 'rest_position': list(v.co), 'weights': influence, 'projection_distance': distance ** 0.5})

rig.animation_data.action = bpy.data.actions['cruise.001']
bpy.context.scene.frame_set(18)
bpy.context.view_layer.update()
report = {'status': 'experiment', 'source_mesh': original.name, 'candidate_mesh': mesh.name,
          'method': 'barycentric weights on a continuous rest-bone digit grid; at most three influences',
          'selection': 'original dominant group is D0..D4 or panel; coincident groups treated together',
          'changed_vertices': len(changed), 'total_vertices': len(mesh.data.vertices), 'records': records,
          'all_rest_positions': [list(v.co) for v in mesh.data.vertices]}
(OUT / 'digit-grid-weights.json').write_text(json.dumps(report))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'v2-digit-grid-mcp.blend'))
bpy.context.scene.render.filepath = str(OUT / 'evidence/digit-grid-3x2-18.png')
bpy.ops.render.render(write_still=True)
result = {key: value for key, value in report.items() if key not in ['records', 'all_rest_positions']}
