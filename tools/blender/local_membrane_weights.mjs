import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { decodeMeshoptGlb } from './decode_meshopt_glb.mjs';
import { readGlb, encodeGlb } from './runtime_rig_contract.mjs';

export function smoothSelectedWeights(positions, indices, joints, weights, selected, blend = 0.25) {
  assert.ok(blend > 0 && blend <= 1);
  const neighbors = positions.map(() => new Set()), groups = new Map();
  for (let i = 0; i < indices.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = indices[i + k], b = indices[i + (k + 1) % 3]; neighbors[a].add(b); neighbors[b].add(a);
  }
  positions.forEach((p, i) => { const key = p.join(','); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i); });
  const result = weights.map(w => [...w]);
  for (const ids of groups.values()) {
    if (!ids.some(i => selected.has(i))) continue;
    const i = ids[0], nearby = new Set(ids.flatMap(v => [...neighbors[v]]));
    if (!nearby.size) continue;
    const next = joints[i].map((joint, k) => {
      if (!weights[i][k]) return 0;
      let sum = 0;
      for (const n of nearby) for (let slot = 0; slot < 4; slot++) if (joints[n][slot] === joint) sum += weights[n][slot];
      return (1 - blend) * weights[i][k] + blend * sum / nearby.size;
    });
    const total = next.reduce((a, b) => a + b, 0);
    assert.ok(total > 0);
    for (const v of ids) result[v] = joints[v].map((joint, slot) => weights[v][slot] ? next[joints[i].indexOf(joint)] / total : 0);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, reportPath, output] = process.argv.slice(2);
  assert.ok(input && reportPath && output, 'Pass candidate, crease report and fresh output');
  assert.ok(!existsSync(output), 'Preserve existing output');
  const bytes = readFileSync(input), report = JSON.parse(readFileSync(reportPath));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(bytes), report.sha256, 'Report must measure this exact input');
  const { gltf: g, binary } = readGlb(decodeMeshoptGlb(bytes));
  const primitive = g.meshes.find(m => m.name === 'SKM_DaenerysDragon.002')?.primitives[0];
  assert.ok(primitive, 'Expected separate membrane primitive');
  function values(index) {
    const a = g.accessors[index], view = g.bufferViews[a.bufferView];
    assert.ok(!a.sparse);
    const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    const size = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType];
    const method = {5120:'readInt8',5121:'readUInt8',5122:'readInt16LE',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
    return Array.from({length:a.count},(_,i)=>Array.from({length:components},(_,k)=>{
      const v = binary[method]((view.byteOffset??0)+(a.byteOffset??0)+i*(view.byteStride??components*size)+k*size);
      return a.normalized ? Math.max(-1,v/({5120:127,5121:255,5122:32767,5123:65535}[a.componentType])) : v;
    }));
  }
  const positions = values(primitive.attributes.POSITION), joints = values(primitive.attributes.JOINTS_0), weights = values(primitive.attributes.WEIGHTS_0), indices = values(primitive.indices).flat();
  assert.equal(positions.length, report.vertices);
  const selected = new Set(report.samples.filter(s => s.clip.startsWith('bank')).flatMap(s => s.worstEdges.flatMap(e => e.vertices)));
  const result = smoothSelectedWeights(positions, indices, joints, weights, selected);
  const changed = result.flatMap((w,i)=>w.some((v,k)=>Math.abs(v-weights[i][k])>1e-12)?[i]:[]);
  const packed = Buffer.alloc(result.length*16);
  result.forEach((w,i)=>w.forEach((v,k)=>packed.writeFloatLE(v,i*16+k*4)));
  const view = g.bufferViews.length;g.bufferViews.push({buffer:0,byteOffset:binary.length,byteLength:packed.length});
  const accessor = g.accessors.length;g.accessors.push({bufferView:view,componentType:5126,type:'VEC4',count:result.length});
  primitive.attributes.WEIGHTS_0=accessor;g.buffers[0].byteLength=binary.length+packed.length;
  const candidate = encodeGlb(g,Buffer.concat([binary,packed]));writeFileSync(output,candidate);
  writeFileSync(output.replace(/\.glb$/,'.weights.json'),JSON.stringify({status:'experiment',source_sha256:hash(bytes),output_sha256:hash(candidate),selection:'eight area-weighted crease edges per bank phase, exact-position groups',blend:0.25,blend_policy:'experimental one-pass neighbor blend; not an acceptance threshold',selected_vertices:selected.size,changed_vertices:changed.length,changed_vertex_indices:changed,preserved:'geometry, joint palettes, skeleton, animations, materials; maximum four influences'},null,2));
  console.log({selected:selected.size,changed:changed.length,output});
}
