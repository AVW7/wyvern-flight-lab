import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// ---------------------------------------------------------------------------
// The shipped asset and its authoring sources drift apart in two ways, and both
// have already happened in this repo:
//
//   1. A candidate GLB stops tracking the pinned runtime asset. Measured
//      2026-10-22: `wyvern-v2-idle-walk-flight-lab-candidate.glb` was still at
//      950c4321… (pre-C5) while `wyvern-v2-rig.glb` was at bef7a09a…. Nothing
//      failed; the desync was found by reading hashes by hand.
//   2. An authoring `.blend` lags the shipped GLB, so exporting it silently
//      reverts every GLB-level stage. `models/source/wyvern-v2-master.blend` is
//      stamped C1 against a post-C5 asset.
//
// The first is pinned by byte identity here; the second by the provenance gate
// (`python3 scripts/blender/cli.py check-provenance`, wired into `cmd_export`).
// ---------------------------------------------------------------------------

const repoRoot = new URL("..", import.meta.url);
const cliPath = new URL("../scripts/blender/cli.py", import.meta.url).pathname;
const manifestPath = new URL("../models/source/blend-provenance.json", import.meta.url).pathname;
const contractPath = new URL("../scripts/blender/wyvern_v2_runtime_contract.json", import.meta.url);

const shippedAsset = "public/models/wyvern-v2-rig.glb";
const candidateAssets = [
  "public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb",
  "public/models/wyvern-v2-membrane-lab-candidate.glb",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("every shipped candidate GLB is byte-identical to the pinned runtime asset", () => {
  const pinned = JSON.parse(readFileSync(contractPath, "utf8")).asset.sha256;
  const reference = readFileSync(new URL(`../${shippedAsset}`, import.meta.url));

  assert.equal(sha256(reference), pinned, `${shippedAsset} no longer matches the contract pin`);

  for (const relative of candidateAssets) {
    const bytes = readFileSync(new URL(`../${relative}`, import.meta.url));
    assert.equal(
      bytes.length,
      reference.length,
      `${relative} is ${bytes.length} B against the pinned ${reference.length} B — it was not synced`,
    );
    assert.equal(sha256(bytes), pinned, `${relative} drifted from ${shippedAsset} (${sha256(bytes).slice(0, 16)}…)`);
  }
});

test("the blend provenance gate passes on the current tree and refuses a stale stamp", () => {
  const clean = spawnSync("python3", [cliPath, "check-provenance", "--manifest", manifestPath], {
    cwd: repoRoot.pathname,
    encoding: "utf8",
  });
  assert.equal(clean.error, undefined, `could not run the gate: ${clean.error?.message}`);
  assert.equal(clean.status, 0, `provenance gate failed on a clean tree:\n${clean.stdout}${clean.stderr}`);
  assert.match(clean.stdout, /wyvern-v2-master\.blend\s+stage C6\s+NOT export-safe/);

  // Prove the gate can fail: a stamp that no longer matches its file must be an
  // error, not a warning. Without this the check is decoration.
  const directory = mkdtempSync(join(tmpdir(), "blend-provenance-"));
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.blends[0].sha256 = "0".repeat(64);
    const stale = join(directory, "stale.json");
    writeFileSync(stale, JSON.stringify(manifest));

    const refused = spawnSync("python3", [cliPath, "check-provenance", "--manifest", stale], {
      cwd: repoRoot.pathname,
      encoding: "utf8",
    });
    assert.equal(refused.status, 1, `a stale stamp must fail the gate, got exit ${refused.status}`);
    assert.match(refused.stdout, /changed since it was stamped/);
    assert.match(refused.stdout, /FAILED/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
