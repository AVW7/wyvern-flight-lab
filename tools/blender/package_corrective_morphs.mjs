import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { encodeGlb, readGlb } from './runtime_rig_contract.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const equal = (a,b) => assert.deepEqual(a,b,'Original runtime data must be preserved');
function floats(g,b,index) {
  const a=g.accessors[index],v=g.bufferViews[a.bufferView];
  assert.equal(a.componentType,5126);assert.ok(!a.sparse);
  const extension=v.extensions?.EXT_meshopt_compression;
  if(extension){
    assert.equal(extension.buffer,0);
    const decoded=Buffer.alloc(extension.count*extension.byteStride);
    MeshoptDecoder.decodeGltfBuffer(decoded,extension.count,extension.byteStride,b.subarray(extension.byteOffset,extension.byteOffset+extension.byteLength),extension.mode,extension.filter);
    b=decoded;
  }
  const n=a.count*({SCALAR:1,VEC3:3}[a.type]);assert.ok(n);
  return Array.from({length:n},(_,i)=>b.readFloatLE((extension?0:(v.byteOffset??0))+(a.byteOffset??0)+i*4));
}
export async function packageCorrectiveMorphs(baseBytes,report,position,normal,coefficients) {
  assert.equal(hash(baseBytes),report.source_sha256,'Source hash mismatch');
  const {gltf:g,binary:base}=readGlb(baseBytes);
  const node=g.nodes.findIndex(n=>n.name==='WyvernMembrane_ExportSafe');assert.ok(node>=0);
  const mesh=g.meshes[g.nodes[node].mesh],p=mesh.primitives[0];
  assert.equal(mesh.primitives.length,1);assert.ok(!p.targets);
  const {vertices,frames,fps,position_targets:pc,normal_targets:nc}=report,total=pc+nc;
  assert.ok(Number.isInteger(total)&&total>0&&frames>=2&&fps>0);
  assert.equal(g.accessors[p.attributes.POSITION].count,vertices);
  assert.equal(position.length,pc*vertices*12);assert.equal(normal.length,nc*vertices*12);
  assert.equal(coefficients.length,frames*total*4);
  for(const b of [position,normal,coefficients])for(let i=0;i<b.length;i+=4)assert.ok(Number.isFinite(b.readFloatLE(i)),'Non-finite corrective data');
  assert.ok(coefficients.subarray(0,total*4).equals(coefficients.subarray((frames-1)*total*4)),'Corrective loop must close');
  const chunks=[base];let length=base.length;
  function add(bytes,type,count,bounds=false) {
    const view=g.bufferViews.length;g.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});chunks.push(bytes);length+=bytes.length;
    const a={bufferView:view,componentType:5126,type,count};
    if(bounds){const size=type==='VEC3'?3:1;a.min=Array(size).fill(Infinity);a.max=Array(size).fill(-Infinity);for(let i=0;i<bytes.length/4;i++){const x=bytes.readFloatLE(i*4),k=i%size;a.min[k]=Math.min(a.min[k],x);a.max[k]=Math.max(a.max[k],x);}}
    return g.accessors.push(a)-1;
  }
  p.targets=[];
  const mixed=pc>0&&nc>0;
  const zeroPosition=mixed?add(Buffer.alloc(vertices*12),'VEC3',vertices,true):null,zeroNormal=mixed?add(Buffer.alloc(vertices*12),'VEC3',vertices):null;
  for(const [semantic,data,count] of [['POSITION',position,pc],['NORMAL',normal,nc]])for(let i=0;i<count;i++)p.targets.push({...(mixed?{POSITION:zeroPosition,NORMAL:zeroNormal}:{}),[semantic]:add(data.subarray(i*vertices*12,(i+1)*vertices*12),'VEC3',vertices,semantic==='POSITION')});
  mesh.weights=Array(total).fill(0);g.nodes[node].weights=Array(total).fill(0);
  for(const a of g.animations){
    assert.ok(!a.channels.some(c=>c.target.path==='weights'));
    const duration=Math.max(...a.samplers.map(s=>g.accessors[s.input].max[0]));
    const cruise=a.name==='cruise';if(cruise)assert.ok(Math.abs(duration-(frames-1)/fps)<1e-6,'Cruise duration mismatch');
    const times=cruise?Array.from({length:frames},(_,i)=>i/fps):[0,duration];
    const input=add(Buffer.from(new Float32Array(times).buffer),'SCALAR',times.length,true);
    const output=add(cruise?coefficients:Buffer.alloc(2*total*4),'SCALAR',times.length*total);
    a.channels.push({sampler:a.samplers.length,target:{node,path:'weights'}});a.samplers.push({input,output,interpolation:'LINEAR'});
  }
  g.buffers[0].byteLength=length;
  const candidate=encodeGlb(g,Buffer.concat(chunks));validateCorrectiveMorphs(baseBytes,candidate);return candidate;
}
export function validateCorrectiveMorphs(baseBytes,candidateBytes) {
  const {gltf:base,binary:bb}=readGlb(baseBytes),{gltf:g,binary:b}=readGlb(candidateBytes);
  assert.ok(b.subarray(0,bb.length).equals(bb),'Original binary must be preserved');
  const node=base.nodes.findIndex(n=>n.name==='WyvernMembrane_ExportSafe'),mi=base.nodes[node].mesh;
  const targets=g.meshes[mi].primitives[0].targets,total=targets.length;assert.ok(total>0);
  equal(g.nodes[node].weights,Array(total).fill(0));equal(g.meshes[mi].weights,Array(total).fill(0));
  const semantics=['NORMAL','POSITION'].filter(name=>targets.some(target=>name in target));
  assert.ok(semantics.length>0);
  for(const target of targets){equal(Object.keys(target).sort(),semantics);for(const ai of Object.values(target)){const a=g.accessors[ai];assert.ok(ai>=base.accessors.length);assert.equal(a.type,'VEC3');assert.equal(a.count,base.accessors[base.meshes[mi].primitives[0].attributes.POSITION].count);assert.ok(floats(g,b,ai).every(Number.isFinite));}}
  assert.equal(g.animations.length,base.animations.length);
  for(let i=0;i<g.animations.length;i++){
    const a=g.animations[i],old=base.animations[i];assert.equal(a.channels.length,old.channels.length+1);assert.equal(a.samplers.length,old.samplers.length+1);
    const channel=a.channels.at(-1),sampler=a.samplers.at(-1);equal(channel,{sampler:old.samplers.length,target:{node,path:'weights'}});assert.equal(sampler.interpolation,'LINEAR');
    const times=floats(g,b,sampler.input),values=floats(g,b,sampler.output);assert.equal(values.length,times.length*total);assert.ok(values.every(Number.isFinite));assert.equal(times[0],0);assert.ok(times.every((t,k)=>k===0||t>times[k-1]));
    const duration=Math.max(...old.samplers.map(s=>base.accessors[s.input].max[0]));assert.ok(Math.abs(times.at(-1)-duration)<1e-6);
    if(a.name==='cruise')equal(values.slice(0,total),values.slice(-total));else assert.ok(values.every(v=>v===0),'Non-cruise animation requires a zero reset');
    a.channels.pop();a.samplers.pop();
  }
  delete g.nodes[node].weights;delete g.meshes[mi].weights;delete g.meshes[mi].primitives[0].targets;
  g.accessors=g.accessors.slice(0,base.accessors.length);g.bufferViews=g.bufferViews.slice(0,base.bufferViews.length);g.buffers[0].byteLength=base.buffers[0].byteLength;
  equal(g,base);return {targets:total,source_sha256:hash(baseBytes),candidate_sha256:hash(candidateBytes),bytes:candidateBytes.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [source,directory,output]=process.argv.slice(2);assert.ok(source&&directory&&output,'Expected source, bake directory, output');
  const base=readFileSync(source),report=JSON.parse(readFileSync(`${directory}/basis-report.json`));
  const candidate=await packageCorrectiveMorphs(base,report,...['position-basis.bin','normal-basis.bin','morph-coefficients.bin'].map(f=>readFileSync(`${directory}/${f}`)));
  writeFileSync(output,candidate,{flag:'wx'});console.log(JSON.stringify(validateCorrectiveMorphs(base,candidate),null,2));
}
