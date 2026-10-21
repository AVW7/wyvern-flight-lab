import { RUNTIME_PATH, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

export function compactGlb(inputPath, outputPath = inputPath) {
  console.log(`Compacting GLB: ${inputPath} -> ${outputPath}`);

  const buf = readFileSync(inputPath);
  assert.equal(buf.toString("ascii", 0, 4), "glTF", "Input is not a GLB");

  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString("utf8", 20, 20 + jsonLength));
  const binaryOffset = 20 + jsonLength;
  const binaryLength = buf.readUInt32LE(binaryOffset);
  const binary = buf.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength);

// 1. Mark used accessors
const usedAccessorsSet = new Set();
for (const m of gltf.meshes ?? []) {
  for (const p of m.primitives ?? []) {
    if (p.indices !== undefined) usedAccessorsSet.add(p.indices);
    for (const a of Object.values(p.attributes ?? {})) usedAccessorsSet.add(a);
  }
}
for (const s of gltf.skins ?? []) {
  if (s.inverseBindMatrices !== undefined) usedAccessorsSet.add(s.inverseBindMatrices);
}
for (const a of gltf.animations ?? []) {
  const usedSamplers = new Set((a.channels ?? []).map(c => c.sampler));
  const oldToNewSampler = new Map();
  const nextSamplers = [];
  for (let sIdx = 0; sIdx < (a.samplers ?? []).length; sIdx++) {
    if (!usedSamplers.has(sIdx)) continue;
    oldToNewSampler.set(sIdx, nextSamplers.length);
    nextSamplers.push(a.samplers[sIdx]);
  }
  for (const c of a.channels ?? []) {
    c.sampler = oldToNewSampler.get(c.sampler);
  }
  a.samplers = nextSamplers;
  for (const s of a.samplers) {
    usedAccessorsSet.add(s.input);
    usedAccessorsSet.add(s.output);
  }
}

// 2. Mark used bufferViews
const usedBufferViewsSet = new Set();
for (const accIdx of usedAccessorsSet) {
  const acc = gltf.accessors[accIdx];
  if (acc && acc.bufferView !== undefined) usedBufferViewsSet.add(acc.bufferView);
}
for (const img of gltf.images ?? []) {
  if (img.bufferView !== undefined) usedBufferViewsSet.add(img.bufferView);
}

console.log(`Audited: ${usedAccessorsSet.size}/${gltf.accessors.length} accessors used, ${usedBufferViewsSet.size}/${gltf.bufferViews.length} bufferViews used.`);

// 3. Build new bufferViews array and packed binary buffer
const oldToNewBufferView = new Map();
const newBufferViews = [];
const newBinaryChunks = [];
let newBinOffset = 0;

for (let oldBvIdx = 0; oldBvIdx < gltf.bufferViews.length; oldBvIdx++) {
  if (!usedBufferViewsSet.has(oldBvIdx)) continue;
  const oldBv = gltf.bufferViews[oldBvIdx];
  const newBvIdx = newBufferViews.length;
  oldToNewBufferView.set(oldBvIdx, newBvIdx);

  const pad = (4 - (newBinOffset % 4)) % 4;
  if (pad > 0) {
    newBinaryChunks.push(Buffer.alloc(pad));
    newBinOffset += pad;
  }

  const newBv = structuredClone(oldBv);

  if (oldBv.extensions?.EXT_meshopt_compression) {
    const ext = newBv.extensions.EXT_meshopt_compression;
    assert.equal(ext.buffer, 0, "meshopt extension expected buffer 0");
    const slice = binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength);
    assert.equal(slice.length, ext.byteLength);
    ext.byteOffset = newBinOffset;
    newBinaryChunks.push(slice);
    newBinOffset += ext.byteLength;
  } else {
    assert.equal(oldBv.buffer, 0, "expected buffer 0 for regular bufferView");
    const offset = oldBv.byteOffset ?? 0;
    const slice = binary.subarray(offset, offset + oldBv.byteLength);
    assert.equal(slice.length, oldBv.byteLength);
    newBv.byteOffset = newBinOffset;
    newBinaryChunks.push(slice);
    newBinOffset += oldBv.byteLength;
  }
  newBufferViews.push(newBv);
}

// 4. Build new accessors array
const oldToNewAccessor = new Map();
const newAccessors = [];
for (let oldAccIdx = 0; oldAccIdx < gltf.accessors.length; oldAccIdx++) {
  if (!usedAccessorsSet.has(oldAccIdx)) continue;
  const oldAcc = gltf.accessors[oldAccIdx];
  const newAccIdx = newAccessors.length;
  oldToNewAccessor.set(oldAccIdx, newAccIdx);

  const newAcc = structuredClone(oldAcc);
  if (newAcc.bufferView !== undefined) {
    assert.ok(oldToNewBufferView.has(newAcc.bufferView));
    newAcc.bufferView = oldToNewBufferView.get(newAcc.bufferView);
  }
  newAccessors.push(newAcc);
}

// 5. Remap references in glTF JSON
const compactedGltf = structuredClone(gltf);
compactedGltf.bufferViews = newBufferViews;
compactedGltf.accessors = newAccessors;

for (const img of compactedGltf.images ?? []) {
  if (img.bufferView !== undefined) {
    img.bufferView = oldToNewBufferView.get(img.bufferView);
  }
}
for (const m of compactedGltf.meshes ?? []) {
  for (const p of m.primitives ?? []) {
    if (p.indices !== undefined) p.indices = oldToNewAccessor.get(p.indices);
    for (const [k, v] of Object.entries(p.attributes ?? {})) {
      p.attributes[k] = oldToNewAccessor.get(v);
    }
  }
}
for (const s of compactedGltf.skins ?? []) {
  if (s.inverseBindMatrices !== undefined) {
    s.inverseBindMatrices = oldToNewAccessor.get(s.inverseBindMatrices);
  }
}
for (const a of compactedGltf.animations ?? []) {
  for (const s of a.samplers ?? []) {
    s.input = oldToNewAccessor.get(s.input);
    s.output = oldToNewAccessor.get(s.output);
  }
}

const finalBinPad = (4 - (newBinOffset % 4)) % 4;
if (finalBinPad > 0) {
  newBinaryChunks.push(Buffer.alloc(finalBinPad));
  newBinOffset += finalBinPad;
}
const finalBin = Buffer.concat(newBinaryChunks);
assert.equal(finalBin.length, newBinOffset);
compactedGltf.buffers[0].byteLength = newBinOffset;

const jsonText = JSON.stringify(compactedGltf);
const jsonBuf = Buffer.from(jsonText, "utf8");
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const finalJson = jsonPad > 0 ? Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]) : jsonBuf;

const out = Buffer.alloc(28 + finalJson.length + finalBin.length);
out.write("glTF");
out.writeUInt32LE(2, 4);
out.writeUInt32LE(out.length, 8);
out.writeUInt32LE(finalJson.length, 12);
out.writeUInt32LE(0x4e4f534a, 16);
finalJson.copy(out, 20);
out.writeUInt32LE(finalBin.length, 20 + finalJson.length);
out.writeUInt32LE(0x004e4942, 24 + finalJson.length);
finalBin.copy(out, 28 + finalJson.length);

  const isRuntimeRig = gltf.nodes?.some(node => node.name === "WyvernMembrane_ExportSafe");
  if (resolve(outputPath) === RUNTIME_PATH || isRuntimeRig) writeValidatedRuntimeRig(outputPath, out);
  else writeFileSync(outputPath, out);
  const saved = buf.length - out.length;
  console.log(`Successfully compacted GLB: ${buf.length} B -> ${out.length} B (Saved ${(saved / 1024 / 1024).toFixed(2)} MB)`);
  return { originalBytes: buf.length, compactedBytes: out.length, savedBytes: saved };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^[./]+/, ""))) {
  const input = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
  const output = process.argv[3] ?? input;
  compactGlb(input, output);
}
