#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const BASE_GLB = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const DONOR_GLB = process.argv[3] ?? "assets/blender/wyvern-gothic.glb";
const OUTPUT_GLB = process.argv[4] ?? "/tmp/wyvern-v2-refined.glb";

console.log(`[REFINE] Reading base ${BASE_GLB}...`);
const baseBytes = readFileSync(BASE_GLB);
const baseJsonLen = baseBytes.readUInt32LE(12);
const baseJson = JSON.parse(baseBytes.toString("utf8", 20, 20 + baseJsonLen));
const baseBinOff = 20 + baseJsonLen;
const baseBinLen = baseBytes.readUInt32LE(baseBinOff);
const baseBin = Buffer.from(baseBytes.subarray(baseBinOff + 8, baseBinOff + 8 + baseBinLen));

console.log(`[REFINE] Reading donor ${DONOR_GLB}...`);
const donorBytes = readFileSync(DONOR_GLB);
const donorJsonLen = donorBytes.readUInt32LE(12);
const donorJson = JSON.parse(donorBytes.toString("utf8", 20, 20 + donorJsonLen));
const donorBinOff = 20 + donorJsonLen;
const donorBinLen = donorBytes.readUInt32LE(donorBinOff);
const donorBin = Buffer.from(donorBytes.subarray(donorBinOff + 8, donorBinOff + 8 + donorBinLen));

const baseNodeByName = new Map(baseJson.nodes.map((n, i) => [n.name, i]));
const baseNameByNode = new Map(baseJson.nodes.map((n, i) => [i, n.name]));
const donorNodeByName = new Map(donorJson.nodes.map((n, i) => [n.name, i]));

const chunks = [baseBin];
let currentBinLen = baseBin.length;

function copyDonorAccessor(donorAccIdx) {
  const donorAcc = donorJson.accessors[donorAccIdx];
  const donorBv = donorJson.bufferViews[donorAcc.bufferView];

  // Align buffer to 4 bytes
  const pad = (4 - (currentBinLen % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    currentBinLen += pad;
  }

  const nextBvIdx = baseJson.bufferViews.length;
  baseJson.bufferViews.push({
    buffer: 0,
    byteOffset: currentBinLen,
    byteLength: donorBv.byteLength,
  });

  const slice = donorBin.subarray(
    donorBv.byteOffset || 0,
    (donorBv.byteOffset || 0) + donorBv.byteLength
  );
  chunks.push(slice);
  currentBinLen += donorBv.byteLength;

  const nextAccIdx = baseJson.accessors.length;
  baseJson.accessors.push({
    ...donorAcc,
    bufferView: nextBvIdx,
  });
  return nextAccIdx;
}

// 1. Splice panel channels from donor for specified clip
function splicePanelChannels(clipName) {
  const baseClip = baseJson.animations.find(a => a.name === clipName);
  const donorClip = donorJson.animations.find(a => a.name === clipName);
  assert.ok(baseClip && donorClip, `Clip ${clipName} missing`);

  const panelNames = new Set([
    "L_WingPanel0_0", "L_WingPanel0_1", "L_WingPanel1_0", "L_WingPanel1_1",
    "L_WingPanel2_0", "L_WingPanel2_1", "L_WingPanel3_0", "L_WingPanel3_1",
    "R_WingPanel0_0", "R_WingPanel0_1", "R_WingPanel1_0", "R_WingPanel1_1",
    "R_WingPanel2_0", "R_WingPanel2_1", "R_WingPanel3_0", "R_WingPanel3_1",
  ]);

  for (const name of panelNames) {
    const baseNodeIdx = baseNodeByName.get(name);
    const donorNodeIdx = donorNodeByName.get(name);
    if (baseNodeIdx === undefined || donorNodeIdx === undefined) continue;

    // Find donor rotation channel
    const donorCh = donorClip.channels.find(
      c => c.target.node === donorNodeIdx && c.target.path === "rotation"
    );
    if (!donorCh) continue;

    const donorSampler = donorClip.samplers[donorCh.sampler];
    const newSamplerIdx = baseClip.samplers.length;
    baseClip.samplers.push({
      input: copyDonorAccessor(donorSampler.input),
      output: copyDonorAccessor(donorSampler.output),
      interpolation: donorSampler.interpolation ?? "LINEAR",
    });

    // Replace or add base rotation channel
    const baseChIdx = baseClip.channels.findIndex(
      c => c.target.node === baseNodeIdx && c.target.path === "rotation"
    );
    if (baseChIdx >= 0) {
      baseClip.channels[baseChIdx] = {
        sampler: newSamplerIdx,
        target: { node: baseNodeIdx, path: "rotation" },
      };
    } else {
      baseClip.channels.push({
        sampler: newSamplerIdx,
        target: { node: baseNodeIdx, path: "rotation" },
      });
    }
  }
  console.log(`[REFINE] Spliced donor panel channels for '${clipName}'`);
}

splicePanelChannels("idle");
splicePanelChannels("takeoff");

// Combine binary chunks
const totalBinary = Buffer.concat(chunks);
baseJson.buffers[0].byteLength = totalBinary.length;

// 2. Mirror hover and scout wing bones and enforce pure sagittal spine
function mirrorWingBonesAndSagittalSpine(clipName) {
  const clip = baseJson.animations.find(a => a.name === clipName);
  assert.ok(clip, `Clip ${clipName} not found`);

  const leftWingChannels = clip.channels.filter(ch => {
    const nodeName = baseNameByNode.get(ch.target.node) ?? "";
    return nodeName.startsWith("L_Wing");
  });

  for (const leftCh of leftWingChannels) {
    const leftName = baseNameByNode.get(leftCh.target.node);
    const rightName = leftName.replace("L_Wing", "R_Wing");
    const rightNode = baseNodeByName.get(rightName);
    if (rightNode === undefined) continue;

    const rightCh = clip.channels.find(
      ch => ch.target.node === rightNode && ch.target.path === leftCh.target.path
    );
    if (!rightCh) continue;

    const leftSampler = clip.samplers[leftCh.sampler];
    const rightSampler = clip.samplers[rightCh.sampler];
    const leftAccOut = baseJson.accessors[leftSampler.output];
    const rightAccOut = baseJson.accessors[rightSampler.output];

    const leftBv = baseJson.bufferViews[leftAccOut.bufferView];
    const rightBv = baseJson.bufferViews[rightAccOut.bufferView];

    const leftOffset = (leftBv.byteOffset || 0) + (leftAccOut.byteOffset || 0);
    const rightOffset = (rightBv.byteOffset || 0) + (rightAccOut.byteOffset || 0);

    const count = Math.min(leftAccOut.count, rightAccOut.count);

    if (leftCh.target.path === "rotation") {
      for (let i = 0; i < count; i++) {
        const oL = leftOffset + i * 16;
        const oR = rightOffset + i * 16;
        const x = totalBinary.readFloatLE(oL);
        const y = totalBinary.readFloatLE(oL + 4);
        const z = totalBinary.readFloatLE(oL + 8);
        const w = totalBinary.readFloatLE(oL + 12);

        totalBinary.writeFloatLE(x, oR);
        totalBinary.writeFloatLE(-y, oR + 4);
        totalBinary.writeFloatLE(-z, oR + 8);
        totalBinary.writeFloatLE(w, oR + 12);
      }
    } else if (leftCh.target.path === "translation") {
      for (let i = 0; i < count; i++) {
        const oL = leftOffset + i * 12;
        const oR = rightOffset + i * 12;
        const x = totalBinary.readFloatLE(oL);
        const y = totalBinary.readFloatLE(oL + 4);
        const z = totalBinary.readFloatLE(oL + 8);

        totalBinary.writeFloatLE(-x, oR);
        totalBinary.writeFloatLE(y, oR + 4);
        totalBinary.writeFloatLE(z, oR + 8);
      }
    }
  }

  // Pure sagittal spine
  for (const spineName of ["Spine1", "Spine2", "Spine3"]) {
    const nodeIdx = baseNodeByName.get(spineName);
    if (nodeIdx === undefined) continue;

    const rotCh = clip.channels.find(c => c.target.node === nodeIdx && c.target.path === "rotation");
    if (rotCh) {
      const sampler = clip.samplers[rotCh.sampler];
      const accOut = baseJson.accessors[sampler.output];
      const bvOut = baseJson.bufferViews[accOut.bufferView];
      const offsetOut = (bvOut.byteOffset || 0) + (accOut.byteOffset || 0);
      for (let i = 0; i < accOut.count; i++) {
        const o = offsetOut + i * 16;
        const x = totalBinary.readFloatLE(o);
        const w = totalBinary.readFloatLE(o + 12);
        const len = Math.hypot(x, w) || 1.0;
        totalBinary.writeFloatLE(x / len, o);
        totalBinary.writeFloatLE(0, o + 4);
        totalBinary.writeFloatLE(0, o + 8);
        totalBinary.writeFloatLE(w / len, o + 12);
      }
    }

    const locCh = clip.channels.find(c => c.target.node === nodeIdx && c.target.path === "translation");
    if (locCh) {
      const sampler = clip.samplers[locCh.sampler];
      const accOut = baseJson.accessors[sampler.output];
      const bvOut = baseJson.bufferViews[accOut.bufferView];
      const offsetOut = (bvOut.byteOffset || 0) + (accOut.byteOffset || 0);
      for (let i = 0; i < accOut.count; i++) {
        totalBinary.writeFloatLE(0, offsetOut + i * 12);
      }
    }
  }

  console.log(`[REFINE] Enforced symmetry on '${clipName}'`);
}

mirrorWingBonesAndSagittalSpine("hover");
mirrorWingBonesAndSagittalSpine("scout");

// Write out new GLB
const jsonBuf = Buffer.from(JSON.stringify(baseJson), "utf8");
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const totalJsonLen = jsonBuf.length + jsonPad;

const finalLen = 12 + 8 + totalJsonLen + 8 + totalBinary.length;
const out = Buffer.alloc(finalLen);
out.write("glTF", 0, "ascii");
out.writeUInt32LE(2, 4);
out.writeUInt32LE(finalLen, 8);
out.writeUInt32LE(totalJsonLen, 12);
out.writeUInt32LE(0x4e4f534a, 16);
jsonBuf.copy(out, 20);
out.fill(0x20, 20 + jsonBuf.length, 20 + totalJsonLen);

const binHeadOff = 20 + totalJsonLen;
out.writeUInt32LE(totalBinary.length, binHeadOff);
out.writeUInt32LE(0x004e4942, binHeadOff + 4);
totalBinary.copy(out, binHeadOff + 8);

writeFileSync(OUTPUT_GLB, out);
console.log(`[REFINE] Output written to ${OUTPUT_GLB} (${finalLen} bytes)`);
