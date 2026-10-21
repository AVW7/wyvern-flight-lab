import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { AnimationMixer, LoopOnce, Vector3, Matrix3, Matrix4 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlb, encodeGlb } from './runtime_rig_contract.mjs';
import { validateCorrectiveMorphs } from './package_corrective_morphs.mjs';
const [source,path,directory]=process.argv.slice(2),bytes=readFileSync(path);
const preservation=validateCorrectiveMorphs(readFileSync(source),bytes);
const {gltf:g,binary}=readGlb(bytes);
for(const m of g.meshes)for(const p of m.primitives)delete p.material;
delete g.materials;delete g.images;delete g.textures;
const stripped=encodeGlb(g,binary);
const {scene,animations}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(stripped.buffer.slice(stripped.byteOffset,stripped.byteOffset+stripped.byteLength),'');
const mesh=scene.getObjectByName('WyvernMembrane_ExportSafe'),report=JSON.parse(readFileSync(`${directory}/basis-report.json`));
assert.ok(mesh?.isSkinnedMesh);assert.equal(mesh.morphTargetInfluences.length,report.total_targets);
const preservedNormals=report.normal_policy==='preserve source authored normals';
if(preservedNormals)for(const attribute of mesh.geometry.morphAttributes.normal??[])assert.ok(attribute.array.every(v=>v===0),'Authored normal policy requires zero normal deltas');
const runtimePose=process.argv[5]==='runtime-pose';
const subframes=process.argv[5]==='subframes'||runtimePose;
const prefix=runtimePose?'runtime-pose-reference':subframes?'subframe-reference':'reference';
const sampleFrames=subframes?JSON.parse(readFileSync(`${directory}/${runtimePose?'runtime-pose-reference':'subframe-samples'}.json`)).frames:Array.from({length:report.frames},(_,i)=>i);
const reference=readFileSync(`${directory}/${prefix}-positions.bin`),mixer=new AnimationMixer(scene);
const cruise=animations.find(a=>a.name==='cruise'),action=mixer.clipAction(cruise).setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
const normalReference=preservedNormals?null:readFileSync(`${directory}/${prefix}-normals.bin`);
let max=0,sum=0,count=0,normalMax=0,normalWorst=null;const frames=[];
for(let frame=0;frame<sampleFrames.length;frame++){
  mixer.setTime(sampleFrames[frame]/report.fps);scene.updateMatrixWorld(true);mesh.skeleton.update();let frameMax=0,frameNormalMax=0,normalFailures=0;
  for(let i=0;i<report.vertices;i++){
    const actual=mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld);
    const offset=(frame*report.vertices+i)*12;
    const expected=new Vector3(reference.readFloatLE(offset),reference.readFloatLE(offset+8),-reference.readFloatLE(offset+4));
    const n=new Vector3().fromBufferAttribute(mesh.geometry.attributes.normal,i),sourceNormal=n.clone();
    if(!preservedNormals)for(let k=0;k<mesh.morphTargetInfluences.length;k++)n.addScaledVector(new Vector3().fromBufferAttribute(mesh.geometry.morphAttributes.normal[k],i),mesh.morphTargetInfluences[k]);
    const skin=new Matrix4();skin.elements.fill(0);
    for(let k=0;k<4;k++){const weight=mesh.geometry.attributes.skinWeight.getComponent(i,k),joint=mesh.geometry.attributes.skinIndex.getComponent(i,k);for(let j=0;j<16;j++)skin.elements[j]+=mesh.skeleton.boneMatrices[joint*16+j]*weight;}
    skin.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
    n.applyMatrix3(new Matrix3().setFromMatrix4(skin)).applyMatrix3(new Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
    const geometricExpectedN=preservedNormals?null:new Vector3(normalReference.readFloatLE(offset),normalReference.readFloatLE(offset+8),-normalReference.readFloatLE(offset+4)).normalize();
    const expectedN=preservedNormals?sourceNormal.applyMatrix3(new Matrix3().setFromMatrix4(skin)).applyMatrix3(new Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize():geometricExpectedN;
    const normalError=Math.max(Math.abs(n.x-expectedN.x),Math.abs(n.y-expectedN.y),Math.abs(n.z-expectedN.z));
    if(normalError>normalMax)normalWorst={frame:sampleFrames[frame],vertex:i,actual:n.toArray(),expected:expectedN.toArray()};
    normalMax=Math.max(normalMax,normalError);frameNormalMax=Math.max(frameNormalMax,normalError);if(normalError>report.normal_error_bound)normalFailures++;
    const error=actual.distanceTo(expected);frameMax=Math.max(frameMax,error);sum+=error;count++;
  }
  max=Math.max(max,frameMax);frames.push({frame:sampleFrames[frame],max_position_error:frameMax,max_normal_component_error:frameNormalMax,normal_failing_vertices:normalFailures});
}
mixer.stopAllAction();
for(const clip of animations.filter(a=>a.name!=='cruise')){
  mixer.clipAction(cruise).play();mixer.setTime(0.75);mixer.stopAllAction();mixer.clipAction(clip).play();mixer.setTime(clip.duration/2);
  assert.ok(mesh.morphTargetInfluences.every(x=>x===0),`${clip.name} correction leaked`);mixer.stopAllAction();
}
const result={...preservation,frames:frames.length,max_position_error:max,mean_position_error:sum/count,position_bound:report.position_error_bound_rig_units,position_pass:max<=report.position_error_bound_rig_units,normal_reference:preservedNormals?'unchanged source authored shader normals':'evaluated Blender geometry normals',max_normal_component_error:normalMax,worst_normal:normalWorst,normal_bound:report.normal_error_bound,normal_pass:normalMax<=report.normal_error_bound,non_cruise_resets:animations.length-1,samples:frames};
writeFileSync(`${directory}/${runtimePose?'runtime-pose-audit':subframes?'runtime-subframe-audit':'runtime-position-audit'}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,samples:undefined},null,2));
assert.ok(result.position_pass,'Runtime positional tolerance failed');
assert.ok(result.normal_pass,'Runtime normal tolerance failed');
