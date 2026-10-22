#!/usr/bin/env node
// PROBE: why attack's 0.5% mean margin is hard to fix, and what was measured.
//
// THE FINDING
// -----------
// D4 closed `attack` by running a uniform gain up to the *mean ceiling* and then
// buying the p95 back with a strike accent. The clip therefore ships at 139.3% of
// V1 `AttackBite`'s mean — 1664.3 against a 1672.7 ceiling. The 0.5% is not a
// defect in the clip; it is D4's own 0.995x safety factor, i.e. the strategy
// deliberately parked the clip on a cap.
//
// THE CAUSE IS SHAPE, NOT SCALE. Measured on the shipped f5d768a2 asset:
//   Head holds the frame maximum in 39 of 89 frames — 51.1% of the mean.
//   Jaw  holds 19 frames — 26.1%.
//   Wing panels/digits hold 15 frames — 19.8%. Tail holds 17 — 3.1%.
//   peak/mean is 2.96 against V1's 4.58.
// `Jaw` is parented to `Head` and sits at a constant local rotation outside the
// t=0.10..0.40 mouth opening, so the jaw's *world* rate is inherited from the
// head for most of the clip: Head carries roughly three quarters of the mean.
// Scaling cannot change a ratio, and a measured uniform sweep tops out at ~5.5%
// (1.00x -> 0.5%, 0.95x -> 5.5%, 0.90x -> 4.0%, 0.85x -> FAIL on the p95 floor).
//
// FOUR APPROACHES, MEASURED
// -------------------------
// 1. Uniform gain on everything: best worst-margin ~5.5%, and it just moves the
//    thin margin from the mean channel to the p95 channel.
// 2. Uniform gain on the PANEL_COUPLED set alone: a near no-op — mean 1664 -> 1637
//    even at gain 0. The panels that hold the frame max are static *at bind*
//    (excursion 0.0), so a gain about bind does nothing to them; their world
//    motion is inherited from ancestors further up the chain.
// 3. Uniform gain on the head/neck chain: kills the peak. Head 4931 -> 3471 at
//    gain 0.70, below the 3830 floor, because the peak IS the head.
// 4. Time-varying gain (full on the strike, `bg` outside): REACHES THE TARGET —
//    mean 1664 -> 1422, worst margin 0.5% -> 15.0%, peak and p95 held, accel
//    unchanged, zero excursions grew — and is still NOT SHIPPABLE, because it
//    injects angular velocity into the wing chain at every window edge.
//
// WHY (4) IS REJECTED, AND WHY THE GATE CANNOT SEE IT
// ---------------------------------------------------
// The wing is a 6-deep chain: Shoulder > Elbow > Wrist > Hand > Digit > Panel.
// A chain's composed angular velocity picks up a term proportional to the sum
// of the per-bone gain derivatives, so a gain that varies in time injects a jerk
// wherever it changes. Measured with the window centred on the peak frame
// (t=0.567, half 0.2): the frame rate at t=0.317 rises 2023 -> 4670 deg/s — a
// 2.3x spike on `L_WingPanel3_1`. Moving the window edges into the clip's
// quiet regions (centre 0.465, half 0.365) reduces it but does not remove it:
// 11 frames still rise, the largest +861 deg/s (+42%) at t=0.250 on
// `L_WingPanel0_0`.
//
// The dynamics gate is blind to this by construction: it takes the per-frame
// *maximum* rate across bones, so a rate rise reads as MORE energy and only
// improves the numbers. An instrument that rewards the artifact is exactly the
// failure mode this project keeps measuring for, so this probe has no write path.
//
// CONCLUSION: `attack` needs authored motion in the blend — a sharper, more
// punctuated bite with a quieter anticipation and recovery — not a gain reshape.
// The 0.5% margin is a pass; it is recorded as an open item rather than "fixed"
// by trading it for a membrane jerk.
//
// USAGE
//   npx tsx tools/blender/probe_attack_punctuation.mjs                 # solve + report
//   npx tsx tools/blender/probe_attack_punctuation.mjs --sweep         # uniform-gain sweeps
//   ... --centre <s> --half <s>                                        # move the window
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Quaternion } from "three";
import { RUNTIME_PATH, encodeGlb, readGlb } from "./runtime_rig_contract.mjs";
import {
  PANEL_COUPLED,
  PROTECTED,
  measureClipBytes,
  qinv,
  qmul,
  qnorm,
  qpow,
  rotationChannels,
  writeFloatsInPlace,
} from "./glb_clip_edit.mjs";
import { REFERENCE_CLIP_MAP, compareToReference } from "../../scripts/wyvern-dynamics.mjs";

const CLIP = "attack";
const REFERENCE_CLIP = REFERENCE_CLIP_MAP[CLIP];
const REFERENCE_PATH = fileURLToPath(
  new URL("../../assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json", import.meta.url),
);
/** Same headroom convention as `restore_jaw_amplitude.mjs`. */
const MARGIN_FLOOR = 0.15;
/** Below this the background is frozen rather than calm, which reads as a stutter. */
const BG_FLOOR = 0.15;
/** Half-width of the protected strike window, in seconds. */
const WINDOW_HALF = 0.2;
/** Raised-cosine blend width at each window edge, in seconds. */
const BLEND = 0.08;
/** Fewer keys than this and the channel is exporter-collapsed static. */
const MIN_KEYS = 8;
const CANDIDATE_ALIASES = [
  fileURLToPath(new URL("../../public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb", import.meta.url)),
  fileURLToPath(new URL("../../public/models/wyvern-v2-membrane-lab-candidate.glb", import.meta.url)),
];

const argv = process.argv.slice(2);
// A probe always reports: the frame-by-frame rise table is the finding.
const report = true;

const angleDeg = (q) => (2 * Math.atan2(Math.hypot(q.x, q.y, q.z), Math.min(1, Math.abs(q.w))) * 180) / Math.PI;
const relativeDeg = (a, b) => angleDeg(a.clone().invert().multiply(b));
const fmt = (v) => `${(v * 100).toFixed(1)}%`;

/** Per-frame max-rate curve of one clip of an in-memory GLB, via the real metric. */
async function frameCurve(bytes) {
  const tmp = `/tmp/attack-curve-${process.pid}.glb`;
  writeFileSync(tmp, bytes);
  try {
    const { loadRig } = await import("../../scripts/wyvern-dynamics.mjs");
    const rig = await loadRig(tmp);
    const clip = rig.gltf.animations.find((a) => a.name === CLIP);
    assert.ok(clip, `${CLIP}: clip missing`);
    const bones = rig.deforming;
    const dt = 1 / 60;
    const frames = Math.max(2, Math.round(clip.duration / dt) + 1);
    const { AnimationMixer, LoopRepeat } = await import("three");
    const mixer = new AnimationMixer(rig.scene);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    const previous = bones.map(() => new Quaternion());
    const current = new Quaternion();
    const curve = [];
    for (let f = 0; f < frames; f++) {
      action.reset().play();
      action.time = Math.min(clip.duration, f * dt);
      mixer.update(0);
      rig.scene.updateMatrixWorld(true);
      let frameMax = 0;
      let frameJoint = null;
      for (let b = 0; b < bones.length; b++) {
        bones[b].getWorldQuaternion(current);
        if (f === 0) {
          previous[b].copy(current);
          continue;
        }
        const a = previous[b].angleTo(current);
        previous[b].copy(current);
        if (!Number.isFinite(a)) continue;
        const rate = (a * 180) / Math.PI / dt;
        if (rate > frameMax) {
          frameMax = rate;
          frameJoint = bones[b].name;
        }
      }
      if (f > 0) curve.push({ t: f * dt, rate: frameMax, joint: frameJoint });
    }
    return curve;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Raised-cosine step from `bg` (outside) to 1 (inside the window). */
function gainAt(t, centre, bg, half) {
  const d = Math.abs(t - centre);
  if (d <= half) return 1;
  if (d >= half + BLEND) return bg;
  // 0 at the outer edge, 1 at the window edge.
  const u = (d - half) / BLEND;
  return bg + (1 - bg) * 0.5 * (1 + Math.cos(Math.PI * u));
}

/**
 * Rewrite `attack` with a time-varying gain about each bone's bind.
 *
 * `readGlb` returns a *view* of its input, so every trial starts from its own
 * copy — otherwise each iteration compounds the previous one's gain (the trap
 * that made the first `death` probe read p95 6973).
 */
function buildClip(sourceBytes, { centre, bg, half = WINDOW_HALF }) {
  const { gltf, binary } = readGlb(Buffer.from(sourceBytes));
  const anim = gltf.animations.find((a) => a.name === CLIP);
  assert.ok(anim, `${CLIP}: clip missing`);
  const bindRot = new Map(gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));

  let touched = 0;
  let skippedSparse = 0;
  for (const rc of rotationChannels(gltf, binary, anim)) {
    // The mouth is authored, not amplified: leave the Jaw channel exactly as it is.
    if (rc.name === "Jaw") continue;
    // D1 pinned Body translation and the grounded foot plane.
    if (PROTECTED.has(rc.name)) continue;
    // A varying gain across two exporter-collapsed keys would invent motion.
    if (rc.times.length < MIN_KEYS) {
      skippedSparse++;
      continue;
    }

    const bind = bindRot.get(rc.name) ?? [0, 0, 0, 1];
    const out = [];
    for (let k = 0; k < rc.times.length; k++) {
      const q = rc.values.slice(k * 4, k * 4 + 4);
      const g = gainAt(rc.times[k], centre, bg, half);
      out.push(...qnorm(qmul(bind, qpow(qmul(qinv(bind), q), g))));
    }
    // In place: these accessors are uncompressed tight float arrays, so appending
    // would orphan the old bufferView (the C6 first-draft +69 kB lesson).
    if (!writeFloatsInPlace(gltf, binary, rc.sampler.output, out)) {
      throw new Error(`${CLIP}: ${rc.name} rotation accessor is not a plain tight float array`);
    }
    touched++;
  }
  return { bytes: encodeGlb(gltf, binary), touched, skippedSparse };
}

/** Margins on every gate channel, as a fraction of the allowed headroom. */
function margins(got, want) {
  const peakFloor = want.peak * 0.7;
  const p95Floor = want.p95 * 0.8;
  const meanFloor = want.mean * 0.7;
  const meanCeil = want.mean * 1.4;
  const accelCeil = want.accelMax * 1.25;
  return {
    peak: (got.peak - peakFloor) / peakFloor,
    p95: (got.p95 - p95Floor) / p95Floor,
    meanLow: (got.mean - meanFloor) / meanFloor,
    meanHigh: (meanCeil - got.mean) / meanCeil,
    accel: (accelCeil - got.accelMax) / accelCeil,
  };
}
const worstMargin = (m) => Math.min(m.peak, m.p95, m.meanLow, m.meanHigh, m.accel);

async function main() {
  const bytes = readFileSync(RUNTIME_PATH);
  const reference = JSON.parse(readFileSync(REFERENCE_PATH, "utf8"));
  const want = reference.clips[REFERENCE_CLIP];
  assert.ok(want, `reference has no ${REFERENCE_CLIP}`);

  const before = await measureClipBytes(bytes, CLIP);
  const curve = await frameCurve(bytes);
  const rates = curve.map((c) => c.rate);
  const peak = Math.max(...rates);
  const peakIdx = rates.indexOf(peak);
  const centreOverride = (() => { const i = argv.indexOf("--centre"); return i >= 0 ? +argv[i + 1] : null; })();
  const halfOverride = (() => { const i = argv.indexOf("--half"); return i >= 0 ? +argv[i + 1] : null; })();
  const centre = centreOverride ?? curve[peakIdx].t;
  const half = halfOverride ?? WINDOW_HALF;
  const sorted = [...rates].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  // Earliest frame at or above p95 — the window has to cover it or the p95 moves.
  const p95Idx = rates.findIndex((r) => r >= p95 - 1e-9);

  console.log(`[probe] ${CLIP} before: peak ${before.peak.toFixed(0)} p95 ${before.p95.toFixed(0)}` +
    ` mean ${before.mean.toFixed(0)} accel ${before.accelMax.toFixed(0)} sustained=${before.sustained}`);
  console.log(`[probe] peak at t=${centre.toFixed(3)}s (${curve[peakIdx].joint}),` +
    ` p95 first reached at t=${curve[p95Idx].t.toFixed(3)}s (${curve[p95Idx].joint})`);
  console.log(`[probe] reference ${REFERENCE_CLIP}: peak ${want.peak.toFixed(0)} p95 ${want.p95.toFixed(0)}` +
    ` mean ${want.mean.toFixed(0)} accelMax ${want.accelMax.toFixed(0)}`);
  console.log(`[probe] window centre t=${centre.toFixed(3)}s +/-${WINDOW_HALF}s` +
    ` (covers t=${(centre - WINDOW_HALF).toFixed(3)}..${(centre + WINDOW_HALF).toFixed(3)}),` +
    ` blend ${BLEND}s, target mean <= ${(want.mean * 1.4 * (1 - MARGIN_FLOOR)).toFixed(0)}`);

  const meanCeil = want.mean * 1.4;
  const meanTarget = meanCeil * (1 - MARGIN_FLOOR);

  // Already punctuated? Then this is a no-op.
  const beforeGate = compareToReference({ [CLIP]: before }, reference);
  const beforeWorst = worstMargin(margins(before, want));
  if (before.mean <= meanTarget && beforeGate.passed) {
    console.log(`[probe] already at target: mean ${before.mean.toFixed(0)} <= ${meanTarget.toFixed(0)}` +
      ` and the gate passes with a ${fmt(beforeWorst)} margin`);
    console.log("\nnothing to write — attack is already punctuated");
    return;
  }

  if (argv.includes("--sweep")) {
    for (const bg of [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1, 0.05, 0.0]) {
      const m = await measureClipBytes(buildClip(bytes, { centre, bg, half }).bytes, CLIP);
      console.log(`[sweep] bg=${bg.toFixed(2)} peak ${m.peak.toFixed(0)} p95 ${m.p95.toFixed(0)} mean ${m.mean.toFixed(0)} accel ${m.accelMax.toFixed(0)} sustained=${m.sustained}`);
    }
    return;
  }

  // Solve `bg` so the mean lands on the target. Monotone: smaller bg -> smaller mean.
  const evaluate = async (bg) => {
    const built = buildClip(bytes, { centre, bg });
    return { ...(await measureClipBytes(built.bytes, CLIP)), built };
  };

  let lo = BG_FLOOR;
  let hi = 1.0;
  let best = null;
  for (let iter = 0; iter < 18; iter++) {
    const mid = (lo + hi) / 2;
    const m = await evaluate(mid);
    // mean rises with bg, so the feasible set is bg <= bg* and the answer is
    // the largest bg that still clears the target.
    if (m.mean <= meanTarget) {
      best = { bg: mid, m };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  assert.ok(best, `${CLIP}: no background gain reaches mean ${meanTarget.toFixed(0)}`);
  const { bg, m } = best;
  const gate = compareToReference({ [CLIP]: m }, reference);
  const worst = worstMargin(margins(m, want));

  console.log(`[probe] solved bg=${bg.toFixed(3)} -> peak ${m.peak.toFixed(0)}` +
    ` p95 ${m.p95.toFixed(0)} mean ${m.mean.toFixed(0)} accel ${m.accelMax.toFixed(0)}` +
    ` sustained=${m.sustained}`);
  console.log(`[probe] margins: peak ${fmt(margins(m, want).peak)}` +
    ` p95 ${fmt(margins(m, want).p95)} meanLow ${fmt(margins(m, want).meanLow)}` +
    ` meanHigh ${fmt(margins(m, want).meanHigh)} accel ${fmt(margins(m, want).accel)}` +
    `  -> worst ${fmt(worst)} (was ${fmt(beforeWorst)})`);

  const failures = [];
  if (!gate.passed) failures.push(`gate: ${gate.failures.map((f) => `${f.channel} ${f.value.toFixed(1)} vs ${f.expected}`).join("; ")}`);
  if (worst < MARGIN_FLOOR) failures.push(`worst margin ${fmt(worst)} < ${fmt(MARGIN_FLOOR)}`);
  if (worst < beforeWorst - 1e-6) failures.push(`conditioning got worse (${fmt(beforeWorst)} -> ${fmt(worst)})`);
  // A relative tolerance, not an exact one: re-encoding the accessors perturbs
  // the last decimals, and "the strike is preserved" means to 0.1%, not to 1e-6.
  if (m.peak < before.peak * 0.999) failures.push(`peak moved (${before.peak.toFixed(1)} -> ${m.peak.toFixed(1)})`);
  if (m.p95 < before.p95 * 0.999) failures.push(`p95 moved (${before.p95.toFixed(1)} -> ${m.p95.toFixed(1)})`);
  if (m.mean < want.mean * 0.7) failures.push(`mean fell below its floor (${m.mean.toFixed(0)} < ${(want.mean * 0.7).toFixed(0)})`);

  // No bone may end up further from bind than it started. With g <= 1 that is
  // arithmetic, but the invariant is asserted rather than assumed.
  const { gltf: g0, binary: b0 } = readGlb(Buffer.from(bytes));
  const anim0 = g0.animations.find((a) => a.name === CLIP);
  const bindRot0 = new Map(g0.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));
  const before0 = new Map(rotationChannels(g0, b0, anim0).map((rc) => [rc.name, rc]));
  const built = buildClip(bytes, { centre, bg });
  const check = readGlb(Buffer.from(built.bytes));
  const anim1 = check.gltf.animations.find((a) => a.name === CLIP);
  const bindRot1 = new Map(check.gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));
  let grew = 0;
  for (const rc of rotationChannels(check.gltf, check.binary, anim1)) {
    if (rc.name === "Jaw") continue;
    const was = before0.get(rc.name);
    if (!was) continue;
    const e0 = (() => {
      const bq = new Quaternion(...(bindRot0.get(rc.name) ?? [0, 0, 0, 1]));
      let w = 0;
      for (let k = 0; k < was.times.length; k++) {
        w = Math.max(w, relativeDeg(bq.clone().invert().multiply(new Quaternion(was.values[k * 4], was.values[k * 4 + 1], was.values[k * 4 + 2], was.values[k * 4 + 3])), new Quaternion()));
      }
      return w;
    })();
    const bq = new Quaternion(...(bindRot1.get(rc.name) ?? [0, 0, 0, 1]));
    let e1 = 0;
    for (let k = 0; k < rc.times.length; k++) {
      e1 = Math.max(e1, relativeDeg(bq.clone().invert().multiply(new Quaternion(rc.values[k * 4], rc.values[k * 4 + 1], rc.values[k * 4 + 2], rc.values[k * 4 + 3])), new Quaternion()));
    }
    if (e1 > e0 + 0.01) grew++;
  }
  if (grew) failures.push(`${grew} channel(s) ended further from bind than they started`);

  console.log(`[probe] channels rewritten: ${built.touched}, skipped as collapsed-static: ${built.skippedSparse}, excursions grew: ${grew}`);

  if (report) {
    const after = await frameCurve(built.bytes);
    console.log("[probe] per-frame max rate, before -> after:");
    for (let i = 0; i < curve.length; i++) {
      const b = curve[i];
      const a = after[i];
      const bar = (r) => "#".repeat(Math.round((r / peak) * 40));
      const rose = a.rate > b.rate + 0.5 ? "  <== ROSE" : "";
      console.log(`  t=${b.t.toFixed(3)}  ${b.rate.toFixed(0).padStart(5)} -> ${a.rate.toFixed(0).padStart(5)}  ${String(b.joint).padEnd(16)} -> ${String(a.joint).padEnd(16)} ${bar(b.rate)}|${bar(a.rate)}${rose}`);
    }
  }

  if (failures.length) {
    console.error(`
FAILED: ${failures.join("; ")}`);
    process.exitCode = 1;
    return;
  }

  // ---- PROBE ONLY -----------------------------------------------------------
  // There is deliberately no write path. See the header: every time-varying-gain
  // formulation reaches the mean target but injects angular velocity into the wing
  // chain at the window edges, and the dynamics gate cannot see it (a rate rise
  // reads as *more* energy, which only helps the gate). Shipping this would be
  // optimising the instrument rather than the animation.
  console.log("");
  console.log("[probe] the mean target IS reachable by a time-varying gain — this probe");
  console.log("[probe] records the numbers so the approach is not re-derived from scratch.");
  console.log("[probe] it is NOT shippable: see the ROSE rows above. The wing is a 6-deep");
  console.log("[probe] chain (Shoulder>Elbow>Wrist>Hand>Digit>Panel) and a chain's composed");
  console.log("[probe] angular velocity picks up a term proportional to the sum of the gain");
  console.log("[probe] derivatives, so every window edge injects a jerk into the membrane.");
  console.log("[probe] attack needs authored motion in the blend, not a gain reshape.");
}

main();
