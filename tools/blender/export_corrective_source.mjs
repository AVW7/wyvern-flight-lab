import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeMeshoptGlb } from './decode_meshopt_glb.mjs';
import { readGlb } from './runtime_rig_contract.mjs';

const [path, output] = process.argv.slice(2);
assert.ok(path && output, 'Pass runtime GLB and extraction JSON');
const bytes = readFileSync(path), { gltf: g, binary } = readGlb(decodeMeshoptGlb(bytes));
const node = g.nodes.find(n => n.name === 'WyvernMembrane_ExportSafe');
assert.ok(node && g.skins.length === 1);
const primitive = g.meshes[node.mesh].primitives[0];
function values(index) {
  const a = g.accessors[index], v = g.bufferViews[a.bufferView];
  assert.ok(!a.sparse);
  const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const size = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType];
  const method = {5120:'readInt8',5121:'readUInt8',5122:'readInt16LE',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
  return Array.from({length:a.count},(_,i)=>Array.from({length:components},(_,k)=>{
    const value = binary[method]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??components*size)+k*size);
    return a.normalized ? Math.max(-1,value/({5120:127,5121:255,5122:32767,5123:65535}[a.componentType])) : value;
  }));
}
writeFileSync(output, JSON.stringify({source_path:path, source_sha256:createHash('sha256').update(bytes).digest('hex'),
  mesh:node.name, positions:values(primitive.attributes.POSITION), normals:values(primitive.attributes.NORMAL),
  joints:values(primitive.attributes.JOINTS_0), weights:values(primitive.attributes.WEIGHTS_0),
  indices:values(primitive.indices).flat(), bone_names:g.skins[0].joints.map(i=>g.nodes[i].name)}));
