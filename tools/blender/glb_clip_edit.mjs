// Shared GLB clip-editing primitives.
//
// Extracted from reshape_buzz_clips.mjs (D2) and reshape_d3_clips.mjs (D3) so a
// fourth reshape tool does not add a third copy of the same quaternion math —
// the tool ladder is already the largest structural liability in this repo
// (docs/flight-lab/40-architecture-audit-and-prioritized-path.md).
//
// Everything here is pure: no I/O, no mutation of the caller's glTF JSON.
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { loadRig, measureDynamics } from "../../scripts/wyvern-dynamics.mjs";

// --- glTF accessor plumbing --------------------------------------------------
export function decodeFloats(gltf, binary, index) {
  const a = gltf.accessors[index];
  const v = gltf.bufferViews[a.bufferView];
  const ext = v.extensions?.EXT_meshopt_compression;
  let data = binary, offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (ext) {
    const d = Buffer.alloc(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(d, ext.count, ext.byteStride,
      binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
    data = d; offset = a.byteOffset ?? 0;
  }
  assert.equal(a.componentType, 5126);
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const stride = v.byteStride ?? ext?.byteStride ?? comps * 4;
  return Array.from({ length: a.count * comps },
    (_, i) => data.readFloatLE(offset + Math.floor(i / comps) * stride + (i % comps) * 4));
}

/**
 * Overwrite a float accessor's data in place, when the accessor is a plain tight array.
 *
 * The alternative — `makeAppendor` — leaves the old bufferView behind, unreferenced but
 * still in the BIN chunk. On the C6 jaw pivot that was 37 orphaned accessors and 69 kB
 * of dead weight in a shipped asset. Most animation accessors in this rig are already
 * uncompressed with their own bufferView, so they can simply be rewritten; the append
 * path stays for compressed ones (the inverse bind matrices are meshopt).
 *
 * `binary` is a view onto the caller's file bytes, so this mutates them. Returns false
 * when the accessor cannot be written in place and the caller must append instead.
 */
export function writeFloatsInPlace(gltf, binary, index, values) {
  const a = gltf.accessors[index];
  const v = gltf.bufferViews[a.bufferView];
  if (a.componentType !== 5126) return false;
  if (v.extensions?.EXT_meshopt_compression) return false;
  if ((a.byteOffset ?? 0) !== 0) return false;
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  if (!comps || values.length !== a.count * comps) return false;
  if ((v.byteStride ?? comps * 4) !== comps * 4) return false;
  const start = v.byteOffset ?? 0;
  if (start + values.length * 4 > binary.length) return false;
  for (let i = 0; i < values.length; i++) binary.writeFloatLE(values[i], start + i * 4);
  // min/max are optional on animation accessors, but a stale pair is a validation error.
  if (a.min || a.max) {
    a.min = Array.from({ length: comps }, (_, c) => Math.min(...values.filter((_, i) => i % comps === c)));
    a.max = Array.from({ length: comps }, (_, c) => Math.max(...values.filter((_, i) => i % comps === c)));
  }
  return true;
}

/** Appends new float accessors/bufferViews and returns a finished BIN chunk. */
export function makeAppendor(gltf, binary) {
  const chunks = [binary];
  let binLength = binary.length;
  return {
    appendFloats(values, type) {
      const comps = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
      const count = values.length / comps;
      const buf = Buffer.alloc(values.length * 4);
      const mins = Array(comps).fill(Infinity), maxs = Array(comps).fill(-Infinity);
      values.forEach((v, i) => {
        buf.writeFloatLE(v, i * 4);
        const c = i % comps;
        if (v < mins[c]) mins[c] = v;
        if (v > maxs[c]) maxs[c] = v;
      });
      const pad = (4 - (binLength % 4)) % 4;
      if (pad) { chunks.push(Buffer.alloc(pad)); binLength += pad; }
      gltf.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: buf.length });
      chunks.push(buf);
      binLength += buf.length;
      gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: 5126, count, type, min: mins, max: maxs });
      return gltf.accessors.length - 1;
    },
    finish() {
      const pad = (4 - (binLength % 4)) % 4;
      if (pad) { chunks.push(Buffer.alloc(pad)); binLength += pad; }
      gltf.buffers[0].byteLength = binLength;
      return Buffer.concat(chunks, binLength);
    },
  };
}

// --- quaternion helpers ------------------------------------------------------
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
export const qnorm = (q) => { const l = Math.hypot(...q); return q.map((v) => v / l); };
export const qaxis = (axis, radians) => {
  const s = Math.sin(radians / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(radians / 2)];
};
export const qpow = (q, g) => {
  const qw = Math.max(-1, Math.min(1, q[3]));
  const angle = 2 * Math.acos(qw);
  const sinHalf = Math.hypot(q[0], q[1], q[2]);
  if (sinHalf < 1e-9) return [0, 0, 0, 1];
  const s = Math.sin((angle * g) / 2) / sinHalf;
  return [q[0] * s, q[1] * s, q[2] * s, Math.cos((angle * g) / 2)];
};
export const qslerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + t * (bb[i] - v)));
  const theta = Math.acos(d);
  const sa = Math.sin((1 - t) * theta) / Math.sin(theta);
  const sb = Math.sin(t * theta) / Math.sin(theta);
  return a.map((v, i) => v * sa + bb[i] * sb);
};

/** Rotation channels of `anim`, decoded. */
export function rotationChannels(gltf, binary, anim) {
  const out = [];
  for (const ch of anim.channels) {
    if (ch.target.path !== "rotation") continue;
    const sampler = anim.samplers[ch.sampler];
    out.push({
      ch, sampler, name: gltf.nodes[ch.target.node].name,
      times: decodeFloats(gltf, binary, sampler.input),
      values: decodeFloats(gltf, binary, sampler.output),
    });
  }
  return out;
}

/** Longest key time in the clip, i.e. its duration. */
export function clipDuration(gltf, binary, anim) {
  let duration = 0;
  for (const ch of anim.channels) {
    const times = decodeFloats(gltf, binary, anim.samplers[ch.sampler].input);
    duration = Math.max(duration, times[times.length - 1]);
  }
  return duration;
}

// --- the secondary-motion ripple --------------------------------------------
/**
 * Bone groups that may carry secondary motion, with the local axis each one
 * flexes about, how far its phase trails the previous bone in the chain, and
 * what fraction of the solved amplitude the chain's root bone gets (the tip
 * always gets the full amount — a flat-amplitude ripple reads as a rigid rod).
 */
export const GROUPS = {
  tail: { bones: Array.from({ length: 10 }, (_, i) => `Tail${i + 1}`), axis: [1, 0, 0], phaseStep: 0.9, rampStart: 0.35 },
  neck: { bones: ["Neck1", "Neck2", "Head"], axis: [1, 0, 0], phaseStep: 1.1, rampStart: 1 },
  spine: { bones: ["Spine2", "Spine3"], axis: [1, 0, 0], phaseStep: 1.3, rampStart: 1 },
  wing: {
    bones: ["L_WingRoot", "L_WingShoulder", "R_WingRoot", "R_WingShoulder"],
    axis: [0, 0, 1], phaseStep: 1.5, rampStart: 1,
  },
};

/** Amplitude multiplier for bone `index` of a chain of `n`. */
export const rampFor = (group, index, n) => {
  const start = GROUPS[group].rampStart ?? 1;
  return n === 1 ? 1 : start + (1 - start) * (index / (n - 1));
};

/**
 * Channels no reshape may touch, because Task D1 pinned them: Body translation
 * is frozen (bodyRng 0.0) and grounded footY sits on the canonical -184 plane.
 * The leg chain is Body > Spine1 > L_LegRoot, so Spine1 is a leg ancestor even
 * though it reads as a torso bone.
 */
export const PROTECTED = new Set([
  "Root", "RootMotion", "Body", "Spine1",
  ...["L", "R"].flatMap((s) => ["LegRoot", "Thigh", "Calf", "Foot", "Toes"].map((b) => `${s}_${b}`)),
]);

/**
 * Wing digits and membrane panels. Each panel is parented to one digit but is
 * validated against the slerp of two *adjacent* digits, so scaling a single
 * digit's local rotation moves its own panel and not its neighbour's (measured:
 * 13.94 deg of neighbour error on attack2). Rotating WingHand or above is safe.
 */
export const PANEL_COUPLED = /(^|_)Wing(D\d|Panel)/;

/** Add `amplitudeDeg * sin(2pi cycles t / duration + phase)` about the group axis. */
export function ripple(rc, { group, amplitudeDeg, cycles, duration }) {
  const { axis, phaseStep, bones } = GROUPS[group];
  const index = bones.indexOf(rc.name);
  if (index < 0) return null;
  const phase = index * phaseStep;
  const amp = amplitudeDeg * rampFor(group, index, bones.length);
  const out = [];
  for (let k = 0; k < rc.times.length; k++) {
    const t = rc.times[k];
    const theta = ((amp * Math.PI) / 180) * Math.sin((2 * Math.PI * cycles * t) / duration + phase);
    out.push(...qnorm(qmul(rc.values.slice(k * 4, k * 4 + 4), qaxis(axis, theta))));
  }
  return out;
}

/** Raised-cosine pulse, zero outside [t0 - half, t0 + half]. */
export function accentPulse(t, t0, half) {
  const d = Math.abs(t - t0);
  if (d >= half) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / half));
}

export function addAccent(base, rc, { group, amplitudeDeg, t0, half }) {
  const { axis, bones } = GROUPS[group];
  const index = bones.indexOf(rc.name);
  if (index < 0) return null;
  const amp = amplitudeDeg * rampFor(group, index, bones.length);
  const out = [];
  for (let k = 0; k < rc.times.length; k++) {
    const theta = ((amp * Math.PI) / 180) * accentPulse(rc.times[k], t0, half);
    out.push(...qnorm(qmul(base.slice(k * 4, k * 4 + 4), qaxis(axis, theta))));
  }
  return out;
}

/** One temporal smoothing pass over a channel's keys (endpoints held). */
export function smoothOnce(values, keyCount) {
  const out = values.slice(0, 4);
  for (let k = 1; k < keyCount - 1; k++) {
    const prev = values.slice((k - 1) * 4, k * 4);
    const cur = values.slice(k * 4, k * 4 + 4);
    const next = values.slice((k + 1) * 4, (k + 2) * 4);
    const blended = qslerp(qslerp(prev, cur, 0.5), next, 0.5).map((v, i) => v * 0.5 + cur[i] * 0.5);
    out.push(...qnorm(blended));
  }
  out.push(...values.slice(-4));
  return out;
}

// --- measurement -------------------------------------------------------------
/** Measure one clip of an in-memory GLB through the official dynamics metric. */
export async function measureClipBytes(bytes, clipName) {
  const tmp = `/tmp/glb-clip-edit-measure-${process.pid}.glb`;
  writeFileSync(tmp, bytes);
  try {
    const rig = await loadRig(tmp);
    return measureDynamics(rig)[clipName];
  } finally {
    rmSync(tmp, { force: true });
  }
}

export const fmtMetrics = (m) =>
  `peak=${m.peak.toFixed(0)} p95=${m.p95.toFixed(0)} mean=${m.mean.toFixed(0)} accel=${m.accelMax.toFixed(0)}`;
