#!/usr/bin/env node
/**
 * Can `attack` be moved off the ceiling of its `mean` gate by scaling it?
 *
 * `attack` passes at 139.3% of V1's mean — 0.5% under the 1.4x ceiling — because the
 * whole clip is amplified 3-11x over the blend (`compare_rig_amplitude.mjs`). The
 * obvious response is "scale it back". This measures whether that is possible.
 *
 * It is not, and the reason is shape rather than level. V1's AttackBite has
 * `peak/mean = 4.58` (one violent bite over a quiet 6.5s); V2's attack has `2.96`
 * (a flat 1.5s swing). Scaling a flat curve down moves it toward the `p95` floor at
 * the same rate it moves away from the `mean` ceiling, so there is no scale at which
 * both have room. The fix is authoring — a sharper, more punctuated bite — not a gain.
 *
 * Usage:
 *   node tools/blender/probe_attack_shape.mjs [--clip attack] [--glb <path>]
 */

import { readFileSync } from "node:fs";
import { Quaternion } from "three";

import { RUNTIME_PATH, encodeGlb, readGlb } from "./runtime_rig_contract.mjs";
import {
  measureClipBytes,
  qinv,
  qmul,
  qpow,
  qnorm,
  rotationChannels,
  writeFloatsInPlace,
} from "./glb_clip_edit.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const clipName = arg("--clip", "attack");
const glbPath = arg("--glb", RUNTIME_PATH);
const referencePath = new URL(
  "../../assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json", import.meta.url,
);

const reference = JSON.parse(readFileSync(referencePath, "utf8"));
const REFERENCE_CLIP = { attack: "AttackBite", attack2: "AttackClaw" }[clipName];
if (!REFERENCE_CLIP) throw new Error(`no reference mapping for ${clipName}`);
const want = reference.clips[REFERENCE_CLIP];

const FLOOR = {
  peak: want.peak * 0.7,
  p95: want.p95 * 0.8,
  meanMin: want.mean * 0.7,
  meanMax: want.mean * 1.4,
  accelMax: want.accelMax * 1.25,
};

const bytes = readFileSync(glbPath);

/** Scale every non-jaw channel about its bind by `s` (<1 pulls toward the authored pose). */
function build(s) {
  // `readGlb` returns a view of its input, so each trial needs its own copy.
  const { gltf, binary } = readGlb(Buffer.from(bytes));
  const anim = gltf.animations.find((a) => a.name === clipName);
  const bindRot = new Map(gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));

  for (const rc of rotationChannels(gltf, binary, anim)) {
    if (rc.name === "Jaw") continue;
    const bind = bindRot.get(rc.name) ?? [0, 0, 0, 1];
    const out = [];
    for (let k = 0; k < rc.times.length; k++) {
      const q = rc.values.slice(k * 4, k * 4 + 4);
      out.push(...qnorm(qmul(bind, qpow(qmul(qinv(bind), q), s))));
    }
    if (!writeFloatsInPlace(gltf, binary, rc.sampler.output, out)) throw new Error(`${rc.name} not in place`);
  }
  return encodeGlb(gltf, binary);
}

const pct = (v, base) => `${((v / base) * 100).toFixed(1)}%`;
const margin = (m) => Math.min(
  m.peak / FLOOR.peak - 1,
  m.p95 / FLOOR.p95 - 1,
  m.mean / FLOOR.meanMin - 1,
  1 - m.mean / FLOOR.meanMax,
  1 - m.accelMax / FLOOR.accelMax,
);

console.log(`${clipName} · reference ${REFERENCE_CLIP} · V1 peak ${want.peak.toFixed(0)} p95 ${want.p95.toFixed(0)} mean ${want.mean.toFixed(0)}\n`);
console.log("scale   peak   %V1    p95   %V1   mean   %V1   accel    worst margin  gate");

for (const s of [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5]) {
  const m = await measureClipBytes(build(s), clipName);
  const worst = margin(m);
  const pass = m.peak >= FLOOR.peak && m.p95 >= FLOOR.p95
    && m.mean >= FLOOR.meanMin && m.mean <= FLOOR.meanMax && m.accelMax <= FLOOR.accelMax;
  console.log(
    `${s.toFixed(2).padStart(5)} ${m.peak.toFixed(0).padStart(6)} ${pct(m.peak, want.peak).padStart(6)}` +
    ` ${m.p95.toFixed(0).padStart(6)} ${pct(m.p95, want.p95).padStart(6)}` +
    ` ${m.mean.toFixed(0).padStart(6)} ${pct(m.mean, want.mean).padStart(6)}` +
    ` ${m.accelMax.toFixed(0).padStart(7)}   ${(worst * 100).toFixed(1).padStart(7)}%    ${pass ? "pass" : "FAIL"}`,
  );
}

const shape = (m) => (m.peak / m.mean).toFixed(2);
console.log(
  `\npeak/mean — V1 ${(want.peak / want.mean).toFixed(2)}, ` +
  `V2 as shipped ${shape(await measureClipBytes(bytes, clipName))}. ` +
  "Scaling cannot change that ratio's direction: it is a property of the curve, not its level.",
);
