import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlb, encodeGlb } from './runtime_rig_contract.mjs';

export function decodeMeshoptGlb(bytes) {
  const { gltf, binary } = readGlb(bytes);
  const chunks = [];
  let offset = 0;
  for (const view of gltf.bufferViews) {
    const compressed = view.extensions?.EXT_meshopt_compression;
    let data;
    if (compressed) {
      assert.equal(compressed.buffer, 0, 'Only embedded GLB buffers are supported');
      data = Buffer.alloc(compressed.count * compressed.byteStride);
      MeshoptDecoder.decodeGltfBuffer(data, compressed.count, compressed.byteStride,
        binary.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
        compressed.mode, compressed.filter);
      delete view.extensions.EXT_meshopt_compression;
      if (!Object.keys(view.extensions).length) delete view.extensions;
    } else {
      assert.equal(view.buffer, 0, 'Only embedded GLB buffers are supported');
      data = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    }
    const padding = (4 - offset % 4) % 4;
    chunks.push(Buffer.alloc(padding), data);
    offset += padding;
    Object.assign(view, { buffer: 0, byteOffset: offset, byteLength: data.length });
    offset += data.length;
  }
  chunks.push(Buffer.alloc((4 - offset % 4) % 4));
  gltf.buffers = [{ byteLength: Math.ceil(offset / 4) * 4 }];
  for (const field of ['extensionsUsed', 'extensionsRequired']) {
    if (gltf[field]) gltf[field] = gltf[field].filter(name => name !== 'EXT_meshopt_compression');
  }
  return encodeGlb(gltf, Buffer.concat(chunks));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2] && process.argv[3], 'Pass input GLB and output import copy');
  assert.notEqual(resolve(process.argv[2]), resolve(process.argv[3]), 'Preserve original GLB');
  writeFileSync(process.argv[3], decodeMeshoptGlb(readFileSync(process.argv[2])));
}
