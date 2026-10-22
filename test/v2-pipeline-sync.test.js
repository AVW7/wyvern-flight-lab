import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PIPELINE_STAGES, STAGE0 } from "../tools/blender/sync_v2_pipeline.mjs";

// ---------------------------------------------------------------------------
// BG-1 (safe half). The shipped GLB is rebuilt from a pinned snapshot by
// tools/blender/sync_v2_pipeline.mjs. This file pins the *specification* — the
// stage-0 anchor, the stage order, and the hash each stage must reproduce —
// so a table edit or a removed CLI flag fails here instead of in a rebuild
// that only fails when somebody happens to run it.
//
// The behaviour itself is proven by the run recorded in
// assets/rig-audits/2026-10-22-bg1-sync/sync-report.json: every stage
// reproduced its historical sha256 and the chain ended on the shipped pin.
// ---------------------------------------------------------------------------

const repoRoot = new URL("..", import.meta.url);
const contract = JSON.parse(readFileSync(new URL("scripts/blender/wyvern_v2_runtime_contract.json", repoRoot), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("package.json", repoRoot), "utf8"));

const HEX64 = /^[0-9a-f]{64}$/;

/** The checks a stage table must satisfy. Exported shape: throws with a reason. */
function checkTable(stages, stage0) {
  assert.ok(Array.isArray(stages) && stages.length > 0, "the pipeline lists no stages");

  const ids = stages.map((stage) => stage.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate stage ids: ${ids.join(", ")}`);

  for (const stage of stages) {
    assert.ok(stage.tool, `${stage.id}: no tool`);
    assert.ok(
      existsSync(new URL(stage.tool, repoRoot)),
      `${stage.id}: tool ${stage.tool} does not exist`,
    );
    assert.match(stage.expect, HEX64, `${stage.id}: expect is not a sha256`);
    assert.ok(Array.isArray(stage.steps) && stage.steps.length > 0, `${stage.id}: no steps`);
    for (const step of stage.steps) {
      if (step.tool) {
        assert.ok(existsSync(new URL(step.tool, repoRoot)), `${stage.id}: step tool ${step.tool} does not exist`);
      }
      assert.equal(typeof step.args, "function", `${stage.id}: a step has no args builder`);
    }
  }

  const hashes = stages.map((stage) => stage.expect);
  assert.equal(new Set(hashes).size, hashes.length, "two stages expect the same hash — a copy-pasted table");

  // The chain must end on the asset the contract pins; anything else and the
  // "rebuild" cannot reproduce what ships.
  assert.equal(
    stages[stages.length - 1].expect,
    contract.asset.sha256,
    "the last stage does not expect the pinned runtime asset",
  );

  if (stage0) {
    assert.match(stage0.sha256, HEX64, "stage 0: sha256 is not a hash");
    assert.ok(Number.isInteger(stage0.bytes) && stage0.bytes > 0, "stage 0: bytes is not a size");
  }
  return true;
}

test("the stage-0 snapshot exists on disk with the hash the driver pins", () => {
  const bytes = readFileSync(new URL(STAGE0.path, repoRoot));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), STAGE0.sha256);
  assert.equal(bytes.length, STAGE0.bytes);
});

test("the pipeline table is well formed and ends on the pinned asset", () => {
  assert.equal(checkTable(PIPELINE_STAGES, STAGE0), true);
});

test("the stage order is the measured one — C5 before the flight group, jaw last", () => {
  // Doc 41's original BG-1 text listed the C5 weight rebalance *after* the D4
  // flight group. The flight group actually ran on the post-C5 asset
  // (bef7a09a… -> b5f1c1ef…), so this order is the one that reproduces the pin.
  assert.deepEqual(
    PIPELINE_STAGES.map((stage) => stage.id),
    [
      "d2-buzz",
      "d1-stabilize",
      "coordinate-panels",
      "d3-motion-floor",
      "d4-attack",
      "c5-weights",
      "d4-flight",
      "c6-jaw-pivot",
      "c6-jaw-restore",
    ],
  );
});

test("the CLI contracts the driver depends on still exist", () => {
  // The driver chains the two jaw passes with --in/--out; without --in they can
  // only read the shipped asset and a mid-chain rebuild is impossible.
  for (const tool of ["tools/blender/recenter_v2_jaw_pivot.mjs", "tools/blender/restore_jaw_amplitude.mjs"]) {
    const source = readFileSync(new URL(tool, repoRoot), "utf8");
    assert.ok(source.includes('"--in"'), `${tool} no longer accepts --in`);
    assert.ok(source.includes('"--out"'), `${tool} no longer accepts --out`);
  }
  const coordinate = readFileSync(new URL("tools/blender/coordinate_all_v2_clips.mjs", repoRoot), "utf8");
  assert.ok(
    coordinate.includes("buildAllCoordinatedV2Glb(base, undefined, out)"),
    "coordinate_all_v2_clips.mjs no longer takes explicit base/output paths",
  );
  const rebalance = readFileSync(new URL("tools/blender/rebalance_v2_skin_weights.mjs", repoRoot), "utf8");
  assert.ok(rebalance.includes('"--out"'), "rebalance_v2_skin_weights.mjs no longer accepts --out");
});

test("npm run blender:sync runs the driver", () => {
  assert.equal(packageJson.scripts["blender:sync"], "node tools/blender/sync_v2_pipeline.mjs");
});

test("the table check fails on a tampered table (it is not decoration)", () => {
  const reordered = [...PIPELINE_STAGES].reverse();
  assert.throws(() => checkTable(reordered, STAGE0), /does not expect the pinned runtime asset/);

  const duplicated = PIPELINE_STAGES.map((stage, index) =>
    index === 1 ? { ...stage, expect: PIPELINE_STAGES[0].expect } : stage,
  );
  assert.throws(() => checkTable(duplicated, STAGE0), /copy-pasted/);

  const missingTool = PIPELINE_STAGES.map((stage, index) =>
    index === 0 ? { ...stage, tool: "tools/blender/does-not-exist.mjs" } : stage,
  );
  assert.throws(() => checkTable(missingTool, STAGE0), /does not exist/);
});
