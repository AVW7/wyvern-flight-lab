import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlb, encodeGlb } from './blender/runtime_rig_contract.mjs';
import { measureCreases, triangleEdges } from './membrane-crease-metrics.mjs';

assert.ok(process.argv.length > 2, 'Pass one or more candidate GLB paths');
for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path);
  const { gltf, binary } = readGlb(bytes);
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  delete gltf.materials; delete gltf.images; delete gltf.textures;
  const stripped = encodeGlb(gltf, binary);
  const { scene, animations } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), '');
  const mesh = scene.getObjectByName('WyvernMembrane_ExportSafe');
  assert.ok(mesh?.isSkinnedMesh, 'Expected the documented separated V2 membrane mesh');
  const geometry = mesh.geometry, position = geometry.getAttribute('position');
  const indices = Array.from(geometry.index.array), edges = triangleEdges(indices);
  const groups = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
  const weights = i => Array.from({ length: 4 }, (_, k) => [skinIndex.getComponent(i, k), skinWeight.getComponent(i, k)])
    .filter(([, weight]) => weight !== 0).sort((a, b) => a[0] - b[0]);
  const paired = [...groups.values()].filter(ids => ids.length > 1);
  const mismatches = paired.filter(ids => ids.some(i => JSON.stringify(weights(i)) !== JSON.stringify(weights(ids[0]))));
  const samples = [];
  for (const clip of animations.filter(a => ['cruise', 'bankLeft', 'bankRight'].includes(a.name))) {
    const mixer = new AnimationMixer(scene), action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true; action.play();
    for (let phaseIndex = 0; phaseIndex < 8; phaseIndex++) {
      const phase = phaseIndex / 8;
      mixer.setTime(clip.duration * phase); scene.updateMatrixWorld(true); mesh.skeleton.update();
      const posed = Array.from({ length: position.count }, (_, i) => mesh.applyBoneTransform(i, new Vector3().fromBufferAttribute(position, i)).toArray());
      samples.push({ clip: clip.name, phase, ...measureCreases(posed, indices, edges) });
    }
    mixer.stopAllAction(); mixer.uncacheRoot(scene);
  }
  console.log(JSON.stringify({ path, sha256: createHash('sha256').update(bytes).digest('hex'),
    mesh: mesh.name, vertices: position.count, exactPositionGroups: paired.length,
    mismatchedSkinGroups: mismatches.length, samples }, null, 2));
}
