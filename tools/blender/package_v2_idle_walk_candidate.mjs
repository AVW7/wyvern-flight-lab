import { writeValidatedRuntimeRig, validateRuntimeRig } from "./runtime_rig_contract.mjs";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { compactGlb } from "./compact_v2_glb.mjs";

const INPUT_GLB = "public/models/wyvern-v2-rig.glb";
const TARGET_GLB = process.argv[2] ?? "/tmp/wyvern-v2-idle-walk-candidate.glb";
const IDLE_DONOR = "/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0/idle-v2-fold-candidate.glb";
const WALK_DONOR = "/Users/ajadvanwyk/.codex/visualizations/2026/09/09/01a08509-1dea-76c0-8707-83856dc9d32c/v2-rig/walk-candidate.glb";
const IDLE_CURVES = "assets/harvest-candidates/2026-10-08/v2-idle-walk/panel-breath-curves.json";

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
  assert.equal(donor.json.animations?.length, 1, `donor ${donorPath} must contain exactly one action`);
  assert.equal(donor.json.skins?.[0]?.joints?.length, 92, `donor ${donorPath} must use the 92-bone rig`);
  const sourceAnimation = donor.json.animations[0];
  const targetIndex = base.json.animations.findIndex(animation => animation.name === targetClipName);
  assert.ok(targetIndex >= 0, `base has no ${targetClipName} action`);
  assert.equal(sourceAnimation.channels.length, base.json.animations[targetIndex].channels.length, `${targetClipName} track count differs`);

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
  console.log(`Spliced ${targetClipName} (${channels.length} tracks) from ${donorPath}`);
}

spliceAnimation("idle", IDLE_DONOR);
spliceAnimation("walk", WALK_DONOR);

const panelCurveData = JSON.parse(readFileSync(IDLE_CURVES, "utf8"));
assert.equal(panelCurveData.format, "blender-v2-idle-panel-curves-v1");
assert.equal(panelCurveData.frameRate, 24);
assert.equal(panelCurveData.frameEnd, 144);
const idleAnimation = base.json.animations.find(animation => animation.name === "idle");
assert.ok(idleAnimation, "idle clip was not packaged");

function appendFloatAccessor(values, type, count, min, max) {
  assert.equal(values.length, count * (type === "SCALAR" ? 1 : type === "VEC4" ? 4 : 0));
  const padding = (4 - (binaryLength % 4)) % 4;
  if (padding) {
    chunks.push(Buffer.alloc(padding));
    binaryLength += padding;
  }
  const packed = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => packed.writeFloatLE(value, index * 4));
  const bufferView = base.json.bufferViews.length;
  base.json.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: packed.length });
  chunks.push(packed);
  binaryLength += packed.length;
  const accessor = base.json.accessors.length;
  base.json.accessors.push({
    bufferView,
    componentType: 5126,
    count,
    type,
    min,
    max,
  });
  return accessor;
}

const times = panelCurveData.times;
assert.ok(Array.isArray(times) && times.length === panelCurveData.frameEnd + 1, "idle panel sample times are incomplete");
const timeAccessor = appendFloatAccessor(times, "SCALAR", times.length, [times[0]], [times.at(-1)]);
let patchedPanels = 0;
for (const [boneName, samples] of Object.entries(panelCurveData.channels)) {
  assert.equal(samples.length, times.length, `${boneName} sample count differs from times`);
  assert.ok(samples.every(sample => Array.isArray(sample) && sample.length === 4 && sample.every(Number.isFinite)), `${boneName} contains invalid quaternion samples`);
  const nodeIndex = nodeByName.get(boneName);
  assert.notEqual(nodeIndex, undefined, `missing idle membrane node ${boneName}`);
  const channel = idleAnimation.channels.find(item => item.target.node === nodeIndex && item.target.path === "rotation");
  assert.ok(channel, `missing idle rotation channel for ${boneName}`);
  const values = samples.flat();
  const components = [0, 1, 2, 3].map(axis => samples.map(sample => sample[axis]));
  const outputAccessor = appendFloatAccessor(
    values,
    "VEC4",
    samples.length,
    components.map(axis => Math.min(...axis)),
    components.map(axis => Math.max(...axis)),
  );
  idleAnimation.samplers[channel.sampler] = {
    input: timeAccessor,
    output: outputAccessor,
    interpolation: "LINEAR",
  };
  patchedPanels++;
}
assert.equal(patchedPanels, 16, "expected breathing response on all 16 wing membrane panels");
console.log(`Applied ${patchedPanels} Blender-authored panel response tracks to Idle`);

for (const key of ["nodes", "skins", "meshes", "materials", "textures", "images"]) {
  assert.deepEqual(base.json[key], unchanged[key], `${key} changed during animation packaging`);
}
for (const animation of unchanged.animations) {
  if (animation.name !== "idle" && animation.name !== "walk") {
    assert.deepEqual(base.json.animations.find(item => item.name === animation.name), animation, `${animation.name} changed`);
  }
}

base.json.buffers[0].byteLength = binaryLength;
const jsonBuffer = Buffer.from(JSON.stringify(base.json), "utf8");
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
mkdirSync(dirname(TARGET_GLB), { recursive: true });
writeValidatedRuntimeRig(TARGET_GLB, outputBytes);
compactGlb(TARGET_GLB);
console.log(`Created isolated V2 Idle/Walk candidate at ${TARGET_GLB}`);
