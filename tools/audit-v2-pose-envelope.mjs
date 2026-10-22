#!/usr/bin/env node
/**
 * Pose-envelope probe over a shipped GLB.
 *
 * `scanSeam` and `validate-wyvern-clips` both measure *change*. The three defects
 * that shipped in the V2 rig were all constant, so both reported success:
 *
 *   idle  -65° neck raise   seam 0.0000°, 0 issues
 *   walk  +8.6° open jaw    seam 0.0000°, 0 issues
 *   land→idle 15.9° snap    invisible to a single-clip scan
 *
 * This runs the detectors in `src/flight-lab/poseEnvelope.ts` over every clip of
 * a real asset, which is the only way to know whether the thresholds fire on
 * healthy motion. Run it after any clip rebuild:
 *
 *   npx tsx tools/audit-v2-pose-envelope.mjs public/models/wyvern-v2-rig.glb
 *
 * Exit code is 1 when any anomaly is found, so it can gate a candidate.
 *
 * `--self-test` answers the other half of the question: a probe that only ever
 * says green is decoration. It re-injects the three defects that actually
 * shipped (in memory — the file on disk is never touched) and requires each
 * detector family to fire. Run it against any rebuilt asset before trusting the
 * clean result above; exit code is 1 if the rig has drifted so far that the
 * injection no longer reproduces the defect, or if a detector has gone blind.
 *
 *   npx tsx tools/audit-v2-pose-envelope.mjs public/models/wyvern-v2-rig.glb --self-test
 */
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  CANONICAL_TRANSITIONS,
  POSE_ENVELOPE_THRESHOLDS,
  captureBindRotations,
  detectTransitionAnomalies,
  scanClipAnomalies,
} from "../src/flight-lab/poseEnvelope.ts";

const ARGS = process.argv.slice(2);
const jsonFlag = ARGS.indexOf("--json-out");
const outPath = jsonFlag === -1 ? null : ARGS[jsonFlag + 1];
const selfTest = ARGS.includes("--self-test");
const inputPath = ARGS.find((a, i) => !a.startsWith("--") && (jsonFlag === -1 || i !== jsonFlag + 1))
  ?? "public/models/wyvern-v2-rig.glb";

await MeshoptDecoder.ready;

function readGlbJson(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLen = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer.buffer, buffer.byteOffset + 20, jsonLen)));
}

/** Rewrites the GLB without textures/materials so GLTFLoader needs no DOM. */
function sanitize(buffer) {
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const dv = new DataView(ab);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  json.materials = (json.materials ?? []).map((m) => ({
    name: m.name,
    pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.6, 1], metallicFactor: 0, roughnessFactor: 0.9 },
  }));
  const binStart = 20 + jsonLen + 8;
  const bin = new Uint8Array(ab, binStart, ab.byteLength - binStart);
  let enc = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (enc.length % 4)) % 4;
  if (pad) {
    const padded = new Uint8Array(enc.length + pad);
    padded.set(enc);
    padded.fill(0x20, enc.length);
    enc = padded;
  }
  const total = 28 + enc.length + bin.length;
  const out = new ArrayBuffer(total);
  const o = new DataView(out);
  const u = new Uint8Array(out);
  o.setUint32(0, 0x46546c67, true);
  o.setUint32(4, 2, true);
  o.setUint32(8, total, true);
  o.setUint32(12, enc.length, true);
  o.setUint32(16, 0x4e4f534a, true);
  u.set(enc, 20);
  o.setUint32(20 + enc.length, bin.length, true);
  o.setUint32(24 + enc.length, 0x004e4942, true);
  u.set(bin, 28 + enc.length);
  return out;
}

const bytes = fs.readFileSync(inputPath);
const gltf = await new Promise((resolve, reject) => {
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(sanitize(bytes), "", resolve, reject);
});

const scene = gltf.scene;
const clips = [...gltf.animations].sort((a, b) => a.name.localeCompare(b.name));

// Bind pose, before any mixer touches a bone. This is the reference every
// detector measures against.
const bind = captureBindRotations(scene);

const perClip = new Map();
const all = [];

function scanEverything() {
  perClip.clear();
  all.length = 0;
  for (const clip of clips) {
    const scan = scanClipAnomalies(scene, clip, bind, { fps: 24, step: 0.25 });
    perClip.set(clip.name, scan);
    all.push(...scan.anomalies);
  }

  const byName = new Map([...perClip].map(([name, scan]) => [name.toLowerCase(), scan]));
  for (const [fromName, toName] of CANONICAL_TRANSITIONS) {
    const from = byName.get(fromName.toLowerCase());
    const to = byName.get(toName.toLowerCase());
    if (!from || !to) continue;
    all.push(...detectTransitionAnomalies({ from, to }));
  }
  return all;
}

scanEverything();

// ---------------------------------------------------------------- report

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log(`\npose envelope — ${inputPath}`);
console.log(`clips ${clips.length}, thresholds ${JSON.stringify(POSE_ENVELOPE_THRESHOLDS)}\n`);
console.log(`${pad("clip", 12)}${rpad("anomalies", 10)}  worst`);
for (const clip of clips) {
  const found = perClip.get(clip.name).anomalies;
  const worst = found[0];
  console.log(
    `${pad(clip.name, 12)}${rpad(found.length, 10)}  ${worst ? `${worst.kind} ${worst.boneName} ${worst.value.toFixed(1)}${worst.unit === "deg" ? "°" : " rig"} (limit ${worst.threshold})` : "-"}`,
  );
}

const handoffs = all.filter((a) => a.kind === "transition_handoff");
if (handoffs.length) {
  console.log("\nhandoffs");
  for (const a of handoffs.slice(0, 12)) console.log(`  ${a.message}`);
}

console.log(`\ntotal anomalies: ${all.length}`);
const baselineTotal = all.length;

// ------------------------------------------------------------- self-test
//
// Injects the three defects that shipped in V2 and requires each detector
// family to fire. Mutates the loaded clips in memory only.

let selfTestFailed = false;
if (selfTest) {
  const clipByName = new Map(gltf.animations.map((c) => [c.name.toLowerCase(), c]));

  /** Post-multiply a local X rotation onto `bone`'s track (all keys, or the last). */
  const inject = (clipName, boneName, pitch, { lastOnly = false } = {}) => {
    const clip = clipByName.get(clipName.toLowerCase());
    if (!clip) throw new Error(`self-test: no clip "${clipName}"`);
    const track = clip.tracks.find((t) => t.name === `${boneName}.quaternion`);
    if (!track) throw new Error(`self-test: no ${boneName}.quaternion in ${clipName}`);
    const bindQ = bind.rotations.get(boneName);
    if (!bindQ) throw new Error(`self-test: no bind rotation for ${boneName}`);
    const delta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      THREE.MathUtils.degToRad(pitch),
    );
    const start = lastOnly ? track.times.length - 1 : 0;
    for (let i = start; i < track.times.length; i += 1) {
      const q = new THREE.Quaternion().fromArray(track.values, i * 4);
      q.copy(bindQ).multiply(delta);
      q.toArray(track.values, i * 4);
    }
  };

  // idle held a -65 deg neck raise: Neck1 -21.1, Neck2 -24.2, Head -19.3.
  inject("idle", "Neck1", -21.1);
  inject("idle", "Neck2", -24.2);
  inject("idle", "Head", -19.3);
  // walk held a +8.6 deg open jaw on a 2-key step track.
  inject("walk", "Jaw", 8.6);
  // land ended 15.9 deg from where idle started.
  inject("land", "Neck2", 15.9, { lastOnly: true });

  const fired = scanEverything();

  const expected = [
    ["bind_delta", "idle", "Neck1"],
    ["bind_delta", "idle", "Neck2"],
    ["bind_delta", "idle", "Head"],
    ["horizon_pitch", "idle", "Head"],
    ["open_jaw", "walk", "Jaw"],
    ["transition_handoff", "land -> idle", "Neck2"],
  ];

  console.log("\nself-test — three shipped defects re-injected in memory");
  const missing = [];
  for (const [kind, clipName, boneName] of expected) {
    const hit = fired.find(
      (a) => a.kind === kind && a.clip === clipName && a.boneName === boneName,
    );
    if (!hit) missing.push(`${kind} ${clipName} ${boneName}`);
    console.log(
      `  ${hit ? "fired  " : "MISSING"} ${pad(kind, 19)}${pad(clipName, 14)}${pad(boneName, 8)}` +
        `${hit ? `${hit.value}${hit.unit === "deg" ? "°" : " rig"} (limit ${hit.threshold})` : ""}`,
    );
  }

  if (missing.length) {
    selfTestFailed = true;
    console.log(`\nself-test FAILED: ${missing.length} detector(s) went blind — ${missing.join(", ")}`);
    console.log("Either the injection no longer reproduces the defect on this asset, or the detector is broken.");
  } else {
    console.log(`\nself-test PASSED: ${expected.length}/${expected.length} expected findings fired (${fired.length} anomalies total)`);
  }
}

if (outPath) {
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        asset: inputPath,
        thresholds: POSE_ENVELOPE_THRESHOLDS,
        clips: clips.map((c) => ({ clip: c.name, anomalies: perClip.get(c.name).anomalies })),
        transitions: handoffs,
        total: all.length,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${outPath}`);
}

// Self-test mode judges only the injection (the baseline is reported above and
// is `all` at that point); normal mode judges the asset.
process.exit(selfTest ? (selfTestFailed ? 1 : 0) : baselineTotal !== 0 ? 1 : 0);
