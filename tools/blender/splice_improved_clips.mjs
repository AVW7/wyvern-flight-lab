#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { writeValidatedRuntimeRig, validateRuntimeRig } from "./runtime_rig_contract.mjs";

const BASE_GLB = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const DONOR_GLB = process.argv[3] ?? "assets/blender/wyvern-gothic.glb";
const OUTPUT_GLB = process.argv[4] ?? "/tmp/wyvern-v2-systematic-candidate.glb";
const CLIPS_TO_SPLICE = (process.argv[5] ?? "hover,scout,idle,takeoff").split(",");

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

console.log(`[SPLICE] Reading base: ${BASE_GLB}`);
const base = readGlb(BASE_GLB);
validateRuntimeRig(base.bytes, { checkHash: false });
assert.equal(base.json.skins?.length, 1, "Base must have exactly 1 skin");
assert.equal(base.json.skins[0].joints?.length, 92, "Base must have 92 joints");

console.log(`[SPLICE] Reading donor: ${DONOR_GLB}`);
const donor = readGlb(DONOR_GLB);

const nodeByName = new Map(base.json.nodes.map((node, index) => [node.name, index]));
const chunks = [base.binary];
let binaryLength = base.binary.length;

const copiedViews = new Map();
const copiedAccessors = new Map();

function copyAccessor(index) {
  if (copiedAccessors.has(index)) return copiedAccessors.get(index);
  const accessor = donor.json.accessors[index];
  assert.ok(!accessor.sparse, "Sparse donor accessors are unsupported");
  const sourceView = donor.json.bufferViews[accessor.bufferView];
  assert.equal(sourceView.buffer, 0, "Donor uses unexpected buffer");

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

for (const clipName of CLIPS_TO_SPLICE) {
  const donorAnimation = donor.json.animations.find(a => a.name === clipName);
  assert.ok(donorAnimation, `Donor has no '${clipName}' animation`);
  const targetIndex = base.json.animations.findIndex(a => a.name === clipName);
  assert.ok(targetIndex >= 0, `Base has no '${clipName}' animation`);

  const channels = donorAnimation.channels.map(channel => {
    const donorNode = donor.json.nodes[channel.target.node];
    const targetNode = nodeByName.get(donorNode.name);
    assert.notEqual(targetNode, undefined, `Unmapped node ${donorNode.name}`);
    return { ...channel, target: { ...channel.target, node: targetNode } };
  });

  base.json.animations[targetIndex] = {
    name: clipName,
    channels,
    samplers: donorAnimation.samplers.map(sampler => ({
      ...sampler,
      input: copyAccessor(sampler.input),
      output: copyAccessor(sampler.output),
    })),
  };
  console.log(`[SPLICE] Successfully spliced '${clipName}' (${channels.length} channels)`);
}

// Preserve single skin on all mesh nodes
assert.equal(base.json.skins.length, 1);
for (const node of base.json.nodes) {
  if (node.skin !== undefined) {
    node.skin = 0;
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
}
const binaryBuffer = Buffer.concat(chunks, binaryLength);

const header = Buffer.alloc(12);
header.write("glTF", 0, 4, "ascii");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + binaryBuffer.length, 8);

const jsonChunkHeader = Buffer.alloc(8);
jsonChunkHeader.writeUInt32LE(paddedJson.length, 0);
jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);

const binChunkHeader = Buffer.alloc(8);
binChunkHeader.writeUInt32LE(binaryBuffer.length, 0);
binChunkHeader.writeUInt32LE(0x004e4942, 4);

const packaged = Buffer.concat([header, jsonChunkHeader, paddedJson, binChunkHeader, binaryBuffer]);
writeValidatedRuntimeRig(OUTPUT_GLB, packaged, { allowCandidate: true });
console.log(`[SPLICE] Successfully wrote validated candidate to ${OUTPUT_GLB}`);
