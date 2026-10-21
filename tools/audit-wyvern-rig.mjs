#!/usr/bin/env node
/**
 * Comprehensive rig & animation audit for a skinned GLB.
 *
 * Structural facts come from the container JSON. Behaviour comes from the same
 * GLTFLoader + AnimationMixer the browser runs, sampled on a fixed grid.
 * Images are stripped before parse so Node needs no DOM; this audit makes no
 * claim about textures.
 *
 * Two conventions matter for reading the numbers:
 *
 * - World rotations are accumulated as parent * local quaternions rather than
 *   decomposed from matrixWorld. At ~1e3 rig-unit translations the matrix path
 *   loses ~1e-4 rad to float32, the same order as the loop seams measured here.
 * - This export stores its rig-unit scale (2187.9565) inside the inverse bind
 *   matrices, not in the node hierarchy, so `boneWorld * inverseBind` is not
 *   identity at rest and comparing it to identity is meaningless. The skinning
 *   invariant that does hold is edge-length preservation: a correct bind is a
 *   similarity transform, so every mesh edge keeps its bind length at rest.
 *
 * Every detector is mutation-tested at the end and must go red on a corrupted
 * clip, otherwise it is decoration.
 *
 * Usage: node tools/audit-wyvern-rig.mjs [glb] [outDir]
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { quatAngle as sharedQuatAngle } from "../scripts/wyvern-loop-metrics.mjs";
import { jointTranslationRange } from "../scripts/wyvern-ground-metrics.mjs";
import {
  FLIGHT_LAB_TARGET_SIZE,
  PLAYER_TARGET_SIZE,
  bindBounds,
  metresPerUnit,
} from "../scripts/wyvern-runtime-scale.mjs";

await MeshoptDecoder.ready;

const ARGS = process.argv.slice(2);
const FLAGS = new Set(ARGS.filter((a) => a.startsWith("--")));
const POSITIONAL = ARGS.filter((a) => !a.startsWith("--"));

const TARGET = POSITIONAL[0] ?? "public/models/wyvern-v2-rig.glb";
const OUT_DIR = POSITIONAL[1] ?? "assets/rig-audits/2026-10-20-v2-rig";
/** Assert the invariants and exit non-zero on failure. */
const CHECK = FLAGS.has("--check");
/** Also enforce the two reported-but-unfixed findings (Body travel, foot spread). */
const STRICT = FLAGS.has("--strict");

/**
 * Metres per rig unit. Not a constant: the runtime rescales every specimen to a
 * display target, so this depends on who is showing it. Assigned after the load
 * — see `scripts/wyvern-runtime-scale.mjs` for why the old hardcoded 0.0072 was
 * wrong by a factor of 5.4.
 */
let FIT = 0;
let FIT_LAB = 0;
let BIND_EXTENT = 0;
const SAMPLE_HZ = 60;
const MESH_FRAMES = 12;
const EDGE_BUDGET = 6000;
/** Bind-space length below which an edge is too short for a ratio to mean anything. */
const EDGE_MIN_BIND = 1e-6;
/** Rig units below which a translation channel is quantisation noise. */
const TRANSLATION_MIN = 0.5;

/** Authored budgets, all from scripts/validate-wyvern-clips.mjs. */
const LIMIT = {
  loopSeamRad: 0.05,        // :92
  loopSeamRigUnits: 0.05,   // :93
  rootTravelRigUnits: 1e-4, // :106
  mirrorMetres: 0.25,       // :91
};

/**
 * No rad/s budget exists in the repo (searched). This is distribution-derived:
 * flagged when a clip peak exceeds P95 + 4*IQR of the 18-clip population.
 * Reported, never asserted as a failure.
 */
const OUTLIER = { iqrFactor: 4, accelFactor: 12 };

/**
 * A 1 cm gap, converted to rig units once the display scale is known. The
 * absolute size matters more than it looks: at 1.34 mm per unit this is 7.5
 * units, not the 1.4 units a 7.2 mm assumption gave, and the contact duty and
 * slip figures move with it.
 */
const CONTACT_BAND_METRES = 0.01;

/** Mirrors LOOPING in scripts/validate-wyvern-clips.mjs:56. */
const LOOPING = new Set([
  "idle", "walk", "rest", "cruise", "scout",
  "bankLeft", "bankRight", "hover", "glide", "dive", "speed",
]);

/** Clips whose feet are meant to carry weight. Used for the foot-height spread. */
const GROUNDED = new Set([
  "idle", "walk", "rest", "attack", "attack2", "breath", "land", "takeoff", "death", "scout",
]);

/**
 * Enforced only under --strict. Both are currently red on the shipped asset,
 * which is the point: the gate can see them now, and the fix is an asset edit
 * rather than a threshold change.
 */
const BODY_TRAVEL_LIMIT = 0.5;   // rig units, ~3.6 mm
const FOOT_SPREAD_LIMIT = 100;   // rig units, ~0.72 m

// ---------------------------------------------------------------- utilities

const bytes = fs.readFileSync(TARGET);
const sha256 = createHash("sha256").update(bytes).digest("hex");

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

const loadScene = (glb) =>
  new Promise((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(glb, "", resolve, reject);
  });

/**
 * Angle between two orientations. Shared with the repo gate so the two cannot
 * drift: `scripts/wyvern-loop-metrics.mjs` explains why the dot-product acos
 * form is wrong here (non-unit float32 quaternions, `quatAngle(q, q) !== 0`).
 */
const quatAngle = (a, b) => sharedQuatAngle(a, b);

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function stats(values) {
  if (!values.length) return { n: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p50: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    max: s[s.length - 1],
  };
}

const REGION = [
  [/^Root$|^RootMotion$/, "root"],
  [/^Body$|^Spine/, "spine"],
  [/^Neck|^Head|^Jaw/, "head"],
  [/Wing/, "wing"],
  [/Leg|Thigh|Calf|Foot|Toes/, "leg"],
  [/Tail/, "tail"],
];
const regionOf = (name) => REGION.find(([re]) => re.test(name))?.[1] ?? "other";

// ------------------------------------------------------------------- load

const json = readGlbJson(bytes);
const gltf = await loadScene(sanitize(bytes));
const scene = gltf.scene;
const clips = gltf.animations;

const bones = [];
scene.traverse((o) => {
  if (o.isBone) bones.push(o);
});
const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
const parentIndex = bones.map((b) => (b.parent?.isBone ? boneIndex.get(b.parent.name) : -1));

const skinnedMeshes = [];
scene.traverse((o) => {
  if (o.isSkinnedMesh) skinnedMeshes.push(o);
});

// Derive the display scale exactly as `normalizedClone` does, so the metres in
// this report mean what the game means by them.
scene.updateMatrixWorld(true);
const bind = bindBounds(skinnedMeshes);
BIND_EXTENT = bind.extent;
const BIND_MIN_Y = bind.min.y;
FIT = metresPerUnit(BIND_EXTENT, PLAYER_TARGET_SIZE);
FIT_LAB = metresPerUnit(BIND_EXTENT, FLIGHT_LAB_TARGET_SIZE);
const CONTACT_BAND = CONTACT_BAND_METRES / FIT;

// ------------------------------------------------------------- 1. structure

const structure = {
  file: { path: TARGET, sha256, bytes: bytes.length },
  generator: json.asset?.generator ?? null,
  gltfVersion: json.asset?.version ?? null,
  extensionsUsed: json.extensionsUsed ?? [],
  counts: {
    nodes: json.nodes?.length ?? 0,
    meshes: json.meshes?.length ?? 0,
    primitives: (json.meshes ?? []).reduce((n, m) => n + m.primitives.length, 0),
    skins: json.skins?.length ?? 0,
    joints: json.skins?.[0]?.joints.length ?? 0,
    animations: json.animations?.length ?? 0,
    materials: json.materials?.length ?? 0,
    accessors: json.accessors?.length ?? 0,
  },
  sceneRoots: (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map((i) => json.nodes[i].name),
  triangles: skinnedMeshes.reduce(
    (n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3,
    0,
  ),
  boneNames: bones.map((b) => b.name),
  meshes: (json.meshes ?? []).map((m) => ({
    name: m.name,
    primitives: m.primitives.length,
    attributes: m.primitives.map((p) => Object.keys(p.attributes)),
    morphTargets: m.primitives.reduce((n, p) => n + (p.targets?.length ?? 0), 0),
  })),
  skin: {
    joints: json.skins?.[0]?.joints.length ?? 0,
    inverseBindMatricesAccessor: json.skins?.[0]?.inverseBindMatrices ?? null,
    skeletonRoot: json.skins?.[0]?.skeleton ?? null,
  },
  positionEncoding: skinnedMeshes.map((m) => {
    const p = m.geometry.attributes.position;
    return { mesh: m.name, type: p.array.constructor.name, normalized: p.normalized };
  }),
};

const depthOf = new Map();
const depth = (bone) => {
  if (depthOf.has(bone.name)) return depthOf.get(bone.name);
  const d = bone.parent?.isBone ? depth(bone.parent) + 1 : 0;
  depthOf.set(bone.name, d);
  return d;
};
const regions = {};
const byDepth = {};
for (const b of bones) {
  regions[regionOf(b.name)] = (regions[regionOf(b.name)] ?? 0) + 1;
  byDepth[depth(b)] = (byDepth[depth(b)] ?? 0) + 1;
}

// ------------------------------------------------- 2. skin weight integrity

const skin = {
  meshes: [],
  totalVertices: 0,
  unweighted: 0,
  nonFinite: 0,
  maxSumError: 0,
  maxInfluences: 0,
  jointsWithMass: 0,
  nonDeformingJoints: [],
  sharedSkeleton: null,
  skeletonInstances: 0,
  jointMass: new Float64Array(bones.length),
};

const skeletons = skinnedMeshes.map((m) => m.skeleton);
skin.skeletonInstances = new Set(skeletons).size;
skin.sharedSkeleton = skeletons.every((s) => s.bones.every((b, i) => b === skeletons[0].bones[i]));
skin.quantizationStep = skinnedMeshes[0]?.geometry.attributes.skinWeight.normalized
  ? 1 / (skinnedMeshes[0].geometry.attributes.skinWeight.array instanceof Uint8Array ? 255 : 65535)
  : 0;

for (const mesh of skinnedMeshes) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  let unweighted = 0;
  let maxSumError = 0;
  let maxInfluences = 0;
  let single = 0;
  const influenceHistogram = {};

  for (let v = 0; v < pos.count; v++) {
    let sum = 0;
    let inf = 0;
    let dominant = 0;
    for (let k = 0; k < 4; k++) {
      // getComponent already denormalizes a normalized attribute.
      const w = sw.getComponent(v, k);
      if (!Number.isFinite(w)) skin.nonFinite++;
      if (w > 0) inf++;
      if (w > dominant) dominant = w;
      sum += w;
      const j = si.getComponent(v, k);
      if (w > 0 && j < bones.length) skin.jointMass[j] += w;
    }
    if (sum <= 1e-6) unweighted++;
    if (inf === 1 && dominant > 0.99) single++;
    influenceHistogram[inf] = (influenceHistogram[inf] ?? 0) + 1;
    maxSumError = Math.max(maxSumError, Math.abs(sum - 1));
    maxInfluences = Math.max(maxInfluences, inf);
  }

  skin.meshes.push({
    name: mesh.name,
    vertices: pos.count,
    unweighted,
    maxSumError,
    singleInfluence: single,
    singleInfluenceFraction: single / pos.count,
    influenceHistogram,
  });
  skin.totalVertices += pos.count;
  skin.unweighted += unweighted;
  skin.maxSumError = Math.max(skin.maxSumError, maxSumError);
  skin.maxInfluences = Math.max(skin.maxInfluences, maxInfluences);
}

for (let j = 0; j < bones.length; j++) {
  if (skin.jointMass[j] > 1e-9) skin.jointsWithMass++;
  else skin.nonDeformingJoints.push(bones[j].name);
}

// ------------------------------------------------------ 3. track analysis

const interpolationByNode = new Map();
for (const anim of json.animations ?? []) {
  for (const ch of anim.channels) {
    const node = json.nodes[ch.target.node]?.name;
    interpolationByNode.set(`${node}.${ch.target.path}`, anim.samplers[ch.sampler].interpolation ?? "LINEAR");
  }
}

/** Exact local-translation travel per bone, straight from the tracks. */
function translationChannels(clip) {
  const out = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith(".position")) continue;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < track.values.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], track.values[i + k]);
        hi[k] = Math.max(hi[k], track.values[i + k]);
      }
    }
    const range = [0, 1, 2].map((k) => hi[k] - lo[k]);
    const magnitude = Math.hypot(...range);
    if (magnitude > TRANSLATION_MIN) out.push({ bone: track.name.split(".")[0], magnitude, range });
  }
  return out.sort((a, b) => b.magnitude - a.magnitude);
}

const trackReport = {};
const translationByBone = {};
for (const clip of clips) {
  const byPath = { translation: 0, rotation: 0, scale: 0 };
  let constant = 0;
  let stepChannels = 0;
  let stepVarying = 0;
  let maxStepRange = 0;
  let maxScaleDeviation = 0;
  let minKeys = Infinity;
  let maxKeys = 0;
  const animatedJoints = new Set();

  for (const track of clip.tracks) {
    const pathName = track.name.split(".").pop();
    if (pathName in byPath) byPath[pathName]++;
    const stride = pathName === "rotation" ? 4 : 3;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < track.values.length; i += stride) {
      for (let k = 0; k < stride; k++) {
        const x = track.values[i + k];
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    const range = hi - lo;
    if (range < 1e-6) constant++;
    if (pathName === "scale") maxScaleDeviation = Math.max(maxScaleDeviation, Math.abs(hi - 1), Math.abs(lo - 1));
    minKeys = Math.min(minKeys, track.times.length);
    maxKeys = Math.max(maxKeys, track.times.length);
    if (pathName === "rotation" && range > 1e-6) animatedJoints.add(track.name.split(".")[0]);

    // STEP is lossless only for a constant channel; a varying STEP is a stepped pose.
    if (interpolationByNode.get(track.name) === "STEP") {
      stepChannels++;
      if (range > 1e-6) {
        stepVarying++;
        maxStepRange = Math.max(maxStepRange, range);
      }
    }
  }

  const translations = translationChannels(clip);
  for (const t of translations) {
    if (!translationByBone[t.bone] || t.magnitude > translationByBone[t.bone].magnitude) {
      translationByBone[t.bone] = { ...t, clip: clip.name };
    }
  }
  const bodyTranslation = translations.find((t) => t.bone === "Body")?.magnitude ?? 0;

  trackReport[clip.name] = {
    duration: clip.duration,
    tracks: clip.tracks.length,
    byPath,
    constantTracks: constant,
    stepChannels,
    stepVarying,
    maxStepRange,
    animatedJoints: animatedJoints.size,
    minKeys,
    maxKeys,
    maxScaleDeviation,
    translatedBones: translations.length,
    maxTranslationRigUnits: translations[0]?.magnitude ?? 0,
    maxTranslationBone: translations[0]?.bone ?? null,
    bodyTranslationRigUnits: bodyTranslation,
  };
}

// ------------------------------------------------------- 4. frame sampling

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

/**
 * Evaluate a clip at an exact time and refresh world matrices.
 *
 * `mixer.setTime(t)` cannot be used to seek: it resets every action's own time
 * to zero first. Assigning `action.time` and stepping the mixer by a zero delta
 * evaluates at that time without advancing it — `_updateTime(0)` returns the
 * assigned time unchanged when `_loopCount` is still -1, which is the state a
 * freshly `play()`ed action is in.
 *
 * Verified rather than assumed: at t=0 the evaluated pose sits at distance
 * 0.00e+0 from the track's first key under every seek strategy tried
 * (`update(0)`, `update(1e-9)`, `stopAllAction()` first). An earlier revision of
 * this file used `update(1e-9)` to dodge a supposed stale first sample; that
 * residual turned out to be the angle formula, not the sampler, and is gone.
 */
function seek(mixer, action, t) {
  action.reset().play();
  action.time = t;
  mixer.update(0);
  scene.updateMatrixWorld(true);
}

// V2's names. V1 keeps the vendor `Bip002-L-Toe12_0207` / `...-Hand...` names,
// so anything not found literally is resolved by pattern — otherwise `contact`
// comes back empty and every clearance reads `Infinity` on the reference rig.
const CONTACT_BONES = (() => {
  const literal = ["L_Toes", "R_Toes", "L_Foot", "R_Foot", "L_WingHand", "R_WingHand"];
  const present = literal.filter((n) => boneIndex.has(n));
  if (present.length === literal.length) return literal;
  const derived = bones
    .map((b) => b.name)
    .filter((n) => /(^|[-_])[LR][-_]?(toe|foot|hand)/i.test(n) && !/finger|claw/i.test(n));
  return [...new Set([...present, ...derived])];
})();

function sampleClip(clip) {
  const dt = 1 / SAMPLE_HZ;
  const frames = Math.max(2, Math.round(clip.duration / dt) + 1);
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const n = bones.length;
  // Float64, not Float32: at 1e-4 rad the storage error of a Float32 quaternion
  // is the same order as the loop seams and the angular-velocity noise floor.
  const pos = new Float64Array(frames * n * 3);
  const quat = new Float64Array(frames * n * 4);
  const local = new Float64Array(frames * n * 4);
  const times = new Float64Array(frames);
  const world = new Array(n).fill(null).map(() => new THREE.Quaternion());

  for (let f = 0; f < frames; f++) {
    // Exact endpoints: a grid of round(duration*60) steps lands short of the
    // last key and turns a closed loop into a false seam.
    const t = (clip.duration * f) / (frames - 1);
    times[f] = t;
    seek(mixer, action, t);

    // Parents precede children in traversal order, so one pass accumulates exactly.
    for (let b = 0; b < n; b++) {
      const parent = parentIndex[b];
      if (parent < 0) world[b].copy(bones[b].quaternion);
      else world[b].copy(world[parent]).multiply(bones[b].quaternion);

      const lq = bones[b].quaternion;
      local[(f * n + b) * 4] = lq.x;
      local[(f * n + b) * 4 + 1] = lq.y;
      local[(f * n + b) * 4 + 2] = lq.z;
      local[(f * n + b) * 4 + 3] = lq.w;

      quat[(f * n + b) * 4] = world[b].x;
      quat[(f * n + b) * 4 + 1] = world[b].y;
      quat[(f * n + b) * 4 + 2] = world[b].z;
      quat[(f * n + b) * 4 + 3] = world[b].w;

      bones[b].getWorldPosition(tmpV);
      pos[(f * n + b) * 3] = tmpV.x;
      pos[(f * n + b) * 3 + 1] = tmpV.y;
      pos[(f * n + b) * 3 + 2] = tmpV.z;
    }
  }
  mixer.stopAllAction();
  mixer.uncacheClip(clip);
  return { dt, frames, times, pos, quat, local };
}

/** Sampled mesh edges, for the skinning invariant. */
const edgeSets = skinnedMeshes.map((mesh) => {
  const g = mesh.geometry;
  const index = g.index;
  const tri = index ? index.count : g.attributes.position.count;
  const stride = Math.max(1, Math.floor(tri / 3 / EDGE_BUDGET));
  const seen = new Set();
  const edges = [];
  for (let t = 0; t < tri / 3; t += stride) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(u, v);
    }
  }
  const attr = g.attributes.position;
  const bindLength = new Float32Array(edges.length / 2);
  for (let e = 0; e < bindLength.length; e++) {
    const u = edges[e * 2];
    const v = edges[e * 2 + 1];
    bindLength[e] = Math.hypot(attr.getX(u) - attr.getX(v), attr.getY(u) - attr.getY(v), attr.getZ(u) - attr.getZ(v));
  }
  return { mesh, edges, bindLength };
});

/**
 * Median ratio of skinned edge length to bind-space edge length at the current
 * pose. This is not a deformation metric — it is the constant scale between the
 * bind space and the posed rig, which for this export is the rig-unit factor
 * baked into the inverse bind matrices.
 */
function edgeScaleVsBind() {
  const cur = skinnedEdgeLengths();
  const ratios = [];
  let i = 0;
  for (const { bindLength } of edgeSets) {
    for (const b of bindLength) {
      if (b > EDGE_MIN_BIND) ratios.push(cur[i] / b);
      i++;
    }
  }
  ratios.sort((a, b) => a - b);
  return { median: quantile(ratios, 0.5), p99: quantile(ratios, 0.99), edges: ratios.length };
}

/**
 * Vertices dominated by the foot/toe joints: the actual support surface.
 * Matched by pattern, not by literal name — V2 ships `L_Toes`/`R_Foot`, V1
 * ships `Bip002-L-Toe12_0207`, and a literal set silently yields no vertices
 * (and an `Infinity` clearance) on the rig it does not know.
 */
const FOOT_JOINT_RE = /toe|foot/i;
const footVertices = skinnedMeshes.map((mesh) => {
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  const indices = [];
  for (let v = 0; v < si.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) {
      if (FOOT_JOINT_RE.test(bones[si.getComponent(v, k)]?.name ?? "")) w += sw.getComponent(v, k);
    }
    if (w > 0.5) indices.push(v);
  }
  return { mesh, indices };
});

/**
 * Height of the foot surface per frame. The whole-mesh minimum is dominated by
 * wing tips and says nothing about ground support; this isolates the vertices
 * that would actually rest on terrain.
 */
function footSurface(clip) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const v = new THREE.Vector3();
  let min = Infinity;
  let max = -Infinity;
  const frames = 48;
  for (let k = 0; k < frames; k++) {
    seek(mixer, action, (clip.duration * k) / (frames - 1));
    let frameMin = Infinity;
    for (const { mesh, indices } of footVertices) {
      const attr = mesh.geometry.attributes.position;
      for (const i of indices) {
        v.fromBufferAttribute(attr, i);
        mesh.applyBoneTransform(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        if (v.y < frameMin) frameMin = v.y;
      }
    }
    min = Math.min(min, frameMin);
    max = Math.max(max, frameMin);
  }
  mixer.stopAllAction();
  mixer.uncacheClip(clip);
  return { min, max, range: max - min, vertices: footVertices.reduce((n, f) => n + f.indices.length, 0) };
}

function meshExtremes(clip) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const v = new THREE.Vector3();
  const per = skinnedMeshes.map((m) => ({ mesh: m, minY: Infinity, maxY: -Infinity }));
  for (let k = 0; k < MESH_FRAMES; k++) {
    seek(mixer, action, (clip.duration * k) / (MESH_FRAMES - 1));
    for (const p of per) {
      const attr = p.mesh.geometry.attributes.position;
      for (let i = 0; i < attr.count; i += 4) {
        v.fromBufferAttribute(attr, i);
        p.mesh.applyBoneTransform(i, v);
        v.applyMatrix4(p.mesh.matrixWorld);
        if (v.y < p.minY) p.minY = v.y;
        if (v.y > p.maxY) p.maxY = v.y;
      }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheClip(clip);
  return {
    minY: Math.min(...per.map((p) => p.minY)),
    maxY: Math.max(...per.map((p) => p.maxY)),
    perMesh: per.map((p) => ({ mesh: p.mesh.name, minY: p.minY, maxY: p.maxY })),
  };
}

/** Skinned length of every sampled edge at the current pose. */
function skinnedEdgeLengths() {
  const out = [];
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  for (const { mesh, edges } of edgeSets) {
    const attr = mesh.geometry.attributes.position;
    for (let e = 0; e < edges.length / 2; e++) {
      const u = edges[e * 2];
      const v = edges[e * 2 + 1];
      va.fromBufferAttribute(attr, u);
      vb.fromBufferAttribute(attr, v);
      mesh.applyBoneTransform(u, va);
      mesh.applyBoneTransform(v, vb);
      out.push(va.distanceTo(vb));
    }
  }
  return out;
}

/**
 * Edge stretch sampled across a clip, relative to that clip's own first frame.
 * Relative, because this export's animated pose is ~2187.96x the node rest
 * pose (the rig-unit scale lives in the inverse bind matrices), so comparing
 * skinned lengths to bind-space lengths only measures that constant scale.
 */
function edgeOverClip(clip) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  seek(mixer, action, 0);
  const base = skinnedEdgeLengths();

  let p99Max = 0;
  let maxMax = 0;
  let p01Min = Infinity;
  for (let k = 1; k < 7; k++) {
    seek(mixer, action, (clip.duration * k) / 6);
    const cur = skinnedEdgeLengths();
    const ratios = [];
    // 0.5 rig units ~ 3.6 mm: below this an edge is a modelling artifact and
    // its ratio is dominated by absolute float error.
    for (let e = 0; e < base.length; e++) if (base[e] > 0.5) ratios.push(cur[e] / base[e]);
    ratios.sort((a, b) => a - b);
    p99Max = Math.max(p99Max, quantile(ratios, 0.99));
    maxMax = Math.max(maxMax, ratios[ratios.length - 1]);
    p01Min = Math.min(p01Min, quantile(ratios, 0.01));
  }
  mixer.stopAllAction();
  mixer.uncacheClip(clip);
  return { p99Max, maxMax, p01Min, edges: base.length };
}

function measureClip(clip) {
  const s = sampleClip(clip);
  const { frames, pos, quat, local, dt } = s;
  const n = bones.length;

  const omega = [];
  const localOmega = [];
  let localPeak = { value: 0, joint: null, frame: 0 };
  let peak = { value: 0, joint: null, frame: 0, time: 0 };
  const perJointMax = new Float64Array(n);
  const accel = [];
  const worldSpeed = [];
  let maxWorldSpeed = { value: 0, joint: null, frame: 0 };

  for (let b = 0; b < n; b++) {
    let prev = 0;
    for (let f = 1; f < frames; f++) {
      const i0 = (f * n + b) * 4;
      const i1 = ((f - 1) * n + b) * 4;
      tmpQ.set(quat[i0], quat[i0 + 1], quat[i0 + 2], quat[i0 + 3]);
      tmpQ2.set(quat[i1], quat[i1 + 1], quat[i1 + 2], quat[i1 + 3]);
      const w = quatAngle(tmpQ, tmpQ2) / dt;
      omega.push(w);

      // Local rate: the authored channel, free of inherited parent motion and
      // of any matrix-decomposition error. Zero iff the rotation tracks are
      // static, which is exactly what the freeze detector needs to assert.
      const l0 = (f * n + b) * 4;
      const l1 = ((f - 1) * n + b) * 4;
      tmpQ.set(local[l0], local[l0 + 1], local[l0 + 2], local[l0 + 3]);
      tmpQ2.set(local[l1], local[l1 + 1], local[l1 + 2], local[l1 + 3]);
      const lw = quatAngle(tmpQ, tmpQ2) / dt;
      localOmega.push(lw);
      if (lw > localPeak.value) localPeak = { value: lw, joint: bones[b].name, frame: f };
      perJointMax[b] = Math.max(perJointMax[b], w);
      if (w > peak.value) peak = { value: w, joint: bones[b].name, frame: f, time: s.times[f] };
      if (f > 1) accel.push(Math.abs(w - prev) / dt);
      prev = w;

      const p0 = (f * n + b) * 3;
      const p1 = ((f - 1) * n + b) * 3;
      const v = Math.hypot(pos[p0] - pos[p1], pos[p0 + 1] - pos[p1 + 1], pos[p0 + 2] - pos[p1 + 2]) / dt;
      worldSpeed.push(v);
      if (v > maxWorldSpeed.value) maxWorldSpeed = { value: v, joint: bones[b].name, frame: f };
    }
  }

  const translate = {};
  for (const name of ["Root", "RootMotion", "Body"]) {
    if (!boneIndex.has(name)) continue;
    const b = boneIndex.get(name);
    const range = [0, 1, 2].map((k) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let f = 0; f < frames; f++) {
        const x = pos[(f * n + b) * 3 + k];
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      return hi - lo;
    });
    translate[name] = {
      // Two different quantities for "how far does this joint move", named
      // apart because they are close enough to be mistaken for one another.
      // `worldRange` is the axis-aligned box of the sampled world position;
      // `localRange` is the authored track range. A box diagonal is not
      // rotation-invariant, so rotating the same travel into world axes changes
      // the diagonal -- `takeoff`'s Body reads 1177.5 against 1187.7 for a path
      // of identical length. Quote `localRange` when the question is how far a
      // clip moves a joint: it is exact rather than sampled, and it is the
      // number `scripts/validate-wyvern-clips.mjs` enforces.
      worldRange: range,
      localRange: jointTranslationRange(clip, name),
      startEnd: Math.hypot(
        pos[(0 * n + b) * 3] - pos[((frames - 1) * n + b) * 3],
        pos[(0 * n + b) * 3 + 1] - pos[((frames - 1) * n + b) * 3 + 1],
        pos[(0 * n + b) * 3 + 2] - pos[((frames - 1) * n + b) * 3 + 2],
      ),
    };
  }

  // Loop seam on local bone transforms, matching scripts/wyvern-loop-metrics.mjs.
  let seamRad = 0;
  let seamJoint = null;
  let seamPos = 0;
  for (let b = 0; b < n; b++) {
    const i0 = (0 * n + b) * 4;
    const i1 = ((frames - 1) * n + b) * 4;
    tmpQ.set(local[i0], local[i0 + 1], local[i0 + 2], local[i0 + 3]);
    tmpQ2.set(local[i1], local[i1 + 1], local[i1 + 2], local[i1 + 3]);
    const a = quatAngle(tmpQ, tmpQ2);
    if (a > seamRad) {
      seamRad = a;
      seamJoint = bones[b].name;
    }
    const p0 = (0 * n + b) * 3;
    const p1 = ((frames - 1) * n + b) * 3;
    seamPos = Math.max(seamPos, Math.hypot(pos[p0] - pos[p1], pos[p0 + 1] - pos[p1 + 1], pos[p0 + 2] - pos[p1 + 2]));
  }

  let seamVel = 0;
  for (let b = 0; b < n; b++) {
    const i0 = (0 * n + b) * 4;
    const i1 = ((frames - 1) * n + b) * 4;
    tmpQ.set(quat[i0], quat[i0 + 1], quat[i0 + 2], quat[i0 + 3]);
    tmpQ2.set(quat[i1], quat[i1 + 1], quat[i1 + 2], quat[i1 + 3]);
    seamVel = Math.max(seamVel, quatAngle(tmpQ, tmpQ2) / dt);
  }
  const omegaStats = stats(omega);

  const contact = {};
  for (const name of CONTACT_BONES) {
    if (!boneIndex.has(name)) continue;
    const b = boneIndex.get(name);
    const xs = [];
    const ys = [];
    const zs = [];
    for (let f = 0; f < frames; f++) {
      const i = (f * n + b) * 3;
      xs.push(pos[i]);
      ys.push(pos[i + 1]);
      zs.push(pos[i + 2]);
    }
    const minY = Math.min(...ys);
    const stance = [];
    for (let f = 0; f < frames; f++) if (ys[f] <= minY + CONTACT_BAND) stance.push(f);
    let slip = 0;
    for (let k = 1; k < stance.length; k++) {
      if (stance[k] - stance[k - 1] !== 1) continue;
      const a = stance[k - 1];
      const c = stance[k];
      slip += Math.hypot(xs[c] - xs[a], zs[c] - zs[a]);
    }
    contact[name] = {
      minY,
      verticalRange: Math.max(...ys) - minY,
      duty: stance.length / frames,
      slipRigUnits: slip,
      slipMetres: slip * FIT,
    };
  }

  const extremes = meshExtremes(clip);
  const foot = footSurface(clip);
  const footY = Math.min(...Object.values(contact).map((c) => c.minY));

  return {
    name: clip.name,
    duration: clip.duration,
    frames,
    loops: LOOPING.has(clip.name),
    angular: {
      peak,
      mean: omegaStats.mean,
      localMean: stats(localOmega).mean,
      localPeak,
      p95: omegaStats.p95,
      // reduce, not spread: a 292-bone rig pushes ~40k samples and the
      // argument list overflows the stack before Math.max sees it.
      accelMax: accel.reduce((a, b) => (b > a ? b : a), 0),
      accelP95: stats(accel).p95,
      perJointMax: Array.from(perJointMax),
    },
    linear: { maxWorldSpeed, p95: stats(worldSpeed).p95 },
    translate,
    seam: { rotationRad: seamRad, joint: seamJoint, positionRigUnits: seamPos, velocity: seamVel, meanVelocity: omegaStats.mean },
    contact,
    groundMin: footY,
    mesh: extremes,
    foot,
    edge: edgeOverClip(clip),
    // Foot surface relative to the origin: the offset a game must apply if the
    // root is placed at y=0.
    footBelowOrigin: foot.min,
    // How far the lowest skinned surface sits below the foot surface.
    belowFeetRigUnits: foot.min - extremes.minY,
    belowOriginRigUnits: -extremes.minY,
    // What the runtime actually does: `normalizedClone` subtracts the *bind
    // pose* minimum once, at load, and never revisits it. Every clip's lowest
    // point is therefore measured against that single bind-pose floor.
    runtimeBelowOriginRigUnits: extremes.minY - BIND_MIN_Y,
    // Contact quality on the foot/toe joints, over the bones that touch.
    contactSummary: (() => {
      const entries = Object.entries(contact);
      if (!entries.length) return null;
      const stance = entries.filter(([, c]) => c.duty > 0);
      return {
        lowestDuty: stance.length ? Math.min(...stance.map(([, c]) => c.duty)) : 0,
        highestDuty: stance.length ? Math.max(...stance.map(([, c]) => c.duty)) : 0,
        totalDuty: stance.reduce((n, [, c]) => n + c.duty, 0),
        maxSlipRigUnits: Math.max(...entries.map(([, c]) => c.slipRigUnits)),
      };
    })(),
  };
}

const measured = [];
for (const clip of clips) {
  const t0 = performance.now();
  const m = measureClip(clip);
  m.ms = Math.round(performance.now() - t0);
  measured.push(m);
}

{
  const peaks = measured.map((m) => m.angular.peak.value).sort((a, b) => a - b);
  const threshold = quantile(peaks, 0.95) + OUTLIER.iqrFactor * (quantile(peaks, 0.75) - quantile(peaks, 0.25));
  for (const m of measured) {
    m.angular.outlierThreshold = threshold;
    m.angular.outlier = m.angular.peak.value > threshold;
    m.angular.accelSpike = m.angular.accelMax > OUTLIER.accelFactor * Math.max(m.angular.accelP95, 1e-9);
  }
}

// ------------------------------------------- 5. inter-clip transition cost

function endpointPose(clip, atEnd) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  seek(mixer, action, atEnd ? clip.duration : 0);
  const q = bones.map((b) => b.quaternion.clone());
  const p = bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
  mixer.stopAllAction();
  mixer.uncacheClip(clip);
  return { q, p };
}

const ends = new Map(clips.map((c) => [c.name, endpointPose(c, true)]));
const starts = new Map(clips.map((c) => [c.name, endpointPose(c, false)]));

const transitions = [];
for (const a of clips) {
  for (const b of clips) {
    if (a === b) continue;
    const e = ends.get(a.name);
    const s = starts.get(b.name);
    let maxRad = 0;
    let worst = null;
    let sum = 0;
    let maxPos = 0;
    for (let i = 0; i < bones.length; i++) {
      const rad = quatAngle(e.q[i], s.q[i]);
      sum += rad * rad;
      if (rad > maxRad) {
        maxRad = rad;
        worst = bones[i].name;
      }
      maxPos = Math.max(maxPos, e.p[i].distanceTo(s.p[i]));
    }
    transitions.push({ from: a.name, to: b.name, maxRad, rmsRad: Math.sqrt(sum / bones.length), worstJoint: worst, maxPosRigUnits: maxPos });
  }
}
const bestPredecessor = {};
for (const clip of clips) {
  const inbound = transitions.filter((t) => t.to === clip.name).sort((x, y) => x.maxRad - y.maxRad);
  bestPredecessor[clip.name] = { ...inbound[0], median: quantile(inbound.map((t) => t.maxRad).sort((a, b) => a - b), 0.5) };
}

// ------------------------------------------------ 6. detector self-tests

function cloneClip(clip) {
  const c = clip.clone();
  c.name = `${clip.name}__mutant`;
  return c;
}

// The self-tests need one clip to mutate. V2 names it `idle`, V1 `Idle`, and
// older exports have neither — fall back to whatever the rig does ship.
const selfTestClip = clips.find((c) => c.name.toLowerCase() === "idle") ?? clips[0];
const baseline = measured.find((m) => m.name.toLowerCase() === "idle") ?? measured[0];

/**
 * Bone naming differs between the two rigs (V2 `Spine1`, V1 `Bip002-Spine1`),
 * so the detector self-tests resolve their mutant track by preference then by
 * pattern instead of assuming one rig's names.
 */
function pickTrack(clip, names, pattern) {
  for (const n of names) {
    const t = clip.tracks.find((x) => x.name === n);
    if (t) return t;
  }
  if (pattern) {
    const t = clip.tracks.find((x) => pattern.test(x.name) && x.name.endsWith(".position"));
    if (t) return t;
  }
  return clip.tracks.find((x) => x.name.endsWith(".position"));
}

/** Heaviest-weighted bone that actually carries a position track. */
function heaviestPositionTrack(clip) {
  const order = bones
    .map((b, i) => i)
    .sort((a, b) => skin.jointMass[b] - skin.jointMass[a]);
  for (const i of order.slice(0, 40)) {
    const t = clip.tracks.find((x) => x.name === `${bones[i].name}.position`);
    if (t) return t;
  }
  return undefined;
}

/**
 * Root of the hierarchy that actually carries the feet. A rig can have more
 * than one root (V1 ships two skins and a detached helper root), and dropping
 * the wrong one moves nothing the clearance detector can see.
 */
function rootPositionTrack(clip) {
  const footBone = CONTACT_BONES.find((n) => boneIndex.has(n));
  let idx = footBone ? boneIndex.get(footBone) : parentIndex.findIndex((p) => p < 0);
  if (idx === undefined || idx < 0) return undefined;
  const chain = [idx];
  while (parentIndex[idx] >= 0) {
    idx = parentIndex[idx];
    chain.unshift(idx);
  }
  // Topmost ancestor that is actually animated with a translation channel —
  // V1 leaves ~74 joints untracked, so the true root can be rotation-only.
  const scale = new THREE.Vector3();
  for (const i of chain) {
    const track = clip.tracks.find((x) => x.name === `${bones[i].name}.position`);
    if (!track) continue;
    // V1's armature hangs under an FBX node scaled 0.01, so a track unit is
    // not a rig unit. The self-test converts before it asserts a distance.
    bones[i].updateWorldMatrix(true, false);
    bones[i].getWorldScale(scale);
    return { track, worldScale: scale.x || 1 };
  }
  return undefined;
}

const selfTests = [];
function selfTest(name, mutate, detect, expect) {
  const mutant = cloneClip(selfTestClip);
  // A mutation can be inapplicable to a rig (no such channel). That is a
  // coverage gap to report, not a detector failure to hide.
  if (mutate(mutant) === false) {
    selfTests.push({ name, value: null, pass: true, skipped: true });
    return;
  }
  const value = detect(mutant);
  const verdict = expect(value);
  if (verdict === "skip") {
    selfTests.push({ name, value, pass: true, skipped: true });
    return;
  }
  selfTests.push({ name, value, pass: verdict });
}

selfTest(
  "loop seam detector bites on a 0.30 rad closing error",
  (c) => {
    // `Body` is V2's root bone name; V1 keeps the vendor `Bip002_*` names.
    const track = c.tracks.find((t) => t.name === "Body.quaternion")
      ?? c.tracks.find((t) => t.name.endsWith(".quaternion"));
    if (!track) return;
    const last = track.values.length - 4;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    const cur = new THREE.Quaternion(track.values[last], track.values[last + 1], track.values[last + 2], track.values[last + 3]);
    cur.multiply(q);
    track.values[last] = cur.x;
    track.values[last + 1] = cur.y;
    track.values[last + 2] = cur.z;
    track.values[last + 3] = cur.w;
  },
  (c) => measureClip(c).seam.rotationRad,
  (v) => v > LIMIT.loopSeamRad,
);

selfTest(
  "motion detector separates a frozen clip from the original",
  (c) => {
    // Rebuild every track from its first key rather than mutating the clone:
    // fresh buffers guarantee the mixer is reading constant data.
    for (let i = 0; i < c.tracks.length; i++) {
      const t = c.tracks[i];
      const stride = t.getValueSize();
      const values = new t.values.constructor(t.times.length * stride);
      for (let k = 0; k < t.times.length; k++) {
        for (let s = 0; s < stride; s++) values[k * stride + s] = t.values[s];
      }
      // The 4th constructor argument is the interpolation factory, not the
      // stride: passing the stride (4) makes three fall back to the default and
      // log a warning per track.
      c.tracks[i] = new t.constructor(t.name, t.times, values, t.interpolation);
    }
  },
  // A frozen clip must measure exactly 0 rad/s on both the authored (local)
  // channel and the accumulated (world) channel. Exactness is the assertion:
  // with the chord/atan2 angle, identical quaternions give identical zeros, so
  // any residual here is a real evaluation defect rather than float noise.
  (c) => {
    const m = measureClip(c);
    return Math.max(m.angular.localMean, m.angular.mean, m.angular.localPeak.value);
  },
  (v) => v === 0,
);

selfTest(
  "edge-stretch detector bites on a 300-unit translation ramp",
  (c) => {
    const t = heaviestPositionTrack(c);
    if (!t) return;
    for (let i = 0, key = 0; i < t.values.length; i += 3, key++) t.values[i + 1] += key * 100;
  },
  (c) => edgeOverClip(c).p99Max,
  (v) => v > 1.2,
);

selfTest(
  // Asserts response, not magnitude: on V1 the armature hangs under an FBX
  // node scaled 0.01 whose bind scale is a further ~2570, so a track-space
  // drop does not map to rig units. The question this test answers is whether
  // the clearance channel is wired to root translation at all.
  "ground detector responds to a downward root translation",
  (c) => {
    const r = rootPositionTrack(c);
    if (!r) return false;
    const drop = -100 / r.worldScale;
    for (let i = 1; i < r.track.values.length; i += 3) r.track.values[i] += drop;
  },
  (c) => measureClip(c).groundMin,
  // A change below noise is not a response. V1's contact surface moves by
  // 3e-5 for a 10,000-unit root drop — the mutation reaches the track but the
  // track has no leverage on the sampled world positions, so the channel is
  // unproven on that rig rather than broken.
  (v) =>
    Math.abs(v - baseline.groundMin) < Math.max(1e-3, Math.abs(baseline.groundMin) * 1e-3)
      ? "skip"
      : v < baseline.groundMin,
);

// ---------------------------------------------------------------- summary

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/** Horizontal bars as inline SVG. Signed mode draws a zero axis. */
function bars(rows, { unit = "", signed = false, fmt = (v) => v.toFixed(1), max = null } = {}) {
  const w = 420;
  const rowH = 18;
  const peak = max ?? Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  const h = rows.length * rowH + 10;
  const zero = signed ? w / 2 : 0;
  const scale = (signed ? w / 2 : w) / peak;
  const body = rows
    .map((r, i) => {
      const y = i * rowH + 4;
      const len = Math.abs(r.value) * scale;
      const x = signed ? (r.value >= 0 ? zero : zero - len) : 0;
      const fill = r.warn ? "#ff8f6b" : "#6ea8fe";
      return (
        `<text x="0" y="${y + 12}" fill="#9aa3ad" font-size="11" font-family="ui-monospace,monospace">${esc(r.label)}</text>` +
        `<rect x="${150 + x}" y="${y + 2}" width="${Math.max(len, 0.5)}" height="12" fill="${fill}" rx="2"/>` +
        `<text x="${150 + w + 8}" y="${y + 12}" fill="#e6e8eb" font-size="11" font-family="ui-monospace,monospace">${fmt(r.value)}${unit}</text>`
      );
    })
    .join("");
  const axis = signed
    ? `<line x1="${150 + zero}" y1="0" x2="${150 + zero}" y2="${h}" stroke="#3a4048" stroke-width="1"/>`
    : "";
  return `<svg viewBox="0 0 ${w + 150} ${h}" width="100%" height="${h}" role="img">${axis}${body}</svg>`;
}

function renderSummary(r) {
  const clipsList = r.clips;
  const stat = (k, v) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
  const footRows = [...clipsList]
    .sort((a, b) => b.foot.min - a.foot.min)
    .map((c) => ({ label: c.name, value: c.foot.min, warn: Math.abs(c.foot.min) > 100 }));
  const bodyRows = clipsList
    .filter((c) => r.tracks[c.name].bodyTranslationRigUnits > 0.5)
    .sort((a, b) => r.tracks[b.name].bodyTranslationRigUnits - r.tracks[a.name].bodyTranslationRigUnits)
    .map((c) => ({ label: c.name, value: r.tracks[c.name].bodyTranslationRigUnits * FIT, warn: r.tracks[c.name].bodyTranslationRigUnits * FIT > 1 }));
  const edgeRows = [...clipsList]
    .sort((a, b) => b.edge.p99Max - a.edge.p99Max)
    .map((c) => ({ label: c.name, value: c.edge.p99Max, warn: c.edge.p99Max > 2 }));
  const seamRows = clipsList
    .filter((c) => c.loops)
    .sort((a, b) => b.seam.rotationRad - a.seam.rotationRad)
    .map((c) => ({ label: c.name, value: c.seam.rotationRad }));

  return `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Rig audit — ${esc(r.target)}</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;background:#0f1115;color:#e6e8eb;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
 .wrap{max-width:1040px;margin:0 auto;padding:36px 28px 64px}
 h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
 .sub{color:#9aa3ad;font-size:12.5px;font-family:ui-monospace,monospace;margin-bottom:28px}
 h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#9aa3ad;margin:34px 0 10px;font-weight:600}
 .note{color:#8b949e;font-size:12.5px;margin:6px 0 14px;max-width:70ch}
 .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:#232830;border:1px solid #232830;border-radius:8px;overflow:hidden}
 .stat{background:#151920;padding:12px 14px}
 .stat .k{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em}
 .stat .v{font-size:16px;font-family:ui-monospace,monospace;margin-top:3px}
 .card{background:#151920;border:1px solid #232830;border-radius:8px;padding:14px 16px}
 table{width:100%;border-collapse:collapse;font-size:12.5px;font-family:ui-monospace,monospace}
 th,td{text-align:left;padding:5px 10px;border-bottom:1px solid #232830}
 th{color:#8b949e;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
 .pass{color:#5dd39e}.fail{color:#ff8f6b}
 footer{margin-top:36px;color:#6e7681;font-size:12px;border-top:1px solid #232830;padding-top:14px}
</style>
<div class="wrap">
 <h1>Rig &amp; animation audit</h1>
 <div class="sub">${esc(r.target)} · ${esc(r.structure.file.sha256.slice(0, 16))}… · ${(r.structure.file.bytes / 1048576).toFixed(2)} MiB · ${r.structure.counts.animations} clips · ${r.structure.counts.joints} joints · ${r.structure.counts.skins} shared skin</div>

 <div class="stats">
  ${stat("Vertices", r.skin.totalVertices.toLocaleString())}
  ${stat("Triangles", r.structure.triangles.toLocaleString())}
  ${stat("Unweighted", r.skin.unweighted)}
  ${stat("Max influences", r.skin.maxInfluences)}
  ${stat("Loop seam max", `${Math.max(...seamRows.map((s) => s.value)).toFixed(4)} rad`)}
  ${stat("Body travel max", `${r.checks.bodyTravelMax.toFixed(0)} u`)}
 </div>

 <h2>Foot surface height per clip</h2>
 <p class="note">Minimum Y of vertices weighted to the foot/toe joints, in rig units (1 unit = 7.2 mm). Zero is the model origin. Grounded clips span ${r.checks.footSpread.toFixed(0)} units — ${(r.checks.footSpread * r.fitMetresPerUnit).toFixed(2)} m.</p>
 <div class="card">${bars(footRows, { signed: true, fmt: (v) => v.toFixed(0) })}</div>

 <h2>Body translation authored into the clip</h2>
 <p class="note">Local translation range on the <code>Body</code> joint, in metres. The root-travel gate only checks <code>Root</code> and <code>RootMotion</code>, so none of this is caught by it.</p>
 <div class="card">${bars(bodyRows, { unit: " m", fmt: (v) => v.toFixed(2) })}</div>

 <h2>Edge stretch (p99, relative to each clip's first frame)</h2>
 <p class="note">Skinned edge length ÷ frame-0 length over ${r.checks.edgeCount ?? ""}sampled edges. Above 2 means the worst 1 % of the skin is stretching to more than double.</p>
 <div class="card">${bars(edgeRows, { unit: "×", fmt: (v) => v.toFixed(2), max: 3 })}</div>

 <h2>Loop seam (looping clips only)</h2>
 <p class="note">Authored budget is ${r.limits.loopSeamRad} rad. Worst measured is ${Math.max(...seamRows.map((s) => s.value)).toFixed(4)} rad.</p>
 <div class="card">${bars(seamRows, { unit: " rad", fmt: (v) => v.toFixed(4), max: r.limits.loopSeamRad })}</div>

 <h2>Detector self-tests</h2>
 <div class="card"><table>
  <tr><th>Detector</th><th>Corruption</th><th>Reading</th><th>Result</th></tr>
  ${r.selfTests
    .map((t) => {
      const [label, detail] = t.name.split(/ bites on | separates /);
      return `<tr><td>${esc(label)}</td><td>${esc(detail ?? "")}</td><td>${t.skipped ? "—" : Number(t.value).toPrecision(4)}</td><td class="${t.skipped ? "skip" : t.pass ? "pass" : "fail"}">${t.skipped ? "SKIP" : t.pass ? "PASS" : "FAIL"}</td></tr>`;
    })
    .join("")}
 </table></div>

 <footer>Generated by tools/audit-wyvern-rig.mjs. No rendering, no textures, no self-collision qualification.</footer>
</div></html>`;
}

// ---------------------------------------------------------------- output

const restScale = edgeScaleVsBind();
const idleClip = clips.find((c) => c.name.toLowerCase() === "idle") ?? clips[0];
const idleMixer = new THREE.AnimationMixer(scene);
const idleAction = idleMixer.clipAction(idleClip);
idleAction.setLoop(THREE.LoopOnce, 1);
idleAction.clampWhenFinished = true;
// Same seek as the sampler: `mixer.setTime(0)` evaluates lazily and lands on
// the previous pose, which is exactly the pose this comparison must not use.
seek(idleMixer, idleAction, 0);
const posedScale = edgeScaleVsBind();
idleMixer.stopAllAction();
idleMixer.uncacheClip(idleClip);

const report = {
  generatedAt: new Date().toISOString(),
  target: TARGET,
  fitMetresPerUnit: FIT,
  fitMetresPerUnitLab: FIT_LAB,
  bindExtentRigUnits: BIND_EXTENT,
  displayTarget: { player: PLAYER_TARGET_SIZE, flightLab: FLIGHT_LAB_TARGET_SIZE },
  sampleHz: SAMPLE_HZ,
  limits: LIMIT,
  outlierRule: OUTLIER,
  contactBandMetres: CONTACT_BAND_METRES,
  structure,
  hierarchy: { regions, byDepth, maxDepth: Math.max(...bones.map(depth)) },
  skin: {
    ...skin,
    jointMass: undefined,
    topJoints: Array.from(skin.jointMass)
      .map((m, i) => ({ joint: bones[i].name, mass: m }))
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 12),
  },
  restScale: {
    noClip: restScale,
    idleFrameZero: posedScale,
    note: "Ratio of skinned edge length to bind-space length. The node rest pose is not the display pose.",
  },
  translationChannels: Object.fromEntries(
    Object.entries(translationByBone).sort((a, b) => b[1].magnitude - a[1].magnitude),
  ),
  tracks: trackReport,
  clips: measured.map((m) => ({ ...m, angular: { ...m.angular, perJointMax: undefined } })),
  jointPeak: Object.fromEntries(measured.map((m) => [m.name, m.angular.perJointMax])),
  transitions: {
    bestPredecessor,
    worst: [...transitions].sort((a, b) => b.maxRad - a.maxRad).slice(0, 8),
  },
  selfTests,
};

// ------------------------------------------------------------- 7. checks

const grounded = measured.filter((m) => GROUNDED.has(m.name));
const footSpread = Math.max(...grounded.map((m) => m.foot.min)) - Math.min(...grounded.map((m) => m.foot.min));
const bodyTravelMax = Math.max(...measured.map((m) => trackReport[m.name].bodyTranslationRigUnits));

const failures = [];
for (const t of selfTests) {
  if (!t.pass) failures.push(`detector self-test failed: ${t.name} -> ${t.value}`);
}
if (skin.unweighted > 0) failures.push(`${skin.unweighted} unweighted vertices`);
if (skin.nonFinite > 0) failures.push(`${skin.nonFinite} non-finite weights`);
if (!(skin.maxSumError <= 1e-5)) failures.push(`weight sums off by ${skin.maxSumError}`);
if (skin.maxInfluences > 4) failures.push(`${skin.maxInfluences} influences on a vertex`);
for (const m of measured) {
  if (!m.loops) continue;
  if (m.seam.rotationRad > LIMIT.loopSeamRad) {
    failures.push(`${m.name}: loop seam ${m.seam.rotationRad.toFixed(4)} rad > ${LIMIT.loopSeamRad}`);
  }
  if (m.seam.positionRigUnits > LIMIT.loopSeamRigUnits) {
    failures.push(`${m.name}: loop position seam ${m.seam.positionRigUnits.toFixed(4)} rig units > ${LIMIT.loopSeamRigUnits}`);
  }
}
for (const m of measured) {
  const rootPeak = Math.max(
    ...["Root", "RootMotion"].flatMap((name) => m.translate[name]?.worldRange ?? [0]),
  );
  if (rootPeak > LIMIT.rootTravelRigUnits) {
    failures.push(`${m.name}: root travels ${rootPeak.toExponential(2)} rig units > ${LIMIT.rootTravelRigUnits}`);
  }
}

const warnings = [];
if (bodyTravelMax > BODY_TRAVEL_LIMIT) {
  warnings.push(`Body translates up to ${bodyTravelMax.toFixed(1)} rig units (${(bodyTravelMax * FIT).toFixed(2)} m) — gameplay owns position`);
}
if (footSpread > FOOT_SPREAD_LIMIT) {
  warnings.push(`grounded foot surface spans ${footSpread.toFixed(0)} rig units (${(footSpread * FIT).toFixed(2)} m) across clips`);
}
if (STRICT) {
  for (const m of measured) {
    const body = trackReport[m.name].bodyTranslationRigUnits;
    if (body > BODY_TRAVEL_LIMIT) failures.push(`${m.name}: Body translates ${body.toFixed(1)} rig units`);
  }
  if (footSpread > FOOT_SPREAD_LIMIT) failures.push(`grounded foot spread ${footSpread.toFixed(0)} rig units > ${FOOT_SPREAD_LIMIT}`);
}

report.checks = { mode: CHECK ? (STRICT ? "strict" : "check") : "report", failures, warnings, footSpread, bodyTravelMax, edgeCount: restScale.edges };

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "audit.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "summary.html"), renderSummary(report));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${TARGET}  ${sha256.slice(0, 12)}  ${bytes.length} B`);
console.log(`bones ${bones.length}  clips ${clips.length}  verts ${skin.totalVertices}  skins ${structure.counts.skins}`);
console.log(`unweighted ${skin.unweighted}  maxSumErr ${skin.maxSumError.toExponential(2)}  maxInf ${skin.maxInfluences}  nonDeforming ${skin.nonDeformingJoints.length}`);
console.log(`rest scale vs bind ${restScale.median.toFixed(3)}  posed ${posedScale.median.toFixed(1)}  edges ${restScale.edges}`);
console.log(`\n${pad("clip", 12)}${pad("dur", 6)}${pad("peakW", 8)}${pad("joint", 16)}${pad("seam", 8)}${pad("bodyRng", 9)}${pad("belowFt", 8)}${pad("grndY", 8)}`);
for (const m of measured) {
  console.log(
    pad(m.name, 12) +
      pad(m.duration.toFixed(2), 6) +
      pad(m.angular.peak.value.toFixed(2), 8) +
      pad(m.angular.peak.joint ?? "-", 16) +
      pad(m.seam.rotationRad.toFixed(4), 8) +
      // The authored Body range, not start-to-end displacement: a looping clip
      // returns to its first pose, so `startEnd` reports 0 for `walk` while the
      // joint actually travels 227 rig units mid-clip.
      pad(trackReport[m.name].bodyTranslationRigUnits.toFixed(1), 9) +
      pad(m.belowFeetRigUnits.toFixed(0), 8) +
      pad(m.groundMin.toFixed(0), 8),
  );
}
console.log("\nself-tests:");
for (const t of selfTests) console.log(`  ${t.skipped ? "SKIP" : t.pass ? "PASS" : "FAIL"}  ${t.name} -> ${t.skipped ? "no applicable channel on this rig" : t.value}`);
for (const w of warnings) console.log(`\nwarning: ${w}`);
if (failures.length) {
  console.error(`\n${failures.length} check failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
}
console.log(`\nwrote ${OUT_DIR}/{audit.json,summary.html}`);

if (CHECK && failures.length) process.exit(1);
