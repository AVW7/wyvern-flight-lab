/**
 * Rider mount and clip mapping.
 *
 * The mount is the one place a wrong number produces a *silent* failure: the
 * rider appears, animates, and is simply in the wrong place -- floating above
 * the wyvern, or buried inside it, or the wrong size. Nothing throws. So the
 * arithmetic is pinned here rather than eyeballed in a screenshot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Matrix4, Object3D, Vector3, Quaternion } from 'three';
import { RIDER_MOUNT } from '../src/flight-lab/rider/mountData.ts';
import { riderMatrix, uniformScaleOf } from '../src/flight-lab/rider/riderMount.ts';
import { riderClipFor, mappedWyvernClips, RIDER_CLIPS } from '../src/flight-lab/rider/riderClip.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Spine3's bind pose, measured: translation plus the uniform wyvern scale. */
function spine3Matrix(scale) {
  return new Matrix4().compose(
    new Vector3(0, 783.439, 25.186),
    new Quaternion(),
    new Vector3(scale, scale, scale)
  );
}

test('the rider lands on the seat, not above or inside it', () => {
  const scale = 0.001; // plausible normalised scale; only the ratio matters
  const matrix = riderMatrix(spine3Matrix(scale), RIDER_MOUNT.offsetLocal, scale);
  const placed = new Vector3().setFromMatrixPosition(matrix);

  // Expected: Spine3 world position plus the offset, both in wyvern units,
  // scaled by the wyvern's normalisation factor.
  const expected = new Vector3(
    0 + RIDER_MOUNT.offsetLocal[0] * scale,
    783.439 + RIDER_MOUNT.offsetLocal[1] * scale,
    25.186 + RIDER_MOUNT.offsetLocal[2] * scale
  );
  assert.ok(placed.distanceTo(expected) < 1e-6, `got ${placed.toArray()} want ${expected.toArray()}`);

  // The seat offset is almost entirely upward in world axes: the rider sits on
  // the back, it does not slide forward or sideways.
  const [wx, wy, wz] = RIDER_MOUNT.offsetWorld;
  assert.ok(Math.abs(wx) < 0.5, `lateral offset ${wx} should be ~0`);
  assert.ok(Math.abs(wz) < 0.5, `fore/aft offset ${wz} should be ~0`);
  assert.ok(wy > 100, `seat should lift the rider well clear of the joint, got ${wy}`);
});

test('the rider inherits the wyvern scale exactly once', () => {
  // The bug this catches: `spine3.matrixWorld` already carries the wyvern's
  // normalisation scale, so multiplying by S(scale) again shrinks the rider by
  // the square of the factor (~1/670) and it vanishes while still animating.
  // An earlier version of this test only checked the offset and let that ship.
  for (const scale of [0.0013413698238881775, 1, 0.5, 2]) {
    const matrix = riderMatrix(spine3Matrix(scale), RIDER_MOUNT.offsetLocal, scale);
    const worldScale = new Vector3();
    new Matrix4().copy(matrix).decompose(new Vector3(), new Quaternion(), worldScale);
    assert.ok(
      Math.abs(worldScale.x - scale) < scale * 1e-6,
      `rider world scale ${worldScale.x} should equal the wyvern's ${scale}`
    );
  }
});

test('doubling the wyvern scale doubles both the rider and its offset', () => {
  const spine = (s) => spine3Matrix(s);
  const one = riderMatrix(spine(1), RIDER_MOUNT.offsetLocal, 1);
  const two = riderMatrix(spine(2), RIDER_MOUNT.offsetLocal, 2);
  const origin = new Vector3(0, 783.439, 25.186);
  const fromSpine = (m) => new Vector3().setFromMatrixPosition(m).sub(origin);
  const ratio = fromSpine(two).length() / fromSpine(one).length();
  assert.ok(Math.abs(ratio - 2) < 1e-9, `offset ratio ${ratio} should be 2`);

  const scaleOf = (m) => {
    const s = new Vector3();
    m.decompose(new Vector3(), new Quaternion(), s);
    return s.x;
  };
  assert.ok(Math.abs(scaleOf(two) / scaleOf(one) - 2) < 1e-9, 'rider scale should track the wyvern');
});

test('the local and world mount offsets describe the same displacement', () => {
  // offsetLocal is in Spine3's frame; offsetWorld is the same vector in world
  // axes. If they disagree, one of them is stale.
  const local = new Vector3(...RIDER_MOUNT.offsetLocal);
  const world = new Vector3(...RIDER_MOUNT.offsetWorld);
  assert.ok(
    Math.abs(local.length() - world.length()) < 0.01,
    `|local| ${local.length()} != |world| ${world.length()}`
  );
});

test('a non-uniform scale is rejected rather than silently distorting the rider', () => {
  const node = new Object3D();
  node.matrixAutoUpdate = false;
  node.matrix.compose(new Vector3(), new Quaternion(), new Vector3(2, 2, 2));
  node.matrixWorld.copy(node.matrix);
  assert.equal(uniformScaleOf(node), 2);

  node.matrix.compose(new Vector3(), new Quaternion(), new Vector3(2, 3, 2));
  node.matrixWorld.copy(node.matrix);
  assert.throws(() => uniformScaleOf(node), /uniform scale/);
});

test('every shipped wyvern clip maps to a rider clip that exists', () => {
  const shipped = [
    'attack', 'attack2', 'attackAir2', 'bankLeft', 'bankRight', 'breath', 'cruise',
    'death', 'dive', 'glide', 'hover', 'idle', 'land', 'rest', 'scout', 'speed',
    'takeoff', 'walk',
  ];
  const mapped = new Set(mappedWyvernClips());
  for (const clip of shipped) {
    assert.ok(mapped.has(clip.toLowerCase()), `${clip} has no rider mapping`);
    const rider = riderClipFor(clip);
    assert.ok(RIDER_CLIPS.includes(rider), `${clip} maps to unknown rider clip ${rider}`);
  }
});

test('banks lean the correct way and combat braces', () => {
  assert.equal(riderClipFor('bankLeft'), 'rider_leanLeft');
  assert.equal(riderClipFor('bankRight'), 'rider_leanRight');
  assert.equal(riderClipFor('attack'), 'rider_brace');
  assert.equal(riderClipFor('takeoff'), 'rider_brace');
  assert.equal(riderClipFor('cruise'), 'rider_idle');
  // Case and whitespace should not change the answer.
  assert.equal(riderClipFor('  BankLeft '), 'rider_leanLeft');
  // Unknown clips degrade to idle rather than throwing.
  assert.equal(riderClipFor('someFutureClip'), 'rider_idle');
});

test('mountData.ts is generated from the assets, not hand-edited', () => {
  // Re-run the calibration and require the committed module to be unchanged.
  // This is what stops a stale mount surviving an asset rebuild.
  const committed = readFileSync(resolve(ROOT, 'src/flight-lab/rider/mountData.ts'), 'utf8');
  execFileSync(process.execPath, ['tools/calibrate-rider-mount.mjs', '--write'], { cwd: ROOT });
  const regenerated = readFileSync(resolve(ROOT, 'src/flight-lab/rider/mountData.ts'), 'utf8');
  assert.equal(regenerated, committed, 'mountData.ts is stale; commit the regenerated file');
});
