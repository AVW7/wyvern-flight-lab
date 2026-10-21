#!/usr/bin/env node
// Splice ONLY the Neck1/Neck2/Head rotation channels of named clips from a donor
// GLB into the runtime rig, leaving every other channel (membrane, wings, legs,
// jaw) untouched. Use when a clip's neck/head tracks were sourced from a retired
// donor and need re-deriving from the Blender authoring source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeValidatedRuntimeRig, validateRuntimeRig } from "./runtime_rig_contract.mjs";

const BASE_GLB = process.argv[2];
const DONOR_GLB = process.argv[3];
const OUTPUT_GLB = process.argv[4];
const CLIPS_TO_SPLICE = (process.argv[5] ?? "idle").split(",");
const SPLICED_TARGETS = new Set(["Neck1:rotation", "Neck2:rotation", "Head:rotation"]);

assert.ok(BASE_GLB && DONOR_GLB && OUTPUT_GLB, "usage: splice_neck_head_channels.mjs <base.glb> <donor.glb> <out.glb> [clips]");

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

console.log(`[SPLICE-NECK] Reading base: ${BASE_GLB}`);
const base = readGlb(BASE_GLB);
validateRuntimeRig(base.bytes, { checkHash: false });
assert.equal(base.json.skins?.length, 1, "Base must have exactly 1 skin");
assert.equal(base.json.skins[0].joints?.length, 92, "Base must have 92 joints");

console.log(`[SPLICE-NECK] Reading donor: ${DONOR_GLB}`);
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
  assert.ok(!sourceView.extensions, "Donor accessor view must be uncompressed");

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
  const baseAnimation = base.json.animations[targetIndex];

  const kept = baseAnimation.channels.filter(channel => {
    const name = base.json.nodes[channel.target.node].name;
    return !SPLICED_TARGETS.has(`${name}:${channel.target.path}`);
  });
  const removed = baseAnimation.channels.length - kept.length;

  const donorChannels = donorAnimation.channels
    .map(channel => {
      const donorNode = donor.json.nodes[channel.target.node];
      if (!SPLICED_TARGETS.has(`${donorNode.name}:${channel.target.path}`)) return null;
      const targetNode = nodeByName.get(donorNode.name);
      assert.notEqual(targetNode, undefined, `Unmapped node ${donorNode.name}`);
      return { ...channel, target: { ...channel.target, node: targetNode } };
    })
    .filter(Boolean);
  assert.equal(donorChannels.length, SPLICED_TARGETS.size, `Donor '${clipName}' must animate all of ${[...SPLICED_TARGETS].join(", ")}`);

  const samplerOffset = baseAnimation.samplers.length;
  base.json.animations[targetIndex] = {
    name: clipName,
    channels: [
      ...kept,
      ...donorChannels.map(channel => ({ ...channel, sampler: channel.sampler + samplerOffset })),
    ],
    samplers: [
      ...baseAnimation.samplers,
      ...donorAnimation.samplers.map(sampler => ({
        ...sampler,
        input: copyAccessor(sampler.input),
        output: copyAccessor(sampler.output),
      })),
    ],
  };
  console.log(`[SPLICE-NECK] '${clipName}': removed ${removed} base neck/head channels, spliced ${donorChannels.length} donor channels`);
}

assert.equal(base.json.skins.length, 1);
for (const node of base.json.nodes) {
  if (node.skin !== undefined) node.skin = 0;
}

base.json.buffers[0].byteLength = binaryLength;
const jsonBuffer = Buffer.from(JSON.stringify(base.json), "utf8");
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
writeValidatedRuntimeRig(OUTPUT_GLB, packaged);
console.log(`[SPLICE-NECK] Wrote validated candidate to ${OUTPUT_GLB}`);
