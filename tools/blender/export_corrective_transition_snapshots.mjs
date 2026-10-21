import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AnimationMixer, LoopRepeat, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlb, encodeGlb } from './runtime_rig_contract.mjs';
const [input,output]=process.argv.slice(2),bytes=readFileSync(input),{gltf,binary}=readGlb(bytes);
for(const mesh of gltf.meshes)for(const primitive of mesh.primitives)delete primitive.material;
delete gltf.materials;delete gltf.images;delete gltf.textures;
const clean=encodeGlb(gltf,binary),model=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(clean.buffer.slice(clean.byteOffset,clean.byteOffset+clean.byteLength),'');
const meshes=[];model.scene.traverse(o=>{if(o.isMesh)meshes.push(o);});
const topology=meshes.map(mesh=>({name:mesh.name,indices:Array.from(mesh.geometry.index.array)})),snapshots=[];
for(const [from,to] of [['cruise','bankLeft'],['cruise','walk'],['cruise','land'],['takeoff','cruise']]){
 const mixer=new AnimationMixer(model.scene),oldClip=model.animations.find(a=>a.name===from),old=mixer.clipAction(oldClip).setLoop(LoopRepeat,Infinity).play();old.time=oldClip.duration*.25;mixer.update(0);
 const next=mixer.clipAction(model.animations.find(a=>a.name===to)).reset().setEffectiveWeight(1).setLoop(LoopRepeat,Infinity).play();next.crossFadeFrom(old,.24,true);
 let previous=0;
 for(const elapsed of [0,.12,.28]){
  mixer.update(elapsed-previous);previous=elapsed;model.scene.updateMatrixWorld(true);
  const positions=meshes.map(mesh=>{mesh.skeleton?.update();return Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>{const v=mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld);return [v.x,-v.z,v.y];});});
  snapshots.push({from,to,elapsed,positions});
 }
 mixer.stopAllAction();mixer.uncacheRoot(model.scene);
}
writeFileSync(output,JSON.stringify({candidate_sha256:createHash('sha256').update(bytes).digest('hex'),coordinate_conversion:'Three.js world (x,y,z) to Blender (x,-z,y)',fade_seconds:.24,topology,snapshots}));
console.log(`Exported ${snapshots.length} exact posed mesh snapshots`);
