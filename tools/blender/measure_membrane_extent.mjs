// Measure the exact quantity `test/wyvern-v2-kinetics.test.js` gates on: the maximum skinned
// membrane X at t = 1.0s of `cruise`. Reads the same way the test does (GLTFLoader + meshopt,
// per-vertex CPU skinning through skeleton.boneMatrices) so the number is comparable.
//
// Usage: node tools/blender/measure_membrane_extent.mjs [glb]
import { readFileSync } from "node:fs";
import { AnimationMixer, Matrix4, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const path = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const bytes = readFileSync(path);
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
for (const mesh of json.meshes ?? []) for (const p of mesh.primitives ?? []) delete p.material;
delete json.materials; delete json.images; delete json.textures;
const encoded = Buffer.from(JSON.stringify(json));
const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
encoded.copy(padded);
const binary = bytes.subarray(20 + jsonLength);
const output = Buffer.alloc(20 + padded.length + binary.length);
bytes.copy(output, 0, 0, 20);
output.writeUInt32LE(output.length, 8);
output.writeUInt32LE(padded.length, 12);
padded.copy(output, 20);
binary.copy(output, 20 + padded.length);

const { scene, animations } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength), "");

let membrane = null;
scene.traverse(o => { if (o.isSkinnedMesh && o.name.includes("Membrane")) membrane = o; });
if (!membrane) throw new Error("no membrane skinned mesh");
let tip = null;
scene.traverse(o => { if (o.isBone && o.name === "L_WingD0P2") tip = o; });

const measure = clipName => {
  const clip = animations.find(a => a.name === clipName);
  if (!clip) throw new Error(`no clip ${clipName}`);
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(clip).play();
  mixer.setTime(1.0);
  scene.updateMatrixWorld(true);
  membrane.skeleton.update();
  const geom = membrane.geometry;
  const pos = geom.attributes.position;
  const si = geom.attributes.skinIndex;
  const sw = geom.attributes.skinWeight;
  const bm = membrane.skeleton.boneMatrices;
  let maxX = -Infinity;
  const v = new Vector3(), acc = new Vector3(), tmp = new Vector3(), bMat = new Matrix4();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > 0) {
        bMat.fromArray(bm, si.getComponent(i, k) * 16);
        acc.add(tmp.copy(v).applyMatrix4(bMat).multiplyScalar(w));
      }
    }
    acc.applyMatrix4(membrane.matrixWorld);
    if (acc.x > maxX) maxX = acc.x;
  }
  const tipPos = new Vector3();
  tip.getWorldPosition(tipPos);
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  return { maxMembraneX: Number(maxX.toFixed(1)), wingTipX: Number(tipPos.x.toFixed(1)), gate2500: maxX > 2500, reachesTip: maxX >= tipPos.x };
};

console.log(JSON.stringify({ path, cruise: measure("cruise") }, null, 2));
