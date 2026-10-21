/**
 * Dynamics: how hard does a clip actually move?
 *
 * The existing gates all measure smoothness — loop seam, panel coordination,
 * mirror residual. None of them notices that a takeoff lost 92% of its
 * acceleration, because a clip that holds still is perfectly smooth. This
 * module measures the missing channel.
 *
 * Definition, chosen so V1 and V2 are directly comparable:
 *
 *   - sample every bone's **world** quaternion at `hz` (default 60),
 *   - per frame, take the **maximum over bones** of |dq| / dt,
 *   - report peak / p95 / mean in deg/s, plus an accent count.
 *
 * World space, not local: a local-only measure misses inherited parent motion,
 * which is most of what a wingbeat actually is.
 *
 * Only **deforming** bones are sampled (weight > 0). This does not change any
 * number: measured across all 13 V1 clips the largest difference is 0.9 deg/s
 * (Roar), because a zero-weight `_end` tip mirrors its parent's world rotation
 * exactly and so reports an identical angular step. It changes only *which bone
 * is named* as the peak — `Bone020_end_0269` becomes `Bone020_0132`. That is the
 * whole point: a report that blames an unkeyable tip is unactionable.
 *
 * Two guards exist because `peak` alone is trivially gameable: one keyframe
 * spike satisfies it while the clip still reads as sludge.
 *
 *   - sustain:   the peak frame must have a neighbour >= 0.8 x peak
 *   - accelMax:  |dw| per frame, which a 2-frame pop cannot hide
 *
 * `accents` (frames at >= 0.5 x peak) is measured and reported but **not
 * gated**: it swings 2 -> 93 on a clip that merely re-times its takeoff, so it
 * fails as a discriminator. It is kept in the report because the number is the
 * clearest single signal of a flat clip.
 *
 * A trap worth recording, because it cost an afternoon: V1's tracks are glTF
 * `CUBICSPLINE`, so `track.values` holds **three** entries per key (in-tangent,
 * value, out-tangent) and is 12 floats per key for a quaternion, not 4. Reading
 * `values[i * 4]` yields tangents, which are unnormalized and frequently
 * `[0, 0, 0, 0]` — it looks exactly like a file full of corrupt keyframes, and
 * it is not. Read `values[i * 12 + 4]` for the real value. This module never
 * touches `track.values`; it samples through an `AnimationMixer`, which is
 * already correct per-track and is the only safe way in.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { AnimationMixer, LoopRepeat, Quaternion } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

export const DYNAMICS_HZ = 60;

/** V2 clip -> V1 clip it is judged against. V1 has no cousin for the rest. */
export const REFERENCE_CLIP_MAP = Object.freeze({
  cruise: "FlightCruise",
  bankLeft: "BankLeft",
  bankRight: "BankRight",
  idle: "Idle",
  walk: "GroundWalk",
  takeoff: "Takeoff",
  death: "Death",
  attack: "AttackBite",
  attack2: "AttackClaw",
});

/**
 * Pass thresholds against a reference clip. `peak` is deliberately the loosest:
 * a clip may read differently from its reference and still be good. The floor
 * exists to catch collapse, not to demand a copy.
 */
export const GATE = Object.freeze({
  peakRatio: 0.7,
  p95Ratio: 0.8,
  meanRatio: [0.7, 1.4],
  accelRatio: 1.25,
});

/**
 * Total skin weight per bone, across every skinned mesh.
 *
 * V1 ships 292 joints of which 127 carry no weight at all — export `_end` tips
 * and the collapsed `Bip002_*` rider skeleton. A zero-weight tip inherits its
 * parent's rotation exactly, so including it does not inflate the metric (max
 * delta 0.9 deg/s over 13 clips); it just steals the `peakJoint` attribution.
 * Filtering keeps the blame on a bone an animator can actually key.
 */
export function jointMass(rig) {
  const mass = new Map();
  rig.scene.traverse((node) => {
    const mesh = node;
    if (!mesh.isSkinnedMesh) return;
    const geometry = mesh.geometry;
    const skinIndex = geometry.attributes.skinIndex;
    const skinWeight = geometry.attributes.skinWeight;
    if (!skinIndex || !skinWeight || !mesh.skeleton) return;
    const bones = mesh.skeleton.bones;
    for (let v = 0; v < skinIndex.count; v++) {
      for (let k = 0; k < 4; k++) {
        const weight = skinWeight.getComponent(v, k);
        if (weight <= 0) continue;
        const bone = bones[skinIndex.getComponent(v, k)];
        if (!bone) continue;
        mass.set(bone.name, (mass.get(bone.name) ?? 0) + weight);
      }
    }
  });
  return mass;
}

/** Bones that actually deform something, in scene order. */
export function deformingBones(rig) {
  const mass = jointMass(rig);
  return rig.bones.filter((bone) => (mass.get(bone.name) ?? 0) > 1e-6);
}

/**
 * Parse a GLB with materials stripped. The WebP decoder needs `self`, which
 * Node does not have, and dynamics does not care about pixels.
 */
export async function loadRig(path) {
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));

  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) delete primitive.material;
  }
  delete json.materials;
  delete json.images;
  delete json.textures;

  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
  encoded.copy(padded);
  const binary = bytes.subarray(20 + jsonLength);
  const output = Buffer.alloc(20 + padded.length + binary.length);
  bytes.copy(output, 0, 0, 20);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  padded.copy(output, 20);
  binary.copy(output, 20 + padded.length);

  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength), "");

  const bones = [];
  gltf.scene.traverse((node) => {
    if (node.isBone) bones.push(node);
  });

  const rig = { gltf, scene: gltf.scene, bones, sha256, bytes: bytes.length };
  rig.deforming = deformingBones(rig);
  return rig;
}

function seek(mixer, action, time, scene) {
  action.reset().play();
  action.time = time;
  mixer.update(0);
  scene.updateMatrixWorld(true);
}

/** One clip. Returns deg/s statistics plus the guard channels. */
export function measureClipDynamics(clip, scene, bones, { hz = DYNAMICS_HZ } = {}) {
  const dt = 1 / hz;
  const frames = Math.max(2, Math.round(clip.duration / dt) + 1);
  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopRepeat, Infinity);
  action.clampWhenFinished = false;

  const previous = bones.map(() => new Quaternion());
  const current = new Quaternion();
  const omega = [];

  for (let f = 0; f < frames; f++) {
    seek(mixer, action, Math.min(clip.duration, f * dt), scene);
    let frameMax = 0;
    let frameJoint = null;
    for (let b = 0; b < bones.length; b++) {
      const bone = bones[b];
      bone.getWorldQuaternion(current);
      if (f === 0) {
        previous[b].copy(current);
        continue;
      }
      const angle = previous[b].angleTo(current);
      previous[b].copy(current);
      if (!Number.isFinite(angle)) continue;
      const rate = angle / dt;
      if (rate > frameMax) {
        frameMax = rate;
        frameJoint = bone.name;
      }
    }
    if (f > 0) omega.push({ rate: frameMax, joint: frameJoint, frame: f });
  }

  mixer.stopAllAction();
  mixer.uncacheClip(clip);

  const rates = omega.map((o) => o.rate);
  const sorted = [...rates].sort((a, b) => a - b);
  const deg = (rad) => (rad * 180) / Math.PI;

  let peakIndex = 0;
  for (let i = 1; i < rates.length; i++) if (rates[i] > rates[peakIndex]) peakIndex = i;
  const peak = rates[peakIndex] ?? 0;

  // Sustain: a peak with no shoulder is a pop, not a beat.
  const neighbour = Math.max(rates[peakIndex - 1] ?? 0, rates[peakIndex + 1] ?? 0);
  const sustained = peak === 0 ? true : neighbour >= peak * 0.8;

  let accelMax = 0;
  for (let i = 1; i < rates.length; i++) accelMax = Math.max(accelMax, Math.abs(rates[i] - rates[i - 1]));

  const mean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
  const accents = peak > 0 ? rates.filter((r) => r >= peak * 0.5).length : 0;

  return {
    clip: clip.name,
    duration: clip.duration,
    frames,
    peak: deg(peak),
    peakJoint: omega[peakIndex]?.joint ?? null,
    peakFrame: omega[peakIndex]?.frame ?? null,
    p95: deg(p95),
    mean: deg(mean),
    accents,
    accelMax: deg(accelMax) * hz,
    sustained,
  };
}

/** Every clip in the file. */
export function measureDynamics(rig, options = {}) {
  const bones = options.includeAll ? rig.bones : rig.deforming;
  const clips = {};
  for (const clip of rig.gltf.animations) {
    clips[clip.name] = measureClipDynamics(clip, rig.scene, bones, options);
  }
  return clips;
}

/** Round to 3 dp so committed references diff cleanly. */
function tidy(metrics) {
  const round = (v) => Number(v.toFixed(3));
  return {
    duration: round(metrics.duration),
    peak: round(metrics.peak),
    peakJoint: metrics.peakJoint,
    p95: round(metrics.p95),
    mean: round(metrics.mean),
    accents: metrics.accents,
    accelMax: round(metrics.accelMax),
    sustained: metrics.sustained,
  };
}

export function buildReference(rig, path) {
  const clips = measureDynamics(rig);
  const tidyClips = {};
  for (const [name, metrics] of Object.entries(clips)) tidyClips[name] = tidy(metrics);
  return {
    generatedAt: new Date().toISOString(),
    source: { path, sha256: rig.sha256, bytes: rig.bytes },
    sampleHz: DYNAMICS_HZ,
    note: "Generated by scripts/wyvern-dynamics.mjs. Do not hand-edit.",
    clips: tidyClips,
  };
}

/**
 * Compare a candidate's clips against a reference. Returns every failure with
 * the numbers that produced it, so a report can quote rather than assert.
 */
export function compareToReference(candidate, reference) {
  const failures = [];
  const rows = [];

  for (const [candidateClip, referenceClip] of Object.entries(REFERENCE_CLIP_MAP)) {
    const got = candidate[candidateClip];
    const want = reference.clips[referenceClip];
    if (!got || !want) continue;

    const checks = [
      ["peak", got.peak, want.peak, GATE.peakRatio, ">="],
      ["p95", got.p95, want.p95, GATE.p95Ratio, ">="],
      ["mean", got.mean, want.mean, GATE.meanRatio, "within"],
      ["accelMax", got.accelMax, want.accelMax, GATE.accelRatio, "<="],
    ];

    for (const [channel, value, floor, threshold, mode] of checks) {
      let pass;
      let limit;
      if (mode === ">=") {
        limit = floor * threshold;
        pass = value >= limit;
      } else if (mode === "<=") {
        limit = floor * threshold;
        pass = value <= limit;
      } else if (Array.isArray(threshold)) {
        limit = [floor * threshold[0], floor * threshold[1]];
        pass = value >= limit[0] && value <= limit[1];
      } else {
        limit = [floor * (1 - threshold), floor * (1 + threshold)];
        pass = value >= limit[0] && value <= limit[1];
      }
      if (!pass) {
        failures.push({
          clip: candidateClip,
          channel,
          value,
          reference: floor,
          expected: mode === ">=" ? `>= ${limit.toFixed(2)}` : mode === "<=" ? `<= ${limit.toFixed(2)}` : `${limit[0].toFixed(2)}..${limit[1].toFixed(2)}`,
        });
      }
    }

    if (!got.sustained) {
      failures.push({ clip: candidateClip, channel: "sustain", value: got.peak, reference: want.peak, expected: "peak needs a neighbour >= 0.8x" });
    }

    rows.push({ clip: candidateClip, referenceClip, got, want });
  }

  return { passed: failures.length === 0, failures, rows };
}
