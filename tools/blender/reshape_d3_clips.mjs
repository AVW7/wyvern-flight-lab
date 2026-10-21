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
//   clip      before (peak / p95 / mean / accel)     V1 p95
//   idle      157 /  19 /  15 /  4663                 239
//   walk      552 / 315 / 238 / 16552                1127
//   attack2  1695 / 685 / 345 / 83690                1372
//
// So the fix is not "amplify" (that scales peak and accel together and leaves
// the floor where it is). It is:
//
//   idle    a travelling secondary-motion ripple through spine/neck/tail/wing
//           root, phase-offset per bone so *some* bone is always moving, plus a
//           settle accent. Solves the floor amplitude to land `mean` in band,
//           then the accent amplitude to land `p95`.
//   walk    the same ripple, solved harder, because a walk should read busy
//           rather than graceful.
//   attack2 the opposite problem — the tail whip is jittery (accelMax 2.27x the
//           V1-scaled cap) while its p95 is only 0.50x. Temporal smoothing
//           first, then gain, solved jointly.
//
// Bone safety rules live in glb_clip_edit.mjs (PROTECTED / PANEL_COUPLED); each
// one was learned from a test that caught the first attempt.
//
// Every amplitude below is SOLVED by measuring the candidate through
// scripts/wyvern-dynamics.mjs, the same 60 Hz world-space metric the gate uses.
//
// NOT IDEMPOTENT: run it against the previous stage's asset, never against its
// own output.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, encodeGlb, validateRuntimeRig, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";
import {
  makeAppendor, rotationChannels, clipDuration, ripple, addAccent, smoothOnce, GROUPS,
  qmul, qinv, qpow, qnorm, PROTECTED, PANEL_COUPLED,
  measureClipBytes, fmtMetrics,
} from "./glb_clip_edit.mjs";

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

const inBand = (m, t) => m.peak >= t.peak && m.p95 >= t.p95 && m.mean >= t.meanMin && m.mean <= t.meanMax && m.accelMax <= t.accelMax;

// Bisection converges *to* a limit, so solving for exactly `>= limit` parks the
// result on the boundary and flips pass/fail on the last decimal. Aim a few
// percent inside instead.
const MARGIN = 1.03;
const solveTarget = (t) => ({ ...t, p95: t.p95 * MARGIN, meanMin: t.meanMin * MARGIN });
// An accent that solves to nothing was not needed: the floor already cleared
// p95. Reporting it as an applied accent would be a lie, so drop it.
const MIN_ACCENT_DEG = 0.5;

/**
 * Ripple + accents. Pure, so the solver can call it many times without touching
 * the real JSON.
 */
function buildRippleClip(gltf, binary, clipName, { floorDeg, cycles, accents }) {
  const anim = gltf.animations.find((a) => a.name === clipName);
  const duration = clipDuration(gltf, binary, anim);
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
    // Body, Spine1 and the leg chain carry the ground contract (D1), and the
    // wing digits carry the membrane contract. Both are left exactly as
    // authored — see glb_clip_edit.mjs.
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

let currentBytes = readFileSync(INPUT);

/** Encode `writes` into a trial GLB without leaking a rejected candidate. */
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
    let lo = 0, hi = floorRange, floorDeg = 0;
    for (let iter = 0; iter < 14; iter++) {
      const mid = (lo + hi) / 2;
      const { writes } = buildRippleClip(gltf, binary, clipName, { floorDeg: mid, cycles, accents: [] });
      const m = await measureClipBytes(trialEncoder(gltf, binary, clipName, writes), clipName);
      if (m.mean < aim.meanMin) lo = mid; else hi = mid;
      floorDeg = mid;
    }
    floorDeg = hi;
    const floorBuild = buildRippleClip(gltf, binary, clipName, { floorDeg, cycles, accents: [] });
    const floorM = await measureClipBytes(trialEncoder(gltf, binary, clipName, floorBuild.writes), clipName);
    console.log(`[D3] ${clipName} cycles=${cycles} floor=${floorDeg.toFixed(2)}° -> ${fmtMetrics(floorM)}`);

    // 2. Solve each accent against `p95`, in order; drop ones that are not needed.
    const accents = [];
    let m = floorM;
    for (const spec of accentSpec) {
      if (m.p95 >= aim.p95) break;
      let alo = 0, ahi = 40;
      for (let iter = 0; iter < 12; iter++) {
        const mid = (alo + ahi) / 2;
        const probe = [...accents, { ...spec, amplitudeDeg: mid }];
        const { writes } = buildRippleClip(gltf, binary, clipName, { floorDeg, cycles, accents: probe });
        const mm = await measureClipBytes(trialEncoder(gltf, binary, clipName, writes), clipName);
        if (mm.p95 < aim.p95) alo = mid; else ahi = mid;
        m = mm;
      }
      if (ahi < MIN_ACCENT_DEG) {
        console.log(`[D3] ${clipName} accent@${spec.t0}s not needed (floor already clears p95)`);
        continue;
      }
      accents.push({ ...spec, amplitudeDeg: ahi });
      console.log(`[D3] ${clipName} accent@${spec.t0}s=${ahi.toFixed(2)}° -> ${fmtMetrics(m)}`);
    }

    const finalBuild = buildRippleClip(gltf, binary, clipName, { floorDeg, cycles, accents });
    const finalM = await measureClipBytes(trialEncoder(gltf, binary, clipName, finalBuild.writes), clipName);
    const ok = inBand(finalM, targets);
    console.log(`[D3] ${clipName} candidate ${fmtMetrics(finalM)} sustained=${finalM.sustained} ${ok ? "OK" : "REJECTED"}`);
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
      const m = await measureClipBytes(trialEncoder(gltf, binary, clipName, writes), clipName);
      const overAccel = m.accelMax > targets.accelMax;
      const shortP95 = m.p95 < aim.p95;
      const shortMean = m.mean < aim.meanMin;
      const ok = !overAccel && !shortP95 && !shortMean && m.mean <= targets.meanMax && m.peak >= targets.peak;
      console.log(`[D3] ${clipName} smooth=${smoothing} gain=${gain.toFixed(2)} -> ${fmtMetrics(m)} ${ok ? "OK" : ""}`);
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

// idle: 6 s loop -> 4 cycles of a 0.67 Hz sway; one settle accent, kept off the
// seam (t0 + half must stay inside the clip).
await solveRipple("idle", {
  cyclesChoices: [3, 4, 2],
  floorRange: 40,
  accentSpec: [
    { group: "neck", t0: 2.1, half: 0.42 },
    { group: "wing", t0: 4.3, half: 0.38 },
  ],
});

// walk: ~2.46 s loop -> 4 cycles (1.63 Hz). A walk should be busier than an idle.
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
