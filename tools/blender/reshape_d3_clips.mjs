#!/usr/bin/env node
// D3: give idle, walk and attack2 the motion character their V1 cousins have.
//
// Measured fact this tool exists for: every V1 clip carries a *floor* of
// continuous angular velocity, not just accents. Idle never drops below 47
// deg/s, GroundWalk below 194, AttackClaw below 197 — because V1 keys all 640
// tracks and the motion ripples continuously through the skeleton. V2 keys 92
// channels but leaves most of them static, so its clips read as a few big
// moves separated by stillness:
//
//   clip      min   p25   p50   p95    mean   V1 p95
//   idle       ?      ?     ?     19     15      239
//   walk       ?      ?     ?    315    238     1127
//   attack2    ?      ?     ?    685    345     1372
//
// So the fix is not "amplify" (that scales peak and accel together and leaves
// the floor where it is). It is:
//
//   idle    a travelling secondary-motion ripple through spine/neck/tail/wing
//           root, phase-offset per bone so *some* bone is always moving, plus
//           two settle accents. Solves the floor amplitude to land `mean` in
//           band, then the accent amplitude to land `p95`.
//   walk    the same ripple on the caudal chain and wing roots (the legs are
//           off limits: D1 pins grounded footY to the -184 plane), solved
//           harder, because a walk should read as busy rather than graceful.
//   attack2 the opposite problem — the tail whip is jittery (accelMax 2.27x the
//           V1-scaled cap) while its p95 is only 0.50x. Temporal smoothing
//           first, then gain, solved jointly.
//
// Bone safety rules, learned from the tests this must not break:
//   - never rotate a wing *digit* (WingD*P*) independently: the panel
//     coordination test compares each panel's bind-delta against the slerp of
//     its two adjacent digits, so an independent digit rotation desynchronises
//     the membrane. Ancestors (WingRoot/Shoulder/Elbow/Wrist/Hand) are safe
//     because they rotate digits and panels by the same world quaternion.
//   - never rotate Body or the legs: Body translation is pinned (bodyRng 0.0)
//     and grounded footY must stay on the canonical -184 plane.
//   - looping clips get an integer number of ripple cycles over the clip, so
//     the loop seam stays continuous in both value and velocity.
//
// Every amplitude below is SOLVED by measuring the candidate through
// scripts/wyvern-dynamics.mjs, the same 60 Hz world-space metric the gate uses.
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

// Gate limits are reference * 0.7 / 0.8 / [0.7, 1.4] / 1.25, with the reference
// numbers read straight out of the committed V1 audit.
const TARGETS = {
  idle: { peak: 259.1, p95: 191.1, meanMin: 55.7, meanMax: 111.3, accelMax: 16499 },
  walk: { peak: 888.0, p95: 901.5, meanMin: 373.6, meanMax: 747.3, accelMax: 47038 },
  attack2: { peak: 1036.3, p95: 1097.6, meanMin: 447.2, meanMax: 894.4, accelMax: 46128 },
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
  return Array.from({ length: a.count * comps },
    (_, i) => data.readFloatLE(offset + Math.floor(i / comps) * stride + (i % comps) * 4));
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
      if (pad) { chunks.push(Buffer.alloc(pad)); binLength += pad; }
      gltf.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: buf.length });
      chunks.push(buf);
      binLength += buf.length;
      gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: 5126, count, type, min: mins, max: maxs });
      return gltf.accessors.length - 1;
    },
    finish() {
      const pad = (4 - (binLength % 4)) % 4;
      if (pad) { chunks.push(Buffer.alloc(pad)); binLength += pad; }
      gltf.buffers[0].byteLength = binLength;
      return Buffer.concat(chunks, binLength);
    },
  };
}

// --- quaternion helpers ------------------------------------------------------
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => { const l = Math.hypot(...q); return q.map((v) => v / l); };
const qaxis = (axis, radians) => {
  const s = Math.sin(radians / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(radians / 2)];
};
const qpow = (q, g) => {
  const qw = Math.max(-1, Math.min(1, q[3]));
  const angle = 2 * Math.acos(qw);
  const sinHalf = Math.hypot(q[0], q[1], q[2]);
  if (sinHalf < 1e-9) return [0, 0, 0, 1];
  const s = Math.sin((angle * g) / 2) / sinHalf;
  return [q[0] * s, q[1] * s, q[2] * s, Math.cos((angle * g) / 2)];
};
const qslerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + t * (bb[i] - v)));
  const theta = Math.acos(d);
  const sa = Math.sin((1 - t) * theta) / Math.sin(theta);
  const sb = Math.sin(t * theta) / Math.sin(theta);
  return a.map((v, i) => v * sa + bb[i] * sb);
};

/** Rotation channels of `anim`, decoded, keyed by bone name. */
function rotationChannels(gltf, binary, anim) {
  const out = [];
  for (const ch of anim.channels) {
    if (ch.target.path !== "rotation") continue;
    const sampler = anim.samplers[ch.sampler];
    out.push({
      ch, sampler, name: gltf.nodes[ch.target.node].name,
      times: decodeFloats(gltf, binary, sampler.input),
      values: decodeFloats(gltf, binary, sampler.output),
    });
  }
  return out;
}

/**
 * Channels no D3 edit may touch, because Task D1 pinned them: Body translation
 * is frozen (bodyRng 0.0) and grounded footY sits on the canonical -184 plane.
 * Rotating Body, Spine1 or any leg bone moves the feet off that plane — the
 * leg chain is Body > Spine1 > L_LegRoot > ... , so Spine1 is a leg ancestor
 * even though it reads as a torso bone.
 */
const PROTECTED = new Set([
  "Root", "RootMotion", "Body", "Spine1",
  ...["L", "R"].flatMap((s) => ["LegRoot", "Thigh", "Calf", "Foot", "Toes"].map((b) => `${s}_${b}`)),
]);

/**
 * Wing digits and membrane panels are excluded from any gain or smoothing.
 * Each panel is parented to one digit but is validated against the slerp of
 * two *adjacent* digits, so scaling a digit's local rotation moves its own
 * panel and not the neighbour's — measured as 13.94 deg of neighbour error on
 * attack2 before this guard. Rotating WingHand or above is safe: it carries
 * every digit and every panel by the same world quaternion.
 */
const PANEL_COUPLED = /(^|_)Wing(D\d|Panel)/;

// --- the ripple --------------------------------------------------------------
/**
 * Bone groups that may carry secondary motion, with the local axis each one
 * flexes about and how far its phase trails the previous bone in the chain.
 * Chains are ordered root -> tip.
 *
 * `rampStart` is the fraction of the solved amplitude the chain's root bone
 * gets; the tip always gets the full amount. A flat-amplitude ripple makes the
 * tail read as a rigid rod swinging, and the idle kinetics test requires the
 * wave to grow toward the tip (tail10 > tail1).
 */
const GROUPS = {
  tail: { bones: Array.from({ length: 10 }, (_, i) => `Tail${i + 1}`), axis: [1, 0, 0], phaseStep: 0.9, rampStart: 0.35 },
  neck: { bones: ["Neck1", "Neck2", "Head"], axis: [1, 0, 0], phaseStep: 1.1, rampStart: 1 },
  spine: { bones: ["Spine2", "Spine3"], axis: [1, 0, 0], phaseStep: 1.3, rampStart: 1 },
  wing: {
    bones: ["L_WingRoot", "L_WingShoulder", "R_WingRoot", "R_WingShoulder"],
    axis: [0, 0, 1], phaseStep: 1.5, rampStart: 1,
  },
};

/** Amplitude multiplier for bone `index` of a chain of `n`. */
const rampFor = (group, index, n) => {
  const start = GROUPS[group].rampStart ?? 1;
  return n === 1 ? 1 : start + (1 - start) * (index / (n - 1));
};

/**
 * Add `amplitudeDeg * sin(2pi f t + phase)` about `axis` to each bone in
 * `groupNames`, post-multiplied in the bone's own frame. `cycles` is forced
 * integral for looping clips so the seam stays continuous.
 */
function ripple(rc, { group, amplitudeDeg, cycles, duration }) {
  const { axis, phaseStep, bones } = GROUPS[group];
  const index = bones.indexOf(rc.name);
  if (index < 0) return null;
  const phase = index * phaseStep;
  const amp = amplitudeDeg * rampFor(group, index, bones.length);
  const out = [];
  for (let k = 0; k < rc.times.length; k++) {
    const t = rc.times[k];
    const theta = ((amp * Math.PI) / 180) * Math.sin((2 * Math.PI * cycles * t) / duration + phase);
    out.push(...qnorm(qmul(rc.values.slice(k * 4, k * 4 + 4), qaxis(axis, theta))));
  }
  return out;
}

/** Raised-cosine pulse, zero outside [t0 - half, t0 + half]. */
function accentPulse(t, t0, half) {
  const d = Math.abs(t - t0);
  if (d >= half) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / half));
}

function addAccent(base, rc, { group, amplitudeDeg, t0, half }) {
  const { axis, bones } = GROUPS[group];
  const index = bones.indexOf(rc.name);
  if (index < 0) return null;
  const amp = amplitudeDeg * rampFor(group, index, bones.length);
  const out = [];
  for (let k = 0; k < rc.times.length; k++) {
    const theta = ((amp * Math.PI) / 180) * accentPulse(rc.times[k], t0, half);
    out.push(...qnorm(qmul(base.slice(k * 4, k * 4 + 4), qaxis(axis, theta))));
  }
  return out;
}

/** Temporal smoothing pass over a channel's keys (endpoints held). */
function smoothOnce(values, keyCount) {
  const out = values.slice(0, 4);
  for (let k = 1; k < keyCount - 1; k++) {
    const prev = values.slice((k - 1) * 4, k * 4);
    const cur = values.slice(k * 4, k * 4 + 4);
    const next = values.slice((k + 1) * 4, (k + 2) * 4);
    const blended = qslerp(qslerp(prev, cur, 0.5), next, 0.5).map((v, i) => v * 0.5 + cur[i] * 0.5);
    out.push(...qnorm(blended));
  }
  out.push(...values.slice(-4));
  return out;
}

// --- measuring ---------------------------------------------------------------
async function measureClip(bytes, clipName) {
  const tmp = `/tmp/reshape-d3-measure-${process.pid}.glb`;
  writeFileSync(tmp, bytes);
  try {
    const rig = await loadRig(tmp);
    return measureDynamics(rig)[clipName];
  } finally {
    rmSync(tmp, { force: true });
  }
}

const inBand = (m, t) => m.peak >= t.peak && m.p95 >= t.p95 && m.mean >= t.meanMin && m.mean <= t.meanMax && m.accelMax <= t.accelMax;
const fmt = (m) => `peak=${m.peak.toFixed(0)} p95=${m.p95.toFixed(0)} mean=${m.mean.toFixed(0)} accel=${m.accelMax.toFixed(0)}`;

// Bisection converges *to* a limit, so solving for exactly `>= limit` parks the
// result on the boundary and flips pass/fail on the last decimal. Aim a few
// percent inside instead; the margin is cheaper than a knife-edge asset.
const MARGIN = 1.03;
const solveTarget = (t) => ({ ...t, p95: t.p95 * MARGIN, meanMin: t.meanMin * MARGIN });
// An accent that solves to nothing was not needed: the floor already cleared
// p95. Reporting it as an applied accent would be a lie, so drop it.
const MIN_ACCENT_DEG = 0.5;

// --- per-clip builds ---------------------------------------------------------
/**
 * Ripple + accents. Returns a write list; pure, so the solver can call it many
 * times without touching the real JSON.
 */
function buildRippleClip(gltf, binary, clipName, { floorDeg, cycles, accents }) {
  const anim = gltf.animations.find((a) => a.name === clipName);
  const duration = Math.max(...anim.channels.map((c) => {
    const s = anim.samplers[c.sampler];
    const times = decodeFloats(gltf, binary, s.input);
    return times[times.length - 1];
  }));
  const writes = [];
  for (const rc of rotationChannels(gltf, binary, anim)) {
    if (rc.times.length < 8) continue; // static channel: nothing to ripple
    let out = rc.values;
    let touched = false;
    for (const group of Object.keys(GROUPS)) {
      const r = ripple(rc, { group, amplitudeDeg: floorDeg, cycles, duration });
      if (r) { out = r; touched = true; }
    }
    for (const acc of accents) {
      const r = addAccent(out, rc, acc);
      if (r) { out = r; touched = true; }
    }
    if (touched) writes.push({ name: rc.name, out });
  }
  return { writes, duration };
}

/** Smooth then gain, for the over-jittered clip. */
function buildSmoothGain(gltf, binary, clipName, { smoothing, gain }) {
  const anim = gltf.animations.find((a) => a.name === clipName);
  const bindRot = new Map(gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));
  const writes = [];
  for (const rc of rotationChannels(gltf, binary, anim)) {
    const keyCount = rc.times.length;
    if (keyCount < 4) continue;
    // Body and the leg chain carry the ground contract (Task D1 put grounded
    // footY on the canonical -184 plane and froze Body translation). Rotating
    // them here would lift the feet off that plane to buy angular velocity, so
    // they are left exactly as authored.
    if (PROTECTED.has(rc.name)) continue;
    if (PANEL_COUPLED.test(rc.name)) continue;
    let out = rc.values;
    for (let p = 0; p < smoothing; p++) out = smoothOnce(out, keyCount);
    if (gain !== 1) {
      const bind = bindRot.get(rc.name) ?? [0, 0, 0, 1];
      const gained = [];
      for (let k = 0; k < keyCount; k++) {
        const q = out.slice(k * 4, k * 4 + 4);
        gained.push(...qnorm(qmul(bind, qpow(qmul(qinv(bind), q), gain))));
      }
      out = gained;
    }
    writes.push({ name: rc.name, out });
  }
  return { writes };
}

// --- driver ------------------------------------------------------------------
let currentBytes = readFileSync(INPUT);

/**
 * Encode `writes` into a trial GLB. Trial encodes work on a structuredClone so
 * a rejected candidate never leaks into the shipped buffer.
 */
function trialEncoder(gltf, binary, clipName, writes) {
  const trial = structuredClone(gltf);
  const tApp = makeAppendor(trial, binary);
  const anim = trial.animations.find((a) => a.name === clipName);
  const byName = new Map(rotationChannels(trial, binary, anim).map((c) => [c.name, c]));
  for (const { name, out } of writes) byName.get(name).sampler.output = tApp.appendFloats(out, "VEC4");
  return encodeGlb(trial, tApp.finish());
}

async function solveRipple(clipName, { cyclesChoices, floorRange, accentSpec }) {
  const { gltf, binary } = readGlb(currentBytes);
  const targets = TARGETS[clipName];
  const aim = solveTarget(targets);
  let best = null;

  for (const cycles of cyclesChoices) {
    // 1. Solve the floor against `mean` (monotone in amplitude).
    let lo = 0, hi = floorRange;
    let floorDeg = 0;
    for (let iter = 0; iter < 14; iter++) {
      const mid = (lo + hi) / 2;
      const { writes } = buildRippleClip(gltf, binary, clipName, { floorDeg: mid, cycles, accents: [] });
      const m = await measureClip(trialEncoder(gltf, binary, clipName, writes), clipName);
      if (m.mean < aim.meanMin) lo = mid; else hi = mid;
      floorDeg = mid;
    }
    floorDeg = hi;
    const floorBuild = buildRippleClip(gltf, binary, clipName, { floorDeg, cycles, accents: [] });
    const floorM = await measureClip(trialEncoder(gltf, binary, clipName, floorBuild.writes), clipName);
    console.log(`[D3] ${clipName} cycles=${cycles} floor=${floorDeg.toFixed(2)}° -> ${fmt(floorM)}`);

    // 2. Solve each accent against `p95`, in order; an accent that solves to
    //    nothing is dropped rather than reported.
    const accents = [];
    let m = floorM;
    for (const spec of accentSpec) {
      if (m.p95 >= aim.p95) break;
      let alo = 0, ahi = 40;
      for (let iter = 0; iter < 12; iter++) {
        const mid = (alo + ahi) / 2;
        const probe = [...accents, { ...spec, amplitudeDeg: mid }];
        const { writes } = buildRippleClip(gltf, binary, clipName, { floorDeg, cycles, accents: probe });
        const mm = await measureClip(trialEncoder(gltf, binary, clipName, writes), clipName);
        if (mm.p95 < aim.p95) alo = mid; else ahi = mid;
        m = mm;
      }
      if (ahi < MIN_ACCENT_DEG) {
        console.log(`[D3] ${clipName} accent@${spec.t0}s not needed (floor already clears p95)`);
        continue;
      }
      accents.push({ ...spec, amplitudeDeg: ahi });
      console.log(`[D3] ${clipName} accent@${spec.t0}s=${ahi.toFixed(2)}° -> ${fmt(m)}`);
    }

    const finalBuild = buildRippleClip(gltf, binary, clipName, { floorDeg, cycles, accents });
    const finalM = await measureClip(trialEncoder(gltf, binary, clipName, finalBuild.writes), clipName);
    const ok = inBand(finalM, targets);
    console.log(`[D3] ${clipName} candidate ${fmt(finalM)} sustained=${finalM.sustained} ${ok ? "OK" : "REJECTED"}`);
    if (ok) { best = { floorDeg, cycles, accents, writes: finalBuild.writes }; break; }
  }

  assert.ok(best, `${clipName}: no ripple solution satisfies the dynamics gate`);
  const anim = gltf.animations.find((a) => a.name === clipName);
  const app = makeAppendor(gltf, binary);
  const byName = new Map(rotationChannels(gltf, binary, anim).map((c) => [c.name, c]));
  for (const { name, out } of best.writes) byName.get(name).sampler.output = app.appendFloats(out, "VEC4");
  currentBytes = encodeGlb(gltf, app.finish());
  console.log(`[D3] ${clipName}: floor ${best.floorDeg.toFixed(2)}° over ${best.cycles} cycles, ${best.accents.length} accent(s)`);
}

async function solveSmoothGain(clipName, { smoothingChoices, gainRange }) {
  const { gltf, binary } = readGlb(currentBytes);
  const targets = TARGETS[clipName];
  const aim = solveTarget(targets);
  let best = null;

  for (const smoothing of smoothingChoices) {
    let lo = 0.5, hi = gainRange;
    for (let iter = 0; iter < 14; iter++) {
      const gain = (lo + hi) / 2;
      const { writes } = buildSmoothGain(gltf, binary, clipName, { smoothing, gain });
      const m = await measureClip(trialEncoder(gltf, binary, clipName, writes), clipName);
      const overAccel = m.accelMax > targets.accelMax;
      const shortP95 = m.p95 < aim.p95;
      const shortMean = m.mean < aim.meanMin;
      const ok = !overAccel && !shortP95 && !shortMean && m.mean <= targets.meanMax && m.peak >= targets.peak;
      console.log(`[D3] ${clipName} smooth=${smoothing} gain=${gain.toFixed(2)} -> ${fmt(m)} ${ok ? "OK" : ""}`);
      if (ok) { best = { smoothing, gain, writes }; break; }
      if (overAccel) hi = gain;
      else if (shortP95 || shortMean) lo = gain;
      else hi = gain;
    }
    if (best) break;
  }

  assert.ok(best, `${clipName}: no smoothing/gain solution satisfies the dynamics gate`);
  const anim = gltf.animations.find((a) => a.name === clipName);
  const app = makeAppendor(gltf, binary);
  const byName = new Map(rotationChannels(gltf, binary, anim).map((c) => [c.name, c]));
  for (const { name, out } of best.writes) byName.get(name).sampler.output = app.appendFloats(out, "VEC4");
  currentBytes = encodeGlb(gltf, app.finish());
  console.log(`[D3] ${clipName}: smoothing ${best.smoothing}, gain ${best.gain.toFixed(2)}`);
}

// idle: 6 s loop -> 3 cycles of a 0.5 Hz sway; two settle accents, kept off the
// seam (t0 + half must stay inside the clip).
await solveRipple("idle", {
  cyclesChoices: [3, 4, 2],
  floorRange: 40,
  accentSpec: [
    { group: "neck", t0: 2.1, half: 0.42 },
    { group: "wing", t0: 4.3, half: 0.38 },
  ],
});

// walk: ~2.5 s loop -> 4 cycles (1.6 Hz). A walk should be busier than an idle.
await solveRipple("walk", {
  cyclesChoices: [4, 5, 3],
  floorRange: 40,
  accentSpec: [
    { group: "tail", t0: 0.62, half: 0.22 },
    { group: "tail", t0: 1.86, half: 0.22 },
  ],
});

// attack2: over-jittered, under-powered.
await solveSmoothGain("attack2", { smoothingChoices: [1, 2, 3], gainRange: 4 });

// --- write through the contract ---------------------------------------------
const tmp = `${OUTPUT}.d3.tmp`;
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
  console.log(`[D3] Wrote ${OUTPUT}: ${JSON.stringify(validateRuntimeRig(readFileSync(OUTPUT), { checkHash: isRuntimePath }))}`);
} finally {
  rmSync(tmp, { force: true });
}
