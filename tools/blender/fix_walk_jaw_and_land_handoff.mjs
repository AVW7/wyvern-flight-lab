#!/usr/bin/env node
// A3: (1) Replace walk's static +8.6° open-jaw STEP track with the closed bind
// pose plus idle's own respiratory jaw motion sampled over walk's time grid.
// (2) Ease land's final settle window (t=2.0..3.0s) on Neck1/Neck2/Head,
// L/R_Thigh, L/R_Calf, L/R_Foot, L/R_WingRoot so land(end) matches idle(start)
// within <1.0°, eliminating the landing-completion snap.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";

await MeshoptDecoder.ready;

const INPUT = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const OUTPUT = process.argv[3] ?? INPUT;
const SETTLE_START = 2.0;
const LAND_BONES = ["Neck1", "Neck2", "Head",
  "L_Thigh", "R_Thigh", "L_Calf", "R_Calf", "L_Foot", "R_Foot", "L_WingRoot", "R_WingRoot"];

const { gltf, binary } = readGlb(readFileSync(INPUT));
const chunks = [binary];
let binLength = binary.length;

function decodeFloats(index) {
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
  assert.equal(a.componentType, 5126, "Expected float accessor");
  const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const stride = v.byteStride ?? ext?.byteStride ?? components * 4;
  return { a, components, values: Array.from({ length: a.count * components },
    (_, i) => data.readFloatLE(offset + Math.floor(i / components) * stride + (i % components) * 4)) };
}

function appendFloatAccessor(values, type) {
  const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
  const count = values.length / components;
  const buf = Buffer.alloc(values.length * 4);
  const mins = Array(components).fill(Infinity), maxs = Array(components).fill(-Infinity);
  values.forEach((v, i) => {
    buf.writeFloatLE(v, i * 4);
    const c = i % components;
    if (v < mins[c]) mins[c] = v;
    if (v > maxs[c]) maxs[c] = v;
  });
  const pad = (4 - (binLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    binLength += pad;
  }
  gltf.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: buf.length });
  chunks.push(buf);
  binLength += buf.length;
  gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: 5126, count, type, min: mins, max: maxs });
  return gltf.accessors.length - 1;
}

function slerp(a, b, t) {
  let [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot;
  }
  if (dot > 0.9995) {
    const q = [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az), aw + t * (bw - aw)];
    const len = Math.hypot(...q);
    return q.map(v => v / len);
  }
  const theta = Math.acos(Math.min(1, dot));
  const sa = Math.sin((1 - t) * theta) / Math.sin(theta);
  const sb = Math.sin(t * theta) / Math.sin(theta);
  return [ax * sa + bx * sb, ay * sa + by * sb, az * sa + bz * sb, aw * sa + bw * sb];
}
const smoothstep = t => t * t * (3 - 2 * t);
const angleDeg = (a, b) => {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
};
function sampleLinear(times, values, t) {
  if (t <= times[0]) return values.slice(0, 4);
  if (t >= times[times.length - 1]) return values.slice(-4);
  let hi = times.findIndex(x => x > t);
  const t0 = times[hi - 1], t1 = times[hi];
  const f = (t - t0) / (t1 - t0);
  return slerp(values.slice((hi - 1) * 4, hi * 4), values.slice(hi * 4, hi * 4 + 4), f);
}

const anims = Object.fromEntries(gltf.animations.map(a => [a.name, a]));
const nodeName = i => gltf.nodes[i].name;

// --- Part 1: walk jaw -------------------------------------------------------
const walk = anims.walk;
const idle = anims.idle;
assert.ok(walk && idle && anims.land, "Missing walk/idle/land");
const idleJawChannel = idle.channels.find(c => nodeName(c.target.node) === "Jaw" && c.target.path === "rotation");
assert.ok(idleJawChannel, "idle has no Jaw rotation channel");
const idleJawTimes = decodeFloats(idle.samplers[idleJawChannel.sampler].input).values;
const idleJawValues = decodeFloats(idle.samplers[idleJawChannel.sampler].output).values;

const walkJawChannel = walk.channels.find(c => nodeName(c.target.node) === "Jaw" && c.target.path === "rotation");
assert.ok(walkJawChannel, "walk has no Jaw rotation channel");
const walkNeck1 = walk.channels.find(c => nodeName(c.target.node) === "Neck1" && c.target.path === "rotation");
const walkTimes = decodeFloats(walk.samplers[walkNeck1.sampler].input).values;
const walkJawValues = walkTimes.map(t => sampleLinear(idleJawTimes, idleJawValues, t)).flat();
{
  const sampler = walk.samplers[walkJawChannel.sampler];
  sampler.input = appendFloatAccessor(walkTimes, "SCALAR");
  sampler.output = appendFloatAccessor(walkJawValues, "VEC4");
  sampler.interpolation = "LINEAR";
}
const bindJaw = gltf.nodes.find(n => n.name === "Jaw").rotation;
const walkJawMax = Math.max(...walkJawValues.reduce((rows, _, i) => i % 4 === 0 ? [...rows, walkJawValues.slice(i, i + 4)] : rows, [])
  .map(q => angleDeg(q, bindJaw)));
console.log(`[A3] walk Jaw: STEP +8.6° -> LINEAR ${walkTimes.length} keys, max deviation vs bind ${walkJawMax.toFixed(3)}°`);

// --- Part 2: land -> idle handoff ------------------------------------------
const land = anims.land;
const landDuration = Math.max(...land.samplers.map(s => gltf.accessors[s.input].max[0]));
assert.ok(Math.abs(landDuration - 3.0) < 1e-3, `land duration ${landDuration}`);

const idleStart = {};
for (const bone of LAND_BONES) {
  const ch = idle.channels.find(c => nodeName(c.target.node) === bone && c.target.path === "rotation");
  assert.ok(ch, `idle missing ${bone} rotation`);
  idleStart[bone] = decodeFloats(idle.samplers[ch.sampler].output).values.slice(0, 4);
}

let worstBefore = 0, worstAfter = 0;
for (const bone of LAND_BONES) {
  const ch = land.channels.find(c => nodeName(c.target.node) === bone && c.target.path === "rotation");
  assert.ok(ch, `land missing ${bone} rotation`);
  const sampler = land.samplers[ch.sampler];
  const times = decodeFloats(sampler.input).values;
  const values = decodeFloats(sampler.output).values;
  worstBefore = Math.max(worstBefore, angleDeg(values.slice(-4), idleStart[bone]));
  const out = [];
  for (let k = 0; k < times.length; k++) {
    const t = times[k];
    const q = values.slice(k * 4, k * 4 + 4);
    if (t < SETTLE_START) {
      out.push(...q);
    } else if (t >= landDuration - 1e-6) {
      out.push(...idleStart[bone]);
    } else {
      const f = smoothstep((t - SETTLE_START) / (landDuration - SETTLE_START));
      out.push(...slerp(q, idleStart[bone], f));
    }
  }
  worstAfter = Math.max(worstAfter, angleDeg(out.slice(-4), idleStart[bone]));
  sampler.output = appendFloatAccessor(out, "VEC4");
  sampler.interpolation = "LINEAR";
}
console.log(`[A3] land(end)->idle(start): worst joint angle ${worstBefore.toFixed(2)}° -> ${worstAfter.toFixed(4)}°`);
assert.ok(worstAfter < 1.0, "land->idle handoff still exceeds 1.0°");

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

const tmp = `${OUTPUT}.a3.tmp`;
writeValidatedRuntimeRig(tmp, out);
compactGlb(tmp, OUTPUT);
console.log(`[A3] Wrote ${OUTPUT}`);
