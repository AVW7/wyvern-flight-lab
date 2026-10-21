import bpy
import json
from pathlib import Path
OUT=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/mcp-study')
rig=bpy.data.objects['WyvernRig'];original=bpy.data.objects['WyvernMembrane_ExportSafe.001'];corrective=bpy.data.objects['V2_CorrectiveSurface_Membrane']
original.hide_set(False);corrective.hide_set(False)
groups={}
for v in original.data.vertices:groups.setdefault(tuple(v.co),[]).append(v.index)
paired=[ids for ids in groups.values() if len(ids)>1]
report={'samples':[],'paired_groups':len(paired),'modifier':{'type':'CORRECTIVE_SMOOTH','factor':corrective.modifiers[-1].factor,'iterations':corrective.modifiers[-1].iterations,'pin_boundary':corrective.modifiers[-1].use_pin_boundary}}
for clip in ['cruise','walk']:
 rig.animation_data.action=bpy.data.actions[f'{clip}.001'];end=int(rig.animation_data.action.frame_range[1])
 for frame in [round(end*i/8) for i in range(8)]:
  bpy.context.scene.frame_set(frame);dg=bpy.context.evaluated_depsgraph_get();entry={'clip':clip,'frame':frame}
  for label,obj in [('baseline',original),('corrective',corrective)]:
   evaluated=obj.evaluated_get(dg);mesh=evaluated.to_mesh();mesh.calc_loop_triangles()
   entry[label]={'positions':[list(v.co) for v in mesh.vertices],'indices':[i for t in mesh.loop_triangles for i in t.vertices],'max_paired_distance':max(((mesh.vertices[i].co-mesh.vertices[ids[0]].co).length for ids in paired for i in ids),default=0)}
   evaluated.to_mesh_clear()
  report['samples'].append(entry)
(OUT/'corrective-posed-surfaces.json').write_text(json.dumps(report))
result={'samples':len(report['samples']),'paired_groups':len(paired),'max_baseline_paired_distance':max(x['baseline']['max_paired_distance'] for x in report['samples']),'max_corrective_paired_distance':max(x['corrective']['max_paired_distance'] for x in report['samples'])}
