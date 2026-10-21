import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, encodeGlb } from './runtime_rig_contract.mjs';

export const PANEL_NAMES = ['L','R'].flatMap(side=>Array.from({length:4},(_,panel)=>[`${side}_WingPanel${panel}_0`,`${side}_WingPanel${panel}_1`]).flat());
export const WING_CHAIN_NAMES = ['L','R'].flatMap(side=>[
  'WingRoot','WingShoulder','WingElbow','WingWrist','WingHand',
  ...Array.from({length:6},(_,d)=>[`WingD${d}P0`,`WingD${d}P1`,`WingD${d}P2`]).flat()
].map(part=>`${side}_${part}`));
export const NECK_HEAD_NAMES = ['Neck1','Neck2','Head'];

export function splicePanelChannels(baseBytes, donorBytes, clipName, extraRotationNodes = []) {
  const {gltf:base,binary:baseBinary}=readGlb(baseBytes), {gltf:donor,binary:donorBinary}=readGlb(donorBytes);
  assert.equal(donor.animations.length,1,'Expected one donor action');
  const animation=base.animations.find(a=>a.name===clipName);assert.ok(animation,'Missing target clip');
  const source=donor.animations[0], targets=new Map(base.nodes.map((n,i)=>[n.name,i]));
  const extraSet=new Set(extraRotationNodes);
  const selected=source.channels.filter(c=>{
    const nodeName=donor.nodes[c.target.node].name;
    if(PANEL_NAMES.includes(nodeName)&&['rotation','translation'].includes(c.target.path))return true;
    if(extraSet.has(nodeName)&&c.target.path==='rotation')return true;
    return false;
  });
  const keys=new Set();
  for(const channel of selected){const key=`${donor.nodes[channel.target.node].name}:${channel.target.path}`;assert.ok(!keys.has(key),'Duplicate panel channel');keys.add(key);}
  for(const name of PANEL_NAMES)assert.ok(keys.has(`${name}:rotation`),'Missing panel rotation');
  animation.channels=animation.channels.filter(c=>!keys.has(`${base.nodes[c.target.node].name}:${c.target.path}`));
  const chunks=[baseBinary],views=new Map(),accessors=new Map();let length=baseBinary.length;
  function copyAccessor(index){
    if(accessors.has(index))return accessors.get(index);
    const a=donor.accessors[index],v=donor.bufferViews[a.bufferView];assert.ok(!a.sparse&&!v.extensions?.EXT_meshopt_compression,'Unsupported donor accessor');assert.equal(v.buffer,0);
    if(!views.has(a.bufferView)){
      const padding=(4-length%4)%4;chunks.push(Buffer.alloc(padding));length+=padding;
      views.set(a.bufferView,base.bufferViews.length);base.bufferViews.push({...v,byteOffset:length});
      const data=donorBinary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);assert.equal(data.length,v.byteLength);chunks.push(data);length+=data.length;
    }
    const next=base.accessors.length;base.accessors.push({...a,bufferView:views.get(a.bufferView)});accessors.set(index,next);return next;
  }
  for(const channel of selected){
    const node=targets.get(donor.nodes[channel.target.node].name);assert.notEqual(node,undefined,'Unmapped panel');
    const sampler=source.samplers[channel.sampler],index=animation.samplers.length;
    animation.samplers.push({...sampler,input:copyAccessor(sampler.input),output:copyAccessor(sampler.output)});
    animation.channels.push({...channel,sampler:index,target:{...channel.target,node}});
  }
  chunks.push(Buffer.alloc((4-length%4)%4));base.buffers[0].byteLength=Math.ceil(length/4)*4;
  return encodeGlb(base,Buffer.concat(chunks));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [basePath,donorPath,output,clip='cruise']=process.argv.slice(2);assert.ok(basePath&&donorPath&&output,'Pass base, isolated donor and fresh output');assert.ok(!existsSync(output),'Preserve existing output');
  const base=readFileSync(basePath),donor=readFileSync(donorPath),candidate=splicePanelChannels(base,donor,clip);
  writeFileSync(output,candidate);const hash=b=>createHash('sha256').update(b).digest('hex');
  writeFileSync(output.replace(/\.glb$/,'.panels.json'),JSON.stringify({status:'experiment',clip,base_path:resolve(basePath),base_sha256:hash(base),donor_path:resolve(donorPath),donor_sha256:hash(donor),output_sha256:hash(candidate),panel_names:PANEL_NAMES,preserved:'all binary data, geometry, skin weights, skeleton, non-panel channels and other clips'},null,2));
}
