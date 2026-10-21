#!/usr/bin/env node
/**
 * Why is a clip flat? Rate alone cannot say.
 *
 * `tools/audit-dynamics.mjs` reports angular *velocity*. A clip can score low on
 * velocity for two completely different reasons, and they need opposite fixes:
 *
 *   - it moves less          -> scale the pose (exaggeration)
 *   - it moves the same, but slowly -> compress the timing
 *
 * This tool separates them by measuring, per clip, alongside the gate's rate:
 *
 *   travel     cumulative |dq| over the whole clip, in degrees, for the bone that
 *              travels most. This is how much rotation the clip actually performs.
 *              Unbounded, unlike a range: the angle between two quaternions caps at
 *              180 deg, so a wing that sweeps 400 deg and back reports 180 twice,
 *              not 400. Summing per-frame deltas avoids that entirely.
 *   range      max angle from the bone's own start pose, in degrees. Useful only
 *              for clips that stay inside one hemisphere (idle, rest); it saturates
 *              at 180 and is reported with that caveat rather than relied on.
 *   travelRate travel / duration, deg/s. The clip's average motion, which is what
 *              `mean` approximates and what `peak` deliberately does not.
 *   duty       fraction of frames at or above 50% of peak rate.
 *
 * `classify` turns a candidate/reference pair into the three-way diagnosis in
 * doc 37. It is exported so tests can pin the rule rather than the table.
 *
 *   node tools/diagnose-clip-dynamics.mjs public/models/player-wyvern.glb
 *   node tools/diagnose-clip-dynamics.mjs public/models/wyvern-v2-rig.glb --json out.json
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { AnimationMixer, LoopRepeat, Quaternion } from "three";
import { loadRig } from "../scripts/wyvern-dynamics.mjs";

const HZ = 60;
const DEG = 180 / Math.PI;

/**
 * Per-clip travel and duty over the same deforming-bone set the gate uses.
 *
 * Sampling mirrors `measureClipDynamics` exactly -- 60 Hz, world quaternions,
 * `a.time = f * dt` with `m.update(0)` -- so `peak` here reproduces the gate's
 * number. If those two ever disagree, one of them is lying.
 */
export function diagnoseClip(clip, scene, bones, hz = HZ) {
  const dt = 1 / hz;
  const frames = Math.max(2, Math.round(clip.duration / dt) + 1);
  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopRepeat, Infinity);

  const n = bones.length;
  const origin = Array.from({ length: n }, () => new Quaternion());
  const prev = Array.from({ length: n }, () => new Quaternion());
  const cur = new Quaternion();
  const rel = new Quaternion();
  const identity = new Quaternion();
  const travel = new Float64Array(n);
  const maxRange = new Float64Array(n);
  const rates = [];

  for (let f = 0; f < frames; f++) {
    action.reset().play();
    action.time = Math.min(clip.duration, f * dt);
    mixer.update(0);
    scene.updateMatrixWorld(true);

    let frameMax = 0;
    for (let b = 0; b < n; b++) {
      bones[b].getWorldQuaternion(cur);
      if (f === 0) {
        origin[b].copy(cur);
        prev[b].copy(cur);
        continue;
      }
      const step = prev[b].angleTo(cur) * DEG;
      travel[b] += step;
      prev[b].copy(cur);

      // Sign-agnostic range from the start pose. Saturates at 180 deg -- see the
      // header note; `travel` is the number to trust.
      rel.copy(origin[b]).invert().multiply(cur);
      const away = rel.angleTo(identity) * DEG;
      if (away > maxRange[b]) maxRange[b] = away;

      if (step / dt > frameMax) frameMax = step / dt;
    }
    if (f > 0) rates.push(frameMax);
  }
  mixer.stopAllAction();

  let widestTravel = 0;
  let widestJoint = "";
  let meanTravel = 0;
  let widestRange = 0;
  for (let b = 0; b < n; b++) {
    meanTravel += travel[b];
    if (travel[b] > widestTravel) {
      widestTravel = travel[b];
      widestJoint = bones[b].name;
    }
    if (maxRange[b] > widestRange) widestRange = maxRange[b];
  }
  meanTravel /= n;

  const peak = rates.reduce((a, b) => (b > a ? b : a), 0);
  const sorted = Float64Array.from(rates).sort();
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const above = rates.filter((r) => r >= peak * 0.5).length;

  return {
    clip: clip.name,
    duration: Number(clip.duration.toFixed(4)),
    keys: Math.max(...clip.tracks.map((t) => t.times.length)),
    travel: Number(widestTravel.toFixed(1)),
    travelJoint: widestJoint,
    meanTravel: Number(meanTravel.toFixed(1)),
    travelRate: Number((widestTravel / clip.duration).toFixed(1)),
    range: Number(widestRange.toFixed(1)),
    peak: Number(peak.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    mean: Number(mean.toFixed(2)),
    duty: Number((above / rates.length).toFixed(3)),
  };
}

/** Thresholds for `classify`, chosen from the measured table rather than taste. */
export const CLASS_RULES = Object.freeze({
  // p95 moves in step with total travel -> the clip is uniformly scaled down.
  uniformBand: [0.6, 1.4],
});

/**
 * Name a clip's defect from a candidate/reference pair.
 *
 * One axis: `sustainRatio = (p95R / travelR)`, how much the *sustained* level
 * moved per unit of total travel.
 *
 *   ~1          UNIFORM       travel and sustain fell together. The pose simply
 *                             travels less far. `tools/amplify-clip.mjs` applies.
 *   < 0.6       CONCENTRATED  the clip travels but does not sustain: motion is
 *                             bunched into brief excursions with dead air between
 *                             (idle, walk, attack2). Gain would enlarge the
 *                             excursions and leave the dead air exactly as dead.
 *   > 1.4       BUZZ          sustained rate outran travel, so the clip moves
 *                             fast through a small range -- a vibration, not a
 *                             sweep (takeoff, death).
 *
 * `peak` is deliberately not the discriminator. A single frame carries it, which
 * is the mistake doc 36 records, and it is why `idle` can look half-alive on peak
 * while its p95 is 7.7% of the reference.
 */
export function classify(candidate, reference, rules = CLASS_RULES) {
  const travelR = candidate.travel / reference.travel;
  const p95R = candidate.p95 / reference.p95;
  const sustainRatio = p95R / Math.max(travelR, 1e-9);
  const [low, high] = rules.uniformBand;
  let cls;
  if (sustainRatio > high) cls = "BUZZ";
  else if (sustainRatio < low) cls = "CONCENTRATED";
  else cls = "UNIFORM";
  return {
    travelR: Number(travelR.toFixed(3)),
    p95R: Number(p95R.toFixed(3)),
    sustainRatio: Number(sustainRatio.toFixed(3)),
    class: cls,
    // The gain that would close the amplitude gap. Only meaningful for UNIFORM:
    // for the other two classes the shortfall is not a scale factor, so quoting
    // one would invite exactly the wrong fix.
    suggestedGain: cls === "UNIFORM" ? Number((reference.travel / candidate.travel).toFixed(2)) : null,
  };
}

// ---------------------------------------------------------------- CLI

async function main(argv) {
  const args = argv.slice(2);
  const target = args.find(
    (a) => !a.startsWith("--") && !(args.indexOf(a) > 0 && args[args.indexOf(a) - 1].startsWith("--"))
  );
  if (!target) {
    console.error("usage: diagnose-clip-dynamics.mjs <glb> [--json out.json]");
    process.exit(2);
  }
  const jsonFlag = args.indexOf("--json");
  const jsonOut = jsonFlag >= 0 ? args[jsonFlag + 1] : null;

  const rig = await loadRig(target);
  const rows = rig.gltf.animations.map((clip) => diagnoseClip(clip, rig.scene, rig.deforming));

  const pad = (s, w) => String(s).padEnd(w);
  const num = (v, w = 9, d = 1) => v.toFixed(d).padStart(w);
  // Column headers are right-aligned like the values under them, but must not go
  // through `num` -- that formatter only accepts numbers.
  const label = (s, w) => String(s).padStart(w);

  console.log(`\n${target}  (${rig.deforming.length} deforming bones of ${rig.bones.length})`);
  console.log(
    pad("clip", 16) +
      label("dur", 7) +
      label("keys", 6) +
      label("travel", 10) +
      label("meanTrv", 9) +
      label("trv/s", 9) +
      label("range", 8) +
      label("peak", 9) +
      label("p95", 9) +
      label("mean", 9) +
      label("duty", 7) +
      "  widest joint"
  );
  for (const row of rows) {
    console.log(
      pad(row.clip, 16) +
        num(row.duration, 7, 2) +
        num(row.keys, 6, 0) +
        num(row.travel, 10) +
        num(row.meanTravel, 9) +
        num(row.travelRate, 9) +
        num(row.range, 8) +
        num(row.peak, 9) +
        num(row.p95, 9) +
        num(row.mean, 9) +
        num(row.duty, 7, 2) +
        "  " +
        row.travelJoint
    );
  }

  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify({ source: target, hz: HZ, clips: rows }, null, 2)}\n`);
    console.log(`\nwrote ${jsonOut}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv);
}
