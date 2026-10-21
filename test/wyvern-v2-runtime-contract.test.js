import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateRuntimeRig, writeValidatedRuntimeRig, readGlb, encodeGlb } from "../tools/blender/runtime_rig_contract.mjs";

const assetPath = new URL("../public/models/wyvern-v2-rig.glb", import.meta.url);
const bytes = readFileSync(assetPath);

test("Final Flight Lab asset passes its own pinned runtime contract", () => {
  assert.equal(validateRuntimeRig(bytes).passed, true);
  assert.throws(() => validateRuntimeRig(readFileSync(new URL("../assets/blender/wyvern-gothic.glb", import.meta.url))));
});

test("Candidate gate rejects corruption before replacing destination", () => {
  const directory = mkdtempSync(join(tmpdir(), "v2-runtime-gate-"));
  const path = join(directory, "candidate.glb");
  try {
    writeFileSync(path, bytes);
    const { gltf, binary } = readGlb(bytes);
    gltf.skins.push(structuredClone(gltf.skins[0]));
    assert.throws(() => writeValidatedRuntimeRig(path, encodeGlb(gltf, binary)));
    assert.deepEqual(readFileSync(path), bytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Candidate bytes can be written but unpinned bytes cannot replace the shipped asset", () => {
  const directory = mkdtempSync(join(tmpdir(), "v2-promotion-gate-"));
  try {
    const path = join(directory, "candidate.glb");
    const { gltf, binary } = readGlb(bytes);
    gltf.asset.generator = "Unreviewed export";
    const candidate = encodeGlb(gltf, binary);
    assert.equal(writeValidatedRuntimeRig(path, candidate).passed, true);
    assert.deepEqual(readFileSync(path), candidate);
    assert.throws(() => writeValidatedRuntimeRig(assetPath.pathname, candidate), /fingerprint changed/);
    assert.deepEqual(readFileSync(assetPath), bytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
