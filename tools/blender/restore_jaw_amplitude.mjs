#!/usr/bin/env node
/**
 * Take the `Jaw` out of the D2/D3/D4 gain solve, and repair what that exposes.
 *
 * ## The defect
 *
 * The gain passes amplify every rotation channel about its own bind rotation —
 * `bind * qpow(bind^-1 * q, gain)` in `reshape_buzz_clips.mjs` and the D3/D4
 * passes. `Jaw` is neither in `PROTECTED` nor `PANEL_COUPLED`, so the mouth was
 * amplified with the rest of the rig:
 *
 *   clip      authored (blend)   shipped (GLB)   ratio
 *   attack         32.0deg          176.9deg      5.53x
 *   attack2        24.0deg           53.7deg      2.24x
 *   death          50.0deg          179.1deg      3.58x
 *
 * `breath`, `attackAir2` and `idle` were never gain-passed and agree with the
 * blend to `0.0000deg`. A jaw cannot open 177deg — the chin passes the hinge and
 * folds up over the snout — so the shipped pose is not a stronger bite, it is an
 * inverted one. The jaw is an authored pose, not a dynamics channel: it should
 * never have been in the gain set.
 *
 * ## The export relation
 *
 * Measured on the three clips that agree, and asserted here as the tool's own
 * control: the exporter writes the **frame-0 pose** as the node TRS, so
 *
 *   channel(k) = rest_glb * basis(0)^-1 * basis(k)
 *
 * not `rest_glb * basis(k)` (that form is off by the constant `basis(0)`, which
 * for this rig is the C6 compensation of `2.090deg`). Reproducing the controls is
 * what proves the restore is the inverse of the export rather than a fit.
 *
 * ## Why `death` needs more than a restore
 *
 * Restoring the jaw costs `attack` and `attack2` exactly nothing — the jaw never
 * holds a frame's maximum angular rate there. `death` is different: the mouth set
 * the maximum in 158 of 240 frames, so restoring it takes the clip from
 * `p95 888 / mean 354` to `p95 560 / mean 305`, both under the floors of
 * `734 / 352`. Part of `death`'s gate was being paid for by an impossible pose.
 *
 * Four repairs were measured and rejected before the fifth was kept:
 *
 *   1. **Uniform gain** — unsafe. The shipped clip already carries 21 bones more
 *      than 150deg from bind (`R_Thigh` 179.1deg, every `WingD*` panel 179.3deg).
 *      `qpow` past 180deg wraps the short way, so a 1.8x gain turns a 179deg bone
 *      into -38deg: it inverts the pose instead of exaggerating it. It measures
 *      beautifully (mean 512, 102% of V1) and is still wrong.
 *   2. **Tail ripple** — invisible. All 10 `Tail*` channels match the group and
 *      `ripple()` returns non-null, but the tail never holds a per-frame maximum,
 *      so 2..14deg at 2..4 cycles changes no digit of the metric.
 *   3. **Neck-only gain** — fits. 1.6x clears at a 3.9% `p95` margin, which is a
 *      number chosen to clear a floor rather than to make the clip better.
 *   4. **Uniform gain + smoothing** — safe on accel, but the smoothing that buys
 *      the headroom takes the peak from 1738 to 1383 for no other reason.
 *
 * What is kept: D2's own map, with a **per-bone cap**. A bone is amplified only
 * while its excursion from bind stays at or below `MAX_EXCURSION_DEG`; a bone
 * already past that is left exactly as it is. This is provably non-wrapping (the
 * cap is computed from the clip's own measured excursion, so the result lands on
 * the cap rather than through it), it leaves the shipped dynamics profile intact
 * (`peak` 1728 against 1738, `accel` 44939 against 44919), and it lifts the
 * failing channel (`mean` 354 -> 428, i.e. 70% -> 85% of V1). No smoothing: the
 * cap already bounds the amplification, and smoothing only costs the peak.
 *
 * The gain is then the *smallest* one that clears every gate by `MARGIN_FLOOR` —
 * not the best match to V1, because past the first clear the extra gain only
 * amplifies bones that still have headroom, and that is authoring, not repair.
 *
 * ## Scope and honesty
 *
 * The gain is applied as a ratio to the *shipped* clip, so it is not bit-identical
 * to a from-source re-run of D2 (the shipped clip is `qpow(orig, g0)` already, and
 * this applies `qpow(that, g)`). It is the same map applied twice, which is the
 * only form available without the pre-D2 stage on disk. A clip the restore does
 * not move keeps whatever conditioning it already had: `attack` ships 0.5% under
 * its `mean` ceiling and this pass reports that rather than taking credit for it.
 *
 * Usage:
 *   node tools/blender/restore_jaw_amplitude.mjs [--out <glb>] [--write] [--report]
 *
 * Dry run by default. `--write` re-signs and re-pins the runtime contract.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Quaternion } from "three";

import {
  CONTRACT_PATH,
  RUNTIME_PATH,
  encodeGlb,
  inspectRuntimeRig,
  readGlb,
  validateRuntimeRig,
} from "./runtime_rig_contract.mjs";
import {
  PANEL_COUPLED,
  decodeFloats,
  measureClipBytes,
  qinv,
  qmul,
  qpow,
  qnorm,
  rotationChannels,
  writeFloatsInPlace,
} from "./glb_clip_edit.mjs";
import { REFERENCE_CLIP_MAP, compareToReference } from "../../scripts/wyvern-dynamics.mjs";

const BASIS_PATH = fileURLToPath(
  new URL("../../assets/rig-audits/2026-10-22-c6-jaw-pivot/jaw-basis-authored.json", import.meta.url),
);
const REFERENCE_PATH = fileURLToPath(
  new URL("../../assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json", import.meta.url),
);
/** A jaw that opens further than this is not a pose, it is a flip. */
const MAX_JAW_DEG = 75;
/** Controls must reproduce the shipped channel this closely for the relation to be trusted. */
const CONTROL_TOLERANCE_DEG = 0.01;
/**
 * No shipped clip may sit within this fraction of a dynamics gate. `death`'s
 * conditioning ceiling here is the accel channel at ~18%, so this is set just
 * below it rather than at a round number: the point is headroom, not a round number.
 */
const MARGIN_FLOOR = 0.15;
/**
 * No bone may end up further than this from its bind rotation. `qpow` past 180deg
 * wraps the short way, so this is the line between "amplified" and "inverted".
 */
const MAX_EXCURSION_DEG = 165;
/** The re-solve family: D2 solved a gain, so this solves a gain. */
const GAIN_SWEEP = Array.from({ length: 20 }, (_, i) => +(1.1 + i * 0.1).toFixed(2));
const CANDIDATE_ALIASES = [
  fileURLToPath(new URL("../../public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb", import.meta.url)),
  fileURLToPath(new URL("../../public/models/wyvern-v2-membrane-lab-candidate.glb", import.meta.url)),
];

const angleDeg = (q) => (2 * Math.atan2(Math.hypot(q.x, q.y, q.z), Math.min(1, Math.abs(q.w))) * 180) / Math.PI;
const relativeDeg = (a, b) => angleDeg(a.clone().invert().multiply(b));
const fmt = (v) => `${(v * 100).toFixed(1)}%`;

function jawChannel(gltf, anim) {
  const jaw = gltf.nodes.findIndex((n) => n.name === "Jaw");
  assert.ok(jaw >= 0, "no Jaw node");
  const channel = anim.channels.find((c) => c.target.node === jaw && c.target.path === "rotation");
  assert.ok(channel, `${anim.name}: no Jaw rotation channel`);
  return { jaw, channel };
}

/** `rest * basis(0)^-1 * basis(k)` — the exporter's own relation, measured. */
function composeAuthored(rest, basis) {
  const b0inverse = basis[0].clone().invert();
  return basis.map((q) => rest.clone().multiply(b0inverse).multiply(q));
}

function analyse(gltf, binary, authored) {
  const jawNode = gltf.nodes.find((n) => n.name === "Jaw");
  const rest = new Quaternion(...(jawNode.rotation ?? [0, 0, 0, 1]));
  const rows = [];
  for (const [name, record] of Object.entries(authored.clips)) {
    const anim = gltf.animations.find((a) => a.name === name);
    assert.ok(anim, `${name}: clip missing from the asset`);
    const { channel } = jawChannel(gltf, anim);
    const sampler = anim.samplers[channel.sampler];
    const current = decodeFloats(gltf, binary, sampler.output);
    assert.equal(
      current.length / 4, record.count,
      `${name}: key count ${current.length / 4} != ${record.count} authored samples`,
    );

    const basis = record.basis.map(([w, x, y, z]) => new Quaternion(x, y, z, w));
    const target = composeAuthored(rest, basis);

    let deviation = 0;
    let authoredMax = 0;
    let currentMax = 0;
    for (let k = 0; k < target.length; k++) {
      const now = new Quaternion(current[k * 4], current[k * 4 + 1], current[k * 4 + 2], current[k * 4 + 3]);
      deviation = Math.max(deviation, relativeDeg(target[k], now));
      // Deformation angle relative to the rest pose, i.e. how far the mouth is open.
      authoredMax = Math.max(authoredMax, relativeDeg(target[k], rest));
      currentMax = Math.max(currentMax, relativeDeg(now, rest));
    }
    rows.push({ clip: name, keys: target.length, deviation, authoredMax, currentMax, target });
  }
  return rows;
}

/** Largest excursion from bind of any non-jaw bone, over the whole clip. */
function excursionOf(rc, bind) {
  const bq = new Quaternion(bind[0], bind[1], bind[2], bind[3]);
  let worst = 0;
  for (let k = 0; k < rc.times.length; k++) {
    const q = new Quaternion(rc.values[k * 4], rc.values[k * 4 + 1], rc.values[k * 4 + 2], rc.values[k * 4 + 3]);
    worst = Math.max(worst, angleDeg(bq.clone().invert().multiply(q)));
  }
  return worst;
}

/** Per-bone gain: full `gain` while the result stays inside the cap, 1 once it cannot. */
const localGain = (gain, excursion) => (
  excursion >= MAX_EXCURSION_DEG ? 1 : Math.min(gain, MAX_EXCURSION_DEG / Math.max(excursion, 1e-9))
);

/**
 * The gain every non-jaw channel gets in one clip.
 *
 * The membrane panels must move as one set. The panel gate compares each panel's
 * world deformation against the slerp of its two *adjacent* digits, so a panel
 * scaled differently from its digits desynchronises the web — measured at 34.65deg
 * in `death` when the cap was applied per bone. The coupled set therefore shares
 * one gain, computed from its worst member, which also keeps the cap honest for
 * every bone in it.
 */
function gainMap(gltf, binary, anim, bindRot, gain) {
  const channels = rotationChannels(gltf, binary, anim);
  const excursion = new Map(
    channels.map((rc) => [rc.name, excursionOf(rc, bindRot.get(rc.name) ?? [0, 0, 0, 1])]),
  );
  const coupled = [...excursion].filter(([name]) => PANEL_COUPLED.test(name)).map(([, e]) => e);
  const coupledGain = coupled.length ? localGain(gain, Math.max(...coupled)) : 1;

  const map = new Map();
  for (const [name, e] of excursion) {
    if (name === "Jaw") continue;
    map.set(name, PANEL_COUPLED.test(name) ? coupledGain : localGain(gain, e));
  }
  return map;
}

/**
 * Rewrite one clip: the authored Jaw channel, plus — when the clip needs it — the
 * capped non-jaw gain. `readGlb` returns a *view* of its input, so every trial
 * starts from its own copy or each iteration compounds the previous one's gain.
 */
function buildClip(sourceBytes, row, gain) {
  const { gltf, binary } = readGlb(Buffer.from(sourceBytes));
  const anim = gltf.animations.find((a) => a.name === row.clip);
  const bindRot = new Map(gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));

  const jawFlat = [];
  for (const q of row.target) jawFlat.push(q.x, q.y, q.z, q.w);
  const { channel } = jawChannel(gltf, anim);
  if (!writeFloatsInPlace(gltf, binary, anim.samplers[channel.sampler].output, jawFlat)) {
    throw new Error(`${row.clip}: Jaw rotation accessor is not a plain tight float array`);
  }

  if (gain !== null) {
    const gains = gainMap(gltf, binary, anim, bindRot, gain);
    for (const rc of rotationChannels(gltf, binary, anim)) {
      if (rc.name === "Jaw") continue;
      const local = gains.get(rc.name) ?? 1;
      if (local === 1) continue;
      const bind = bindRot.get(rc.name) ?? [0, 0, 0, 1];
      const out = [];
      for (let k = 0; k < rc.times.length; k++) {
        const q = rc.values.slice(k * 4, k * 4 + 4);
        out.push(...qnorm(qmul(bind, qpow(qmul(qinv(bind), q), local))));
      }
      if (!writeFloatsInPlace(gltf, binary, rc.sampler.output, out)) {
        throw new Error(`${row.clip}: ${rc.name} rotation accessor is not a plain tight float array`);
      }
    }
  }
  return encodeGlb(gltf, binary);
}

/** Gate one clip through the project's own comparator and report every margin. */
function gateClip(clip, metrics, reference) {
  const { passed, failures } = compareToReference({ [clip]: metrics }, reference);
  const want = reference.clips[REFERENCE_CLIP_MAP[clip]];
  const margins = {
    peak: metrics.peak / (want.peak * 0.7) - 1,
    p95: metrics.p95 / (want.p95 * 0.8) - 1,
    meanLow: metrics.mean / (want.mean * 0.7) - 1,
    meanHigh: 1 - metrics.mean / (want.mean * 1.4),
    accel: 1 - metrics.accelMax / (want.accelMax * 1.25),
  };
  return { passed, failures, want, metrics, margins, worst: Math.min(...Object.values(margins)) };
}

async function main() {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? resolve(argv[outIndex + 1]) : null;
  const write = argv.includes("--write");
  const report = argv.includes("--report");

  const authored = JSON.parse(readFileSync(BASIS_PATH, "utf8"));
  const reference = JSON.parse(readFileSync(REFERENCE_PATH, "utf8"));
  const bytes = readFileSync(RUNTIME_PATH);
  const { gltf, binary } = readGlb(bytes);

  const rows = analyse(gltf, binary, authored);
  for (const row of rows) row.kind = row.deviation <= CONTROL_TOLERANCE_DEG ? "control" : "restore";
  const controls = rows.filter((r) => r.kind === "control");
  const restores = rows.filter((r) => r.kind === "restore");

  const failures = [];
  const warnings = [];
  if (rows.length === 0) failures.push("the authored dump covers no clips");
  // The controls are the instrument: if the export relation no longer reproduces
  // the clips that were never gain-passed, the restore is a fit and must not write.
  if (controls.length === 0) failures.push("no control clip reproduced — the export composition is unverified");
  for (const row of rows) {
    if (row.authoredMax > MAX_JAW_DEG) {
      failures.push(`${row.clip}: authored jaw opens ${row.authoredMax.toFixed(1)}deg > ${MAX_JAW_DEG}deg`);
    }
  }

  // ---- Per clip: restore, then re-gain only if the restore breaks a gate -----
  const decisions = [];
  for (const row of restores) {
    const bareGate = gateClip(row.clip, await measureClipBytes(buildClip(bytes, row, null), row.clip), reference);
    if (bareGate.passed) {
      decisions.push({ row, gain: null, gate: bareGate, bareGate });
      continue;
    }

    const trials = [];
    for (const gain of GAIN_SWEEP) {
      const gate = gateClip(row.clip, await measureClipBytes(buildClip(bytes, row, gain), row.clip), reference);
      trials.push({ gain, gate });
      if (report) {
        console.log(
          `  ${row.clip} gain=${gain.toFixed(2)} peak=${gate.metrics.peak.toFixed(0)}` +
          ` p95=${gate.metrics.p95.toFixed(0)} mean=${gate.metrics.mean.toFixed(0)}` +
          ` accel=${gate.metrics.accelMax.toFixed(0)}  worst margin ${fmt(gate.worst)}` +
          ` ${gate.passed && gate.worst >= MARGIN_FLOOR ? "OK" : ""}`,
        );
      }
    }

    const eligible = trials.filter((t) => t.gate.passed && t.gate.worst >= MARGIN_FLOOR);
    if (eligible.length === 0) {
      const best = trials.reduce((a, b) => (b.gate.worst > a.gate.worst ? b : a));
      failures.push(
        `${row.clip}: restoring the jaw breaks the dynamics gate and no capped gain recovers it with a ` +
        `${fmt(MARGIN_FLOOR)} margin (best gain ${best.gain.toFixed(2)}, worst margin ${fmt(best.gate.worst)})`,
      );
      decisions.push({ row, gain: null, gate: bareGate, bareGate, unsolved: true });
      continue;
    }
    // Smallest gain that clears: past the first clear the extra gain only amplifies
    // bones that still have headroom, which is authoring rather than repair.
    decisions.push({ row, gain: eligible[0].gain, gate: eligible[0].gate, bareGate });
  }

  // ---- Assemble -------------------------------------------------------------
  const encodeAll = (items) => {
    let encoded = bytes;
    for (const { row, gain } of items) encoded = buildClip(encoded, row, gain);
    return encoded;
  };
  const encoded = restores.length
    ? encodeAll(decisions.map((d) => ({ row: d.row, gain: d.gain })))
    : bytes;

  // ---- Verify the assembled asset -------------------------------------------
  let signature = null;
  let sha256 = null;
  if (restores.length) {
    const check = readGlb(encoded);
    for (const row of analyse(check.gltf, check.binary, authored)) {
      if (row.deviation > CONTROL_TOLERANCE_DEG) {
        failures.push(`${row.clip}: still ${row.deviation.toFixed(4)}deg from authored after the write`);
      }
    }
    // The cap's whole point is that no bone wraps. The invariant is not "every bone
    // ends under the cap" — a bone already past it is held at 1x, deliberately — but
    // "no bone is pushed further than it already was, and none crosses the cap".
    for (const decision of decisions) {
      if (decision.gain === null) continue;
      const anim = check.gltf.animations.find((a) => a.name === decision.row.clip);
      const bindRot = new Map(check.gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));
      const before = new Map(
        rotationChannels(gltf, binary, gltf.animations.find((a) => a.name === decision.row.clip))
          .map((rc) => [rc.name, excursionOf(rc, bindRot.get(rc.name) ?? [0, 0, 0, 1])]),
      );
      for (const rc of rotationChannels(check.gltf, check.binary, anim)) {
        if (rc.name === "Jaw") continue;
        const worst = excursionOf(rc, bindRot.get(rc.name) ?? [0, 0, 0, 1]);
        const was = before.get(rc.name) ?? 0;
        if (worst > Math.max(was, MAX_EXCURSION_DEG) + 0.01) {
          failures.push(
            `${decision.row.clip}: ${rc.name} pushed to ${worst.toFixed(1)}deg from bind ` +
            `(was ${was.toFixed(1)}deg, cap ${MAX_EXCURSION_DEG}deg)`,
          );
        }
      }
    }
    for (const decision of decisions) {
      const gate = gateClip(decision.row.clip, await measureClipBytes(encoded, decision.row.clip), reference);
      if (!gate.passed) {
        failures.push(`${decision.row.clip}: assembled asset fails ${gate.failures.map((f) => f.channel).join(", ")}`);
        continue;
      }
      // A clip the restore does not move keeps whatever conditioning it already
      // had: `attack` ships 0.5% under its mean ceiling and this pass must not be
      // blamed for it. A clip this pass re-gains has to clear MARGIN_FLOOR.
      if (decision.gain !== null && gate.worst < MARGIN_FLOOR) {
        failures.push(`${decision.row.clip}: assembled margin ${fmt(gate.worst)} < ${fmt(MARGIN_FLOOR)}`);
      } else if (gate.worst < MARGIN_FLOOR) {
        warnings.push(`${decision.row.clip}: passes with a ${fmt(gate.worst)} margin — pre-existing, unchanged by this pass`);
      }
      if (gate.worst < decision.bareGate.worst - 1e-6) {
        failures.push(`${decision.row.clip}: conditioning got worse (${fmt(decision.bareGate.worst)} → ${fmt(gate.worst)})`);
      }
      decision.final = gate;
    }
    signature = inspectRuntimeRig(encoded);
    sha256 = createHash("sha256").update(encoded).digest("hex");
  }

  const table = rows.map((row) => {
    const decision = decisions.find((d) => d.row === row);
    const gain = decision?.gain ?? null;
    let amplified = 0;
    let held = 0;
    if (gain !== null) {
      const anim = gltf.animations.find((a) => a.name === row.clip);
      const bindRot = new Map(gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));
      for (const local of gainMap(gltf, binary, anim, bindRot, gain).values()) {
        if (local === 1) held += 1;
        else amplified += 1;
      }
    }
    const block = (gate) => gate && ({
      passed: gate.passed,
      worstMargin: +gate.worst.toFixed(4),
      margins: Object.fromEntries(Object.entries(gate.margins).map(([k, v]) => [k, +v.toFixed(4)])),
      peak: +gate.metrics.peak.toFixed(1),
      p95: +gate.metrics.p95.toFixed(1),
      mean: +gate.metrics.mean.toFixed(1),
      accelMax: +gate.metrics.accelMax.toFixed(1),
    });
    return {
      clip: row.clip,
      kind: row.kind,
      keys: row.keys,
      deviationDeg: +row.deviation.toFixed(4),
      shippedMaxDeg: +row.currentMax.toFixed(2),
      authoredMaxDeg: +row.authoredMax.toFixed(2),
      compensation: gain === null ? null : { gain, bonesAmplified: amplified, bonesHeldAtCap: held },
      dynamics: decision ? { restoreOnly: block(decision.bareGate), final: block(decision.final ?? decision.gate) } : null,
    };
  });

  console.log(JSON.stringify({
    clips: table,
    bytesBefore: bytes.length,
    bytesAfter: encoded.length,
    sha256,
    gates: failures.length ? { passed: false, failures } : { passed: true },
    warnings,
  }, null, 2));

  if (report) {
    console.log("\nclip          jaw shipped→authored   restore-only          final");
    for (const decision of decisions) {
      const { row, bareGate, gate } = decision;
      const comp = decision.gain === null ? "jaw only" : `gain ${decision.gain.toFixed(2)} capped at ${MAX_EXCURSION_DEG}deg`;
      console.log(
        `  ${row.clip.padEnd(12)} ${row.currentMax.toFixed(1).padStart(6)}→${row.authoredMax.toFixed(1).padStart(5)}` +
        `   worst ${fmt(bareGate.worst).padStart(7)} ${bareGate.passed ? "pass" : "FAIL"}` +
        `   worst ${fmt(gate.worst).padStart(7)} ${gate.passed ? "pass" : "FAIL"}  (${comp})`,
      );
      const w = gate.want;
      const m = gate.metrics;
      console.log(
        `      peak ${m.peak.toFixed(0).padStart(6)} / floor ${(w.peak * 0.7).toFixed(0)}` +
        `   p95 ${m.p95.toFixed(0).padStart(5)} / floor ${(w.p95 * 0.8).toFixed(0)}` +
        `   mean ${m.mean.toFixed(0).padStart(5)} / band ${(w.mean * 0.7).toFixed(0)}..${(w.mean * 1.4).toFixed(0)}` +
        `   accel ${m.accelMax.toFixed(0).padStart(6)} / ceiling ${(w.accelMax * 1.25).toFixed(0)}`,
      );
    }
  }

  if (failures.length) {
    console.error(`\nFAILED: ${failures.join("; ")}`);
    process.exitCode = 1;
  }

  if (write) {
    if (restores.length === 0) {
      console.log("\nnothing to write — every clip already carries its authored jaw");
      return;
    }
    if (failures.length) {
      console.error("\nrefusing to re-pin: the gates above did not pass");
      return;
    }

    const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
    contract.signature = signature;
    contract.asset.sha256 = sha256;
    contract.asset.bytes = encoded.length;
    const stamp = new Date().toISOString().slice(0, 10);
    const reGained = decisions.filter((d) => d.gain !== null)
      .map((d) => `${d.row.clip} gain ${d.gain.toFixed(2)}x capped at ${MAX_EXCURSION_DEG}deg from bind`);
    contract.provenance.baseline =
      `${stamp}: Jaw taken out of the D2/D3/D4 gain solve — the authored mouth restored in ` +
      `${restores.map((r) => r.clip).join(", ")}` +
      (reGained.length ? `; where that broke a gate the non-jaw gain was re-solved (${reGained.join("; ")})` : "") +
      `. tools/blender/restore_jaw_amplitude.mjs. ${contract.provenance.baseline}`;
    contract.provenance.evidence =
      `assets/rig-audits/2026-10-22-c6-jaw-pivot/jaw-restore.json; ${contract.provenance.evidence}`;
    validateRuntimeRig(encoded, { contract });

    const temporary = `${RUNTIME_PATH}.jaw-restore.tmp`;
    try {
      writeFileSync(temporary, encoded);
      renameSync(temporary, RUNTIME_PATH);
    } finally {
      rmSync(temporary, { force: true });
    }
    writeFileSync(CONTRACT_PATH, `${JSON.stringify(contract, null, 2)}\n`);
    for (const alias of CANDIDATE_ALIASES) writeFileSync(alias, encoded);

    // Re-read from disk: the bytes that will actually ship, against the pin on disk.
    validateRuntimeRig(readFileSync(RUNTIME_PATH));
    console.log(`\nre-pinned ${RUNTIME_PATH}`);
    console.log(`re-signed ${CONTRACT_PATH}`);
    console.log(`synced ${CANDIDATE_ALIASES.length} candidate aliases`);
  } else if (outPath) {
    writeFileSync(outPath, encoded);
    console.log(`\nwrote candidate ${outPath}`);
  } else {
    console.log("\ndry run (pass --out <path> or --write)");
  }
}

main();
