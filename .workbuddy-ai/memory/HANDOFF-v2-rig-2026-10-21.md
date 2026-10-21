# Handoff — V2 rig task list (doc 41) execution state

**From:** Blaze session (started ~21:11, ended 22:39) · **Date:** 2026-10-21
**For:** the concurrent agent session working this repo, or any successor.

## Tree state right now

- HEAD = `5fb3ab1` (committed 22:19 — contains this session's A1–D1, B1–B3, C1–C3 work).
- Suite green at HEAD state: **165/165**, `tsc --noEmit` clean,
  `validate-wyvern-clips --strict` clean, runtime contract passes.
- Runtime GLB + contract pinned at sha256 `88adf57e…`, 5,844,968 B (the D1 state).
- The two V2 candidate GLBs are byte-identical promoted aliases of the baseline
  (`promotedAliasOf` in `catalog.ts`, pinned by a test in `test/flight-lab.test.js`).

## Task list (doc 41 Part 4) status

| Task | State |
|---|---|
| A1 sampler leak + compaction | **Done, committed.** `splice_neck_head_channels.mjs` now copies only referenced samplers, checks rest pose (1e-4) and duration, rejects CUBICSPLINE. `runtime_rig_contract.mjs` has the orphaned-sampler invariant. |
| A2 idle neck-lift bomb | **Done, committed.** Upgrader lift now −4.0/−5.0/−3.5°; applied to shipped idle via `apply_idle_horizon_leveling.mjs` (net world head pitch mean +14° → +1.8°). |
| A3 walk jaw + land→idle | **Done, committed.** `fix_walk_jaw_and_land_handoff.mjs`: jaw 8.6° → 0.4° breathing; land→idle worst joint snap 16.98° → 0.036°. |
| B1 jaw tracking/seal | **Done, committed.** jaw in `allControlledBones`; `sealFlightJaw` takes a context object (dive/speed/>12 m/s or >2° static drift); roar+death in `isMouthActionActive`. |
| B2 gaze grounding + dive | **Done, committed.** `holdStreamlinedHeadPose` deleted; `zeroTargets` damping; `isGroundedMode` in `FlightContext`. |
| B3 bankRight hotspot | **Done, committed.** `bankRightHotspotFrame` wired in `runtime.ts` (both sites) + `comparisonRig.ts`; cache invalidates on iteration change. |
| C1 master blend | **Done, committed.** `models/source/wyvern-v2-master.blend` via `build_v2_master_blend.py`: 92/92 deform, 2 meshes, 18 actions, 1 scene. audit-scene clean; round-trip export verified. |
| C2 bone weights | **Done, committed.** `bind_missing_panel_and_tail1_weights.mjs`; nonDeformingJoints now `["Root","RootMotion"]`. **JOINTS_0 must be non-normalized** (normalized breaks three.js skinIndex). |
| C3 cli/gltf/control_rig | **Done, committed.** Positional `glb` fix, 2-mesh auto-detect, `export_def_bones=False`, WingPanel fold ratios. |
| D1 body/feet stabilize | **Done, committed.** `stabilize_v2_body_and_feet.mjs` (3 passes). bodyRng 0.0 on all clips; grounded footY exactly −184; attack2/attackAir2 floor penetration → ≤3 rig units. |
| **D2 takeoff/death BUZZ** | **Implemented + gate-verified, NOT INSTALLED** (tree was reset under me twice). See below. |
| D3 idle/walk/attack2 | **Not started.** |
| D4 attack/banks/cruise + promotion | **Not started.** Note: this session's `recoordinate_candidate_panels.mjs` overlaps — reconcile with my `coordinate_all_v2_clips.mjs` changes first (missing-donor fallback + 24 fps solve grid + `legacyDonorMode` gating). |
| D5 candidate aliases | **Done, committed.** v1 symlink removed. |

## D2 — staged, verified, waiting for a stable tree

Tool: `tools/blender/reshape_buzz_clips.mjs` (committed). Gains are **solved against the
official 60 Hz world-space metric**, not typed:

- takeoff: windowed gain 12.25 (0.55–0.85 s launch), 1 smoothing pass → peak 7083,
  p95 3593, mean 528, accel 278k (limit 301k), sustained; takeoff(end)→cruise(start)
  worst joint jump **0.037°** (was 4.41°).
- death: gain 4.0, 2 smoothing passes → peak 1745, p95 888, mean 354, accel 44973
  (limit 46128).

Both pass the V1-baseline dynamics gate. Staged artifacts in `/tmp/wyvern-d2-staging/`:

- `wyvern-v2-d2.glb` — sha `064b974a…` (D2 only, pre floor-realign)
- `wyvern-v2-flight-panels-coordinated.glb` — sha `645b5f33…`, 6,357,164 B — **the fully
  verified end state**: D2 + D1 floor realign (death Body Y −41.1) + panel re-solve at
  24 fps. Full suite passed on this binary before the tree was reset.

**Install recipe** (when the tree is exclusively yours):

```sh
cp /tmp/wyvern-d2-staging/wyvern-v2-flight-panels-coordinated.glb public/models/wyvern-v2-rig.glb
# pin contract: asset.sha256 = 645b5f3311a420221e72741b9c3fb6e198b9fb3adf22509c60d02ed2a70c273f, bytes = 6357164
node tools/blender/runtime_rig_contract.mjs   # must pass
cp public/models/wyvern-v2-rig.glb public/models/wyvern-v2-membrane-lab-candidate.glb
cp public/models/wyvern-v2-rig.glb public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb
npm test
```

Then update `test/wyvern-v2-dynamics.test.js` reason 2: takeoff/death must **pass** the
gate (the edit is written but currently reverted to match the D1 asset; search for
"D2 BUZZ reshape" comment).

## Hazards encountered (read before touching the GLB pipeline)

1. **`git checkout -- <asset>` is lethal mid-session**: HEAD is stale while you work.
   Recover from candidate copies, never from git.
2. **Another session resets tracked assets to HEAD** (happened twice tonight). Verify
   `shasum -a 256 public/models/wyvern-v2-rig.glb` vs the contract pin after any pause.
3. `upgrade_v2_rig_ground_and_membrane.mjs` cannot run: its 2026-10-07 donor GLB is gone
   from the repo. `coordinate_all_v2_clips.mjs` now falls back to re-solving panels from
   base when donors are missing (and solves at 24 fps — sparse grids break `land`).
4. `tools/membrane-crease-metrics.mjs` was never committed; I reconstructed it from
   doc 21's spec (flat=0°/fold=90° fixture-tested).
5. `tools/asset-budget.json` doesn't exist; the upgrader tolerates that now.
6. All my GLB tools are deterministic — same input → same sha. Rebuild order is:
   `reshape_buzz_clips` → `stabilize_v2_body_and_feet` → `coordinate_all_v2_clips`
   → pin contract → sync candidates → `npm test`.

## Remaining work (D3, D4)

- D3: idle needs continuous secondary motion (p95 19.3 → ≥192 deg/s), walk digit/knuckle
  articulation (p95 → ≥901), attack2 tail-whip smoothing (accelMax 83.7k → ≤45k).
  Pattern after `reshape_buzz_clips.mjs`: solve gains against `scripts/wyvern-dynamics.mjs`.
- D4: attack needs 49 static channels authored before amplification (amplify-clip caps at
  3.47×; attack needs 12.28×); banks/cruise are UNIFORM — `build-dynamics-candidate.mjs`
  handles those; then re-coordinate panels, promote, and flip
  `assert.equal(result.passed, true)` in `test/wyvern-v2-dynamics.test.js`.

— Blaze 👻
