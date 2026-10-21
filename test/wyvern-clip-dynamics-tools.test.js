/**
 * Stage 3's two instruments: the defect classifier and the amplifier.
 *
 * Both make claims that are easy to assert and hard to be sure of:
 *
 *   - `classify` claims V2's deficit splits into three classes that need
 *     different fixes. If the rule is wrong, Stage 3 works on the wrong thing.
 *   - `amplify` claims it exaggerates a pose without corrupting it. If the
 *     quaternion math is wrong, the clip looks fine to every gate and wrong to
 *     every eye.
 *
 * So these tests pin the rule against the real measured pair, and pin the
 * quaternion math against closed-form answers, not against itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  amplify,
  applyGain,
  readGlb,
  norm,
  multiply,
  conjugate,
  fromAxisAngle,
  angleOf,
} from '../tools/amplify-clip.mjs';
import { classify, diagnoseClip, CLASS_RULES } from '../tools/diagnose-clip-dynamics.mjs';
import { loadRig } from '../scripts/wyvern-dynamics.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const V2 = resolve(ROOT, 'public/models/wyvern-v2-rig.glb');
const V1 = resolve(ROOT, 'public/models/player-wyvern.glb');
const DEG = 180 / Math.PI;

/** A quaternion `degrees` away from identity about a given axis. */
const about = (axis, degrees) => fromAxisAngle(axis, degrees / DEG);

test('amplify is an exact identity at gain 1', () => {
  const ref = about([0.3, 0.5, 0.81], 22);
  const q = norm(multiply(ref, about([1, 0, 0], 37)));
  const out = amplify(q, ref, 1, 160 / DEG);
  // Decompose/recompose cannot be bit-exact. The tolerance is set at float32
  // storage precision -- a quaternion component near 0.3 has an ulp of ~3e-8,
  // which is 1.7e-6 deg -- because the result is written to a float32 GLB, so
  // anything below that cannot survive the write regardless.
  const err = Math.abs(angleOf(multiply(conjugate(q), out.q))) * DEG;
  assert.ok(err < 1e-4, `identity gain drifted by ${err} deg`);
  assert.equal(out.capped, false);
});

test('amplify scales the angle by exactly the gain', () => {
  const ref = about([0.1, -0.7, 0.7], 11);
  const q = norm(multiply(ref, about([0, 1, 0], 30)));
  for (const gain of [1.5, 2, 3.25]) {
    const out = amplify(q, ref, gain, 170 / DEG);
    const relative = multiply(conjugate(ref), out.q);
    const got = angleOf(relative) * DEG;
    assert.ok(Math.abs(got - 30 * gain) < 1e-6, `gain ${gain}: expected ${30 * gain} deg, got ${got}`);
  }
});

test('amplify survives the non-unit quaternions a float32 GLB actually contains', () => {
  // This is the case the normalisation exists for. glTF stores quaternions as
  // float32 and does not require them to be exactly unit; a component error of
  // 1e-3 is normal in the wild. Reading the angle from `acos(w)` on such a
  // quaternion reports the wrong angle, because `acos(w)` and `hypot(xyz)` no
  // longer describe the same rotation -- a 0.3 deg error at 30 deg, which a 2x
  // gain then doubles and a chain of 92 bones compounds.
  const ref = about([0.2, 0.9, -0.4], 15);
  const q = norm(multiply(ref, about([1, 0, 0], 30)));
  const scaled = q.map((v) => v * 1.002);

  for (const gain of [1, 2]) {
    const out = amplify(scaled, ref, gain, 170 / DEG);
    const got = angleOf(multiply(conjugate(ref), out.q)) * DEG;
    assert.ok(
      Math.abs(got - 30 * gain) < 1e-6,
      `gain ${gain} on a 1.002x-magnitude quaternion: expected ${30 * gain} deg, got ${got}`
    );
  }
});

test('amplify preserves the rotation axis', () => {
  // Exaggeration means "same swing, further". If the axis moves, the bone swings
  // somewhere it was never authored to go.
  const raw = [0.6, 0.48, -0.64];
  const length = Math.hypot(...raw);
  const axis = raw.map((v) => v / length);
  const ref = about([0, 0, 1], 5);
  const q = norm(multiply(ref, fromAxisAngle(axis, 20 / DEG)));
  const out = amplify(q, ref, 3, 170 / DEG);
  const relative = multiply(conjugate(ref), out.q);
  const sign = relative[3] < 0 ? -1 : 1;
  const got = [relative[0] * sign, relative[1] * sign, relative[2] * sign];
  const gotLength = Math.hypot(...got);
  assert.ok(gotLength > 1e-6, 'relative rotation collapsed to identity');
  const dot = (got[0] * axis[0] + got[1] * axis[1] + got[2] * axis[2]) / gotLength;
  assert.ok(dot > 1 - 1e-9, `axis drifted, dot = ${dot}`);
});

test('amplify caps instead of spinning past 180 deg', () => {
  const ref = [0, 0, 0, 1];
  const q = about([1, 0, 0], 60);
  const capped = amplify(q, ref, 10, 160 / DEG);
  assert.equal(capped.capped, true);
  const got = angleOf(capped.q) * DEG;
  assert.ok(Math.abs(got - 160) < 1e-6, `expected the cap, got ${got} deg`);
  // And a gain that stays under the cap must not report one.
  assert.equal(amplify(q, ref, 2, 160 / DEG).capped, false);
});

test('amplify takes the short way round when the quaternion is negated', () => {
  // Quaternions double-cover SO(3): -q is the same rotation as q. Reading the
  // angle without normalising the hemisphere turns a 30 deg pose into a 330 deg
  // one, and a 10x gain then caps everything. This is the bug that makes an
  // amplifier look like it "ran out of axis".
  const ref = [0, 0, 0, 1];
  const q = about([0, 0, 1], 30);
  const negated = q.map((v) => -v);
  const a = amplify(q, ref, 2, 170 / DEG);
  const b = amplify(negated, ref, 2, 170 / DEG);
  assert.ok(Math.abs(angleOf(a.q) * DEG - 60) < 1e-6);
  assert.ok(Math.abs(angleOf(b.q) * DEG - 60) < 1e-6);
});

test('applyGain cannot touch geometry, and the layout is what makes that true', () => {
  // The claim is not "we promise not to write geometry" but "the file makes it
  // impossible". Mesh data in this GLB lives in buffer 1 (a decompressed target
  // filled by the meshopt decoder); only the *compressed* blobs are physically in
  // buffer 0, the chunk we patch. So the invariant to assert is that no animation
  // accessor's byte range overlaps a compressed mesh region.
  const glb = readGlb(V2);

  const meshRegions = [];
  for (const view of glb.json.bufferViews) {
    const compressed = view.extensions?.EXT_meshopt_compression;
    if (compressed && compressed.buffer === 0) {
      meshRegions.push([compressed.byteOffset, compressed.byteOffset + compressed.byteLength]);
    }
  }
  assert.ok(meshRegions.length > 0, 'no compressed mesh regions found; the test would be vacuous');

  const animAccessors = new Set();
  for (const animation of glb.json.animations) {
    for (const sampler of animation.samplers) {
      animAccessors.add(sampler.input);
      animAccessors.add(sampler.output);
    }
  }
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  for (const index of animAccessors) {
    const accessor = glb.json.accessors[index];
    const view = glb.json.bufferViews[accessor.bufferView];
    assert.equal(view.buffer, 0, `animation accessor ${index} is not in buffer 0`);
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const end = start + accessor.count * 4 * components[accessor.type];
    for (const [meshStart, meshEnd] of meshRegions) {
      assert.ok(
        end <= meshStart || start >= meshEnd,
        `animation accessor ${index} [${start},${end}) overlaps compressed mesh [${meshStart},${meshEnd})`
      );
    }
  }

  // And the bytes really do survive the transform.
  const snapshot = meshRegions.map(([start, end]) => Buffer.from(glb.buf.subarray(start, end)));
  applyGain(glb, 'cruise', 2.08, 160 / DEG);
  meshRegions.forEach(([start, end], i) => {
    assert.ok(snapshot[i].equals(glb.buf.subarray(start, end)), `compressed mesh region ${i} changed`);
  });
});

test('applyGain at gain 1 changes only float32 rounding', () => {
  // The strongest available self-check: if the transform is lossless in exact
  // arithmetic, gain 1 must return the input up to float32 epsilon.
  const glb = readGlb(V2);
  const original = Buffer.from(glb.buf);
  applyGain(glb, 'cruise', 1, 160 / DEG);

  assert.equal(glb.buf.length, original.length, 'byte length must not change');
  let worst = 0;
  let differing = 0;
  for (let i = 0; i < original.length; i += 4) {
    if (original[i] === glb.buf[i] && original[i + 1] === glb.buf[i + 1] &&
        original[i + 2] === glb.buf[i + 2] && original[i + 3] === glb.buf[i + 3]) continue;
    differing++;
    const a = original.readFloatLE(i);
    const b = glb.buf.readFloatLE(i);
    if (Number.isFinite(a) && Number.isFinite(b)) worst = Math.max(worst, Math.abs(a - b));
  }
  assert.ok(worst <= 1e-6, `gain 1 drifted by ${worst}, more than float32 rounding`);
  assert.ok(differing > 0, 'nothing changed at all: the transform is not being applied');
});

test('amplifying cruise raises its measured travel, and the file still loads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-amplify-'));
  const out = join(dir, 'cruise.glb');
  try {
    const glb = readGlb(V2);
    const before = await loadRig(V2);
    const cruiseBefore = before.gltf.animations.find((c) => c.name === 'cruise');
    const travelBefore = diagnoseClip(cruiseBefore, before.scene, before.deforming).travel;

    applyGain(glb, 'cruise', 2.08, 160 / DEG);
    writeFileSync(out, glb.buf);

    const after = await loadRig(out);
    const cruiseAfter = after.gltf.animations.find((c) => c.name === 'cruise');
    assert.ok(cruiseAfter, 'the amplified file must still contain cruise');
    const rowAfter = diagnoseClip(cruiseAfter, after.scene, after.deforming);

    assert.ok(
      rowAfter.travel > travelBefore * 1.8,
      `travel only moved ${travelBefore} -> ${rowAfter.travel}`
    );
    // Other clips must be untouched by a single-clip gain.
    assert.equal(after.gltf.animations.length, before.gltf.animations.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classify names the three defect classes from the real measured pair', async () => {
  // Measured, not asserted from memory: both rigs are re-diagnosed here, so the
  // table in doc 37 and this test cannot drift apart.
  const v1 = await loadRig(V1);
  const v2 = await loadRig(V2);
  const ref = Object.fromEntries(
    v1.gltf.animations.map((c) => [c.name, diagnoseClip(c, v1.scene, v1.deforming)])
  );
  const cand = Object.fromEntries(
    v2.gltf.animations.map((c) => [c.name, diagnoseClip(c, v2.scene, v2.deforming)])
  );

  const pairs = [
    ['cruise', 'FlightCruise', 'UNIFORM'],
    ['bankLeft', 'BankLeft', 'UNIFORM'],
    ['attack', 'AttackBite', 'UNIFORM'],
    ['takeoff', 'Takeoff', 'BUZZ'],
    ['death', 'Death', 'BUZZ'],
    ['walk', 'GroundWalk', 'CONCENTRATED'],
    ['attack2', 'AttackClaw', 'CONCENTRATED'],
    ['idle', 'Idle', 'CONCENTRATED'],
  ];

  for (const [candidate, reference, expected] of pairs) {
    const result = classify(cand[candidate], ref[reference]);
    assert.equal(
      result.class,
      expected,
      `${candidate}: sustainRatio ${result.sustainRatio} (travelR ${result.travelR}, p95R ${result.p95R})`
    );
  }

  // A gain is only meaningful for the class the amplifier can actually fix.
  assert.notEqual(classify(cand.cruise, ref.FlightCruise).suggestedGain, null);
  assert.equal(classify(cand.takeoff, ref.Takeoff).suggestedGain, null);
  assert.equal(classify(cand.idle, ref.Idle).suggestedGain, null);
});

test('classify refuses to read a spike as amplitude', () => {
  // The mistake doc 36 records: `peak` alone would call this "almost half". It is
  // actually a single snap with dead air either side, so no gain is offered.
  const reference = { travel: 1000, p95: 500, peak: 1000, mean: 400 };
  const spiky = { travel: 400, p95: 40, peak: 480, mean: 60 };
  const result = classify(spiky, reference);
  assert.equal(result.class, 'CONCENTRATED');
  assert.equal(result.suggestedGain, null);
});

test('classify band boundaries are the documented ones', () => {
  const reference = { travel: 100, p95: 100, peak: 100, mean: 100 };
  // p95 and travel fall together -> uniform, gain = reference/candidate travel.
  const uniform = classify({ travel: 50, p95: 50, peak: 50, mean: 50 }, reference);
  assert.equal(uniform.class, 'UNIFORM');
  assert.equal(uniform.suggestedGain, 2);
  // Exactly on each boundary must land inside the uniform band, not outside it.
  assert.equal(classify({ travel: 100, p95: 60, peak: 60, mean: 60 }, reference).class, 'UNIFORM');
  assert.equal(classify({ travel: 100, p95: 140, peak: 140, mean: 140 }, reference).class, 'UNIFORM');
  // And one step outside on each side must not.
  assert.equal(classify({ travel: 100, p95: 59, peak: 59, mean: 59 }, reference).class, 'CONCENTRATED');
  assert.equal(classify({ travel: 100, p95: 141, peak: 141, mean: 141 }, reference).class, 'BUZZ');
});
