/**
 * The dynamics gate must be able to fail, and must fail for the right reason.
 *
 * A threshold that no clip can violate is decoration. These tests break the
 * thing the gate claims to measure — clip timing — and require the gate to
 * notice. They also record V2's current deficit as a measured fact rather than
 * a remembered impression.
 *
 * An earlier draft of this file claimed V2's problem was "flatness rather than
 * amplitude". The measurements do not support that. Across the nine mapped
 * clips V2 carries a median 41% of V1's peak angular velocity, and the crest
 * factor (peak / mean) moves in both directions: takeoff drops to 0.27x while
 * idle rises to 2.33x. So it is neither a uniform scaling nor a uniform
 * flattening. What the numbers actually say is in the last test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  loadRig,
  measureClipDynamics,
  measureDynamics,
  compareToReference,
  REFERENCE_CLIP_MAP,
} from '../scripts/wyvern-dynamics.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reference = JSON.parse(
  readFileSync(resolve(ROOT, 'assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json'), 'utf8')
);

/** Re-time a clip without touching its poses: same motion, stretched over `factor`. */
function retime(clip, factor) {
  const tracks = clip.tracks.map((track) => {
    const copy = track.clone();
    for (let i = 0; i < copy.times.length; i++) copy.times[i] *= factor;
    return copy;
  });
  return new clip.constructor(clip.name, clip.duration * factor, tracks, clip.blendMode);
}

/** A candidate built straight from the reference: every ratio is exactly 1.0. */
function identityCandidate() {
  const candidate = {};
  for (const [v2Name, v1Name] of Object.entries(REFERENCE_CLIP_MAP)) {
    const clip = reference.clips[v1Name];
    if (clip) candidate[v2Name] = { ...clip };
  }
  return candidate;
}

test('the gate admits a candidate identical to its reference', () => {
  const result = compareToReference(identityCandidate(), reference);
  assert.deepEqual(result.failures, []);
  assert.ok(result.passed);
});

test('the gate rejects a clip that loses its peak, and names that clip only', () => {
  const candidate = identityCandidate();
  candidate.cruise.peak *= 0.5;
  const result = compareToReference(candidate, reference);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures.map((f) => `${f.clip}.${f.channel}`), ['cruise.peak']);
});

test('the gate rejects a clip that gains jitter', () => {
  const candidate = identityCandidate();
  candidate.takeoff.accelMax *= 2;
  const result = compareToReference(candidate, reference);
  assert.deepEqual(result.failures.map((f) => `${f.clip}.${f.channel}`), ['takeoff.accelMax']);
});

test('the gate rejects a clip whose peak has no shoulder', () => {
  const candidate = identityCandidate();
  candidate.idle.sustained = false;
  const result = compareToReference(candidate, reference);
  assert.deepEqual(result.failures.map((f) => `${f.clip}.${f.channel}`), ['idle.sustain']);
});

test('stretching a clip in time halves its measured angular velocity', async () => {
  // The mutation Stage 3 will actually perform, in reverse: if re-timing were
  // invisible to this instrument, the instrument would be measuring nothing.
  const rig = await loadRig(resolve(ROOT, 'public/models/wyvern-v2-rig.glb'));
  const cruise = rig.gltf.animations.find((clip) => clip.name === 'cruise');
  assert.ok(cruise, 'V2 must ship a cruise clip');

  const original = measureClipDynamics(cruise, rig.scene, rig.deforming);
  const stretched = measureClipDynamics(retime(cruise, 2), rig.scene, rig.deforming);

  assert.ok(original.peak > 0);
  const ratio = stretched.peak / original.peak;
  assert.ok(
    ratio > 0.4 && ratio < 0.6,
    `2x duration should roughly halve peak, got ${original.peak.toFixed(1)} -> ${stretched.peak.toFixed(1)} (ratio ${ratio.toFixed(3)})`
  );
  assert.ok(stretched.duration > original.duration * 1.99);
});

test('V2 passes the dynamics gate on six of nine clips; the flight group is left', async () => {
  const rig = await loadRig(resolve(ROOT, 'public/models/wyvern-v2-rig.glb'));
  const measured = measureDynamics(rig);
  const result = compareToReference(measured, reference);

  // Stage 3 landed in three of four slices, each solved against this module's
  // 60 Hz world-space metric rather than typed in:
  //   D2  takeoff + death      (BUZZ: transient gains + smoothing)
  //   D3  idle, walk, attack2  (travelling secondary-motion ripple)
  //   D4  attack               (gain + a strike accent on its existing peak)
  const shipped = ['idle', 'walk', 'attack2', 'takeoff', 'death', 'attack'];
  for (const name of shipped) {
    const named = result.failures.filter((f) => f.clip === name);
    assert.deepEqual(
      named.map((f) => `${f.channel}=${f.value.toFixed(1)} expected ${f.expected}`),
      [],
      `${name} was reshaped and must pass the gate`
    );
  }

  // The flight group is deliberately NOT amplified. Both remaining clips are
  // blocked by product invariants, measured in tools/blender/reshape_d4_clips.mjs:
  //   cruise  a 1.68x gain folds the membrane to 2256 units against the 2500
  //           floor the span test requires at t = 1.0 s (authored: 2780.9).
  //   banks   a 6.7x gain plus smoothing moves their wingbeat from 0.500 Hz to
  //           1.500 Hz, breaking the 8% cadence tolerance the flight phase
  //           group needs for steering crossfades.
  // Closing them needs authored motion, not a scale factor. Until then the gate
  // must keep reporting them as failures rather than be quietly loosened.
  assert.equal(result.passed, false);
  assert.deepEqual(
    [...new Set(result.failures.map((f) => f.clip))].sort(),
    ['bankLeft', 'bankRight', 'cruise']
  );

  // A clip that silently vanished would otherwise shrink the gate to nothing.
  assert.equal(result.rows.length, 9);
  for (const { clip, got, want } of result.rows) {
    assert.ok(got.peak > 0, `${clip} must carry motion`);
    assert.ok(got.sustained, `${clip} peak needs a shoulder, not a single-frame pop`);
    assert.ok(
      got.mean <= want.mean * 1.4,
      `${clip} mean ${got.mean.toFixed(1)} must stay under 1.4x reference ${want.mean.toFixed(1)}`
    );
  }
});
