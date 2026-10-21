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

test('V2 currently fails the gate, for three distinct measured reasons', async () => {
  const rig = await loadRig(resolve(ROOT, 'public/models/wyvern-v2-rig.glb'));
  const measured = measureDynamics(rig);
  const result = compareToReference(measured, reference);

  assert.equal(result.passed, false, 'if this passes, Stage 3 has landed: invert the assertion');

  const row = (name) => {
    const found = result.rows.find((r) => r.clip === name);
    assert.ok(found, `${name} must be comparable`);
    return found;
  };

  // 1. Amplitude. The median mapped clip carries ~41% of the reference peak.
  //    Cruise is representative: peak 0.48x, p95 0.56x, mean 0.52x.
  const cruise = row('cruise');
  assert.ok(cruise.got.peak < cruise.want.peak * 0.7, `cruise peak ${cruise.got.peak.toFixed(1)}`);

  // 2. Transients. Before Task D2, attack and takeoff both lost their peaks
  //    disproportionately: crest factor 0.57x and 0.27x of reference, in exactly
  //    the two clips whose V1 cousins are the most peaky (crest 4.58 and 7.12).
  //    The D2 BUZZ reshape (solved against this module's 60 Hz world-space
  //    metric, not typed) restored takeoff to 1.68x peak / death to 1.16x, and
  //    both now pass every channel of the gate. Attack is still the outlier at
  //    0.09x because 49 of its channels are static and amplification is capped
  //    at 3.47x — that is Task D4, not a regression.
  for (const name of ['takeoff', 'death']) {
    const named = result.failures.filter((f) => f.clip === name);
    assert.deepEqual(
      named.map((f) => f.channel),
      [],
      `${name} was reshaped in D2 and must now pass the gate`
    );
  }
  const attack = row('attack');
  assert.ok(
    attack.got.peak < attack.want.peak * 0.15,
    `attack peak should still collapse to under 15% of reference, got ${(attack.got.peak / attack.want.peak).toFixed(3)}x`
  );

  // 3. The opposite failure. V2's idle is not gently reduced, it is frozen
  //    between rare twitches: p95 falls to 7.7% of reference while its crest
  //    factor rises to 2.33x. A single peak-amplitude threshold would score this
  //    clip as merely quiet and miss that it is dead for most of its duration.
  const idle = row('idle');
  assert.ok(
    idle.got.p95 < idle.want.p95 * 0.1,
    `idle p95 ${idle.got.p95.toFixed(1)} should be under 10% of ${idle.want.p95.toFixed(1)}`
  );
  assert.ok(
    idle.got.peak / idle.got.mean > (idle.want.peak / idle.want.mean) * 1.5,
    'idle should read as spikier than its reference, not just quieter'
  );
});
