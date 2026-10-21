/**
 * Skinned-vertex sampling.
 *
 * A skinned mesh's `matrixWorld` does NOT describe where its vertices are. The
 * geometry sits in a small bind space (the wyvern's body mesh is 1.3 x 0.5 x 1.9
 * units) and the bones' inverse-bind matrices bake a scale of roughly 2187. A
 * naive `applyMatrix4(mesh.matrixWorld)` therefore reports the wyvern as 1.9
 * units long when it is really 4162. This module does the real thing:
 *
 *     world = sum_i w_i * (boneWorld_i * boneInverse_i) * bindMatrix * position
 *
 * Both `tools/measure-wyvern-saddle.mjs` and `tools/calibrate-rider-mount.mjs`
 * depend on it, so the saddle height and the seat offset cannot disagree.
 */

import { Matrix4, Vector3 } from "three";

/** One Matrix4 per bone: boneWorld * boneInverse, precomputed. */
export function boneMatrices(skeleton) {
  return skeleton.bones.map((bone, index) =>
    new Matrix4().multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[index])
  );
}

/**
 * World positions of every vertex, as flat [x, y, z] triples.
 * Requires `scene.updateMatrixWorld(true)` to have run.
 */
export function skinnedWorldPositions(mesh) {
  const position = mesh.geometry.attributes.position;
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const skinWeight = mesh.geometry.attributes.skinWeight;
  if (!skinIndex || !skinWeight) return null;

  const matrices = boneMatrices(mesh.skeleton);
  const out = new Float32Array(position.count * 3);
  const bind = new Vector3();
  const transformed = new Vector3();
  const accumulated = new Vector3();

  for (let v = 0; v < position.count; v++) {
    accumulated.set(0, 0, 0);
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(v, k);
      if (weight <= 0) continue;
      const bone = skinIndex.getComponent(v, k);
      if (bone >= matrices.length) continue;
      bind.fromBufferAttribute(position, v).applyMatrix4(mesh.bindMatrix);
      transformed.copy(bind).applyMatrix4(matrices[bone]);
      accumulated.addScaledVector(transformed, weight);
      total += weight;
    }
    if (total > 0) accumulated.multiplyScalar(1 / total);
    out[v * 3] = accumulated.x;
    out[v * 3 + 1] = accumulated.y;
    out[v * 3 + 2] = accumulated.z;
  }
  return out;
}

/** Every skinned mesh in the scene, with its sampled world positions. */
export function skinnedMeshes(scene) {
  const meshes = [];
  scene.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const points = skinnedWorldPositions(node);
    if (points) meshes.push({ mesh: node, points, count: points.length / 3 });
  });
  return meshes;
}

/** Quantile of a numeric array, sorted in place. */
export function quantile(values, fraction) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}
