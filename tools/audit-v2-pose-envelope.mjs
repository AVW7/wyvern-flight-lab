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

process.exit(all.length === 0 ? 0 : 1);
