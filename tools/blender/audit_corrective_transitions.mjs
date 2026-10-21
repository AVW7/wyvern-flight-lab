import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AnimationMixer, LoopOnce, LoopRepeat, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlb, encodeGlb } from './runtime_rig_contract.mjs';
import { validateCorrectiveMorphs } from './package_corrective_morphs.mjs';
const [source,candidate,output,mutant]=process.argv.slice(2),baseBytes=readFileSync(source),candidateBytes=readFileSync(candidate);
validateCorrectiveMorphs(baseBytes,candidateBytes);
async function load(bytes){const {gltf:g,binary:b}=readGlb(bytes);for(const m of g.meshes)for(const p of m.primitives)delete p.material;delete g.materials;delete g.images;delete g.textures;const clean=encodeGlb(g,b);const data=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(clean.buffer.slice(clean.byteOffset,clean.byteOffset+clean.byteLength),'');return {...data,mesh:data.scene.getObjectByName('WyvernMembrane_ExportSafe')};}
const base=await load(baseBytes),corrected=await load(candidateBytes),position=base.mesh.geometry.attributes.position,groups=new Map();
for(let i=0;i<position.count;i++){const key=[position.getX(i),position.getY(i),position.getZ(i)].join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
const paired=[...groups.values()].filter(ids=>ids.length>1);
if(mutant==='open-seam'){const attribute=corrected.mesh.geometry.morphAttributes.position[0],index=paired[0][1];attribute.setX(index,attribute.getX(index)+1);}
function pose(model,target,phase,weight){
 const mixer=new AnimationMixer(model.scene);
 for(const [name,w] of [['cruise',1-weight],[target,weight]]){const clip=model.animations.find(a=>a.name===name),action=mixer.clipAction(clip).setLoop(LoopOnce,1);action.clampWhenFinished=true;action.setEffectiveWeight(w).play();action.time=name==='cruise'?phase*clip.duration:0;}
 mixer.update(0);model.scene.updateMatrixWorld(true);model.mesh.skeleton.update();
 const vertices=Array.from({length:position.count},(_,i)=>model.mesh.getVertexPosition(i,new Vector3()).applyMatrix4(model.mesh.matrixWorld));
 const bones=model.mesh.skeleton.bones.map(b=>b.matrixWorld.toArray()),influences=[...(model.mesh.morphTargetInfluences??[])];
 mixer.stopAllAction();mixer.uncacheRoot(model.scene);return {vertices,bones,influences};
}
const samples=[];
for(const target of base.animations.filter(a=>a.name!=='cruise').map(a=>a.name))for(let phase=0;phase<8;phase++)for(const weight of [0,.25,.5,.75,1]){
 const a=pose(base,target,phase/8,weight),b=pose(corrected,target,phase/8,weight);
 let boneError=0,seamGap=0,baselineGap=0,displacement=0,extent=0;
 for(let i=0;i<a.bones.length;i++)for(let k=0;k<16;k++)boneError=Math.max(boneError,Math.abs(a.bones[i][k]-b.bones[i][k]));
 for(let i=0;i<position.count;i++){assert.ok(b.vertices[i].toArray().every(Number.isFinite));displacement=Math.max(displacement,a.vertices[i].distanceTo(b.vertices[i]));extent=Math.max(extent,...b.vertices[i].toArray().map(Math.abs));}
 for(const ids of paired)for(const i of ids.slice(1)){seamGap=Math.max(seamGap,b.vertices[i].distanceTo(b.vertices[ids[0]]));baselineGap=Math.max(baselineGap,a.vertices[i].distanceTo(a.vertices[ids[0]]));}
 const roundingBound=Number.EPSILON*extent*64;
 assert.equal(boneError,0,'Correction must preserve blended skeleton motion');assert.ok(seamGap<=baselineGap+roundingBound,'Correction opens a skin seam');
 if(weight===1){assert.ok(b.influences.every(v=>v===0));assert.equal(displacement,0,'Fully transitioned clips must retain original geometry');}
 samples.push({target,cruise_phase:phase/8,target_start_weight:weight,bone_error:boneError,seam_gap:seamGap,baseline_seam_gap:baselineGap,max_correction_displacement:displacement});
}
const timed=[];
for(const target of base.animations.filter(a=>a.name!=='cruise').map(a=>a.name))for(const direction of ['out','in'])for(const fade of [.24,.16])for(const phase of [0,.25,.5,.75]){
 const models=[base,corrected],mixers=models.map(model=>{
  const mixer=new AnimationMixer(model.scene),from=model.animations.find(a=>a.name===(direction==='out'?'cruise':target)),to=model.animations.find(a=>a.name===(direction==='out'?target:'cruise'));
  const old=mixer.clipAction(from).setLoop(LoopRepeat,Infinity).play();old.time=phase*from.duration;mixer.update(0);
  const next=mixer.clipAction(to).reset().setEffectiveWeight(1).setLoop(LoopRepeat,Infinity).play();next.crossFadeFrom(old,fade,true);return mixer;
 });
 let seamGap=0,boneError=0,endDisplacement=0,endMorphWeight=0;
 for(let step=0;step<=Math.ceil(fade*60)+2;step++){
  mixers.forEach((m,i)=>{m.update(step===0?0:1/60);models[i].scene.updateMatrixWorld(true);models[i].mesh.skeleton.update();});
  for(let i=0;i<base.mesh.skeleton.bones.length;i++){const a=base.mesh.skeleton.bones[i].matrixWorld.elements,b=corrected.mesh.skeleton.bones[i].matrixWorld.elements;for(let k=0;k<16;k++)boneError=Math.max(boneError,Math.abs(a[k]-b[k]));}
  for(const ids of paired){const first=corrected.mesh.getVertexPosition(ids[0],new Vector3());for(const i of ids.slice(1))seamGap=Math.max(seamGap,first.distanceTo(corrected.mesh.getVertexPosition(i,new Vector3())));}
  if(step===Math.ceil(fade*60)+2&&direction==='out'){
   endMorphWeight=Math.max(...corrected.mesh.morphTargetInfluences.map(Math.abs));
   for(let i=0;i<position.count;i++)endDisplacement=Math.max(endDisplacement,base.mesh.getVertexPosition(i,new Vector3()).distanceTo(corrected.mesh.getVertexPosition(i,new Vector3())));
  }
 }
 mixers.forEach((m,i)=>{m.stopAllAction();m.uncacheRoot(models[i].scene);});
 timed.push({target,direction,fade_seconds:fade,phase,max_seam_gap:seamGap,max_bone_error:boneError,end_displacement:endDisplacement,end_morph_weight:endMorphWeight});
}
const timedFailures=timed.filter(s=>s.max_seam_gap!==0||s.max_bone_error!==0||s.end_displacement!==0||s.end_morph_weight!==0);
const report={source_sha256:createHash('sha256').update(baseBytes).digest('hex'),candidate_sha256:createHash('sha256').update(candidateBytes).digest('hex'),paired_vertex_groups:paired.length,samples:samples.length,max_seam_gap:Math.max(...samples.map(s=>s.seam_gap)),max_bone_error:Math.max(...samples.map(s=>s.bone_error)),max_correction_displacement:Math.max(...samples.map(s=>s.max_correction_displacement)),scope:'Static blends and timed warped Three.js crossfades at 60 Hz; no visual acceptance',fade_provenance:'src/flight-lab/runtime.ts:309 default 0.24 seconds and :971 one-shot 0.16 seconds',timed_samples:timed.length,timed_failures:timedFailures.length,timed_measurements:timed,measurements:samples};writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,measurements:undefined,timed_measurements:undefined},null,2));assert.equal(timedFailures.length,0,'Timed crossfades must preserve seams, bones and complete correction resets');
