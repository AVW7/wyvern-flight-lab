#!/usr/bin/env node
// D2: Reshape the BUZZ-class clips (takeoff, death) at GLB level.
//
// takeoff: quiet crouch (t<0.55s, damped), explosive downstroke/launch window
//          (0.55..0.85s, high gain about the window-entry pivot), then two
//          progressive climb beats whose final 0.5s blends every rotation
//          channel onto cruise frame 0 (killing the takeoff->cruise jump).
// death:   whole-clip gain-from-bind across every rotation channel, followed by
//          a 3-key temporal smoothing pass, with the gain solved against the
//          official 60 Hz world-space dynamics metric.
//
// Both gains are SOLVED by measuring the candidate with the project's own
// scripts/wyvern-dynamics.mjs, not typed.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, encodeGlb, validateRuntimeRig, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";
import { loadRig, measureDynamics } from "../../scripts/wyvern-dynamics.mjs";

await MeshoptDecoder.ready;

const INPUT = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const OUTPUT = process.argv[3] ?? INPUT;

const TAKEOFF_TARGETS = {
  peak: 3376.92, p95: 1086.96, meanMin: 474.53, meanMax: 949.05, accelMax: 300838.9,
};
const DEATH_TARGETS = {
  peak: 1050.11, p95: 734.19, meanMin: 351.81, meanMax: 703.62, accelMax: 46127.79,
};

// --- glTF helpers ------------------------------------------------------------
function decodeFloats(gltf, binary, index) {
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
  assert.equal(a.componentType, 5126);
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const stride = v.byteStride ?? ext?.byteStride ?? comps * 4;
  return { a, comps, values: Array.from({ length: a.count * comps },
    (_, i) => data.readFloatLE(offset + Math.floor(i / comps) * stride + (i % comps) * 4)) };
}

function makeAppendor(gltf, binary) {
  const chunks = [binary];
  let binLength = binary.length;
  return {
    appendFloats(values, type) {
      const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
      const count = values.length / comps;
      const buf = Buffer.alloc(values.length * 4);
      const mins = Array(comps).fill(Infinity), maxs = Array(comps).fill(-Infinity);
      values.forEach((v, i) => {
        buf.writeFloatLE(v, i * 4);
        const c = i % comps;
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
    },
    finish() {
      const pad = (4 - (binLength % 4)) % 4;
      if (pad) {
        chunks.push(Buffer.alloc(pad));
        binLength += pad;
      }
      gltf.buffers[0].byteLength = binLength;
      return Buffer.concat(chunks, binLength);
    },
  };
}

const nodeName = (gltf, i) => gltf.nodes[i].name;

// Quaternion power: q^g about identity (angle scaled by g, axis preserved).
function qpow(q, g) {
  const qw = Math.max(-1, Math.min(1, q[3]));
  const angle = 2 * Math.acos(qw);
  const sinHalf = Math.hypot(q[0], q[1], q[2]);
  if (sinHalf < 1e-9) return [0, 0, 0, 1];
  const scaled = angle * g;
  const s = Math.sin(scaled / 2) / sinHalf;
  return [q[0] * s, q[1] * s, q[2] * s, Math.cos(scaled / 2)];
}
function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qinv(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}
function qnorm(q) {
  const l = Math.hypot(...q);
  return q.map(v => v / l);
}
// shortest-path slerp
function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    bb = b.map(v => -v);
    d = -d;
  }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + t * (bb[i] - v)));
  const theta = Math.acos(d);
  const sa = Math.sin((1 - t) * theta) / Math.sin(theta);
  const sb = Math.sin(t * theta) / Math.sin(theta);
  return a.map((v, i) => v * sa + bb[i] * sb);
}
const smoothstep = t => t * t * (3 - 2 * t);

function sampleTrack(times, values, t) {
  if (t <= times[0]) return values.slice(0, 4);
  if (t >= times[times.length - 1]) return values.slice(-4);
  let hi = times.findIndex(x => x > t);
  return qslerp(values.slice((hi - 1) * 4, hi * 4), values.slice(hi * 4, hi * 4 + 4), (t - times[hi - 1]) / (times[hi] - times[hi - 1]));
}

/** Rotation channels of `anim`, decoded. */
function rotationChannels(gltf, binary, anim, boneFilter = null) {
  const out = [];
  for (const ch of anim.channels) {
    if (ch.target.path !== "rotation") continue;
    const name = nodeName(gltf, ch.target.node);
    if (boneFilter && !boneFilter(name)) continue;
    const sampler = anim.samplers[ch.sampler];
    out.push({
      ch, sampler, name,
      times: decodeFloats(gltf, binary, sampler.input).values,
      values: decodeFloats(gltf, binary, sampler.output).values,
    });
  }
  return out;
}

async function measureClip(bytes, clipName) {
  const tmp = `/tmp/reshape-buzz-measure-${process.pid}.glb`;
  writeFileSync(tmp, bytes);
  try {
    const rig = await loadRig(tmp);
    return measureDynamics(rig)[clipName];
  } finally {
    rmSync(tmp, { force: true });
  }
}

// === takeoff =================================================================
async function reshapeTakeoff(gltf, binary, app, toBytes) {
  const anim = gltf.animations.find(a => a.name === "takeoff");
  const cruise = gltf.animations.find(a => a.name === "cruise");
  assert.ok(anim && cruise);
  const duration = 3.0;
  const WINDOW_START = 0.55, WINDOW_END = 0.85, BLEND_START = 2.5;

  const cruiseStart = new Map();
  for (const rc of rotationChannels(gltf, binary, cruise)) {
    cruiseStart.set(rc.name, rc.values.slice(0, 4));
  }
  const channels = rotationChannels(gltf, binary, anim);

  const build = (gain, smoothing) => {
    const writes = [];
    for (const rc of channels) {
      const pivot = sampleTrack(rc.times, rc.values, WINDOW_START);
      const cruise0 = cruiseStart.get(rc.name);
      let out = [];
      for (let k = 0; k < rc.times.length; k++) {
        const t = rc.times[k];
        let q = rc.values.slice(k * 4, k * 4 + 4);
        if (t < WINDOW_START) {
          // Quiet crouch anticipation: damp rotation about the clip start.
          const anchor = rc.values.slice(0, 4);
          q = qnorm(qmul(anchor, qpow(qmul(qinv(anchor), q), 0.55)));
        } else if (t < WINDOW_END) {
          // Explosive launch: amplify rotation about the window-entry pivot.
          q = qnorm(qmul(pivot, qpow(qmul(qinv(pivot), q), gain)));
        }
        if (cruise0 && t >= BLEND_START) {
          const f = smoothstep(Math.min(1, (t - BLEND_START) / (duration - BLEND_START)));
          q = qslerp(q, cruise0, f);
        }
        out.push(...q);
      }
      for (let pass = 0; pass < smoothing; pass++) {
        const smoothed = out.slice(0, 4);
        for (let k = 1; k < rc.times.length - 1; k++) {
          const prev = out.slice((k - 1) * 4, k * 4);
          const cur = out.slice(k * 4, k * 4 + 4);
          const next = out.slice((k + 1) * 4, (k + 2) * 4);
          const blended = qslerp(qslerp(prev, cur, 0.5), next, 0.5).map((v, i) => v * 0.5 + cur[i] * 0.5);
          smoothed.push(...qnorm(blended));
        }
        smoothed.push(...out.slice(-4));
        out = smoothed;
      }
      writes.push({ rc, out });
    }
    return writes;
  };

  // Solve the launch gain against the official metric, escalating smoothing if
  // the launch window's acceleration overshoots the V1-scaled cap.
  let best = null;
  outer: for (const smoothing of [0, 1, 2]) {
    let lo = 1.0, hi = 16.0;
    for (let iter = 0; iter < 10; iter++) {
      const gain = (lo + hi) / 2;
      const bytes = toBytes(build(gain, smoothing));
      const m = await measureClip(bytes, "takeoff");
      const overAccel = m.accelMax > TAKEOFF_TARGETS.accelMax;
      const enough = m.peak >= TAKEOFF_TARGETS.peak && m.p95 >= TAKEOFF_TARGETS.p95 && m.mean >= TAKEOFF_TARGETS.meanMin;
      const ok = enough && !overAccel && m.mean <= TAKEOFF_TARGETS.meanMax;
      console.log(`[D2] takeoff gain=${gain.toFixed(2)} smooth=${smoothing} peak=${m.peak.toFixed(0)} p95=${m.p95.toFixed(0)} mean=${m.mean.toFixed(0)} accel=${m.accelMax.toFixed(0)} sustained=${m.sustained} ${ok ? "OK" : ""}`);
      if (ok) {
        best = { gain, smoothing, writes: build(gain, smoothing) };
        break outer; // first (least-smoothed) passing solution wins
      }
      if (overAccel) hi = gain;
      else if (!enough) lo = gain;
      else hi = gain;
    }
  }
  assert.ok(best, "takeoff: no gain satisfies the dynamics gate");
  for (const { rc, out } of best.writes) {
    rc.sampler.output = app.appendFloats(out, "VEC4");
  }
  console.log(`[D2] takeoff reshaped with launch gain ${best.gain.toFixed(2)}, smoothing passes ${best.smoothing}`);
  return best.gain;
}

// === death ===================================================================
async function reshapeDeath(gltf, binary, app, toBytes) {
  const anim = gltf.animations.find(a => a.name === "death");
  assert.ok(anim);
  const channels = rotationChannels(gltf, binary, anim);
  const bindRot = new Map();
  for (const node of gltf.nodes) {
    if (node.name) bindRot.set(node.name, node.rotation ?? [0, 0, 0, 1]);
  }

  const build = (gain, smoothing) => {
    const writes = [];
    for (const rc of channels) {
      const bind = bindRot.get(rc.name) ?? [0, 0, 0, 1];
      let out = [];
      for (let k = 0; k < rc.times.length; k++) {
        const q = rc.values.slice(k * 4, k * 4 + 4);
        out.push(...qnorm(qmul(bind, qpow(qmul(qinv(bind), q), gain))));
      }
      for (let pass = 0; pass < smoothing; pass++) {
        const smoothed = out.slice(0, 4);
        for (let k = 1; k < rc.times.length - 1; k++) {
          const prev = out.slice((k - 1) * 4, k * 4);
          const cur = out.slice(k * 4, k * 4 + 4);
          const next = out.slice((k + 1) * 4, (k + 2) * 4);
          const blended = qslerp(qslerp(prev, cur, 0.5), next, 0.5).map((v, i) => v * 0.5 + cur[i] * 0.5);
          smoothed.push(...qnorm(blended));
        }
        smoothed.push(...out.slice(-4));
        out = smoothed;
      }
      writes.push({ rc, out });
    }
    return writes;
  };

  let best = null;
  outer: for (const smoothing of [0, 1, 2]) {
    let lo = 1.0, hi = 5.0;
    for (let iter = 0; iter < 8; iter++) {
      const gain = (lo + hi) / 2;
      const bytes = toBytes(build(gain, smoothing));
      const m = await measureClip(bytes, "death");
      const overAccel = m.accelMax > DEATH_TARGETS.accelMax;
      const enough = m.peak >= DEATH_TARGETS.peak && m.p95 >= DEATH_TARGETS.p95 && m.mean >= DEATH_TARGETS.meanMin;
      const ok = enough && !overAccel && m.mean <= DEATH_TARGETS.meanMax;
      console.log(`[D2] death gain=${gain.toFixed(2)} smooth=${smoothing} peak=${m.peak.toFixed(0)} p95=${m.p95.toFixed(0)} mean=${m.mean.toFixed(0)} accel=${m.accelMax.toFixed(0)} ${ok ? "OK" : ""}`);
      if (ok) {
        best = { gain, smoothing, writes: build(gain, smoothing) };
        break outer;
      }
      if (overAccel) hi = gain;
      else if (!enough) lo = gain;
      else hi = gain;
    }
  }
  assert.ok(best, "death: no gain/smoothing satisfies the dynamics gate");
  for (const { rc, out } of best.writes) {
    rc.sampler.output = app.appendFloats(out, "VEC4");
  }
  console.log(`[D2] death reshaped with gain ${best.gain.toFixed(2)}, smoothing passes ${best.smoothing}`);
}

// Trials encode via structuredClone of the working JSON so rejected gains never
// leak into the shipped buffer; final writes append into the real JSON.
let currentBytes = readFileSync(INPUT);

// takeoff
{
  const { gltf, binary } = readGlb(currentBytes);
  const app = makeAppendor(gltf, binary);
  const trialBytes = (writes) => {
    const trial = structuredClone(gltf);
    const tAnim = trial.animations.find(a => a.name === "takeoff");
    const tApp = makeAppendor(trial, binary);
    const channels = rotationChannels(trial, binary, tAnim);
    const byName = new Map(channels.map(c => [c.name, c]));
    for (const { rc, out } of writes) byName.get(rc.name).sampler.output = tApp.appendFloats(out, "VEC4");
    return encodeGlb(trial, tApp.finish());
  };
  await reshapeTakeoff(gltf, binary, app, trialBytes);
  // build() inside reshapeTakeoff appended final outputs already
  currentBytes = encodeGlb(gltf, app.finish());
}

// death
{
  const { gltf, binary } = readGlb(currentBytes);
  const app = makeAppendor(gltf, binary);
  const trialBytes = (writes) => {
    const trial = structuredClone(gltf);
    const tAnim = trial.animations.find(a => a.name === "death");
    const tApp = makeAppendor(trial, binary);
    const channels = rotationChannels(trial, binary, tAnim);
    const byName = new Map(channels.map(c => [c.name, c]));
    for (const { rc, out } of writes) byName.get(rc.name).sampler.output = tApp.appendFloats(out, "VEC4");
    return encodeGlb(trial, tApp.finish());
  };
  await reshapeDeath(gltf, binary, app, trialBytes);
  currentBytes = encodeGlb(gltf, app.finish());
}

// === Write through the contract ==============================================
const tmp = `${OUTPUT}.d2.tmp`;
writeFileSync(tmp, currentBytes);
try {
  compactGlb(tmp, tmp);
  const finalBytes = readFileSync(tmp);
  const isRuntimePath = resolve(OUTPUT) === resolve("public/models/wyvern-v2-rig.glb");
  if (isRuntimePath) {
    const contractPath = "scripts/blender/wyvern_v2_runtime_contract.json";
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    contract.asset.sha256 = createHash("sha256").update(finalBytes).digest("hex");
    contract.asset.bytes = finalBytes.length;
    writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
  }
  writeValidatedRuntimeRig(OUTPUT, finalBytes);
  console.log(`[D2] Wrote ${OUTPUT}: ${JSON.stringify(validateRuntimeRig(readFileSync(OUTPUT), { checkHash: isRuntimePath }))}`);
} finally {
  rmSync(tmp, { force: true });
}
