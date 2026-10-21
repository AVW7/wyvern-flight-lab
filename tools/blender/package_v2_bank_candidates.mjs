import { writeValidatedRuntimeRig, validateRuntimeRig } from "./runtime_rig_contract.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = "/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0/v2-best-wing-shape-candidate.glb";
const DONOR_BANK_L = "/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0/bankLeft-v1-shape-candidate.glb";
const DONOR_BANK_R = "/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0/bankRight-v1-shape-candidate.glb";
const OUTPUT = process.argv[2] ?? "/tmp/package_v2_bank_candidates-candidate.glb";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function readGlb(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString("ascii", 0, 4), "glTF", `${path} is not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const binaryOffset = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(binaryOffset + 4), 0x004e4942, `${path} has no binary chunk`);
  const binaryLength = bytes.readUInt32LE(binaryOffset);
  return { bytes, json, binary: bytes.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength) };
}

const base = readGlb(BASE);
validateRuntimeRig(base.bytes, { checkHash: false });
assert.equal(base.json.skins?.length, 1, "base must preserve the reviewed one-skin V2 model");
assert.equal(base.json.animations?.length, 18, "base must have the canonical 18 clips");

const unchanged = structuredClone(base.json);
const nodeByName = new Map(base.json.nodes.map((node, index) => [node.name, index]));
const chunks = [base.binary];
let binaryLength = base.binary.length;

function spliceAnimation(targetClipName, donorPath) {
  const donor = readGlb(donorPath);
  assert.equal(donor.json.animations?.length, 1, `donor ${donorPath} must contain exactly 1 action`);
  const sourceAnimation = donor.json.animations[0];
  const targetIndex = base.json.animations.findIndex(animation => animation.name === targetClipName);
  assert.ok(targetIndex >= 0, `base has no ${targetClipName} action`);

  const copiedViews = new Map();
  const copiedAccessors = new Map();

  function copyAccessor(index) {
    if (copiedAccessors.has(index)) return copiedAccessors.get(index);
    const accessor = donor.json.accessors[index];
    assert.ok(!accessor.sparse, "sparse donor accessors are unsupported");
    const sourceView = donor.json.bufferViews[accessor.bufferView];
    assert.equal(sourceView.buffer, 0, "donor uses an unexpected buffer");
    assert.ok(!sourceView.extensions, "donor buffer view is unexpectedly compressed");

    if (!copiedViews.has(accessor.bufferView)) {
      const padding = (4 - (binaryLength % 4)) % 4;
      if (padding) {
        chunks.push(Buffer.alloc(padding));
        binaryLength += padding;
      }
      const nextView = base.json.bufferViews.length;
      copiedViews.set(accessor.bufferView, nextView);
      base.json.bufferViews.push({ ...sourceView, byteOffset: binaryLength });
      chunks.push(donor.binary.subarray(sourceView.byteOffset ?? 0, (sourceView.byteOffset ?? 0) + sourceView.byteLength));
      binaryLength += sourceView.byteLength;
    }

    const nextAccessor = base.json.accessors.length;
    base.json.accessors.push({ ...accessor, bufferView: copiedViews.get(accessor.bufferView) });
    copiedAccessors.set(index, nextAccessor);
    return nextAccessor;
  }

  const channels = sourceAnimation.channels.map(channel => {
    const donorNode = donor.json.nodes[channel.target.node];
    const targetNode = nodeByName.get(donorNode.name);
    assert.notEqual(targetNode, undefined, `unmapped donor node ${donorNode.name}`);
    return { ...channel, target: { ...channel.target, node: targetNode } };
  });

  base.json.animations[targetIndex] = {
    name: targetClipName,
    channels,
    samplers: sourceAnimation.samplers.map(sampler => ({
      ...sampler,
      input: copyAccessor(sampler.input),
      output: copyAccessor(sampler.output),
    })),
  };
  console.log(`Spliced ${targetClipName} with ${channels.length} channels from ${donorPath}`);
}

spliceAnimation("bankLeft", DONOR_BANK_L);
spliceAnimation("bankRight", DONOR_BANK_R);

for (const key of ["nodes", "skins", "meshes", "materials", "textures", "images"]) {
  assert.deepEqual(base.json[key], unchanged[key], `${key} changed during animation packaging`);
}
for (const animation of unchanged.animations) {
  if (animation.name !== "bankLeft" && animation.name !== "bankRight") {
    assert.deepEqual(base.json.animations.find(item => item.name === animation.name), animation, `${animation.name} changed`);
  }
}

base.json.buffers[0].byteLength = binaryLength;
const encodedJson = Buffer.from(JSON.stringify(base.json));
const json = Buffer.alloc(Math.ceil(encodedJson.length / 4) * 4, 0x20);
encodedJson.copy(json);
const binary = Buffer.concat([...chunks, Buffer.alloc((4 - (binaryLength % 4)) % 4)]);
const output = Buffer.alloc(28 + json.length + binary.length);
output.write("glTF");
output.writeUInt32LE(2, 4);
output.writeUInt32LE(output.length, 8);
output.writeUInt32LE(json.length, 12);
output.writeUInt32LE(0x4e4f534a, 16);
json.copy(output, 20);
output.writeUInt32LE(binary.length, 20 + json.length);
output.writeUInt32LE(0x004e4942, 24 + json.length);
binary.copy(output, 28 + json.length);
writeValidatedRuntimeRig(OUTPUT, output);

const report = {
  base: { path: BASE, sha256: sha256(base.bytes) },
  donors: [DONOR_BANK_L, DONOR_BANK_R],
  output: { path: OUTPUT, sha256: sha256(output), bytes: output.length },
  clips: base.json.animations.map(a => a.name),
};
console.log(JSON.stringify(report, null, 2));
