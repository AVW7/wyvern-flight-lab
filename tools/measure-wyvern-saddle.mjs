import { loadRig } from "/Users/ajadvanwyk/wyvern-flight-lab/scripts/wyvern-dynamics.mjs";
import { Vector3, Matrix4, Box3 } from "three";

const ROOT = "/Users/ajadvanwyk/wyvern-flight-lab";
const rig = await loadRig(`${ROOT}/public/models/wyvern-v2-rig.glb`);
rig.scene.updateMatrixWorld(true);

/** World position of a skinned vertex: sum_i w_i * (boneWorld_i * boneInverse_i) * bindMatrix * p */
function skinnedWorldPositions(mesh) {
  const pos = mesh.geometry.attributes.position;
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  const bones = mesh.skeleton.bones;
  const inverses = mesh.skeleton.boneInverses;
  const boneMats = bones.map((bone, i) => new Matrix4().multiplyMatrices(bone.matrixWorld, inverses[i]));
  const out = [];
  const p = new Vector3();
  const tmp = new Vector3();
  const acc = new Vector3();
  for (let v = 0; v < pos.count; v++) {
    acc.set(0, 0, 0);
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k);
      if (w <= 0) continue;
      const bi = si.getComponent(v, k);
      p.fromBufferAttribute(pos, v).applyMatrix4(mesh.bindMatrix);
      tmp.copy(p).applyMatrix4(boneMats[bi]);
      acc.addScaledVector(tmp, w);
      total += w;
    }
    if (total > 0) acc.multiplyScalar(1 / total);
    out.push([acc.x, acc.y, acc.z]);
  }
  return out;
}

const meshes = [];
rig.scene.traverse((n) => { if (n.isSkinnedMesh) meshes.push(n); });

for (const mesh of meshes) {
  const pts = skinnedWorldPositions(mesh);
  const box = new Box3();
  for (const [x, y, z] of pts) box.expandByPoint(new Vector3(x, y, z));
  const s = box.getSize(new Vector3());
  console.log(`${mesh.name.padEnd(28)} verts=${String(pts.length).padStart(6)} size=${s.toArray().map((v) => v.toFixed(1)).join(" x ")}`);
  console.log(`  min ${box.min.toArray().map((v) => v.toFixed(1)).join(", ")}   max ${box.max.toArray().map((v) => v.toFixed(1)).join(", ")}`);
}

// Saddle cross-section: vertices near Spine3's z, on the body mesh.
const SPINE3 = new Vector3(0, 783.44, 25.19);
const body = meshes.find((m) => m.name.includes("DaenerysDragon001") && !m.name.endsWith("_1"));
const bodyPts = skinnedWorldPositions(body);
const slab = bodyPts.filter(([, , z]) => Math.abs(z - SPINE3.z) < 80);
console.log(`\nsaddle slab (|z - ${SPINE3.z}| < 80): ${slab.length} vertices`);
if (slab.length) {
  const ys = slab.map((p) => p[1]).sort((a, b) => a - b);
  const xs = slab.map((p) => p[0]).sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.floor((arr.length - 1) * f)];
  console.log(`  y: p50 ${q(ys, 0.5).toFixed(1)}  p90 ${q(ys, 0.9).toFixed(1)}  p99 ${q(ys, 0.99).toFixed(1)}  max ${ys[ys.length - 1].toFixed(1)}`);
  console.log(`  x: p01 ${q(xs, 0.01).toFixed(1)}  p50 ${q(xs, 0.5).toFixed(1)}  p99 ${q(xs, 0.99).toFixed(1)}`);
  const backTop = q(ys, 0.98);
  console.log(`\n  back surface near Spine3 ~ y ${backTop.toFixed(1)} (Spine3 joint at ${SPINE3.y})`);
  console.log(`  torso half-width at saddle (p01..p99 / 2): ${((q(xs, 0.99) - q(xs, 0.01)) / 2).toFixed(1)}`);
  // Rider sizing: a seated rider's hip-to-crown is ~0.55 of standing height.
  const torsoTop = q(ys, 0.98);
  const torsoBottom = q(ys, 0.02);
  console.log(`  torso vertical extent at saddle: ${(torsoTop - torsoBottom).toFixed(1)}`);
}
