#!/usr/bin/env node
import { writeValidatedRuntimeRig, validateRuntimeRig } from "./runtime_rig_contract.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const INPUT_GLB = "public/models/wyvern-v2-rig.glb";
const TARGET_GLB = process.argv[2] ?? "/tmp/wyvern-v2-harvested-candidate.glb";

export function validateHarvestProvenance(manifest, clipName, base, donor) {
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  assert.equal(manifest.clip, clipName, "Harvest manifest clip mismatch");
  assert.equal(manifest.output_sha256, hash(donor), "Harvest donor hash mismatch");
  assert.equal(manifest.source_sha256?.v2, hash(base), "Harvest base hash mismatch");
  assert.match(manifest.source_sha256?.v1 ?? "", /^[a-f0-9]{64}$/, "Missing V1 source hash");
  assert.ok(manifest.pairs?.length > 0, "Missing verified bone mapping");
  const targets = manifest.pairs.map(pair => pair.target);
  assert.equal(new Set(targets).size, targets.length, "Duplicate target mapping");
  const sources = manifest.pairs.map(pair => pair.source);
  assert.equal(new Set(sources).size, sources.length, "Duplicate donor mapping");
  for (const pair of manifest.pairs) {
    assert.match(pair.target, /^[LR]_Wing(?:Shoulder|Elbow|Wrist|Hand|D[0-4]P[0-2])$/,
      "Harvest may only replace measured wing rotations");
    assert.ok(Number.isFinite(pair.residual_rig_units) && pair.residual_rig_units >= 0 && pair.residual_rig_units <= 1,
      "Mapping outside documented 1 rig-unit bound");
  }
  const transferred = manifest.transferred_bones ?? targets;
  assert.ok(transferred.length > 0, "No transferred wing bones");
  assert.equal(new Set(transferred).size, transferred.length, "Duplicate transferred wing bone");
  assert.ok(transferred.every(name => targets.includes(name)), "Unverified transferred wing bone");
  return transferred;
}

function readGlb(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString("ascii", 0, 4), "glTF", `${path} is not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const binaryOffset = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(binaryOffset + 4), 0x004e4942, `${path} has no binary chunk`);
  const binaryLength = bytes.readUInt32LE(binaryOffset);
  return { bytes, json, binary: bytes.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength) };
}

export function packageHarvestedCandidate(targetPath = TARGET_GLB, donorMap = {}) {
  assert.ok(Object.keys(donorMap).length > 0, "Harvest packaging requires at least one donor");
  for (const [clipName, donorPath] of Object.entries(donorMap)) {
    assert.ok(existsSync(donorPath), `Donor for ${clipName} does not exist: ${donorPath}`);
  }
  const base = readGlb(INPUT_GLB);
  validateRuntimeRig(base.bytes, { checkHash: false });
  assert.equal(base.json.skins?.length, 1, "Base must preserve single shared skin invariant");
  assert.equal(base.json.skins[0].joints?.length, 92, "Base must preserve exactly 92 canonical joints");

  const nodeByName = new Map(base.json.nodes.map((node, index) => [node.name, index]));
  const chunks = [base.binary];
  let binaryLength = base.binary.length;

  for (const [clipName, donorPath] of Object.entries(donorMap)) {
    const donor = readGlb(donorPath);
    const manifest = JSON.parse(readFileSync(donorPath.replace(/\.glb$/i, ".harvest.json"), "utf8"));
    const transferredBones = new Set(validateHarvestProvenance(manifest, clipName, base.bytes, donor.bytes));
    assert.equal(donor.json.animations?.length, 1, `Donor ${donorPath} must contain exactly 1 action`);
    const sourceAnimation = donor.json.animations[0];
    const targetIndex = base.json.animations.findIndex(a => a.name === clipName);
    assert.ok(targetIndex >= 0, `Base rig has no '${clipName}' animation`);

    const copiedViews = new Map();
    const copiedAccessors = new Map();

    function copyAccessor(index) {
      if (copiedAccessors.has(index)) return copiedAccessors.get(index);
      const accessor = donor.json.accessors[index];
      assert.ok(!accessor.sparse, "Sparse donor accessors are unsupported");
      const sourceView = donor.json.bufferViews[accessor.bufferView];
      assert.ok(!sourceView.extensions, "Decode compressed donor accessors before packaging");
      assert.equal(sourceView.buffer, 0, "Donor uses unexpected buffer");

      if (!copiedViews.has(accessor.bufferView)) {
        const padding = (4 - (binaryLength % 4)) % 4;
        if (padding) {
          chunks.push(Buffer.alloc(padding));
          binaryLength += padding;
        }
        const nextView = base.json.bufferViews.length;
        copiedViews.set(accessor.bufferView, nextView);
        base.json.bufferViews.push({ ...sourceView, byteOffset: binaryLength });
        chunks.push(donor.binary.subarray(sourceView.byteOffset ?? 0, (sourceView.byteOffset ?? 0) + sourceView.byteLength));
        binaryLength += sourceView.byteLength;
      }

      const nextAccessor = base.json.accessors.length;
      base.json.accessors.push({ ...accessor, bufferView: copiedViews.get(accessor.bufferView) });
      copiedAccessors.set(index, nextAccessor);
      return nextAccessor;
    }

    const selectedChannels = sourceAnimation.channels.filter(channel =>
      channel.target.path === "rotation" && transferredBones.has(donor.json.nodes[channel.target.node].name));
    assert.equal(selectedChannels.length, transferredBones.size, "Missing or duplicate harvested rotation channel");
    assert.equal(new Set(selectedChannels.map(channel => channel.target.node)).size, transferredBones.size,
      "Duplicate harvested rotation channel");
    const existing = base.json.animations[targetIndex];
    const samplers = [...existing.samplers];
    const channels = selectedChannels.map(channel => {
      const donorNode = donor.json.nodes[channel.target.node];
      const targetNode = nodeByName.get(donorNode.name);
      assert.notEqual(targetNode, undefined, `Unmapped donor node ${donorNode.name}`);
      const sampler = sourceAnimation.samplers[channel.sampler];
      const samplerIndex = samplers.length;
      samplers.push({ ...sampler, input: copyAccessor(sampler.input), output: copyAccessor(sampler.output) });
      return { ...channel, sampler: samplerIndex, target: { ...channel.target, node: targetNode } };
    });

    base.json.animations[targetIndex] = {
      name: clipName,
      channels: [...existing.channels.filter(channel => !(channel.target.path === "rotation" &&
        transferredBones.has(base.json.nodes[channel.target.node].name))), ...channels],
      samplers,
    };
    console.log(`[PACKAGE] Spliced harvested '${clipName}' (${channels.length} channels)`);
  }

  // Enforce single skin pointer on all meshes
  assert.equal(base.json.skins.length, 1);
  for (const node of base.json.nodes) {
    if (node.skin !== undefined) {
      node.skin = 0;
    }
  }

  base.json.buffers[0].byteLength = binaryLength;
  const jsonText = JSON.stringify(base.json);
  const jsonBuffer = Buffer.from(jsonText, "utf8");
  const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
  const paddedJson = jsonPadding ? Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)]) : jsonBuffer;

  const binaryPadding = (4 - (binaryLength % 4)) % 4;
  if (binaryPadding) {
    chunks.push(Buffer.alloc(binaryPadding));
    binaryLength += binaryPadding;
  }
  const binaryBuffer = Buffer.concat(chunks, binaryLength);

  const header = Buffer.alloc(12);
  header.write("glTF", 0, 4, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + binaryBuffer.length, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(paddedJson.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binaryBuffer.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);

  const packaged = Buffer.concat([header, jsonChunkHeader, paddedJson, binChunkHeader, binaryBuffer]);
  writeValidatedRuntimeRig(targetPath, packaged, { allowCandidate: true });
  console.log(`[PACKAGE] Validated candidate written to ${targetPath}`);
  return targetPath;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const donorMap = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : {};
  packageHarvestedCandidate(TARGET_GLB, donorMap);
}
