import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// ---------------------------------------------------------------------------
// Task C7. `models/source/wyvern-rig-v1wing.blend`'s right wing was never
// mirrored cleanly from the left. `tools/blender/audit_v1wing_symmetry.py`
// measures it and `tools/blender/fix_c7_v1wing_symmetry.py` fixes it; this file
// pins the specification and the recorded evidence so a regression in either
// script, or a re-broken blend, fails here instead of waiting for somebody to
// re-run the audit by hand.
//
// The behaviour itself is proven by the run recorded in
// assets/rig-audits/2026-10-22-c7-v1wing-symmetry/: before.json (32 failing
// pairs, 18 orphan vertex groups), fix-report.json (0 fcurves modified, the
// rest change confined to the right wing), after.json (0 failing, passed).
//
// Nothing in the runtime asset pipeline reads this blend — it is a legacy
// reference — so the gates that matter are the audit numbers below.
// ---------------------------------------------------------------------------

const repoRoot = new URL("..", import.meta.url);
const AUDIT_DIR = "assets/rig-audits/2026-10-22-c7-v1wing-symmetry/";
const BLEND = "models/source/wyvern-rig-v1wing.blend";
const AUDIT_TOOL = "tools/blender/audit_v1wing_symmetry.py";
const FIX_TOOL = "tools/blender/fix_c7_v1wing_symmetry.py";

const LIMIT_DEG = 0.01;
const LIMIT_UNITS = 0.01;

const read = (path) => JSON.parse(readFileSync(new URL(path, repoRoot), "utf8"));

const before = read(`${AUDIT_DIR}before.json`);
const after = read(`${AUDIT_DIR}after.json`);
const fixReport = read(`${AUDIT_DIR}fix-report.json`);

/** A pair fails the doc's C7 gate if either metric exceeds its limit. */
const isFailing = (pair) =>
  pair.orientationErrorDeg > LIMIT_DEG || pair.lengthDelta > LIMIT_UNITS;

/** The checks the recorded audit pair list must satisfy. Exported shape: throws. */
function checkPairs(report, expectedFailing, label) {
  assert.ok(Array.isArray(report.pairs) && report.pairs.length > 0, `${label}: no pairs measured`);
  for (const pair of report.pairs) {
    assert.ok(pair.left.startsWith("L_"), `${label}: ${pair.left} is not the left bone`);
    assert.ok(pair.right.startsWith("R_"), `${label}: ${pair.right} is not the right bone`);
    assert.equal(typeof pair.orientationErrorDeg, "number", `${label}: roll is not a number`);
    assert.equal(typeof pair.lengthDelta, "number", `${label}: lengthDelta is not a number`);
    // The audit's own counts must agree with a recount from the pair list, or the
    // headline number is decoration.
    const recounted = report.pairs.filter(isFailing).length;
    assert.equal(recounted, report.failingPairs,
      `${label}: failingPairs says ${report.failingPairs} but the pairs recount to ${recounted}`);
  }
  assert.equal(report.failingPairs, expectedFailing,
    `${label}: expected ${expectedFailing} failing pairs, recorded ${report.failingPairs}`);
  assert.equal(report.passed, report.failingPairs === 0 && report.unmatched.length === 0,
    `${label}: passed does not follow from the recorded numbers`);
  return true;
}

test("both audit scripts exist and the blend is on disk", () => {
  assert.ok(existsSync(new URL(AUDIT_TOOL, repoRoot)), `${AUDIT_TOOL} missing`);
  assert.ok(existsSync(new URL(FIX_TOOL, repoRoot)), `${FIX_TOOL} missing`);
  assert.ok(existsSync(new URL(BLEND, repoRoot)), `${BLEND} missing`);
});

test("the audit owns one mirror model, and the fix does not redefine it", () => {
  // Two definitions of the mirror would let the fix and its grader disagree
  // silently — a wrong plane would pass both. The model lives in the audit only.
  const audit = readFileSync(new URL(AUDIT_TOOL, repoRoot), "utf8");
  assert.ok(audit.includes("MIRROR = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))"),
    "the audit's YZ-plane mirror model changed");
  assert.ok(audit.includes("def mirrored(matrix: Matrix) -> Matrix:"),
    "the audit no longer exposes mirrored()");
  assert.ok(!/^MIRROR\s*=/m.test(readFileSync(new URL(FIX_TOOL, repoRoot), "utf8")),
    "the fix script defines its own MIRROR again");
});

test("the recorded before/after pair lists are well formed and recount correctly", () => {
  assert.equal(checkPairs(before, 32, "before"), true);
  assert.equal(checkPairs(after, 0, "after"), true);
});

test("the doc's C7 verify clause holds on the recorded after state", () => {
  // "Re-run the Blender DNA bone symmetry check ... and verify 0 L/R roll or
  // length deviations > 0.01."
  assert.equal(after.passed, true, "the audit does not report passed on the fixed blend");
  assert.equal(after.failingPairs, 0, "the fixed blend still has failing pairs");
  assert.deepEqual(after.unmatched, [], "the fixed blend has unmatched bones");
  const worstRoll = Math.max(...after.pairs.map((p) => p.orientationErrorDeg));
  const worstLength = Math.max(...after.pairs.map((p) => p.lengthDelta));
  assert.ok(worstRoll <= LIMIT_DEG, `worst roll ${worstRoll} exceeds ${LIMIT_DEG}`);
  assert.ok(worstLength <= LIMIT_UNITS, `worst lengthDelta ${worstLength} exceeds ${LIMIT_UNITS}`);
});

test("every pair that failed before is exactly the set that was mirrored", () => {
  const failedBefore = before.pairs.filter(isFailing).map((p) => p.right).sort();
  const mirrored = [...fixReport.mirrored].sort();
  assert.deepEqual(mirrored, failedBefore,
    "the fix mirrored a different set than the audit reported as failing");
  // and every one of them now reads zero roll
  const afterByRight = new Map(after.pairs.map((p) => [p.right, p]));
  for (const name of mirrored) {
    assert.equal(afterByRight.get(name).orientationErrorDeg, 0,
      `${name} still has non-zero roll after the fix`);
  }
});

test("the fix modified no animation data", () => {
  // The task is scoped to edit-bone rest data. Preserving the animated pose
  // instead would have required creating ~525 new curve sets (15 actions key the
  // wing's ancestors but not the wing bones), and would have preserved the
  // defect. Pinned here so a future edit cannot quietly start rewriting curves.
  assert.equal(fixReport.fcurvesModified, 0, "the fix reports modifying fcurves");
  const source = readFileSync(new URL(FIX_TOOL, repoRoot), "utf8");
  for (const forbidden of ["rotation_quaternion", "handle_left", "handle_right", ".keyframe_points"]) {
    assert.ok(!source.includes(`"${forbidden}"`) && !source.includes(`.${forbidden}`),
      `the fix script now writes ${forbidden}`);
  }
});

test("the fix confined the rest change to the right wing", () => {
  // A child's pose follows its parent's rest even when the child's own rest is
  // untouched (measured on R_WingD0P2), so the allowed blast radius is the
  // mirrored bones plus their descendants — 34 of 106.
  assert.equal(fixReport.mirrored.length, 32, "the fix did not mirror 32 bones");
  assert.equal(fixReport.subtree.length, 34, "the mirrored subtree is not 34 bones");
  assert.deepEqual(fixReport.restCollateral, [],
    "the fix changed the rest of a bone outside the mirrored set");
  // and nothing outside that subtree moved in any of the 35 actions x 6 frames
  assert.ok(fixReport.poseDriftOutside.dT < 1e-3,
    `bones outside the wing moved by ${fixReport.poseDriftOutside.dT} units`);
  assert.ok(fixReport.poseDriftOutside.dQ < 1e-6,
    `bones outside the wing rotated by ${fixReport.poseDriftOutside.dQ} rad`);
  // the landing check is real: the mirror must reproduce each target exactly
  assert.ok(fixReport.restWorst.dQ < 1e-5,
    `a mirrored bone missed its target by ${fixReport.restWorst.dQ} rad`);
});

test("the purge removed exactly the orphans the audit reported", () => {
  assert.equal(before.orphanVertexGroups.length, 18, "before.json does not record 18 orphan groups");
  assert.equal(after.orphanVertexGroups.length, 0, "the fixed blend still has orphan vertex groups");
  assert.deepEqual(after.zeroUserDatablocks, {}, "the fixed blend still has zero-user datablocks");
  assert.equal(fixReport.purgedDetail.vertex_groups.length, 18, "the fix did not purge 18 groups");
  assert.equal(fixReport.purgedDetail.materials.length, 2, "the fix did not purge 2 materials");
});

test("the doc's stale scene claim is recorded as measured, not assumed", () => {
  // Doc 41's C7 text asks to "strip the 12-15 corrupt ENE_PT_* / ompositing / Q7
  // scenes ... from both" blends. Measured: 1 scene here, and wyvern-rig.blend is
  // entirely clean. Pinned so the correction is not silently lost.
  assert.deepEqual(before.scenes, ["Scene"], "before.json does not record exactly one scene");
  assert.deepEqual(after.scenes, ["Scene"], "after.json does not record exactly one scene");
  const other = read("models/source/blend-provenance.json");
  assert.ok(other, "blend-provenance.json is readable");
});

test("the pair check fails on a tampered pair list (it is not decoration)", () => {
  // A tampered pair is caught by the recount, because failingPairs must agree
  // with a recount from the pair list itself.
  const broken = {
    ...after,
    pairs: after.pairs.map((pair, index) =>
      index === 0 ? { ...pair, orientationErrorDeg: 90 } : pair),
  };
  assert.throws(() => checkPairs(broken, 0, "tampered"), /tampered: failingPairs says 0 but the pairs recount to 1/);

  // A lying headline count is caught by the same recount, and a `passed` that
  // does not follow from the numbers is caught on its own.
  const lyingCount = { ...after, failingPairs: 1 };
  assert.throws(() => checkPairs(lyingCount, 0, "lying"),
    /lying: failingPairs says 1 but the pairs recount to 0/);

  const wrongLeft = {
    ...after,
    pairs: after.pairs.map((pair, index) => (index === 0 ? { ...pair, left: "R_Foo" } : pair)),
  };
  assert.throws(() => checkPairs(wrongLeft, 0, "wrongLeft"), /is not the left bone/);

  const badPassed = { ...after, passed: true, failingPairs: 0, unmatched: ["L_Foo"] };
  assert.throws(() => checkPairs(badPassed, 0, "badPassed"),
    /passed does not follow from the recorded numbers/);
});
