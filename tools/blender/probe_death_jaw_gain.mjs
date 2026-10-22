#!/usr/bin/env node
/**
 * Why `death`'s non-jaw gain is capped, measured.
 *
 * `restore_jaw_amplitude.mjs` amplifies a bone only while its excursion from bind
 * stays at or below `MAX_EXCURSION_DEG`. That cap is not caution — a uniform gain
 * scores *better* on the dynamics gate and is still wrong, because `qpow` past
 * 180deg wraps the short way and inverts the pose. This probe prints both sides of
 * that trade so the choice can be re-checked without re-deriving it.
 *
 * Reproduce with:
 *   node tools/blender/probe_death_jaw_gain.mjs
 *
 * Reads the shipped asset; writes nothing.
 */

import { readFileSync } from "node:fs";
import { Quaternion } from "three";

import { RUNTIME_PATH, encodeGlb, readGlb } from "./runtime_rig_contract.mjs";
import {
  PANEL_COUPLED,
  measureClipBytes,
  qinv,
  qmul,
  qpow,
  qnorm,
  rotationChannels,
  writeFloatsInPlace,
} from "./glb_clip_edit.mjs";

const BASIS_PATH = new URL(
  "../../assets/rig-audits/2026-10-22-c6-jaw-pivot/jaw-basis-authored.json", import.meta.url,
);
const CLIP = "death";
const CAP_DEG = 165;
/** The reference floors, as `compareToReference` computes them from the V1 Death clip. */
const FLOOR = { peak: 1050.11, p95: 734.19, meanMin: 351.81, meanMax: 703.62, accelMax: 54819.4 };

const baseIndex = process.argv.indexOf("--base");
const BASE = baseIndex >= 0 ? process.argv[baseIndex + 1] : RUNTIME_PATH;
const bytes = readFileSync(BASE);
const authored = JSON.parse(readFileSync(BASIS_PATH, "utf8"));
const angleDeg = (q) => (2 * Math.atan2(Math.hypot(q.x, q.y, q.z), Math.min(1, Math.abs(q.w))) * 180) / Math.PI;

/** The authored Jaw channel, by the measured export relation. */
function authoredJaw(gltf) {
  const node = gltf.nodes.find((n) => n.name === "Jaw");
  const rest = new Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
  const basis = authored.clips[CLIP].basis.map(([w, x, y, z]) => new Quaternion(x, y, z, w));
  const b0 = basis[0].clone().invert();
  return basis.map((q) => rest.clone().multiply(b0).multiply(q));
}

function excursionOf(rc, bind) {
  const bq = new Quaternion(...bind);
  let worst = 0;
  for (let k = 0; k < rc.times.length; k++) {
    const q = new Quaternion(rc.values[k * 4], rc.values[k * 4 + 1], rc.values[k * 4 + 2], rc.values[k * 4 + 3]);
    worst = Math.max(worst, angleDeg(bq.clone().invert().multiply(q)));
  }
  return worst;
}

/**
 * `mode`: "none" | "uniform" | "capped". The capped mode shares one gain across
 * the `PANEL_COUPLED` set, taken from its worst member, for the reason the tool
 * documents: the panel gate compares a panel against its two adjacent digits.
 */
function build({ restoreJaw, mode = "none", gain = 1 }) {
  // `readGlb` returns a view of its input, so every trial needs its own copy or the
  // previous trial's write leaks into this one.
  const { gltf, binary } = readGlb(Buffer.from(bytes));
  const anim = gltf.animations.find((a) => a.name === CLIP);
  const bindRot = new Map(gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));
  const channels = rotationChannels(gltf, binary, anim);

  if (restoreJaw) {
    const flat = [];
    for (const q of authoredJaw(gltf)) flat.push(q.x, q.y, q.z, q.w);
    const jaw = channels.find((rc) => rc.name === "Jaw");
    if (!writeFloatsInPlace(gltf, binary, jaw.sampler.output, flat)) throw new Error("jaw not in place");
  }

  const excursion = new Map(channels.map((rc) => [rc.name, excursionOf(rc, bindRot.get(rc.name) ?? [0, 0, 0, 1])]));
  const coupled = [...excursion].filter(([name]) => PANEL_COUPLED.test(name)).map(([, e]) => e);
  const coupledGain = coupled.length
    ? (Math.max(...coupled) >= CAP_DEG ? 1 : Math.min(gain, CAP_DEG / Math.max(...coupled)))
    : 1;

  for (const rc of channels) {
    if (rc.name === "Jaw" || mode === "none") continue;
    const e = excursion.get(rc.name);
    const local = mode === "uniform"
      ? gain
      : PANEL_COUPLED.test(rc.name)
        ? coupledGain
        : (e >= CAP_DEG ? 1 : Math.min(gain, CAP_DEG / e));
    if (local === 1) continue;
    const bind = bindRot.get(rc.name) ?? [0, 0, 0, 1];
    const out = [];
    for (let k = 0; k < rc.times.length; k++) {
      const q = rc.values.slice(k * 4, k * 4 + 4);
      out.push(...qnorm(qmul(bind, qpow(qmul(qinv(bind), q), local))));
    }
    if (!writeFloatsInPlace(gltf, binary, rc.sampler.output, out)) throw new Error(`${rc.name} not in place`);
  }
  return encodeGlb(gltf, binary);
}

/**
 * How many bones get pushed past the pole by this gain.
 *
 * Measured on the **pre-gain** excursion, because a shortest-arc angle can never
 * exceed 180deg: once `qpow` wraps, the pose reads as `360 − gain·excursion` and the
 * instrument that measured it can no longer see the wrap. The arithmetic is the only
 * honest witness.
 */
function wrappedBy(baseBytes, gain, mode) {
  const { gltf, binary } = readGlb(Buffer.from(baseBytes));
  const anim = gltf.animations.find((a) => a.name === CLIP);
  const bindRot = new Map(gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));
  const rows = rotationChannels(gltf, binary, anim)
    .filter((rc) => rc.name !== "Jaw")
    .map((rc) => {
      const e = excursionOf(rc, bindRot.get(rc.name) ?? [0, 0, 0, 1]);
      const local = mode === "uniform" ? gain : (e >= CAP_DEG ? 1 : Math.min(gain, CAP_DEG / Math.max(e, 1e-9)));
      return { name: rc.name, reached: local * e, local };
    });
  const wrapped = rows.filter((r) => r.reached > 180);
  const worst = rows.reduce((a, b) => (b.reached > a.reached ? b : a));
  return { wrapped: wrapped.length, worst: worst.reached, worstName: worst.name };
}

const passes = (m) => m.peak >= FLOOR.peak && m.p95 >= FLOOR.p95
  && m.mean >= FLOOR.meanMin && m.mean <= FLOOR.meanMax && m.accelMax <= FLOOR.accelMax;

const scenarios = [
  ["asset as-is", { restoreJaw: false }],
  ["jaw re-applied (no gain)", { restoreJaw: true }],
  ["jaw + uniform gain 1.05", { restoreJaw: true, mode: "uniform", gain: 1.05 }],
  ["jaw + uniform gain 1.80", { restoreJaw: true, mode: "uniform", gain: 1.8 }],
  [`jaw + capped gain 1.90 (cap ${CAP_DEG}deg)`, { restoreJaw: true, mode: "capped", gain: 1.9 }],
];

console.log(
  `clip ${CLIP} · base ${BASE}\n` +
  `floors peak ${FLOOR.peak} / p95 ${FLOOR.p95} / mean ${FLOOR.meanMin}..${FLOOR.meanMax} / ` +
  `accel <= ${FLOOR.accelMax}\n`,
);
console.log("scenario                                  peak    p95   mean  accel    gate  wrapped  peak excursion");

for (const [label, options] of scenarios) {
  const encoded = build(options);
  const m = await measureClipBytes(encoded, CLIP);
  const wrap = wrappedBy(bytes, options.gain ?? 1, options.mode ?? "none");
  console.log(
    `${label.padEnd(40)} ${m.peak.toFixed(0).padStart(6)} ${m.p95.toFixed(0).padStart(6)}` +
    ` ${m.mean.toFixed(0).padStart(6)} ${m.accelMax.toFixed(0).padStart(6)}` +
    `  ${(passes(m) ? "pass" : "FAIL").padStart(4)}  ${String(wrap.wrapped).padStart(7)}` +
    `  ${wrap.worst.toFixed(1).padStart(6)}deg (${wrap.worstName})`,
  );
}

console.log(
  "\n`jaw re-applied (no gain)` is the restore on its own, and it fails: the mouth set the\n" +
  "maximum angular rate in 158 of 240 frames, so p95 888 -> 560 and mean 354 -> 305. That\n" +
  "is why there is a gain at all.\n\n" +
  "A uniform gain does not fix it at any size. At 1.05x it already wraps 20 bones past the\n" +
  "pole and still fails; at 1.8x it reaches V1's p95 and mean but wraps 24 bones to 322.7deg\n" +
  "— which is -37.3deg, an inverted pose, not an exaggerated one — and blows the accel\n" +
  "ceiling (68,544 against 54,819). Both would look like a stronger death clip on the\n" +
  "numbers and read as broken in the viewport.\n\n" +
  "The capped row wraps nothing, keeps the shipped peak (1728 against 1738) and accel\n" +
  "(44,935 against 44,919), and lifts the failing channel from 354 to 418.\n\n" +
  "Run this against the shipped asset and rows 1 and 2 coincide: the tool is idempotent, so\n" +
  "re-applying the authored jaw is a no-op once it has landed. The recorded run used\n" +
  "`--base` pointed at the pre-restore `04dbda5c…` asset.",
);
