import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readGlb, encodeGlb } from './runtime_rig_contract.mjs';

const [input, output] = process.argv.slice(2);
assert.ok(input && output, 'Pass a bankLeft donor and a new bankRight output');
assert.notEqual(resolve(input), resolve(output));
assert.ok(!existsSync(output), 'Preserve existing candidate');
const manifest = JSON.parse(readFileSync(input.replace(/\.glb$/i, '.harvest.json')));
assert.equal(manifest.clip, 'bankLeft');
const bytes = readFileSync(input);
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(hash(bytes), manifest.output_sha256, 'Donor hash mismatch');
const { gltf, binary } = readGlb(bytes);
assert.equal(gltf.animations.length, 1);
const byName = new Map(gltf.nodes.map((node, index) => [node.name, index]));
const selected = new Set(manifest.transferred_bones);
const changed = new Set();
const flip = name => name.replace(/^([LR])_/, (_, side) => `${side === 'L' ? 'R' : 'L'}_`);
for (const channel of gltf.animations[0].channels) {
  const name = gltf.nodes[channel.target.node].name;
  if (channel.target.path !== 'rotation' || !selected.has(name)) continue;
  const mirroredNode = byName.get(flip(name));
  assert.notEqual(mirroredNode, undefined);
  channel.target.node = mirroredNode;
  const index = gltf.animations[0].samplers[channel.sampler].output;
  if (changed.has(index)) continue;
  changed.add(index);
  const accessor = gltf.accessors[index];
  assert.equal(accessor.componentType, 5126);
  assert.equal(accessor.type, 'VEC4');
  delete accessor.min;
  delete accessor.max;
  const view = gltf.bufferViews[accessor.bufferView];
  assert.ok(!view.extensions && !accessor.sparse);
  for (let frame = 0; frame < accessor.count; frame++) {
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + frame * (view.byteStride ?? 16);
    for (const component of [1, 2]) binary.writeFloatLE(-binary.readFloatLE(offset + component * 4), offset + component * 4);
  }
}
gltf.animations[0].name = 'bankRight_harvest_candidate';
const encoded = encodeGlb(gltf, binary);
writeFileSync(output, encoded);
writeFileSync(output.replace(/\.glb$/i, '.harvest.json'), JSON.stringify({ ...manifest,
  clip: 'bankRight', output_sha256: hash(encoded),
  mirror_policy: 'Opposed bank from bankLeft: swap L/R targets, preserve local X pitch, negate local Y/Z quaternion components',
  performance_parent: { path: resolve(input), sha256: hash(bytes) },
  performance_mapping: manifest.transferred_bones.map(target => ({ target: flip(target), reference: target })),
}, null, 2) + '\n');
