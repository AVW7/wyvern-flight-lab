import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlb, encodeGlb } from './runtime_rig_contract.mjs';
const [path,directory]=process.argv.slice(2),bytes=readFileSync(path),{gltf:g,binary}=readGlb(bytes);
for(const m of g.meshes)for(const p of m.primitives)delete p.material;
delete g.materials;delete g.images;delete g.textures;
const stripped=encodeGlb(g,binary),{scene,animations}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(stripped.buffer.slice(stripped.byteOffset,stripped.byteOffset+stripped.byteLength),'');
scene.updateMatrixWorld(true);
const mesh=scene.getObjectByName('WyvernMembrane_ExportSafe'),bones=mesh.skeleton.bones;
const rest=bones.map(b=>b.matrixWorld.toArray()),mixer=new AnimationMixer(scene),action=mixer.clipAction(animations.find(a=>a.name==='cruise')).setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
const fps=Number(process.argv[4]??48),dense=process.argv[5]==='dense';
const frames=Array.from({length:6*fps+(dense?1:0)},(_,i)=>dense?i:i+0.5),poses=[],positions=Buffer.alloc(frames.length*mesh.geometry.attributes.position.count*12);
for(let f=0;f<frames.length;f++){
 mixer.setTime(frames[f]/fps);scene.updateMatrixWorld(true);mesh.skeleton.update();poses.push(bones.map(b=>b.matrixWorld.toArray()));
 for(let i=0;i<mesh.geometry.attributes.position.count;i++){const v=mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld);[v.x,-v.z,v.y].forEach((x,k)=>positions.writeFloatLE(x,(f*mesh.geometry.attributes.position.count+i)*12+k*4));}
}
writeFileSync(`${directory}/runtime-pose-samples.json`,JSON.stringify({source_sha256:createHash('sha256').update(bytes).digest('hex'),fps,frames,bone_names:bones.map(b=>b.name),rest,poses}));
writeFileSync(`${directory}/runtime-baseline-positions.bin`,positions);
console.log(`Exported ${frames.length} runtime poses and complete baseline vertex references`);
