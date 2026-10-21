import bpy
import argparse
import sys

if not bpy.app.background:
    raise RuntimeError("Review rendering requires a dedicated headless Blender process")
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--candidate',type=Path,required=True)
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--baseline',type=Path,default=ROOT/'public/models/wyvern-v2-rig.glb')
parser.add_argument('--clip',choices=['cruise','bankLeft','bankRight'],default='cruise')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
OUT=args.out.resolve()
OUT.mkdir(parents=True,exist_ok=True)
for label,path in [('baseline',args.baseline.resolve()),('candidate',args.candidate.resolve())]:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 import subprocess
 decoded=Path('/tmp')/f'render-harvest-{label}.glb'
 subprocess.run(['node',str(ROOT/'tools/blender/decode_meshopt_glb.mjs'),str(path),str(decoded)],check=True)
 bpy.ops.import_scene.gltf(filepath=str(decoded))
 arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
 arm.animation_data.action=bpy.data.actions[args.clip];arm.animation_data.use_nla=False
 for obj in bpy.data.objects:
  if obj.type=='MESH':
   obj.data.materials.clear()
   mat=bpy.data.materials.new('Inspection clay');mat.diffuse_color=(0.42,0.48,0.54,1);obj.data.materials.append(mat)
 scene=bpy.context.scene
 scene.render.engine='CYCLES';scene.cycles.samples=8;scene.cycles.use_denoising=True;scene.cycles.device='CPU'
 scene.world=bpy.data.worlds.new('Inspection world');scene.world.use_nodes=True
 scene.world.node_tree.nodes['Background'].inputs[0].default_value=(0.12,0.14,0.18,1)
 scene.world.node_tree.nodes['Background'].inputs[1].default_value=0.6
 light=bpy.data.lights.new('Inspection key','AREA');light.energy=40000000;light.shape='DISK';light.size=3500
 obj=bpy.data.objects.new('Inspection key',light);scene.collection.objects.link(obj);obj.location=(1800,-2500,3500);obj.rotation_euler=(Vector((0,0,700))-obj.location).to_track_quat('-Z','Y').to_euler()
 cam=bpy.data.cameras.new('Matched front');cam.type='ORTHO';cam.ortho_scale=8000;cam.clip_end=20000
 obj=bpy.data.objects.new('Matched front',cam);scene.collection.objects.link(obj);obj.location=(0,-4200,2300);obj.rotation_euler=(Vector((0,100,1200))-obj.location).to_track_quat('-Z','Y').to_euler();scene.camera=obj
 for ratio,w,h in [('16x9',640,360),('3x2',600,400)]:
  scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.resolution_percentage=100
  for frame in range(0,48,6):
   scene.frame_set(frame);scene.render.filepath=str(OUT/f'{label}-{ratio}-{frame:02}.png');bpy.ops.render.render(write_still=True)
 print('RENDERED',label)
