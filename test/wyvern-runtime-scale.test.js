import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import {
  FLIGHT_LAB_TARGET_SIZE,
  PLAYER_TARGET_SIZE,
  bindBounds,
  largestBindExtent,
  metresPerUnit,
} from '../scripts/wyvern-runtime-scale.mjs';

/** One bone at the origin; vertices spanning 10 units in x and 3 in y. */
function rig() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 10, 0, 0, 0, 3, 0], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const bone = new Bone();
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(new Skeleton([bone]));
  mesh.updateMatrixWorld(true);
  return { mesh, bone };
}

test('bind bounds report the largest extent, not the largest axis of one vertex', () => {
  const { mesh } = rig();
  const bounds = bindBounds([mesh]);
  assert.equal(bounds.extent, 10);
  assert.deepEqual(bounds.min, { x: 0, y: 0, z: 0 });
  assert.deepEqual(bounds.max, { x: 10, y: 3, z: 0 });
  assert.equal(largestBindExtent([mesh]), 10);
});

test('the extent follows the pose, because it is measured on skinned vertices', () => {
  const { mesh, bone } = rig();
  // Stretch the bone 4x along x: a bind-attribute extent would not notice.
  bone.scale.set(4, 1, 1);
  mesh.updateMatrixWorld(true);
  assert.equal(largestBindExtent([mesh]), 40);
});

test('metres per unit is the display target divided by the extent', () => {
  assert.equal(metresPerUnit(10, 5.8), 0.58);
  assert.equal(metresPerUnit(6266.8, PLAYER_TARGET_SIZE), PLAYER_TARGET_SIZE / 6266.8);
  // The two consumers disagree by design, and the ratio is the targets' ratio.
  const player = metresPerUnit(6266.8, PLAYER_TARGET_SIZE);
  const lab = metresPerUnit(6266.8, FLIGHT_LAB_TARGET_SIZE);
  assert.ok(Math.abs(lab / player - FLIGHT_LAB_TARGET_SIZE / PLAYER_TARGET_SIZE) < 1e-12);
});

test('a degenerate model yields a finite scale instead of an infinite one', () => {
  const { mesh } = rig();
  // Collapse every vertex onto the origin: extent 0 would divide by zero.
  const position = mesh.geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    position.setXYZ(index, 0, 0, 0);
  }
  position.needsUpdate = true;
  assert.equal(largestBindExtent([mesh]), 1);
  assert.ok(Number.isFinite(metresPerUnit(largestBindExtent([mesh]), 5.8)));
});
