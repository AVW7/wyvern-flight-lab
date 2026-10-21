import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readGlb, encodeGlb, RUNTIME_PATH } from '../tools/blender/runtime_rig_contract.mjs';

test('bank audit rejects two copies of the same turning direction', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bank-direction-'));
  try {
    const { gltf, binary } = readGlb(readFileSync(RUNTIME_PATH));
    const left = gltf.animations.find(a => a.name === 'bankLeft');
    gltf.animations[gltf.animations.findIndex(a => a.name === 'bankRight')] = { ...structuredClone(left), name: 'bankRight' };
    const path = join(directory, 'same-direction.glb');
    writeFileSync(path, encodeGlb(gltf, binary));
    const result = spawnSync(process.execPath, ['scripts/validate-wyvern-clips.mjs', path], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /bank.*trajectory/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('bank audit rejects a wrong body turn hidden by body-local wing comparisons', async () => {
  const { decodeMeshoptGlb } = await import('../tools/blender/decode_meshopt_glb.mjs');
  const { Quaternion, Vector3 } = await import('three');
  const directory = mkdtempSync(join(tmpdir(), 'bank-body-'));
  try {
    const { gltf, binary } = readGlb(decodeMeshoptGlb(readFileSync(RUNTIME_PATH)));
    const bank = gltf.animations.find(a => a.name === 'bankRight');
    const root = gltf.nodes.findIndex(node => node.name === 'Root');
    const channel = bank.channels.find(c => c.target.node === root && c.target.path === 'rotation');
    const sampler = bank.samplers[channel.sampler];
    const old = gltf.accessors[sampler.output];
    const view = gltf.bufferViews[old.bufferView];
    const offset = (view.byteOffset ?? 0) + (old.byteOffset ?? 0);
    const q = new Quaternion(...[0, 1, 2, 3].map(i => binary.readFloatLE(offset + i * 4)))
      .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.2));
    const count = gltf.accessors[sampler.input].count;
    const data = Buffer.alloc(count * 16);
    for (let frame = 0; frame < count; frame++) q.toArray().forEach((value, index) => data.writeFloatLE(value, frame * 16 + index * 4));
    const bufferView = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: data.length });
    const output = gltf.accessors.length;
    gltf.accessors.push({ bufferView, componentType: 5126, count, type: 'VEC4' });
    channel.sampler = bank.samplers.length;
    bank.samplers.push({ ...sampler, output });
    gltf.buffers[0].byteLength = binary.length + data.length;
    const path = join(directory, 'wrong-body.glb');
    writeFileSync(path, encodeGlb(gltf, Buffer.concat([binary, data])));
    const result = spawnSync(process.execPath, ['scripts/validate-wyvern-clips.mjs', path], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /bank opposed body rotation residual/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
