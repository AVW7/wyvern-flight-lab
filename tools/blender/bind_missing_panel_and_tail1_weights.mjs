#!/usr/bin/env node
// C2: Bind the 5 unweighted deforming bones. Membrane vertices spanning panels 0/1
// get smooth proximal batten weights on L/R_WingPanel0_0 and L/R_WingPanel1_0
// (taken from the D{p}P0/D{p+1}P0 digit weights that currently carry 100% of the
// proximal panel); proximal caudal vertices split Tail2's weight with Tail1.
// Keeps <= 4 influences per vertex and exact unit (255) weight sums.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Matrix4, Quaternion, Vector3 } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, inspectRuntimeRig, validateRuntimeRig, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";
import { createHash } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";

await MeshoptDecoder.ready;

const INPUT = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const OUTPUT = process.argv[3] ?? INPUT;

const PANEL_SHARE = 0.25; // fraction of proximal digit weight handed to WingPanel{p}_0
const TAIL1_SHARE = 0.3; // fraction of Tail2 weight handed to Tail1 for proximal caudal verts

const { gltf, binary } = readGlb(readFileSync(INPUT));
const chunks = [binary];
let binLength = binary.length;

function decode(index) {
  const a = gltf.accessors[index];
  const v = gltf.bufferViews[a.bufferView];
  const ext = v.extensions?.EXT_meshopt_compression;
  let data = binary, offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (ext) {
    const d = Buffer.alloc(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(d, ext.count, ext.byteStride,
      binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
    data = d; offset = a.byteOffset ?? 0;
  }
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  const stride = v.byteStride ?? ext?.byteStride ?? comps * size;
  const read = { 5120: "readInt8", 5121: "readUInt8", 5122: "readInt16LE", 5123: "readUInt16LE", 5125: "readUInt32LE", 5126: "readFloatLE" }[a.componentType];
  return { a, comps, size, get: (i, c) => data[read](offset + i * stride + c * size) };
}

function appendU8Accessor(values, type, normalized) {
  const components = { VEC4: 4, VEC3: 3 }[type];
  const count = values.length / components;
  const buf = Buffer.from(values);
  const pad = (4 - (binLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    binLength += pad;
  }
  gltf.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: buf.length });
  chunks.push(buf);
  binLength += buf.length;
  const accessor = { bufferView: gltf.bufferViews.length - 1, componentType: 5121, count, type,
    min: Array(components).fill(0), max: Array(components).fill(255) };
  // JOINTS_0 must stay non-normalized: three.js reads skinIndex raw, and a
  // normalized joints accessor turns bone indices into 0..1 floats.
  if (normalized) accessor.normalized = true;
  gltf.accessors.push(accessor);
  return gltf.accessors.length - 1;
}

// Bind-pose world positions via node-hierarchy TRS composition.
const parentOf = new Map();
gltf.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parentOf.set(c, i)));
const worldCache = new Map();
function worldMatrix(i) {
  if (worldCache.has(i)) return worldCache.get(i);
  const n = gltf.nodes[i];
  const local = new Matrix4();
  if (n.matrix) {
    local.fromArray(n.matrix);
  } else {
    local.compose(
      new Vector3(...(n.translation ?? [0, 0, 0])),
      new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
      new Vector3(...(n.scale ?? [1, 1, 1])),
    );
  }
  const world = parentOf.has(i) ? worldMatrix(parentOf.get(i)).clone().multiply(local) : local;
  worldCache.set(i, world);
  return world;
}
const nodeIndexByName = new Map(gltf.nodes.map((n, i) => [n.name, i]));
const bindWorldPos = name => new Vector3().setFromMatrixPosition(worldMatrix(nodeIndexByName.get(name)));

const jointIndexByName = new Map(gltf.skins[0].joints.map((nodeIdx, j) => [gltf.nodes[nodeIdx].name, j]));

function editSkinWeights(nodeName, edit) {
  const node = gltf.nodes.find(n => n.name === nodeName);
  const prim = gltf.meshes[node.mesh].primitives[0];
  const J = decode(prim.attributes.JOINTS_0);
  const W = decode(prim.attributes.WEIGHTS_0);
  const P = decode(prim.attributes.POSITION);
  assert.equal(J.a.componentType, 5121);
  assert.ok(W.a.normalized && W.a.componentType === 5121);
  const count = J.a.count;
  const joints = [], weights = [];
  let touched = 0;
  for (let i = 0; i < count; i++) {
    const ji = [0, 1, 2, 3].map(c => J.get(i, c));
    const wi = [0, 1, 2, 3].map(c => W.get(i, c));
    const pos = [P.get(i, 0), P.get(i, 1), P.get(i, 2)];
    if (edit(ji, wi, pos)) touched++;
    // Re-quantize to an exact 255 sum on the largest slots.
    let sum = wi.reduce((a, b) => a + b, 0);
    if (sum !== 255) {
      const order = [0, 1, 2, 3].sort((a, b) => wi[b] - wi[a]);
      let diff = 255 - sum;
      for (const slot of order) {
        if (diff === 0) break;
        const delta = Math.max(-wi[slot], Math.min(255 - wi[slot], diff));
        wi[slot] += delta;
        diff -= delta;
      }
      assert.equal(wi.reduce((a, b) => a + b, 0), 255, `vertex ${i} cannot renormalize`);
    }
    joints.push(...ji);
    weights.push(...wi);
  }
  prim.attributes.JOINTS_0 = appendU8Accessor(joints, "VEC4", false);
  prim.attributes.WEIGHTS_0 = appendU8Accessor(weights, "VEC4", true);
  console.log(`[C2] ${nodeName}: edited ${touched}/${count} vertices`);
}

// Transfer `delta` (0..255) into `targetJoint`, taking from slots in `fromSlots`.
function transfer(ji, wi, targetJoint, fromSlots, delta) {
  const jointIdx = jointIndexByName.get(targetJoint);
  assert.notEqual(jointIdx, undefined, `unknown joint ${targetJoint}`);
  const available = fromSlots.reduce((a, s) => a + wi[s], 0);
  if (available <= 0 || delta <= 0) return false;
  delta = Math.min(delta, available);
  let slot = ji.indexOf(jointIdx);
  if (slot === -1) {
    const zero = wi.indexOf(0);
    if (zero !== -1) {
      slot = zero;
    } else {
      // Evict the smallest influence if it is smaller than the incoming weight.
      let smallest = 0;
      for (let c = 1; c < 4; c++) if (wi[c] < wi[smallest]) smallest = c;
      if (fromSlots.includes(smallest) || wi[smallest] >= delta) return false;
      wi[fromSlots[0]] += wi[smallest]; // keep the evicted mass on the lead digit
      wi[smallest] = 0;
      slot = smallest;
    }
    ji[slot] = jointIdx;
  }
  let remaining = delta;
  for (const s of fromSlots) {
    const take = Math.min(wi[s], remaining);
    wi[s] -= take;
    remaining -= take;
    if (remaining === 0) break;
  }
  wi[slot] += delta - remaining;
  return remaining < delta;
}

// --- Membrane panels --------------------------------------------------------
editSkinWeights("WyvernMembrane_ExportSafe", (ji, wi) => {
  let touched = false;
  for (const side of ["L", "R"]) {
    for (const p of [0, 1]) {
      const digitA = jointIndexByName.get(`${side}_WingD${p}P0`);
      const digitB = jointIndexByName.get(`${side}_WingD${p + 1}P0`);
      const slots = [0, 1, 2, 3].filter(c => ji[c] === digitA || ji[c] === digitB);
      const digitMass = slots.reduce((a, s) => a + wi[s], 0);
      if (digitMass < 13) continue; // only bind where digits carry real proximal weight
      const delta = Math.round(digitMass * PANEL_SHARE);
      touched = transfer(ji, wi, `${side}_WingPanel${p}_0`, slots, delta) || touched;
    }
  }
  return touched;
});

// --- Tail1 ------------------------------------------------------------------
const tail1Pos = bindWorldPos("Tail1");
const tail2Pos = bindWorldPos("Tail2");
const tail2Joint = jointIndexByName.get("Tail2");
const vPos = new Vector3();
editSkinWeights("WyvernBody_Rebuild", (ji, wi, pos) => {
  const slots = [0, 1, 2, 3].filter(c => ji[c] === tail2Joint);
  if (slots.length === 0) return false;
  vPos.set(pos[0], pos[1], pos[2]);
  // Proximal caudal vertices sit nearer the Tail1 head than the Tail2 head.
  if (vPos.distanceTo(tail1Pos) >= vPos.distanceTo(tail2Pos)) return false;
  const mass = slots.reduce((a, s) => a + wi[s], 0);
  const delta = Math.round(mass * TAIL1_SHARE);
  return transfer(ji, wi, "Tail1", slots, delta);
});

// --- Write ------------------------------------------------------------------
gltf.buffers[0].byteLength = binLength;
const json = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPad = (4 - (json.length % 4)) % 4;
const paddedJson = jsonPad ? Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]) : json;
const binPad = (4 - (binLength % 4)) % 4;
if (binPad) {
  chunks.push(Buffer.alloc(binPad));
  binLength += binPad;
}
const bin = Buffer.concat(chunks, binLength);
const out = Buffer.alloc(28 + paddedJson.length + bin.length);
out.write("glTF", 0, 4, "ascii");
out.writeUInt32LE(2, 4);
out.writeUInt32LE(out.length, 8);
out.writeUInt32LE(paddedJson.length, 12);
out.writeUInt32LE(0x4e4f534a, 16);
paddedJson.copy(out, 20);
out.writeUInt32LE(bin.length, 20 + paddedJson.length);
out.writeUInt32LE(0x004e4942, 24 + paddedJson.length);
bin.copy(out, 28 + paddedJson.length);

const tmp = `${OUTPUT}.c2.tmp`;
writeFileSync(tmp, out);
try {
  // Weight fingerprints legitimately change: re-sign the contract BEFORE
  // compacting, because compactGlb validates against the on-disk contract.
  const contractPath = "scripts/blender/wyvern_v2_runtime_contract.json";
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.signature = inspectRuntimeRig(out);
  writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
  compactGlb(tmp, tmp);
  const finalBytes = readFileSync(tmp);
  contract.signature = inspectRuntimeRig(finalBytes);
  contract.asset.sha256 = createHash("sha256").update(finalBytes).digest("hex");
  contract.asset.bytes = finalBytes.length;
  writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
  writeValidatedRuntimeRig(OUTPUT, finalBytes);
  const validation = validateRuntimeRig(readFileSync(OUTPUT));
  console.log(`[C2] Wrote ${OUTPUT}: ${JSON.stringify(validation)}`);
} finally {
  rmSync(tmp, { force: true });
}
