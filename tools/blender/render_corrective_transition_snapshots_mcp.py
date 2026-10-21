import bpy,json
from pathlib import Path
from mathutils import Vector
folder=Path('/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/runtime-authored-normals-096')
data=json.loads((folder/'transition-snapshots.json').read_text())
source=bpy.data.scenes['V2 Optimized 14-bit Review']
scene=bpy.data.scenes.new('V2 Runtime Transition Snapshots')
bpy.context.window.scene=scene
scene.world=source.world
scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.image_settings.file_format='PNG'
for field in ['view_transform','look','exposure','gamma']:setattr(scene.view_settings,field,getattr(source.view_settings,field))
for original in source.objects:
    if original.type in ['CAMERA','LIGHT']:
        obj=original.copy();obj.data=original.data.copy();scene.collection.objects.link(obj)
        if obj.type=='CAMERA':scene.camera=obj
scene.camera.data.ortho_scale=8000
scene.camera.location=(0,-4200,2300)
scene.camera.rotation_euler=(Vector((0,100,1200))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
objects=[]
for index,topology in enumerate(data['topology']):
    mesh=bpy.data.meshes.new('Runtime snapshot '+topology['name'])
    faces=[topology['indices'][i:i+3] for i in range(0,len(topology['indices']),3)]
    mesh.from_pydata(data['snapshots'][0]['positions'][index],[],faces);mesh.update()
    obj=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(obj)
    material=bpy.data.materials['V2 panel inspection clay.001' if 'Membrane' in topology['name'] else 'V2 panel inspection clay']
    mesh.materials.append(material)
    for polygon in mesh.polygons:polygon.use_smooth=True
    objects.append(obj)
right=scene.camera.rotation_euler.to_quaternion()@Vector((1,0,0))
up=scene.camera.rotation_euler.to_quaternion()@Vector((0,1,0))
points=[Vector(v) for snapshot in data['snapshots'] for positions in snapshot['positions'] for v in positions]
x=[v.dot(right) for v in points];y=[v.dot(up) for v in points]
scene.camera.location+=right*((min(x)+max(x))/2-scene.camera.location.dot(right))+up*((min(y)+max(y))/2-scene.camera.location.dot(up))
scene.camera.data.ortho_scale=max(max(x)-min(x),(max(y)-min(y))*16/9)*1.05
rendered=[]
for index,snapshot in enumerate(data['snapshots']):
    for obj,positions in zip(objects,snapshot['positions']):
        obj.data.vertices.foreach_set('co',[v for point in positions for v in point]);obj.data.update()
    bpy.context.view_layer.update()
    for ratio,resolution in [('16x9',(960,540)),('3x2',(900,600))]:
        scene.render.resolution_x,scene.render.resolution_y=resolution;scene.render.resolution_percentage=100
        name=f"transition-{ratio}-{index:02}-{snapshot['from']}-{snapshot['to']}-{snapshot['elapsed']:.2f}.png"
        scene.render.filepath=str(folder/name);bpy.ops.render.render(write_still=True);rendered.append(name)
scene['snapshot_candidate_sha256']=data['candidate_sha256']
scene['snapshot_scope']='Exact runtime positions; Blender recomputed clay normals, not runtime shader normals'
bpy.ops.wm.save_as_mainfile(filepath=str(folder/'v2-runtime-transition-snapshot-study.blend'),copy=True)
(folder/'transition-render-manifest.json').write_text(json.dumps({'candidate_sha256':data['candidate_sha256'],'renders':rendered,'snapshots':[{k:v for k,v in s.items() if k!='positions'} for s in data['snapshots']],'scope':scene['snapshot_scope']},indent=2))
result={'scene':scene.name,'renders':len(rendered),'blend':str(folder/'v2-runtime-transition-snapshot-study.blend')}
