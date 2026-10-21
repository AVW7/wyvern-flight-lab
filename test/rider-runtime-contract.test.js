/**
 * The rider asset must match its contract exactly.
 *
 * The failure this guards against is silent: `riderMount` resolves bones by
 * name, so a renamed joint or a changed clip list does not throw — it just
 * leaves the rider floating, or playing the wrong clip, with nothing in the
 * console. Pinning the signature turns that into a test failure.
 *
 * It also pins orientation geometrically rather than trusting the exporter:
 * +Y up and +Z forward are read off the actual node transforms, so an
 * `export_yup` regression is caught here rather than discovered on screen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  RIDER_PATH,
  RIDER_CONTRACT_PATH,
  buildContract,
  inspect,
  validateRider,
} from '../tools/blender/rider_runtime_contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = readFileSync(resolve(ROOT, 'public/models/wyvern-rider.glb'));
const contract = JSON.parse(readFileSync(resolve(ROOT, 'scripts/blender/wyvern_rider_runtime_contract.json'), 'utf8'));
const report = inspect(bytes);

test('the shipped rider matches its pinned contract', () => {
  const result = validateRider(bytes);
  assert.deepEqual(result.errors, []);
  assert.ok(result.passed);
});

test('the contract on disk is generated from the shipped GLB, not hand-written', () => {
  // Rebuilding the contract must reproduce it exactly. If this drifts, the
  // contract describes a rider that no longer exists.
  assert.deepEqual(buildContract(bytes), contract);
});

test('the rider is oriented +Y up and +Z forward, like the wyvern', () => {
  assert.equal(report.upAxis, '+Y', 'head must be above the pelvis');
  assert.equal(report.forwardAxis, '+Z', 'feet must lead along +Z');
  // Independent of the contract, check the magnitudes make sense in wyvern
  // units (400 per metre).
  const [, headY] = report.headWorld;
  const [, , footZ] = report.footWorld;
  assert.ok(headY > 250 && headY < 420, `head height ${headY} should be ~0.75 m of a 1.8 m rider`);
  assert.ok(footZ > 100, `feet should lead forward, got z ${footZ}`);
});

test('every bone is prefixed so it cannot collide with a wyvern joint', () => {
  for (const name of report.boneNames) {
    assert.ok(name.startsWith('RDR_'), `${name} is not namespaced`);
  }
  assert.equal(report.boneNames.length, 24);
  assert.equal(new Set(report.boneNames).size, 24, 'duplicate bone names would break name lookup');
});

test('the rider carries its own clip set for idle and both leans', () => {
  const names = report.clips.map((clip) => clip.name).sort();
  assert.deepEqual(names, ['rider_brace', 'rider_idle', 'rider_leanLeft', 'rider_leanRight']);
  for (const clip of report.clips) {
    assert.ok(clip.duration > 0.5, `${clip.name} is too short to read as motion`);
  }
});

test('the rider is skinned and cheap enough to draw beside a 50k-tri wyvern', () => {
  assert.equal(report.skinCount, 1, 'must be skinned, not rigid-parented');
  assert.equal(report.meshCount, 1);
  assert.ok(report.triCount > 1500 && report.triCount < 4000, `tri count ${report.triCount} outside budget`);
});

test('a renamed bone is rejected', () => {
  // Simulate the silent failure: change one node name in the GLB JSON and
  // require the validator to notice.
  const clone = Buffer.from(bytes);
  const jsonLength = clone.readUInt32LE(12);
  const gltf = JSON.parse(clone.toString('utf8', 20, 20 + jsonLength));
  const target = gltf.nodes.find((node) => node.name === 'RDR_Head');
  assert.ok(target, 'fixture expects RDR_Head in the shipped asset');
  target.name = 'RDR_HeadRenamed';
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const binary = clone.subarray(20 + jsonLength);
  const mutated = Buffer.alloc(20 + padded.length + binary.length);
  clone.copy(mutated, 0, 0, 20);
  mutated.writeUInt32LE(mutated.length, 8);
  mutated.writeUInt32LE(padded.length, 12);
  padded.copy(mutated, 20);
  binary.copy(mutated, 20 + padded.length);

  const result = validateRider(mutated);
  assert.equal(result.passed, false);
  assert.ok(
    result.errors.some((error) => error.includes('bone names changed')),
    `expected a bone-name error, got ${JSON.stringify(result.errors)}`
  );
});
