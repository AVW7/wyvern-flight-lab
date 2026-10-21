import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { AnimationMixer, LoopOnce, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createMembraneSurfaceRuntime } from '../../src/flight-lab/membraneSurfaceRuntime';
import { encodeGlb, readGlb } from './runtime_rig_contract.mjs';
const [file, directory] = process.argv.slice(2);
const { gltf, binary } = readGlb(readFileSync(file!));
for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) delete primitive.material;
delete gltf.materials; delete gltf.images; delete gltf.textures;
const bytes = encodeGlb(gltf, binary);
const parsed = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const mesh = parsed.scene.getObjectByName('WyvernMembrane_ExportSafe') as SkinnedMesh;
const runtime = createMembraneSurfaceRuntime(parsed.scene);
const config = mesh.userData.membraneSurfaceRepair;
const referenceBytes = readFileSync(`${directory}/corrected.bin`);
const reference = new Float32Array(referenceBytes.buffer, referenceBytes.byteOffset, referenceBytes.length / 4);
const samples = JSON.parse(readFileSync(`${directory}/samples.json`, 'utf8')) as { clip: string; frame: number }[];
const count = config.strength.length;
assert.equal(runtime.count, 1);
mesh.skeleton.computeBoneTexture();
const mixer = new AnimationMixer(parsed.scene), point = new Vector3(), expected = new Vector3();
const rows = [];
for (const sample of samples) {
  mixer.stopAllAction();
  const clip = parsed.animations.find(clip => clip.name === sample.clip)!;
  const action = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1);
  action.clampWhenFinished = true; action.play(); mixer.setTime(sample.frame / 24);
  const start = performance.now(); runtime.update(); const elapsed = performance.now() - start;
  let error = 0;
  const offset = rows.length * count * 3;
  for (let i = 0; i < config.sourceVertexCount; i++) {
    const j = offset + config.vertexMap[i] * 3;
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
    expected.set(reference[j]!, reference[j + 2]!, -reference[j + 1]!);
    error = Math.max(error, point.distanceTo(expected));
  }
  rows.push({ ...sample, max_blender_difference: error, surface_update_ms: elapsed });
}
const times = rows.map(row => row.surface_update_ms).sort((a, b) => a - b);
const result = {
  samples: rows,
  maximum_blender_difference: Math.max(...rows.map(row => row.max_blender_difference)),
  surface_update_p95_ms: times[Math.floor(times.length * 0.95)],
  position_bound: 0.5 * 4200 / 900,
  position_bound_reference: '22-blender-mcp-corrective-cruise-rig.md: half pixel in 900px, 4200-unit close view',
};
writeFileSync(`${directory}/runtime-surface-audit.json`, JSON.stringify(result, null, 2));
runtime.dispose();
assert.ok(result.maximum_blender_difference < result.position_bound, 'Runtime surface differs from Blender');
console.log(JSON.stringify({ ...result, samples: rows.length }, null, 2));
