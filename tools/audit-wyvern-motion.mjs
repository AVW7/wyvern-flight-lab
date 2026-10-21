import { RUNTIME_PATH, validateRuntimeRig } from "./blender/runtime_rig_contract.mjs";
import { resolve } from "node:path";
import { readFileSync } from 'node:fs';
import { AnimationMixer, LoopOnce, Quaternion } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

if (process.argv.length < 3) throw new Error('Pass one or more GLB paths.');

for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path);
  if (resolve(path) === RUNTIME_PATH) validateRuntimeRig(bytes);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) delete p.material;
  delete json.materials; delete json.images; delete json.textures;
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
  encoded.copy(padded);
  const binary = bytes.subarray(20 + length);
  const output = Buffer.alloc(20 + padded.length + binary.length);
  bytes.copy(output, 0, 0, 20);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  padded.copy(output, 20); binary.copy(output, 20 + padded.length);
  const { scene, animations } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength), '');
  const bones = [];
  scene.traverse(o => { if (o.isBone) bones.push(o); });
  const results = [];
  for (const clip of animations.filter(a => /walk|cruise|bank/i.test(a.name) || animations.length === 1)) {
    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true; action.play();
    let previous, first;
    const peak = { degrees: 0, bone: '', seconds: 0 };
    const steps = Math.ceil(clip.duration * 96);
    for (let k = 0; k <= steps; k++) {
      const time = clip.duration * k / steps;
      mixer.setTime(time); scene.updateMatrixWorld(true);
      const pose = bones.map(b => b.getWorldQuaternion(new Quaternion()));
      first ??= pose;
      if (previous) pose.forEach((q, i) => {
        const degrees = q.angleTo(previous[i]) * 180 / Math.PI;
        if (degrees > peak.degrees) Object.assign(peak, { degrees, bone: bones[i].name, seconds: time });
      });
      previous = pose;
    }
    const seamDegrees = Math.max(...previous.map((q, i) => q.angleTo(first[i]) * 180 / Math.PI));
    const seamBone = bones[previous.findIndex((q, i) => q.angleTo(first[i]) * 180 / Math.PI === seamDegrees)]?.name;
    results.push({ seamBone, clip: clip.name, duration: clip.duration, samples: steps + 1, peak, seamDegrees });
    mixer.stopAllAction(); mixer.uncacheRoot(scene);
  }
  if (!results.length) throw new Error(`No walk/cruise/bank clip found in ${path}`);
  console.log(JSON.stringify({ path, skins: json.skins?.length, bones: bones.length, results }, null, 2));
}
