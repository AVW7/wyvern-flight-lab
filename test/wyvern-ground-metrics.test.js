import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import {
  CANONICAL_GROUND_CONTACT_PLANE_Y,
  footSurfaceHeight,
  jointTranslationRange,
  stanceVerticalJitter,
  wingKnuckleSurfaceHeight,
} from '../scripts/wyvern-ground-metrics.mjs';

/**
 * A one-bone skinned mesh whose three vertices sit at local y = 0..1, so the
 * skinned surface height is exactly the bone's offset from its bind pose.
 *
 * Deliberately a *skinned mesh* and not a bare bone position: the whole point
 * of the measure is that the surface is not the joint.
 */
function footRig() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const bone = new Bone();
  bone.position.set(0, 10, 0);
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(new Skeleton([bone]));
  mesh.updateMatrixWorld(true);
  return { bone, mesh, footMeshes: [{ mesh, indices: [0, 1, 2] }] };
}

test('joint translation range is the 3-D diagonal, not the widest axis', () => {
  const clip = { tracks: [{ name: 'Body.position', values: new Float32Array([0, 0, 0, 3, 4, 0, 0, 0, 0]) }] };
  assert.equal(jointTranslationRange(clip, 'Body'), 5);
});

test('joint translation range is zero for a joint with no translation track', () => {
  assert.equal(jointTranslationRange({ tracks: [] }, 'Body'), 0);
  const rotationOnly = { tracks: [{ name: 'Body.quaternion', values: new Float32Array([0, 0, 0, 1]) }] };
  assert.equal(jointTranslationRange(rotationOnly, 'Body'), 0);
});

test('foot surface height measures the skinned surface, not the joint position', () => {
  const { bone, mesh, footMeshes } = footRig();
  const bindHeight = footSurfaceHeight({
    poseAt: () => mesh.updateMatrixWorld(true),
    footMeshes,
    duration: 4,
    frames: 3,
  });
  assert.equal(bindHeight, 0);
  assert.equal(bone.getWorldPosition(new Vector3()).y, 10);
});

test('foot surface height samples every frame including the endpoints', () => {
  const { bone, mesh, footMeshes } = footRig();
  const height = footSurfaceHeight({
    poseAt: (time) => {
      bone.position.y = 10 - time;
      mesh.updateMatrixWorld(true);
    },
    footMeshes,
    duration: 4,
    frames: 3,
  });
  assert.equal(height, -4);
});

test('foot surface height is sensitive to rotation at a fixed joint position', () => {
  const { bone, mesh, footMeshes } = footRig();
  const height = footSurfaceHeight({
    poseAt: () => {
      bone.rotation.z = Math.PI / 2;
      mesh.updateMatrixWorld(true);
    },
    footMeshes,
    duration: 1,
    frames: 1,
  });
  assert.ok(Math.abs(height - 10) < 1e-9, `expected 10, got ${height}`);
});

test('canonical ground contact plane, wing knuckle surface height, and stance vertical jitter helpers', () => {
  assert.equal(CANONICAL_GROUND_CONTACT_PLANE_Y, -184);
  const { bone, mesh, footMeshes } = footRig();
  const knuckleHeight = wingKnuckleSurfaceHeight({
    poseAt: () => mesh.updateMatrixWorld(true),
    knuckleMeshes: footMeshes,
    duration: 2,
    frames: 2,
  });
  assert.equal(knuckleHeight, 0);

  const jitter = stanceVerticalJitter({
    poseAt: (t) => {
      bone.position.y = t < 1 ? 0 : 20;
      mesh.updateMatrixWorld(true);
    },
    bone,
    duration: 4,
    frames: 8,
    stanceFraction: 0.25,
  });
  assert.equal(jitter, 0);
});

test('the clip gate enforces Body travel and foot height under --strict', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/validate-wyvern-clips.mjs', 'public/models/wyvern-v2-rig.glb', '--strict'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /Body translates by .* rig units/);
  assert.match(result.stderr, /foot surface spans .* rig units/);
});
