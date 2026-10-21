import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlb, encodeGlb } from './runtime_rig_contract.mjs';
import { validateCorrectiveMorphs } from './package_corrective_morphs.mjs';
const [source,input,output]=process.argv.slice(2);
assert.ok(source&&input&&output);
const bits=process.argv[5]===undefined?null:Number(process.argv[5]);
assert.ok(bits===null||(Number.isInteger(bits)&&bits>=1&&bits<=24),"Meshopt exponential filter requires 1 to 24 bits");
const base=readFileSync(source),candidate=readFileSync(input);
validateCorrectiveMorphs(base,candidate);
const require=createRequire(import.meta.url),dependency=createRequire(require.resolve('@types/three/package.json'));
const {MeshoptEncoder}=await import(pathToFileURL(dependency.resolve('meshoptimizer')).href);
await MeshoptEncoder.ready;
const {gltf:g,binary:b}=readGlb(candidate),{gltf:old,binary:original}=readGlb(base);
assert.ok(g.extensionsRequired.includes('EXT_meshopt_compression'));
const chunks=[original];let length=original.length;
for(let i=old.bufferViews.length;i<g.bufferViews.length;i++){
  const view=g.bufferViews[i];assert.ok(!view.extensions);
  const a=g.accessors.find(x=>x.bufferView===i);assert.ok(a);
  const stride=a.type==='VEC3'?12:4;
  const raw=b.subarray(view.byteOffset,view.byteOffset+view.byteLength);
  assert.equal(raw.length,a.count*stride);
  const filter=bits!==null&&a.type==='VEC3'?'EXPONENTIAL':'NONE';
  const values=Float32Array.from({length:raw.length/4},(_,j)=>raw.readFloatLE(j*4));
  const filtered=filter==='EXPONENTIAL'?MeshoptEncoder.encodeFilterExp(values,a.count,stride,bits,'SharedComponent'):raw;
  const encoded=Buffer.from(MeshoptEncoder.encodeGltfBuffer(filtered,a.count,stride,'ATTRIBUTES'));
  const decoded=Buffer.alloc(raw.length);
  MeshoptDecoder.decodeGltfBuffer(decoded,a.count,stride,encoded,'ATTRIBUTES',filter);
  if(filter==='NONE')assert.ok(decoded.equals(raw),'Lossless corrective compression altered an accessor');
  else {
    assert.ok(Array.from({length:decoded.length/4},(_,j)=>decoded.readFloatLE(j*4)).every(Number.isFinite));
    if(a.min&&a.max){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let j=0;j<decoded.length/4;j++){const x=decoded.readFloatLE(j*4),k=j%3;a.min[k]=Math.min(a.min[k],x);a.max[k]=Math.max(a.max[k],x);}}
  }
  const padding=(4-length%4)%4;chunks.push(Buffer.alloc(padding));length+=padding;
  view.extensions={EXT_meshopt_compression:{buffer:0,byteOffset:length,byteLength:encoded.length,byteStride:stride,count:a.count,mode:'ATTRIBUTES',filter}};
  view.byteOffset=0;chunks.push(encoded);length+=encoded.length;
}
const padding=(4-length%4)%4;chunks.push(Buffer.alloc(padding));length+=padding;
g.buffers[0].byteLength=length;
const result=encodeGlb(g,Buffer.concat(chunks));
const report=validateCorrectiveMorphs(base,result);
writeFileSync(output,result,{flag:'wx'});
console.log(JSON.stringify({...report,input_bytes:candidate.length,compression:bits===null?'lossless EXT_meshopt_compression':`meshopt exponential ${bits}-bit morph precision; original source unchanged`},null,2));
