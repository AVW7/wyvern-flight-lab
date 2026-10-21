import { RUNTIME_PATH } from "./runtime_rig_contract.mjs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { compactGlb } from "./compact_v2_glb.mjs";

const INPUT_GLB = "public/models/wyvern-v2-rig.glb";
const TARGET_GLB = process.argv[2] ?? "/tmp/wyvern-v2-jaw-closure-candidate.glb";
assert.notEqual(resolve(TARGET_GLB), RUNTIME_PATH, "Jaw geometry studies must not overwrite the runtime asset");
const REF_PATH = "/tmp/drogon_jaw_reference.json";

// We require meshoptimizer from the npx cache or local environment
const meshoptPath = "/Users/ajadvanwyk/.npm/_npx/a6797f7ff67bb1f2/node_modules/meshoptimizer/meshopt_decoder.mjs";
const meshoptEncPath = "/Users/ajadvanwyk/.npm/_npx/a6797f7ff67bb1f2/node_modules/meshoptimizer/meshopt_encoder.js";

const { MeshoptDecoder } = await import(meshoptPath);
const { MeshoptEncoder } = await import(meshoptEncPath);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

console.log("Meshopt codecs ready.");

const refData = JSON.parse(readFileSync(REF_PATH, "utf8"));
const refVerts = refData.vertices;
const pivot = refData.pivot; // [0.0021, -917.5795, 634.1551]

const glbBytes = readFileSync(INPUT_GLB);
assert.equal(glbBytes.toString("ascii", 0, 4), "glTF");
const jsonLength = glbBytes.readUInt32LE(12);
const gltf = JSON.parse(glbBytes.toString("utf8", 20, 20 + jsonLength));
const binaryChunkOffset = 20 + jsonLength;
const binaryLength = glbBytes.readUInt32LE(binaryChunkOffset);
const binary = glbBytes.subarray(binaryChunkOffset + 8, binaryChunkOffset + 8 + binaryLength);

// Primitive 1: head mesh
const prim = gltf.meshes[0].primitives[1];
const posAccIndex = prim.attributes.POSITION;
const posAcc = gltf.accessors[posAccIndex];
assert.equal(posAcc.count, 9984);
assert.equal(posAcc.componentType, 5122); // INT16
assert.equal(posAcc.normalized, true);

const bvIndex = posAcc.bufferView;
const bv = gltf.bufferViews[bvIndex];
const ext = bv.extensions.EXT_meshopt_compression;
assert.ok(ext, "bufferView must be meshopt compressed");
assert.equal(ext.count, 9984);
assert.equal(ext.byteStride, 8);

// Decode INT16 vertex positions
const decodedBytes = new Uint8Array(ext.count * ext.byteStride);
MeshoptDecoder.decodeGltfBuffer(
  decodedBytes,
  ext.count,
  ext.byteStride,
  binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength),
  ext.mode,
  ext.filter
);
const vInt16 = new Int16Array(decodedBytes.buffer, decodedBytes.byteOffset, decodedBytes.byteLength / 2);

// Affine transform parameters derived from canonical model bounds
const sx = 2276 / 151.99;
const ox = 0.0;
const sy = (4960 - (-788)) / (862.00 - 478.39);
const oy = -788 - sy * 478.39;
const sz = (32767 - 27235) / (1145.60 - 775.77);
const oz = 27235 - sz * 775.77;

const PIVOT_X = pivot[0];
const PIVOT_Y = pivot[1];
const PIVOT_Z = pivot[2];

const DEGREES = -14.0;
const BASE_RAD = (DEGREES * Math.PI) / 180.0;

let deformedCount = 0;
let minX = Infinity, maxX = -Infinity;
let minY = Infinity, maxY = -Infinity;
let minZ = Infinity, maxZ = -Infinity;

for (let i = 0; i < ext.count; i++) {
  const vx = vInt16[i * 4 + 0];
  const vy = vInt16[i * 4 + 1];
  const vz = vInt16[i * 4 + 2];

  // Invert affine transform to get coordinates in reference (Drogon) space
  const ex = (vx - ox) / sx;
  const ez = (vy - oy) / sy;
  const ey = -((vz - oz) / sz);

  // Find nearest vertex in refVerts
  let minD = Infinity;
  let bestRef = null;
  for (const rv of refVerts) {
    const d = Math.hypot(ex - rv.x, ey - rv.y, ez - rv.z);
    if (d < minD) {
      minD = d;
      bestRef = rv;
    }
  }

  let finalX = vx;
  let finalY = vy;
  let finalZ = vz;

  if (minD < 5.0 && ey < -700.0 && bestRef.w > 0.0) {
    deformedCount++;
    const rad = BASE_RAD * bestRef.w;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    // Rotate (ex, ey, ez) around (PIVOT_X, PIVOT_Y, PIVOT_Z) along X-axis
    // In Blender space: X is unchanged, Y and Z rotate:
    // y_rel = ey - PIVOT_Y
    // z_rel = ez - PIVOT_Z
    // y_new = PIVOT_Y + y_rel * cosR - z_rel * sinR
    // z_new = PIVOT_Z + y_rel * sinR + z_rel * cosR
    const dy = ey - PIVOT_Y;
    const dz = ez - PIVOT_Z;
    const newEy = PIVOT_Y + dy * cosR - dz * sinR;
    const newEz = PIVOT_Z + dy * sinR + dz * cosR;
    const newEx = ex;

    // Convert back to vInt16
    finalX = Math.round(sx * newEx + ox);
    finalY = Math.round(sy * newEz + oy);
    finalZ = Math.round(sz * (-newEy) + oz);
  }

  vInt16[i * 4 + 0] = finalX;
  vInt16[i * 4 + 1] = finalY;
  vInt16[i * 4 + 2] = finalZ;
  vInt16[i * 4 + 3] = 0;

  if (finalX < minX) minX = finalX; if (finalX > maxX) maxX = finalX;
  if (finalY < minY) minY = finalY; if (finalY > maxY) maxY = finalY;
  if (finalZ < minZ) minZ = finalZ; if (finalZ > maxZ) maxZ = finalZ;
}

console.log(`Deformed ${deformedCount} lower jaw vertices.`);
console.log(`Updated bounds: X [${minX}, ${maxX}], Y [${minY}, ${maxY}], Z [${minZ}, ${maxZ}]`);

posAcc.min = [minX, minY, minZ];
posAcc.max = [maxX, maxY, maxZ];

// Re-encode bufferView with MeshoptEncoder
const compressedNew = MeshoptEncoder.encodeGltfBuffer(
  decodedBytes,
  ext.count,
  ext.byteStride,
  ext.mode,
  ext.filter
);
console.log(`Re-encoded bufferView ${bvIndex}: original ${ext.byteLength} B -> new ${compressedNew.byteLength} B`);

// Replace compressed slice in binary
// To avoid disturbing byte offsets of subsequent views, we create a new binary buffer
const chunks = [];
let binOffset = 0;
for (let bvi = 0; bvi < gltf.bufferViews.length; bvi++) {
  const curBv = gltf.bufferViews[bvi];
  const curExt = curBv.extensions?.EXT_meshopt_compression;
  const pad = (4 - (binOffset % 4)) % 4;
  if (pad > 0) {
    chunks.push(Buffer.alloc(pad));
    binOffset += pad;
  }
  if (bvi === bvIndex) {
    curExt.byteOffset = binOffset;
    curExt.byteLength = compressedNew.byteLength;
    chunks.push(compressedNew);
    binOffset += compressedNew.byteLength;
  } else if (curExt) {
    const slice = binary.subarray(curExt.byteOffset, curExt.byteOffset + curExt.byteLength);
    curExt.byteOffset = binOffset;
    chunks.push(slice);
    binOffset += slice.length;
  } else {
    const slice = binary.subarray(curBv.byteOffset ?? 0, (curBv.byteOffset ?? 0) + curBv.byteLength);
    curBv.byteOffset = binOffset;
    chunks.push(slice);
    binOffset += slice.length;
  }
}

gltf.buffers[0].byteLength = binOffset;
const jsonText = JSON.stringify(gltf);
const jsonBuffer = Buffer.from(jsonText, "utf8");
const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
const paddedJson = jsonPadding ? Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)]) : jsonBuffer;

const binaryPadding = (4 - (binOffset % 4)) % 4;
if (binaryPadding > 0) {
  chunks.push(Buffer.alloc(binaryPadding));
  binOffset += binaryPadding;
  gltf.buffers[0].byteLength = binOffset;
}

const totalLength = 12 + 8 + paddedJson.length + 8 + binOffset;
const header = Buffer.alloc(12);
header.write("glTF", 0, 4, "ascii");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(paddedJson.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);

const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binOffset, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);

const outputBytes = Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, ...chunks]);
assert.equal(outputBytes.length, totalLength);

writeFileSync(TARGET_GLB, outputBytes);
console.log(`Saved preliminary modified GLB (${outputBytes.length} B)`);

// Compact GLB to ensure optimal byte packing
compactGlb(TARGET_GLB);
console.log("Successfully applied jaw closure to V2 rig!");
