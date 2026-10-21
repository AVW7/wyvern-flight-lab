import { writeValidatedRuntimeRig, validateRuntimeRig } from "./runtime_rig_contract.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compactGlb } from "./compact_v2_glb.mjs";

const INPUT_GLB = "public/models/wyvern-v2-rig.glb";
const TARGET_GLB = process.argv[2] ?? "/tmp/package_v2_glide_dive-candidate.glb";
const DONOR_GLIDE = "/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0/glide-v1-shape-candidate.glb";
const DONOR_DIVE = "/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0/dive-v1-shape-candidate.glb";

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

const base = readGlb(INPUT_GLB);
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

spliceAnimation("glide", DONOR_GLIDE);
spliceAnimation("dive", DONOR_DIVE);

for (const key of ["nodes", "skins", "meshes", "materials", "textures", "images"]) {
  assert.deepEqual(base.json[key], unchanged[key], `${key} changed during animation packaging`);
}
for (const animation of unchanged.animations) {
  if (animation.name !== "glide" && animation.name !== "dive") {
    assert.deepEqual(base.json.animations.find(item => item.name === animation.name), animation, `${animation.name} changed`);
  }
}

base.json.buffers[0].byteLength = binaryLength;
const jsonText = JSON.stringify(base.json);
const jsonBuffer = Buffer.from(jsonText, "utf8");
const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
const paddedJson = jsonPadding ? Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)]) : jsonBuffer;

const binaryPadding = (4 - (binaryLength % 4)) % 4;
if (binaryPadding) {
  chunks.push(Buffer.alloc(binaryPadding));
  binaryLength += binaryPadding;
  base.json.buffers[0].byteLength = binaryLength;
}

const totalLength = 12 + 8 + paddedJson.length + 8 + binaryLength;
const header = Buffer.alloc(12);
header.write("glTF", 0, 4, "ascii");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(paddedJson.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);

const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binaryLength, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);

const outputBytes = Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, ...chunks]);
assert.equal(outputBytes.length, totalLength, "length mismatch in packaged GLB");

writeValidatedRuntimeRig(TARGET_GLB, outputBytes);
console.log(`Successfully packaged updated ${TARGET_GLB} (${outputBytes.length} bytes, ${(outputBytes.length / (1024 * 1024)).toFixed(2)} MB)`);
compactGlb(TARGET_GLB);
