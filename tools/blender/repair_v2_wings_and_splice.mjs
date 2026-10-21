import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { compactGlb } from "./compact_v2_glb.mjs";

const BASE_GLB = "/tmp/test-wyvern.glb";
const DONOR_GLB = "public/models/wyvern-v2-rig.glb";
const OUTPUT_GLB = "/tmp/wyvern-v2-repaired.glb";

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

console.log("Reading base:", BASE_GLB);
const base = readGlb(BASE_GLB);
console.log("Base skins:", base.json.skins?.length, "nodes:", base.json.nodes?.length);

console.log("Reading donor:", DONOR_GLB);
const donor = readGlb(DONOR_GLB);
console.log("Donor animations:", donor.json.animations?.length);

// Clean up node names if needed
base.json.nodes.forEach(node => {
  if (node.name === "WyvernBody_Rebuild.001") node.name = "WyvernBody_Rebuild";
  if (node.name === "WyvernMembrane_ExportSafe.001") node.name = "WyvernMembrane_ExportSafe";
});

const nodeByName = new Map(base.json.nodes.map((node, index) => [node.name, index]));
const chunks = [base.binary];
let binaryLength = base.binary.length;

// Clear base animations and re-splice all 18 from donor
base.json.animations = [];

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

for (const sourceAnimation of donor.json.animations) {
  const channels = sourceAnimation.channels.map(channel => {
    const donorNode = donor.json.nodes[channel.target.node];
    const targetNode = nodeByName.get(donorNode.name);
    assert.notEqual(targetNode, undefined, `unmapped donor node ${donorNode.name}`);
    return { ...channel, target: { ...channel.target, node: targetNode } };
  });

  base.json.animations.push({
    name: sourceAnimation.name,
    channels,
    samplers: sourceAnimation.samplers.map(sampler => ({
      ...sampler,
      input: copyAccessor(sampler.input),
      output: copyAccessor(sampler.output),
    })),
  });
  console.log(`Spliced ${sourceAnimation.name} (${channels.length} channels)`);
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

const output = Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, ...chunks]);
assert.equal(output.length, totalLength);
writeFileSync(OUTPUT_GLB, output);
console.log(`Wrote uncompacted ${OUTPUT_GLB}: ${output.length} bytes`);

compactGlb(OUTPUT_GLB, OUTPUT_GLB);
const finalBuf = readFileSync(OUTPUT_GLB);
console.log(`Final compacted ${OUTPUT_GLB}: ${finalBuf.length} bytes (${(finalBuf.length / (1024*1024)).toFixed(2)} MB)`);
