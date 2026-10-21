import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { measurePoseEndpoints, quatAngle } from '../scripts/wyvern-loop-metrics.mjs';

test('endpoint metrics keep angular and positional changes separate with responsible bones', () => {
  const start = [{ name: 'Body', quaternion: new Quaternion(), position: new Vector3() },
    { name: 'Wing', quaternion: new Quaternion(), position: new Vector3() }];
  const end = [{ name: 'Body', quaternion: new Quaternion(), position: new Vector3(0, 0, 520) },
    { name: 'Wing', quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.25), position: new Vector3() }];
  const result = measurePoseEndpoints(start, end);
  assert.ok(Math.abs(result.rotationRad - 0.25) < 1e-12);
  assert.equal(result.translationRigUnits, 520);
  assert.equal(result.rotationBone, 'Wing');
  assert.equal(result.translationBone, 'Body');
  assert.deepEqual(measurePoseEndpoints(start, start), { rotationRad: 0, translationRigUnits: 0, rotationBone: null, translationBone: null });
});

test('an orientation compared with itself is zero radians even when it is not unit length', () => {
  // These are the stored values of `R_WingD4P0` in the shipped idle clip, not a
  // fabricated fixture: glTF keeps quaternions as float32, and |q|^2 here is
  // 0.9999998952 rather than 1. `Quaternion.angleTo` divides neither operand by
  // its norm, so it reads that as a 9.16e-4 rad rotation -- a floor under every
  // seam and every angular-velocity figure. A closed loop must measure 0.
  const q = new Quaternion(0.208738625, 0.623954654, 0.526592910, 0.538338721);
  assert.ok(Math.abs(q.dot(q) - 1) > 1e-8, 'fixture must not be unit length');
  assert.equal(quatAngle(q, q), 0);
  assert.ok(q.angleTo(q) > 1e-4, 'the three.js helper this replaced reports a floor');
});

test('quatAngle reads the same orientation through the double cover', () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.1);
  const negated = new Quaternion(-q.x, -q.y, -q.z, -q.w);
  assert.equal(quatAngle(q, negated), 0);
});
