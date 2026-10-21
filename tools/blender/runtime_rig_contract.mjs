import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

await MeshoptDecoder.ready;
export const RUNTIME_PATH = fileURLToPath(new URL("../../public/models/wyvern-v2-rig.glb", import.meta.url));
export const CONTRACT_PATH = fileURLToPath(new URL("../../scripts/blender/wyvern_v2_runtime_contract.json", import.meta.url));
const SOURCE_CONTRACT = fileURLToPath(new URL("../../scripts/blender/wyvern_v2_rig_contract.json", import.meta.url));
const hash = data => createHash("sha256").update(data).digest("hex");

export function readGlb(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length, "GLB length mismatch");
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const offset = 20 + length;
  assert.equal(bytes.readUInt32LE(offset + 4), 0x004e4942);
  assert.equal(offset + 8 + bytes.readUInt32LE(offset), bytes.length);
  return { gltf: JSON.parse(bytes.toString("utf8", 20, offset)), binary: bytes.subarray(offset + 8) };
}

export function encodeGlb(gltf, binary) {
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const bytes = Buffer.alloc(28 + padded.length + binary.length);
  bytes.write("glTF");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(bytes, 20);
  bytes.writeUInt32LE(binary.length, 20 + padded.length);
  bytes.writeUInt32LE(0x004e4942, 24 + padded.length);
  binary.copy(bytes, 28 + padded.length);
  return bytes;
}

export function inspectRuntimeRig(bytes) {
  const { gltf: g, binary } = readGlb(bytes);
  const cache = new Map();
  function accessor(index) {
    const a = g.accessors[index];
    assert.ok(a && !a.sparse, "Missing or sparse rig accessor");
    const v = g.bufferViews[a.bufferView];
    const ext = v.extensions?.EXT_meshopt_compression;
    let data = binary;
    let offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (ext) {
      assert.equal(ext.buffer, 0);
      if (!cache.has(a.bufferView)) {
        const decoded = Buffer.alloc(ext.count * ext.byteStride);
        MeshoptDecoder.decodeGltfBuffer(decoded, ext.count, ext.byteStride,
          binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
        cache.set(a.bufferView, decoded);
      }
      data = cache.get(a.bufferView);
      offset = a.byteOffset ?? 0;
    } else assert.equal(v.buffer, 0);
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    assert.ok(components && size);
    const packed = Buffer.alloc(a.count * components * size);
    for (let i = 0; i < a.count; i++) {
      const start = offset + i * (v.byteStride ?? ext?.byteStride ?? components * size);
      assert.ok(start + components * size <= data.length, "Accessor exceeds buffer");
      data.copy(packed, i * components * size, start, start + components * size);
    }
    return { a, packed, components, size };
  }
  function values(index) {
    const { a, packed, components, size } = accessor(index);
    const reader = { 5120: "readInt8", 5121: "readUInt8", 5122: "readInt16LE", 5123: "readUInt16LE", 5125: "readUInt32LE", 5126: "readFloatLE" }[a.componentType];
    return Array.from({ length: a.count * components }, (_, i) => packed[reader](i * size));
  }
  function fingerprint(index) {
    const { a, packed } = accessor(index);
    return { type: a.type, componentType: a.componentType, normalized: a.normalized ?? false, count: a.count, sha256: hash(packed) };
  }
  assert.equal(g.skins?.length, 1, "Runtime requires one shared skin");
  assert.equal(g.scenes?.length, 1, "Runtime requires one scene; remove empty review scenes");
  assert.equal(g.scene, 0);
  const skin = g.skins[0];
  const joints = new Set(skin.joints);
  assert.equal(joints.size, 92);
  const parents = new Map();
  g.nodes.forEach((node, i) => (node.children ?? []).forEach(child => {
    assert.ok(g.nodes[child] && !parents.has(child), "Invalid or multiply parented node");
    parents.set(child, i);
  }));
  for (let i = 0; i < g.nodes.length; i++) {
    let current = i;
    const seen = new Set();
    while (parents.has(current)) {
      assert.ok(!seen.has(current), "Node hierarchy cycle");
      seen.add(current);
      current = parents.get(current);
    }
  }
  const boneNames = skin.joints.map(i => g.nodes[i]?.name);
  assert.equal(new Set(boneNames).size, 92);
  assert.ok(boneNames.every(Boolean));
  const bones = skin.joints.map(i => ({
    name: g.nodes[i].name,
    parent: joints.has(parents.get(i)) ? g.nodes[parents.get(i)].name : null,
  }));
  const source = JSON.parse(readFileSync(SOURCE_CONTRACT, "utf8"));
  assert.deepEqual(bones, source.bones.map(({ name, parent }) => ({ name, parent })), "Runtime bone ABI differs from Gothic source");
  assert.equal(skin.name, "WyvernRig");
  assert.ok(g.scenes[0].nodes.some(i => g.nodes[i].name === "WyvernRig"));
  assert.equal(g.meshes.length, 2);
  assert.deepEqual(g.nodes.filter(n => n.skin !== undefined).map(n => n.skin), [0, 0]);
  assert.equal(g.accessors[skin.inverseBindMatrices].type, "MAT4");
  assert.equal(g.accessors[skin.inverseBindMatrices].count, 92);
  assert.ok(values(skin.inverseBindMatrices).every(Number.isFinite), "Nonfinite bind matrix");
  const meshes = g.meshes.map((mesh, mi) => ({
    name: mesh.name,
    nodes: g.nodes.filter(n => n.mesh === mi).map(n => ({ name: n.name, skin: n.skin })),
    primitives: mesh.primitives.map(p => {
      assert.ok(!p.targets, "Unexpected runtime morph targets");
      assert.ok(!("JOINTS_1" in p.attributes), "Only four skin influences supported");
      assert.ok(values(p.attributes.POSITION).every(Number.isFinite));
      assert.ok(values(p.attributes.JOINTS_0).every(j => j >= 0 && j < 92), "Invalid skin joint index");
      const weights = values(p.attributes.WEIGHTS_0);
      const wa = g.accessors[p.attributes.WEIGHTS_0];
      assert.equal(g.accessors[p.attributes.JOINTS_0].count, g.accessors[p.attributes.POSITION].count);
      assert.equal(wa.count, g.accessors[p.attributes.POSITION].count);
      assert.equal(wa.type, "VEC4");
      assert.ok(weights.every(w => Number.isFinite(w) && w >= 0));
      const unit = wa.normalized ? ({ 5121: 255, 5123: 65535 }[wa.componentType]) : 1;
      assert.ok(unit, "Unsupported weight representation");
      for (let i = 0; i < weights.length; i += 4) {
        const sum = weights.slice(i, i + 4).reduce((a, b) => a + b, 0);
        const rounding = wa.normalized ? 4 : 4 * 2 ** -23;
        assert.ok(sum > 0 && Math.abs(sum - unit) <= rounding, "Unweighted or non-unit skin vertex");
      }
      return { mode: p.mode ?? 4, material: p.material,
        indices: fingerprint(p.indices),
        attributes: Object.fromEntries(Object.entries(p.attributes).sort().map(([key, i]) => [key, fingerprint(i)])) };
    }),
  }));
  assert.deepEqual(g.animations.map(a => a.name).sort(), source.clips, "Canonical clip inventory changed");
  const clips = g.animations.map(a => {
    const usedSamplers = new Set(a.channels.map(c => c.sampler));
    assert.equal(a.samplers.length, usedSamplers.size,
      `Animation '${a.name}' has ${a.samplers.length - usedSamplers.size} orphaned samplers`);
    const targets = new Set();
    for (const c of a.channels) {
      assert.ok(joints.has(c.target.node), "Animation target outside skin");
      assert.ok(["rotation", "translation", "scale"].includes(c.target.path));
      const target = `${g.nodes[c.target.node].name}:${c.target.path}`;
      assert.ok(!targets.has(target), "Duplicate animation target");
      targets.add(target);
      const sampler = a.samplers[c.sampler];
      const input = g.accessors[sampler.input];
      const output = g.accessors[sampler.output];
      assert.equal(input.type, "SCALAR");
      assert.equal(input.componentType, 5126);
      assert.ok(["LINEAR", "STEP", "CUBICSPLINE"].includes(sampler.interpolation ?? "LINEAR"));
      assert.equal(output.type, c.target.path === "rotation" ? "VEC4" : "VEC3");
      assert.equal(output.count, input.count * (sampler.interpolation === "CUBICSPLINE" ? 3 : 1), "Animation key counts differ");
      const times = values(sampler.input);
      assert.equal(times[0], 0, "Animation must begin at time zero");
      assert.ok(times.every((t, i) => Number.isFinite(t) && (!i || t > times[i - 1])), "Invalid animation key times");
      assert.ok(values(sampler.output).every(Number.isFinite), "Nonfinite animation keys");
    }
    return { name: a.name, targets: [...targets].sort() };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return JSON.parse(JSON.stringify({
    nodes: g.nodes.map(n => ({ name: n.name, children: n.children ?? [], mesh: n.mesh, skin: n.skin,
      matrix: n.matrix, translation: n.translation ?? [0, 0, 0], rotation: n.rotation ?? [0, 0, 0, 1], scale: n.scale ?? [1, 1, 1] })),
    roots: g.scenes[0].nodes, bones, skinName: skin.name, skeleton: skin.skeleton,
    bindMatrices: fingerprint(skin.inverseBindMatrices), meshes, clips,
    materials: g.materials, textures: g.textures, samplers: g.samplers,
    images: g.images.map(image => {
      const v = g.bufferViews[image.bufferView];
      assert.equal(v.buffer, 0);
      return { name: image.name, mimeType: image.mimeType, sha256: hash(binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)) };
    }),
    extensionsUsed: g.extensionsUsed, extensionsRequired: g.extensionsRequired,
  }));
}

export function validateRuntimeRig(bytes, { checkHash = true, contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) } = {}) {
  assert.equal(contract.contractVersion, 1);
  const signature = inspectRuntimeRig(bytes);
  assert.deepEqual(signature, contract.signature, "Runtime rig/mesh/bind/material/clip contract drift");
  if (checkHash) {
    assert.equal(hash(bytes), contract.asset.sha256, "Runtime asset fingerprint changed; record reviewed candidate explicitly");
    assert.equal(bytes.length, contract.asset.bytes, "Pinned runtime byte count is stale");
  }
  return { passed: true, sha256: hash(bytes), bytes: bytes.length, joints: signature.bones.length, clips: signature.clips.length };
}

export function writeValidatedRuntimeRig(path, bytes) {
  const report = validateRuntimeRig(bytes, { checkHash: resolve(path) === RUNTIME_PATH });
  const temporary = `${path}.rig-candidate.tmp`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2] ?? RUNTIME_PATH;
  console.log(JSON.stringify(validateRuntimeRig(readFileSync(path), { checkHash: !process.argv.includes("--candidate") }), null, 2));
}
