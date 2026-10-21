/**
 * The committed V1 dynamics reference must be *generated*, not typed.
 *
 * A reference file is only trustworthy if re-running the measurer reproduces it.
 * Every other gate in this repo asserts against a number someone wrote down; this
 * one asserts against a number the instrument produces, and fails loudly if the
 * two ever drift apart.
 *
 * It also pins the SHA-256 of the file the numbers came from. If `player-wyvern.glb`
 * is ever re-exported, the reference is invalid and this test says so instead of
 * quietly gating new work against stale dynamics.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadRig, measureDynamics, DYNAMICS_HZ, REFERENCE_CLIP_MAP } from '../scripts/wyvern-dynamics.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLB = resolve(ROOT, 'public/models/player-wyvern.glb');
const REFERENCE = resolve(ROOT, 'assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json');

const reference = JSON.parse(readFileSync(REFERENCE, 'utf8'));
const rig = await loadRig(GLB);
const measured = measureDynamics(rig);

const CHANNELS = ['peak', 'p95', 'mean', 'accelMax'];

test('the reference records the file it was measured from', () => {
  const sha256 = createHash('sha256').update(readFileSync(GLB)).digest('hex');
  assert.equal(reference.source.sha256, sha256, 'reference was measured from a different GLB');
  assert.equal(reference.source.bytes, readFileSync(GLB).length);
  assert.equal(reference.sampleHz, DYNAMICS_HZ);
});

test('re-measuring V1 reproduces every committed number to 3 decimal places', () => {
  assert.deepEqual(
    Object.keys(measured).sort(),
    Object.keys(reference.clips).sort(),
    'clip set changed'
  );
  for (const [name, got] of Object.entries(measured)) {
    const want = reference.clips[name];
    for (const channel of CHANNELS) {
      assert.equal(
        Number(got[channel].toFixed(3)),
        want[channel],
        `${name}.${channel}: measured ${got[channel].toFixed(3)}, reference ${want[channel]}`
      );
    }
    assert.equal(got.peakJoint, want.peakJoint, `${name}.peakJoint`);
    assert.equal(got.sustained, want.sustained, `${name}.sustained`);
  }
});

test('every sampled peak is attributed to a deforming bone', () => {
  // The filter exists so a report names a bone an animator can key. An `_end`
  // tip mirrors its parent exactly, so it would otherwise win the attribution
  // while being invisible in the mesh.
  const deforming = new Set(rig.deforming.map((bone) => bone.name));
  assert.ok(deforming.size > 0 && deforming.size < rig.bones.length, 'filter must be selective');
  for (const [name, got] of Object.entries(measured)) {
    assert.ok(deforming.has(got.peakJoint), `${name} blamed ${got.peakJoint}, which carries no weight`);
    assert.ok(!/_end/.test(got.peakJoint), `${name} blamed an export tip: ${got.peakJoint}`);
  }
});

test('every mapped V2 clip has a V1 cousin that was actually measured', () => {
  for (const [candidate, cousin] of Object.entries(REFERENCE_CLIP_MAP)) {
    assert.ok(reference.clips[cousin], `${candidate} maps to ${cousin}, which the reference lacks`);
  }
});

test('V1 compared against its own reference passes the gate', () => {
  // Guards against a gate that no clip could ever satisfy. Ratios are all 1.0,
  // so this is the tightest the thresholds can be and still admit their source.
  const candidate = {};
  for (const [v2Name, v1Name] of Object.entries(REFERENCE_CLIP_MAP)) {
    if (measured[v1Name]) candidate[v2Name] = measured[v1Name];
  }
  return import('../scripts/wyvern-dynamics.mjs').then(({ compareToReference }) => {
    const result = compareToReference(candidate, reference);
    assert.deepEqual(result.failures, [], 'the reference fails against itself');
    assert.ok(result.passed);
  });
});
