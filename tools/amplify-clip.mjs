#!/usr/bin/env node
/**
 * Amplify a clip's angular motion, in place, without touching geometry.
 *
 * Stage 3's measurement (`tools/diagnose-clip-dynamics.mjs`) splits V2's deficit
 * into three classes. This tool addresses exactly one of them:
 *
 *   AMPLITUDE   travel and p95 both scale with the reference -> the pose simply
 *               travels less far. Fix: exaggerate the pose.
 *   EVENED OUT, FROZEN+SPIKES -> *not* fixable here. See doc 37.
 *
 * Method. For every rotation channel in the target clip, take the **first key**
 * as the reference pose and express each later key as a rotation *away* from it.
 * Scale that angle by `gain`, keep the axis, rebuild the quaternion. Axis
 * preservation is what makes this exaggeration rather than corruption: the bone
 * still swings the same way, just further.
 *
 * The first key is the reference rather than the bind pose because it makes the
 * operation a no-op at the clip's start, which preserves loop seams (first key ==
 * last key stays true) and leaves one-shot clips starting from their authored
 * pose instead of from rest.
 *
 * Why in place is safe here: measured on `wyvern-v2-rig.glb`, animation accessors
 * are uncompressed float32, each in its own bufferView, and none of those
 * bufferViews is shared with mesh data (0 overlap of 4915 animation views against
 * 16 mesh views). So the byte length and every offset stay identical -- the only
 * thing that changes is float values. Geometry, skinning and the runtime contract
 * are therefore untouched by construction, not by promise.
 *
 *   node tools/amplify-clip.mjs public/models/wyvern-v2-rig.glb \
 *     --clip cruise --gain 2.08 --out candidate.glb
 *
 *   node tools/amplify-clip.mjs <glb> --clip <name> --gain <k> --dry-run
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const GLB_MAGIC = "glTF";
const FLOAT = 5126;
const VEC4 = "VEC4";
const DEG = 180 / Math.PI;

/** Parse a GLB into its JSON plus the absolute offset of the binary chunk. */
export function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== GLB_MAGIC) throw new Error(`${path}: not a GLB`);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLength));
  const binHeader = 20 + jsonLength;
  const binLength = buf.readUInt32LE(binHeader);
  const binStart = binHeader + 8;
  if (binStart + binLength > buf.length) throw new Error(`${path}: truncated binary chunk`);
  return { buf, json, binStart, binLength, jsonLength };
}

/** Absolute byte offset of an accessor's first element, within the GLB. */
export function accessorOffset(glb, accessorIndex) {
  const accessor = glb.json.accessors[accessorIndex];
  if (accessor.componentType !== FLOAT) {
    throw new Error(`accessor ${accessorIndex}: componentType ${accessor.componentType}, expected FLOAT`);
  }
  if (accessor.sparse) throw new Error(`accessor ${accessorIndex}: sparse accessors are not supported`);
  const view = glb.json.bufferViews[accessor.bufferView];
  if (!view) throw new Error(`accessor ${accessorIndex}: no bufferView`);
  if (view.extensions?.EXT_meshopt_compression) {
    throw new Error(`accessor ${accessorIndex}: meshopt-compressed, cannot patch in place`);
  }
  if (view.buffer !== 0) throw new Error(`accessor ${accessorIndex}: buffer ${view.buffer}, expected 0`);
  const stride = view.byteStride ?? 0;
  if (stride) throw new Error(`accessor ${accessorIndex}: interleaved (byteStride ${stride}), not supported`);
  return glb.binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
}

/** Unit quaternion helpers, [x, y, z, w] to match glTF. */
export function norm(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n < 1e-12) return [0, 0, 0, 1];
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
export function conjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}
export function multiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
/**
 * Quaternion from an axis and an angle.
 *
 * The axis is normalised here rather than trusted: an unnormalised axis yields a
 * non-unit quaternion, and `angleOf` on a non-unit quaternion silently reports
 * the wrong angle because `acos(w)` and `hypot(xyz)` disagree. Callers inside
 * this module always pass a unit axis, but a silent wrong answer is not worth the
 * microsecond this saves.
 */
export function fromAxisAngle(axis, radians) {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (n < 1e-12) return [0, 0, 0, 1];
  const half = radians / 2;
  const s = Math.sin(half) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}
/** Signed angle of a unit quaternion, taking the short way round. */
export function angleOf(q) {
  const w = Math.min(1, Math.max(-1, Math.abs(q[3])));
  return 2 * Math.acos(w);
}

/**
 * Rebuild `q` so that its rotation away from `ref` is `gain` times larger.
 *
 * Returns `{ q, angle, capped }` where `angle` is the *input* angle in degrees.
 * A key that sits on the reference is returned unchanged rather than being
 * perturbed by floating-point noise in the axis extraction.
 */
export function amplify(q, ref, gain, capRadians) {
  // Both operands are normalised on entry, and that is load-bearing: glTF stores
  // quaternions as float32 without requiring them to be exactly unit, and
  // `angleOf` reads the angle from `acos(w)` while the axis comes from
  // `hypot(xyz)`. On a non-unit quaternion those two describe different
  // rotations, so a 30 deg pose is read as 29.7 and a gain of 2 doubles the
  // error. `applyGain` normalises `ref` too, but a direct caller may not.
  const unitQ = norm(q);
  const unitRef = norm(ref);
  let d = multiply(conjugate(unitRef), unitQ);
  // Quaternions double-cover SO(3): flip to the hemisphere nearest identity so
  // the extracted angle is the short way round, not the 360-theta complement.
  if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const angle = angleOf(d);
  if (angle < 1e-7) return { q: [...q], angle: 0, capped: false };

  const sinHalf = Math.hypot(d[0], d[1], d[2]);
  if (sinHalf < 1e-9) return { q: [...q], angle: angle * DEG, capped: false };
  const axis = [d[0] / sinHalf, d[1] / sinHalf, d[2] / sinHalf];

  let target = angle * gain;
  const capped = target > capRadians;
  if (capped) target = capRadians;

  return { q: norm(multiply(unitRef, fromAxisAngle(axis, target))), angle: angle * DEG, capped };
}

/**
 * Apply `gain` to every rotation channel of `clipName`, mutating `glb.buf`.
 *
 * Returns a report rather than throwing on a marginal result: the caller decides
 * whether a capped fraction is acceptable. `keysCapped` is the number to look at,
 * because a capped key is a plateau -- see the CLI's refusal below.
 */
export function applyGain(glb, clipName, gain, capRadians) {
  const clip = glb.json.animations?.find((a) => a.name === clipName);
  if (!clip) {
    throw new Error(`clip ${clipName} not found; have: ${glb.json.animations?.map((a) => a.name).join(", ")}`);
  }

  let channels = 0;
  let constantChannels = 0;
  let keys = 0;
  let cappedKeys = 0;
  let maxInputAngle = 0;
  let maxOutputAngle = 0;
  // Two channels can point at one output accessor (glTF allows deduplication).
  // Patching such an accessor twice would square the gain, so each is claimed once.
  const patchedAccessors = new Set();
  let sharedAccessors = 0;

  for (const channel of clip.channels) {
    if (channel.target.path !== "rotation") continue;
    const sampler = clip.samplers[channel.sampler];
    const interpolation = sampler.interpolation ?? "LINEAR";
    const times = glb.json.accessors[sampler.input];
    const values = glb.json.accessors[sampler.output];
    const keyCount = times.count;

    // A <=2-key channel encodes a constant pose. Scaling about its own only key
    // is an identity, so skip it and count it -- those bones are simply not
    // animated, and no gain can supply motion that was never authored.
    if (keyCount <= 2) {
      constantChannels++;
      continue;
    }
    if (patchedAccessors.has(sampler.output)) {
      sharedAccessors++;
      continue;
    }
    patchedAccessors.add(sampler.output);

    if (values.type !== VEC4) throw new Error(`channel ${channel.target.node}: output type ${values.type}`);
    // CUBICSPLINE stores (in-tangent, value, out-tangent) per key. Scaling the
    // angle by k scales its derivative by k, so tangents take the same factor.
    const perKey = interpolation === "CUBICSPLINE" ? 3 : 1;
    if (values.count !== keyCount * perKey) {
      throw new Error(
        `channel ${channel.target.node}: ${values.count} values for ${keyCount} keys with ${interpolation}`
      );
    }

    const base = accessorOffset(glb, sampler.output);
    const read = (i) => {
      const o = base + i * 16;
      return [
        glb.buf.readFloatLE(o),
        glb.buf.readFloatLE(o + 4),
        glb.buf.readFloatLE(o + 8),
        glb.buf.readFloatLE(o + 12),
      ];
    };
    const write = (i, q) => {
      const o = base + i * 16;
      glb.buf.writeFloatLE(q[0], o);
      glb.buf.writeFloatLE(q[1], o + 4);
      glb.buf.writeFloatLE(q[2], o + 8);
      glb.buf.writeFloatLE(q[3], o + 12);
    };

    const valueIndex = (k) => (interpolation === "CUBICSPLINE" ? k * 3 + 1 : k);
    const ref = norm(read(valueIndex(0)));
    channels++;

    for (let k = 1; k < keyCount; k++) {
      const at = valueIndex(k);
      const result = amplify(read(at), ref, gain, capRadians);
      write(at, result.q);
      keys++;
      if (result.angle > maxInputAngle) maxInputAngle = result.angle;
      if (result.capped) cappedKeys++;
      const outAngle = Math.min(result.angle * gain, capRadians * DEG);
      if (outAngle > maxOutputAngle) maxOutputAngle = outAngle;

      if (perKey === 3) {
        // Tangents scale linearly with the angle factor. They are not unit
        // quaternions and must not be normalised.
        for (const tangentIndex of [k * 3, k * 3 + 2]) {
          const t = read(tangentIndex);
          write(tangentIndex, [t[0] * gain, t[1] * gain, t[2] * gain, t[3] * gain]);
        }
      }
    }
  }

  return {
    clip: clipName,
    gain,
    capDegrees: capRadians * DEG,
    rotationChannels: channels + constantChannels,
    amplifiedChannels: channels,
    constantChannels,
    keysScaled: keys,
    keysCapped: cappedKeys,
    sharedAccessors,
    maxInputAngle: Number(maxInputAngle.toFixed(2)),
    maxOutputAngle: Number(maxOutputAngle.toFixed(2)),
  };
}

// ---------------------------------------------------------------- CLI

function main(argv) {
  const args = argv.slice(2);
  const flag = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const has = (name) => args.includes(`--${name}`);

  const input = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  if (!input) {
    console.error(
      "usage: amplify-clip.mjs <glb> --clip <name> --gain <k> [--out <path>] [--cap <deg>] " +
        "[--max-capped-fraction <f>] [--allow-capped] [--dry-run]"
    );
    process.exit(2);
  }
  const clipName = flag("clip");
  const gain = Number(flag("gain", "1"));
  const capDegrees = Number(flag("cap", "160"));
  const maxCappedFraction = Number(flag("max-capped-fraction", "0.02"));
  const out = flag("out");
  const dryRun = has("dry-run");

  if (!clipName) throw new Error("--clip is required");
  if (!Number.isFinite(gain) || gain <= 0) throw new Error(`--gain must be positive, got ${flag("gain")}`);
  if (!Number.isFinite(capDegrees) || capDegrees <= 0) throw new Error("--cap must be positive");
  if (!out && !dryRun) throw new Error("--out is required unless --dry-run");

  const glb = readGlb(input);
  const report = applyGain(glb, clipName, gain, (capDegrees / 180) * Math.PI);
  console.log(JSON.stringify({ source: input, ...report }, null, 2));

  if (report.keysCapped > 0) {
    console.log(
      `\nWARNING: ${report.keysCapped} key(s) hit the ${capDegrees} deg cap. The clip wanted more ` +
        `rotation than one bone can express without a visible flip; raising --cap trades ` +
        `fidelity for a spin.`
    );
  }
  if (report.constantChannels > 0) {
    console.log(
      `${report.constantChannels} channel(s) are constant (<=2 keys) and cannot be amplified. ` +
        `Those bones are static in this clip by construction -- see doc 37 on coverage.`
    );
  }

  // The gate measures how much a clip moves, not how well. A capped key is a pose
  // frozen at 160 deg while its neighbours keep going: a plateau, which raises
  // `mean` and `p95` while looking like a hitch. So a gain that only reaches the
  // numbers by capping is refused rather than written -- that is the whole lesson
  // of doc 36, applied to this tool before it can repeat the mistake.
  const cappedFraction = report.keysScaled > 0 ? report.keysCapped / report.keysScaled : 0;
  if (cappedFraction > maxCappedFraction && !has("allow-capped")) {
    console.error(
      `\nREFUSING to write: ${(cappedFraction * 100).toFixed(1)}% of keys hit the ${capDegrees} deg cap ` +
        `(limit ${(maxCappedFraction * 100).toFixed(1)}%).\n` +
        `Gain ${gain} asks for more rotation than this clip's axes can express, so the result ` +
        `would be plateaus, not exaggeration. Reduce --gain, or accept the distortion with ` +
        `--allow-capped and say so in the doc.`
    );
    process.exit(1);
  }

  if (!dryRun) {
    writeFileSync(out, glb.buf);
    console.log(`\nwrote ${out} (${glb.buf.length} bytes, unchanged length)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
