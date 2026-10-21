import { RUNTIME_PATH, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Matrix4, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export function validateSharedV2Skin(gltf) {
  assert.equal(gltf.skins.length, 1, "V2 body and membrane must share the single Gothic export rig");
  assert.equal(gltf.skins[0].joints.length, 92);
  assert.deepEqual(gltf.nodes.filter(node => node.skin !== undefined).map(node => node.skin), [0, 0]);
}

export async function deduplicateSkins(inputPath, outputPath = inputPath) {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(inputPath);
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const binaryChunk = bytes.subarray(20 + jsonLength);
  const binary = binaryChunk.subarray(8);
  if (gltf.skins.length === 1) return { before: 1, after: 1 };
  assert.equal(gltf.skins.length, 2);
  const [body, membrane] = gltf.skins;
  assert.deepEqual(body.joints, membrane.joints);
  assert.equal(body.skeleton, membrane.skeleton);
  const decoded = new Map();
  function readAccessor(index, components) {
    const accessor = gltf.accessors[index];
    assert.ok([5126, 5122].includes(accessor.componentType));
    assert.ok(!accessor.sparse);
    const elementBytes = accessor.componentType === 5126 ? 4 : 2;
    const view = gltf.bufferViews[accessor.bufferView];
    const compressed = view.extensions?.EXT_meshopt_compression;
    let data = binary;
    let offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    if (compressed) {
      assert.equal(compressed.buffer, 0);
      if (!decoded.has(accessor.bufferView)) {
        const output = Buffer.alloc(compressed.count * compressed.byteStride);
        MeshoptDecoder.decodeGltfBuffer(output, compressed.count, compressed.byteStride,
          binary.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
          compressed.mode, compressed.filter);
        decoded.set(accessor.bufferView, output);
      }
      data = decoded.get(accessor.bufferView);
      offset = accessor.byteOffset ?? 0;
    } else assert.equal(view.buffer, 0);
    return Array.from({ length: accessor.count }, (_, i) =>
      Array.from({ length: components }, (_, k) =>
        (() => {
          const address = offset + i * (view.byteStride ?? compressed?.byteStride ?? components * elementBytes) + k * elementBytes;
          if (accessor.componentType === 5126) return data.readFloatLE(address);
          const value = data.readInt16LE(address);
          return accessor.normalized ? Math.max(-1, value / 32767) : value;
        })()));
  }
  const bodyMatrices = readAccessor(body.inverseBindMatrices, 16);
  const membraneMatrices = readAccessor(membrane.inverseBindMatrices, 16);
  assert.equal(bodyMatrices.length, body.joints.length);
  assert.equal(membraneMatrices.length, body.joints.length);
  const correction = new Matrix4().fromArray(bodyMatrices[0]).invert()
    .multiply(new Matrix4().fromArray(membraneMatrices[0]));
  // Float32 export rounding, bounded relative to the measured matrix magnitude.
  const precisionBound = 32 * 2 ** -23;
  for (let i = 0; i < bodyMatrices.length; i++) {
    const expected = new Matrix4().fromArray(bodyMatrices[i]).multiply(correction).elements;
    const scale = Math.max(1, ...membraneMatrices[i].map(Math.abs));
    for (let k = 0; k < 16; k++) {
      assert.ok(Math.abs(expected[k] - membraneMatrices[i][k]) <= precisionBound * scale,
        `Joint ${i} has a different bind pose`);
    }
  }
  const e = correction.elements;
  const scale = e[0];
  assert.ok(scale > 0);
  for (let k = 0; k < 12; k++) {
    const expected = [0, 5, 10].includes(k) ? scale : 0;
    assert.ok(Math.abs(e[k] - expected) <= precisionBound * scale,
      "Only uniform scale and translation normalization is supported");
  }
  const chunks = [binary];
  let binaryLength = binary.length;
  const positions = new Map();
  for (const node of gltf.nodes.filter(node => node.skin === 1)) {
    const mesh = gltf.meshes[node.mesh];
    assert.ok(!gltf.nodes.some(other => other !== node && other.mesh === node.mesh && other.skin !== 1));
    for (const primitive of mesh.primitives) {
      assert.ok(!primitive.targets, "Morph targets require separate normalization");
      const index = primitive.attributes.POSITION;
      if (!positions.has(index)) {
        const source = readAccessor(index, 3);
        const data = Buffer.alloc(source.length * 12);
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        source.forEach((position, i) => {
          const transformed = new Vector3().fromArray(position).applyMatrix4(correction).toArray();
          transformed.forEach((value, k) => {
            data.writeFloatLE(value, i * 12 + k * 4);
            const rounded = data.readFloatLE(i * 12 + k * 4);
            min[k] = Math.min(min[k], rounded);
            max[k] = Math.max(max[k], rounded);
          });
        });
        const view = gltf.bufferViews.length;
        gltf.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: data.length });
        const accessor = gltf.accessors.length;
        gltf.accessors.push({ componentType: 5126, type: "VEC3", count: source.length, bufferView: view, min, max });
        positions.set(index, accessor);
        chunks.push(data);
        binaryLength += data.length;
      }
      primitive.attributes.POSITION = positions.get(index);
    }
    node.skin = 0;
  }
  gltf.skins = [body];
  validateSharedV2Skin(gltf);
  gltf.buffers[0].byteLength = binaryLength;
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const header = Buffer.from(bytes.subarray(0, 20));
  header.writeUInt32LE(28 + padded.length + binaryLength, 8);
  header.writeUInt32LE(padded.length, 12);
  const binHeader = Buffer.from(binaryChunk.subarray(0, 8));
  binHeader.writeUInt32LE(binaryLength, 0);
  const output = Buffer.concat([header, padded, binHeader, ...chunks]);
  if (resolve(outputPath) === RUNTIME_PATH) writeValidatedRuntimeRig(outputPath, output);
  else writeFileSync(outputPath, output);
  return { before: 2, after: 1, correction: correction.elements };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await deduplicateSkins(process.argv[2], process.argv[3]));
}
