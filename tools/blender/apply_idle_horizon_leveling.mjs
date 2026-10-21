#!/usr/bin/env node
// Apply the horizon-leveling counter-pitch (Neck1 -4.0°, Neck2 -5.0°, Head -3.5°)
// to idle's neck/head rotation tracks so idle's net world head pitch sits at
// ~+0.4° instead of drooping +13.0° under Body's +12.9° forward pitch.
// Mirrors the corrected lift in upgrade_v2_rig_ground_and_membrane.mjs, applied
// as a GLB post-pass because that upgrader's source donor is no longer in the repo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";

await MeshoptDecoder.ready;

const INPUT = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const OUTPUT = process.argv[3] ?? INPUT;
const LIFT_DEG = { Neck1: -4.0, Neck2: -5.0, Head: -3.5 };

const { gltf, binary } = readGlb(readFileSync(INPUT));
const idle = gltf.animations.find(a => a.name === "idle");
assert.ok(idle, "No idle animation");

function decodeFloats(index) {
  const a = gltf.accessors[index];
  const v = gltf.bufferViews[a.bufferView];
  const ext = v.extensions?.EXT_meshopt_compression;
  let data = binary;
  let offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (ext) {
    const decoded = Buffer.alloc(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(decoded, ext.count, ext.byteStride,
      binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
    data = decoded;
    offset = a.byteOffset ?? 0;
  }
  assert.equal(a.componentType, 5126, "Expected float accessor");
  const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const stride = v.byteStride ?? ext?.byteStride ?? components * 4;
  return { a, components, values: Array.from({ length: a.count * components },
    (_, i) => data.readFloatLE(offset + Math.floor(i / components) * stride + (i % components) * 4)) };
}

function quatFromXDeg(deg) {
  const half = (deg * Math.PI) / 360;
  return [Math.sin(half), 0, 0, Math.cos(half)];
}
function quatMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

const chunks = [binary];
let binLength = binary.length;
let touched = 0;

for (const channel of idle.channels) {
  const name = gltf.nodes[channel.target.node].name;
  if (channel.target.path !== "rotation" || !(name in LIFT_DEG)) continue;
  const sampler = idle.samplers[channel.sampler];
  const { a, components, values } = decodeFloats(sampler.output);
  assert.equal(components, 4);
  const lift = quatFromXDeg(LIFT_DEG[name]);
  const out = [];
  for (let k = 0; k < a.count; k++) {
    const q = quatMul(lift, values.slice(k * 4, k * 4 + 4));
    const len = Math.hypot(...q);
    out.push(...q.map(v => v / len));
  }
  const buf = Buffer.alloc(out.length * 4);
  out.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  const pad = (4 - (binLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    binLength += pad;
  }
  gltf.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: buf.length });
  chunks.push(buf);
  binLength += buf.length;
  gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: 5126,
    count: a.count, type: "VEC4",
    min: [0, 1, 2, 3].map(c => Math.min(...out.filter((_, i) => i % 4 === c))),
    max: [0, 1, 2, 3].map(c => Math.max(...out.filter((_, i) => i % 4 === c))) });
  sampler.output = gltf.accessors.length - 1;
  touched++;
  console.log(`[LEVEL] idle ${name}: premultiplied ${LIFT_DEG[name]}° across ${a.count} keys`);
}
assert.equal(touched, 3, "Expected Neck1/Neck2/Head rotation channels in idle");

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

const tmp = `${OUTPUT}.leveling.tmp`;
writeValidatedRuntimeRig(tmp, out);
compactGlb(tmp, OUTPUT);
console.log(`[LEVEL] Wrote ${OUTPUT}`);
