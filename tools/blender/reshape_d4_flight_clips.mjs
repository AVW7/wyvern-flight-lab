#!/usr/bin/env node
// D4, flight group: cruise + bankLeft + bankRight.
//
// The earlier note in reshape_d4_clips.mjs says both are unshippable by
// amplification — cruise because a gain folds the membrane below the span test's
// 2500 floor, the banks because a 6.7x gain folds the wing through the body.
// Both measurements are correct and both diagnoses were incomplete.
//
// The missing term is *rate*. Measured with the validator's own DFT of the
// wingtip elevation (the estimator that survives a secondary bump), V2's flight
// group beats at 0.500 Hz where V1 beats at 1.000 Hz. Velocity is amplitude
// times frequency, so half the cadence is half the dynamics — which is exactly
// what cruise scores: 0.480x V1 peak, 0.518x mean. Doubling cruise's rate alone
// lands it on V1 (0.958x peak, 1.034x mean) with *no* pose change at all.
//
// The banks carry a second, genuine deficit on top of the rate: after the
// retime they still sit at 0.49x V1 peak, so their stroke really is shallower.
// That takes a 1.95x gain, which is only safe once the clip is no longer
// playing at half speed — at 1.0 Hz the same gain keeps the wingtip outboard
// (min 117 rig units over the cycle) where 2.6x at 0.5 Hz sent it through the
// midline.
//
// Group lock: all three are retimed by the same factor, so the flight group
// still beats as one (spread 0.0%, limit 8%) — it just beats at the reference's
// rate. `node scripts/validate-wyvern-clips.mjs` is the authority on that; run
// it after this.
//
// NOT IDEMPOTENT: run it against the previous stage's asset.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, encodeGlb, validateRuntimeRig, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";
import {
  makeAppendor, decodeFloats, rotationChannels, clipDuration,
  qmul, qinv, qpow, qnorm, PROTECTED, PANEL_COUPLED, measureClipBytes, fmtMetrics,
} from "./glb_clip_edit.mjs";
import { REFERENCE_CLIP_MAP, GATE } from "../../scripts/wyvern-dynamics.mjs";

await MeshoptDecoder.ready;

const INPUT = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const OUTPUT = process.argv[3] ?? INPUT;

/** One wingbeat at the reference's rate, not at half of it. */
const RETIME = 0.5;
/** Banks only: the extra stroke depth the retime does not supply. */
const BANK_GAIN = 1.95;

const reference = JSON.parse(
  readFileSync(resolve("assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json"), "utf8"),
);

/** Gate floors, derived from the committed reference rather than typed in. */
function floorsFor(clipName) {
  const want = reference.clips[REFERENCE_CLIP_MAP[clipName]];
  return {
    peak: want.peak * GATE.peakRatio,
    p95: want.p95 * GATE.p95Ratio,
    meanMin: want.mean * GATE.meanRatio[0],
    meanMax: want.mean * GATE.meanRatio[1],
    accelMax: want.accelMax * GATE.accelRatio,
  };
}

const PLAN = [
  { clip: "cruise", gain: 1 },
  { clip: "bankLeft", gain: BANK_GAIN },
  { clip: "bankRight", gain: BANK_GAIN },
];

let currentBytes = readFileSync(INPUT);

function buildClip(bytes, clipName, gain) {
  const { gltf, binary } = readGlb(bytes);
  const anim = gltf.animations.find((a) => a.name === clipName);
  const bindRot = new Map(gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));
  const duration = clipDuration(gltf, binary, anim);

  const app = makeAppendor(gltf, binary);
  const byName = new Map(rotationChannels(gltf, binary, anim).map((c) => [c.name, c]));

  // Every channel is retimed — a rotation-only retime would leave the clip's
  // duration pinned by its translation tracks and the pose would drift out of
  // sync with its own key times.
  for (const channel of anim.channels) {
    const sampler = anim.samplers[channel.sampler];
    const times = decodeFloats(gltf, binary, sampler.input).map((t) => t * RETIME);
    sampler.input = app.appendFloats(times, "SCALAR");
  }

  if (gain !== 1) {
    for (const rc of byName.values()) {
      if (rc.times.length < 4) continue;
      if (PROTECTED.has(rc.name)) continue;
      if (PANEL_COUPLED.test(rc.name)) continue;
      const bind = bindRot.get(rc.name) ?? [0, 0, 0, 1];
      const out = [];
      for (let k = 0; k < rc.times.length; k++) {
        const q = rc.values.slice(k * 4, k * 4 + 4);
        out.push(...qnorm(qmul(bind, qpow(qmul(qinv(bind), q), gain))));
      }
      byName.get(rc.name).sampler.output = app.appendFloats(out, "VEC4");
    }
  }

  return { bytes: encodeGlb(gltf, app.finish()), duration: duration * RETIME };
}

for (const { clip, gain } of PLAN) {
  const { bytes, duration } = buildClip(currentBytes, clip, gain);
  const m = await measureClipBytes(bytes, clip);
  const f = floorsFor(clip);
  const ok = m.peak >= f.peak && m.p95 >= f.p95 && m.mean >= f.meanMin
    && m.mean <= f.meanMax && m.accelMax <= f.accelMax && m.sustained;
  console.log(
    `[D4f] ${clip} retime=${RETIME} gain=${gain} dur=${duration.toFixed(2)}s ${fmtMetrics(m)} ` +
      `sustained=${m.sustained} ${ok ? "OK" : "REJECTED"}`,
  );
  console.log(
    `[D4f]   floors peak>=${f.peak.toFixed(1)} p95>=${f.p95.toFixed(1)} ` +
      `mean=${f.meanMin.toFixed(1)}..${f.meanMax.toFixed(1)} accel<=${f.accelMax.toFixed(0)}`,
  );
  assert.ok(ok, `${clip}: retime ${RETIME} + gain ${gain} does not satisfy the dynamics gate`);
  currentBytes = bytes;
}

const tmp = `${OUTPUT}.d4f.tmp`;
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
  console.log(`[D4f] Wrote ${OUTPUT}: ${JSON.stringify(validateRuntimeRig(readFileSync(OUTPUT), { checkHash: isRuntimePath }))}`);
} finally {
  rmSync(tmp, { force: true });
}
