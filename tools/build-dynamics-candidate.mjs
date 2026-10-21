#!/usr/bin/env node
/**
 * Build the Stage 3 dynamics candidate from measured gains, not typed ones.
 *
 * The gain for each clip is *solved*: start from the gain that would close the
 * travel gap against V1, then walk it down until the capped-key fraction is inside
 * the plateau limit. That makes the result reproducible and stops the numbers from
 * drifting away from the assets they were measured on.
 *
 * Only `UNIFORM` clips are touched. `CONCENTRATED` and `BUZZ` clips are reported
 * and skipped, because their shortfall is not a scale factor -- amplifying them
 * would enlarge the part that already moves and leave the dead air exactly as dead.
 * See docs/flight-lab/37-stage3-clip-defect-taxonomy.md.
 *
 *   node tools/build-dynamics-candidate.mjs
 *   node tools/build-dynamics-candidate.mjs --gate
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadRig, measureDynamics, compareToReference, REFERENCE_CLIP_MAP } from "../scripts/wyvern-dynamics.mjs";
import { diagnoseClip, classify } from "./diagnose-clip-dynamics.mjs";
import { readGlb, applyGain } from "./amplify-clip.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const V1 = resolve(ROOT, "public/models/player-wyvern.glb");
const V2 = resolve(ROOT, "public/models/wyvern-v2-rig.glb");
const REFERENCE = resolve(ROOT, "assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json");
const OUT = resolve(ROOT, "assets/rig-audits/2026-10-21-dynamics/candidates/wyvern-v2-dynamics-candidate.glb");

const CAP_DEGREES = 160;
const CAP_RADIANS = (CAP_DEGREES / 180) * Math.PI;
/** Plateau limit: above this, the gain is buying numbers with frozen poses. */
const MAX_CAPPED_FRACTION = 0.02;
/** How far to walk the gain down per rejected trial. */
const GAIN_STEP = 0.9;

/** Largest gain <= `wanted` whose capped-key fraction stays inside the limit. */
function solveCleanGain(sourceBuffer, clipName, wanted) {
  let gain = wanted;
  while (gain > 1.001) {
    // Work on a copy: applyGain mutates the buffer, and a rejected trial must not
    // leak into the next one.
    const trial = { json: sourceBuffer.json, buf: Buffer.from(sourceBuffer.buf), binStart: sourceBuffer.binStart };
    const report = applyGain(trial, clipName, gain, CAP_RADIANS);
    const fraction = report.keysScaled > 0 ? report.keysCapped / report.keysScaled : 0;
    if (fraction <= MAX_CAPPED_FRACTION) return { gain: Number(gain.toFixed(3)), report, fraction };
    gain *= GAIN_STEP;
  }
  return null;
}

const v1 = await loadRig(V1);
const v2 = await loadRig(V2);

const referenceRows = Object.fromEntries(
  v1.gltf.animations.map((clip) => [clip.name, diagnoseClip(clip, v1.scene, v1.deforming)])
);
const candidateRows = Object.fromEntries(
  v2.gltf.animations.map((clip) => [clip.name, diagnoseClip(clip, v2.scene, v2.deforming)])
);

const glb = readGlb(V2);
const decisions = [];

for (const [clipName, referenceName] of Object.entries(REFERENCE_CLIP_MAP)) {
  const reference = referenceRows[referenceName];
  const candidate = candidateRows[clipName];
  if (!reference || !candidate) {
    decisions.push({ clip: clipName, verdict: "skipped", reason: "not comparable" });
    continue;
  }
  const diagnosis = classify(candidate, reference);
  if (diagnosis.class !== "UNIFORM") {
    decisions.push({ clip: clipName, verdict: "skipped", ...diagnosis, reason: `class ${diagnosis.class}` });
    continue;
  }

  const solved = solveCleanGain(glb, clipName, diagnosis.suggestedGain);
  if (!solved) {
    decisions.push({ clip: clipName, verdict: "skipped", ...diagnosis, reason: "no gain inside the plateau limit" });
    continue;
  }

  applyGain(glb, clipName, solved.gain, CAP_RADIANS);
  decisions.push({
    clip: clipName,
    verdict: "amplified",
    ...diagnosis,
    gain: solved.gain,
    cappedFraction: Number(solved.fraction.toFixed(4)),
    // The gain the travel gap asked for, versus what the axes could supply.
    gainShortfall: Number((solved.gain / diagnosis.suggestedGain).toFixed(3)),
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, glb.buf);

const pad = (s, w) => String(s).padEnd(w);
const num = (v, w = 8, d = 2) => (v === null || v === undefined ? "-" : v.toFixed(d)).padStart(w);
// Headers are right-aligned like their values but must not go through `num`,
// which only accepts numbers.
const label = (s, w) => String(s).padStart(w);

console.log(`\ncandidate ${OUT}`);
console.log(
  pad("clip", 12) +
    pad("class", 14) +
    label("travelR", 8) +
    label("p95R", 8) +
    label("sustain", 8) +
    label("want", 7) +
    label("used", 7) +
    label("capped", 8) +
    "  verdict"
);
for (const d of decisions) {
  console.log(
    pad(d.clip, 12) +
      pad(d.class ?? "-", 14) +
      num(d.travelR, 8, 3) +
      num(d.p95R, 8, 3) +
      num(d.sustainRatio, 8, 3) +
      num(d.suggestedGain, 7) +
      num(d.gain, 7) +
      num(d.cappedFraction, 8, 3) +
      "  " +
      d.verdict +
      (d.reason ? ` (${d.reason})` : "")
  );
}

const amplified = decisions.filter((d) => d.verdict === "amplified").length;
const skipped = decisions.filter((d) => d.verdict === "skipped").length;
console.log(`\n${amplified} clip(s) amplified, ${skipped} left alone.`);

if (process.argv.includes("--gate")) {
  const reference = JSON.parse(readFileSync(REFERENCE, "utf8"));
  const before = compareToReference(measureDynamics(v2), reference);
  const after = compareToReference(measureDynamics(await loadRig(OUT)), reference);
  console.log(`\ngate before: ${before.passed ? "PASS" : "FAIL"}  (${before.failures.length} failing checks)`);
  console.log(`gate after : ${after.passed ? "PASS" : "FAIL"}  (${after.failures.length} failing checks)`);
  const byClip = new Map();
  for (const failure of after.failures) {
    byClip.set(failure.clip, [...(byClip.get(failure.clip) ?? []), failure.channel]);
  }
  for (const [clip, channels] of byClip) console.log(`  ${clip.padEnd(12)} ${channels.join(", ")}`);
}
