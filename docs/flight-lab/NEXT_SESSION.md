# Wyvern model work: next-session handoff

## Current: V2 & Blender Rig Audit, Workstreams A/B/C1-C5/D1-D3 Landed, 21 October 2026 (23:59)

Read these active planning, audit, and log documents first:
1. **[42-blender-rig-audit-and-pipeline-reference.md](42-blender-rig-audit-and-pipeline-reference.md)** — **Full Rig Audit & Blender Pipeline Log**: Complete summary of source rig matrices, IK pole calibrations, glTF 2.0 importer invariants, control rig fixes, candidate re-coordination, and operational commands.
2. **[39-v2-development-roadmap.md](39-v2-development-roadmap.md)** — Master V2 development roadmap (`Milestones M1–M11`), V2 vs V1 capability matrix, and error/anomaly handling plan.
3. **[40-architecture-audit-and-prioritized-path.md](40-architecture-audit-and-prioritized-path.md)** — Full codebase architecture audit (`14.6k` LOC `src/` vs `28.9k` LOC `tools/`), technical debt register (`D1–D16`), and verified mobile reachability closure (`M2`).
4. **[41-v2-and-blender-rig-audit-task-list.md](41-v2-and-blender-rig-audit-task-list.md)** — Independent review of Step 5 note ([37-v2-idle-neck-audit-note.md](37-v2-idle-neck-audit-note.md)), binary GLB + `src/flight-lab/` runtime audit, deep Blender DNA & `control_rig.py` audit, Flight Lab AI/anomaly-detector design, and coding-agent task list (`Workstreams A–E`, including new Blender rig tasks `Tasks C4–C7`).

### What has landed (`sha256: bef7a09a…`, `6,368,564 B`, `165/165` tests, `21/21` Blender unit tests)
- **Workstream A (`Tasks A1–A3`) ✅**: Fixed `splice_neck_head_channels.mjs` 114-sampler leak & enforced `0` orphaned samplers in `runtime_rig_contract.mjs` (`A1`); removed `-32°` neck-lift regression bomb from `upgrade_v2_rig_ground_and_membrane.mjs` & leveled `idle` horizon eyeline to `+0.4°` (`A2`); closed `walk` `+8.6°` open jaw & smoothed `land → idle` snap to `0.0000°` (`A3`).
- **Workstream B (`Tasks B1–B3`) ✅**: Tracked `jaw` in `allControlledBones` & preserved `±0.4°` respiratory breathing (`B1`); gated `gazeController` when grounded & removed `dive`'s hard `holdStreamlinedHeadPose` overwrite (`B2`); wired `bankRightHotspotFrame` in `runtime.ts` and `comparisonRig.ts` (`B3`).
- **Workstream C (`Tasks C1–C3`) ✅**: Reconstructed canonical 92-bone, 2-mesh `models/source/wyvern-v2-master.blend` (`C1`); weighted `L/R_WingPanel0_0`, `L/R_WingPanel1_0`, and `Tail1` (`85 → 90` deforming bones, `nonDeformingJoints: ["Root", "RootMotion"]` — `C2`); fixed `cli.py` positional `glb` forwarding, `export/gltf.py` 2-mesh + `export_def_bones=False`, and `WING_FOLD_RATIOS` panel bones (`C3`).
- **Workstream C, Task C4 ✅ (2026-10-21)**: `control_rig.py` contact plane corrected to the **measured skinned sole `-2.6549`** (`+142.2` in doc 41 is the *bone tail*, 144.9 units above the sole; `-184.0` is glTF `Body`-relative); `CTRL_Pole_Elbow_L/R` added on the **geometric bend bisector** with `pole_angle` `L = 164.0° / R = 9.5°` (uncalibrated pole displaced the wing **`176.47°`** at rest); panels solved by **`apply_panel_bisect()`** (`cli.py control-rig --panel-bisect`) instead of constraints, because the documented `COPY_ROTATION` pair measures **`28.20°`** where the inter-digital bisect requires **`10.00°`**; `ActionCompat.setup_slotted_action()` now precedes `bpy.ops.nla.bake()`. Result: **`0.0°` rest deviation across all 92 deform bones with `ground_contact_ik = 1.0`**, evidence in `assets/rig-audits/2026-10-21-control-rig/`, probe `tools/blender/audit_v2_control_rig.py`.
- **Workstream C, Task C5 ✅ (2026-10-21)**: Skin weights rebalanced in `tools/blender/rebalance_v2_skin_weights.mjs` (new), audited by `tools/blender/audit_v2_skin_weights.mjs` (new), evidence in `assets/rig-audits/2026-10-21-skin-weights/`. All 16 membrane panels now own **`26.8–57.2%`** of their inter-digital web (was `0–12%`); `L_WingRoot` `8 verts / 0.95` → **`118 / 26.90`** vs `R_WingRoot` `24 / 2.16` → **`127 / 27.26`** (`ratio 0.0066`); the audit flips from **4 failing L/R pairs to none** (worst `0.0165`). **The "20× thoracic cliff" in doc 41 was a misdiagnosis** — 92% of `Spine3`'s mass sits above `Neck1.head` and the chest carries only `~63` of it, so the real defect was `Spine3` owning the whole `Neck1` span (3,832 verts nearest `Neck1`); C5 hands `50%` of that mass to the nearest neck bone (body-only `Spine3 5,624.78 → 3,531.4`, `Neck1 412.85 → 2,539.9`; audit totals over both meshes `9,463 / 3,877.8` and `6,015 / 2,541.1`) and neck-slab `dominant==nearest` agreement rises **`20.1% → 59.9%`**. Asset `950c4321…` → **`bef7a09aa131…`**, still `6,368,564 B`; `cruise` `maxMembraneX` is **unchanged at `2780.9`**, so D4's cruise blocker is untouched. Underlying cause of two silent no-op passes: `readSkin` compared raw `POSITION` against `bindWorldPos()` across two different spaces (bind scale `2187.9565`; body `POSITION` is normalized `SHORT` under `KHR_mesh_quantization`) — now owned by `tools/blender/glb_skin_io.mjs`.
- **Workstream D (`Tasks D1, D2, D3, D5`, partial `D4`) ✅**: Flattened horizontal `Body` drift on 10 clips, aligned grounded `footY` to `-184`, and lifted `attack2`/`attackAir2` underground wingtips (`D1`); reshaped `BUZZ` clips `takeoff` (`0.27× → 1.68×` peak) and `death` (`0.47× → 1.16×` peak) (`D2`); added continuous secondary-motion floor on `idle` (`p95` `19 → 197`), `walk` (`315 → 929`), and `attack2` (`accelMax` `83,690 → 37,710`) (`D3`); amplified `attack` (`0.09× → 0.91×` peak) (`D4`); marked alias candidates in `catalog.ts` (`D5`).

### Open Tasks in Roadmap (`39`) & Task List (`41`) for Next Sessions
1. **New Blender Rig, Control-Rig & Skinning Tasks (`Tasks C6–C7` in [doc 41](41-v2-and-blender-rig-audit-task-list.md), Milestones `M7`/`M8`)** — `C4` and `C5` are ✅ done (see above):
   - **Task C4 ✅** — see "What has landed". Re-verify with `python3 -m unittest discover -s tools/blender/tests -p "test_*.py"` and `~/.local/bin/blender --background models/source/wyvern-v2-master.blend --python tools/blender/audit_v2_control_rig.py -- --json-out <path>`.
   - **Task C5 ✅** — see "What has landed". Re-verify with `node tools/blender/audit_v2_skin_weights.mjs` (`passed: true`) and `node tools/blender/measure_membrane_extent.mjs` (`maxMembraneX 2780.9`). Rebalance with `node tools/blender/rebalance_v2_skin_weights.mjs [--out <candidate.glb>] [--write]` — dry run by default.
   - **Task C6 (Blender Bone Geometry)**: Recenter `Jaw.head` in `wyvern-v2-master.blend` from `[3.6, -583.7, 867.8]` (`3.6` units off-center and `74.5` units *above* `Head` `[0.0, -547.3, 793.3]`) to `[0.0, -565.0, 785.0]` (`roll = 0.0°`) with track compensation; extend `Body.tail` from its `0.05`-unit stub to `Spine1.head` (`length = 164.1`); and flatten `RootMotion` onto the ground plane.
   - **Task C7 (`wyvern-rig-v1wing.blend` Symmetry & Cleanup)**: Symmetrize `L_WingD0..5` and `L_WingBatten040..054` to `R_` (fixing `14.9°–22.5°` roll errors on `R_WingD0..3P0` and inverted `R_WingBatten061..066` tails) and purge 18 orphaned `WingFinger*` vertex groups and 12–15 junk `ENE_PT_*` scenes.
2. **Stage 3 Flight Group Remainder (`Task D4` — `cruise`, `bankLeft`, `bankRight`, Milestone `M6`)**:
   - Replace the single-frame `t = 1.0s` `maxMembraneX > 2500` proxy with cycle-peak + `maxMembraneX >= wingTipPos.x` for `cruise`, author `0.500 Hz`-locked mid-stroke recovery and spine/neck/tail banking roll on `bankLeft`/`bankRight` so `mean >= 0.70×` without breaking the `8%` cadence lock, and invert `test/wyvern-v2-dynamics.test.js`.
3. **Workstream E (`Tasks E1–E4`, Milestone `M11`) — Flight Lab AI Co-Pilot & Pose-Anomaly Detector**:
   - **Task E1 — landed (2026-10-22)**: `src/flight-lab/poseEnvelope.ts` owns five detectors (`bind_delta`, `horizon_pitch`, `open_jaw`, `transition_handoff`, `root_drift`); `Scan` logs a `Pose envelope:` line beside the seam result; `npm run assets:audit-pose-envelope` runs the same detectors over a shipped GLB and exits 1 on any finding. The shipped asset is **18/18 clips clean**; re-injecting the three historical defects makes it fire (4 / 1 / 1 anomalies). **E1.2 landed too**: `src/flight-lab/poseAnomalyOverlay.ts` paints a pulsing `#ef4444` camera-facing ring on each flagged bone, follows the bone every frame, and is cleared by a clip change. Verified in Chromium by `scripts/probe-pose-anomaly-rings.mjs`: defective asset → `Head / Neck2 / Neck1` ringed, red pixels `3 → 1423`, `3 bones ringed` in the log; pinned asset → 0 rings. Two sub-items remain deliberately untaken and are documented in doc 41: `scripts/validate-wyvern-clips.mjs` wiring (plain-`node` call sites, TS detector) and floor penetration (`audit-wyvern-rig.mjs` already gates it).
   - Remaining: add Bind Delta + Procedural Offset + World Horizon Pitch + user note input to `Copy for AI` pins (`Task E2`), add a `Proc` (`flightRig` ON/OFF) toolbar button (`Task E3`), and add `POST /api/flight-lab/report` to save captures directly to `docs/flight-lab/inbox/` (`Task E4`).

## Previous: Stage 3 clip dynamics started, 21 October 2026

Read [37-stage3-clip-defect-taxonomy.md](37-stage3-clip-defect-taxonomy.md) first, then [36-v2-dynamics-gate.md](36-v2-dynamics-gate.md) and [35-rider-asset-and-mount.md](35-rider-asset-and-mount.md).

- **The deficit is three defects, not one.** `npm run assets:diagnose-dynamics` adds a `travel` channel (cumulative |dq|, unbounded — range saturates at 180°). `sustainRatio = p95R/travelR` splits the mapped clips: **UNIFORM** (cruise, both banks, attack — travel and sustain fell together, a gain fixes it), **CONCENTRATED** (idle, walk, attack2 — travels in brief excursions with dead air), **BUZZ** (takeoff, death — fast through a small range).
- **Gate progress: 27 failing checks → 20.** `npm run assets:amplify-dynamics` derives each gain, refuses anything above a 2% capped-key plateau limit, and writes `assets/rig-audits/2026-10-21-dynamics/candidates/wyvern-v2-dynamics-candidate.glb`. `cruise` now passes all four channels; both banks pass `peak` and `p95` but not `mean`. The shipped rig is **unchanged** — the candidate is not promoted.
- **`attack` is capped at 3.5× when it needs 12.3×.** Its axes run out because 49 of its 92 rotation channels are constant poses. No gain animates a bone that was never keyed — this is a coverage problem, not an amplitude one.
- **V2 has no CUBICSPLINE anywhere**; every channel is LINEAR or STEP. STEP is only ever used on ≤2-key channels, so it is harmless. But linear interpolation cannot overshoot, which caps `peak` independently of amplitude. Adding spline tangents to the dominant channels is probably the highest-leverage change left.
- **Timing is NOT the problem** (unchanged from last session): V1 cruise 1.00 Hz, V2 1.08 Hz, Pennycuick ~0.71 Hz. See `docs/2026-10-21-research-notes.md`.
- **Rider shipped** (unchanged): `public/models/wyvern-rider.glb`, 24 `RDR_` bones, 2,860 tris, byte-identical rebuilds, mounted at Spine3 via a derived offset.
- **Suite**: 161 tests pass. New this session: `wyvern-clip-dynamics-tools` (12).

**Next**: `takeoff` and `death` first — they are `BUZZ`, and takeoff's duty cycle went 0.01 → 0.52, i.e. an explosion replaced by a wind-up. Then `CONCENTRATED` (`idle`, `walk`, `attack2`). Do not reach for a gain on any of them. Invert the assertion in `test/wyvern-v2-dynamics.test.js` only when the gate passes.

## Previous: Dynamics Gate + Rider Asset, 21 October 2026

- **New measurement channel**: `npm run assets:audit-dynamics` / `:v2` reports world-space per-frame max angular velocity (peak / p95 / mean / accelMax, plus a `sustained` guard) over deforming bones at 60 Hz. Reference: `assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json`, reproduced exactly on re-run and pinned by SHA-256.
- **V2 fails the gate on 27 checks** (three per mapped clip, all nine). Peak ratio min 0.079 / median 0.414 / max 1.145. Worst: `attack` 9%, `takeoff` 8% of V1 peak; `idle` p95 at 7.7% (frozen between rare twitches).
- **Timing is NOT the problem.** Measured wingbeat: V1 cruise 1.00 Hz, V2 cruise 1.08 Hz, against a Pennycuick prediction of ~0.71 Hz. The earlier "fixed 6 s loop caps dynamics" hypothesis is **rejected** — see `docs/2026-10-21-research-notes.md`. Stage 3 must add amplitude and transients, not re-time clips.
- **Rider shipped**: `public/models/wyvern-rider.glb` — 24 `RDR_` bones, 2,860 tris, 4 clips, byte-identical rebuilds. Mounted at Spine3 via a derived offset (`tools/calibrate-rider-mount.mjs` → `src/flight-lab/rider/mountData.ts`). Separate GLB, world-space follower, own mixer.
- **Suite**: 149 tests pass. New: `wyvern-dynamics-reference` (5), `wyvern-v2-dynamics` (6), `rider-runtime-contract` (7), `rider-mount` (8).

**Next**: Stage 3 (clip dynamics) — start with `attack` and `takeoff`, which lost their transients, then `idle`'s frozen p95. Invert the assertion in `test/wyvern-v2-dynamics.test.js` when the gate passes.

## Current: V2 18-Clip Panel Coordination Promotion & Procedural Rig Polish, 14 October 2026

Read [`docs/plans/sanctuary/WYVERN_ANIMATION_IMPROVEMENTS_LOG_AND_HANDOFF.md`](../sanctuary/WYVERN_ANIMATION_IMPROVEMENTS_LOG_AND_HANDOFF.md) (Section 10).
- **Runtime V2 Rig Promoted (`public/models/wyvern-v2-rig.glb`)**: SHA-256 `2ef4eb1bdbca142d224041bccf16e192258d1936ffa94cb0bf78f07c4afb1b8c` (`5,685,288 B`, `-316 KB`). All 18 clips now have coordinated wing-membrane panels (`maxPanelErr <= 0.71°`, `peakP95 <= 40.66°`), upgraded 4-beat reptile `walk`, lifted ground `idle`/`takeoff`/`land` posture, and loop-closed `cruise`/`bankLeft`/`bankRight`.
- **Flight Lab Candidates Synchronized**: `public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb` and `public/models/wyvern-v2-membrane-lab-candidate.glb` (`SHA-256: 8705038ca1b78f4118a25734e453d5a9ca76e3702500fb8ad7acb1ef5fdd866f`, `6,014,168 B`, `-316 KB`) carry the 18 coordinated clips; with `membraneSurfaceRuntime.ts` active, `p95` membrane creases drop to `19.04°–22.24°`.
- **Procedural Rig (`wingRefinement.ts`, `wyvernFlightRig.ts`)**: Synchronized bilateral flutter phase in level flight, added `turnRate`-driven inside-wing tuck on banks, matched `Panel1..5` procedural offsets to adjacent digit midpoints, and gated airborne `2.5 Hz` spine/tail waves when grounded.

## Current: V2 BankRight additive target review, 8 October 2026

Read [33-bank-animation-interpolation-and-dense-targets.md](33-bank-animation-interpolation-and-dense-targets.md). Resume from `assets/harvest-candidates/2026-10-07/bank-corrective-study/v44-bankRight-additive-target-80519-corrective.blend`, a cumulative diagnostic copy with the paired 92-bone rig and 453 shape keys. V44 adds one Basis-relative corrective target at frame 80.51953125 with a three-key Bezier envelope from 80.5 to 80.53125. Its 4,608-sample cycle audit at 1/32 spacing records a 2.332010-unit maximum, zero samples above the separate 2.333 cruise comparison, and zero loop surface seam. The 1,406-sample fine scan now peaks at 2.763612 units at frame 70.8828125; the corrected 80.51953125 sample is 2.467360, and four fine samples remain above 2.333. Global sampled speed remains 1,185.998 units/frame at 70.88671875–70.890625. On the 1/1024 local support grid, the maximum falls from 3.238180 to 2.685215, with sampled speed 1,148.344 units/frame below the existing global ceiling. Existing bank curves are unchanged outside support and both support endpoint surfaces have zero measured drift. The original mix curves still sum to 1 within 1.8e-7; the additive corrective separately reaches 0.205, so total shape-key values can reach 1.205. Matched 16:9/3:2 V43-equivalent and V44 contact sheets were inspected with no obvious silhouette break. These are static views, not continuous playback evidence. Keep V44 in Flight Lab. Bank-specific limits, continuous playback, crease/normals and inter-clip transitions remain unqualified; do not promote this candidate to player/runtime assets. V43 remains the rollback; runtime assets remain unchanged.

### V44 artifacts and remaining review

`tools/blender/author_bankright_v44_additive_target_mcp.py`, `tools/blender/audit_bankright_v44_cycle_and_fine_windows_mcp.py` and `tools/blender/render_bankright_v44_hotspot_review_mcp.py` reproduce the authoring, numeric audit and static review. Reports are `bankRight-v44-additive-target-authoring.json` and `bankRight-v44-full-cycle-fine-audit.json`; matched contact sheets are in `v44-review/`. The total fine-scan shape-key sum includes the additive target, while the original mix-curve partition remains normalized. Next qualify continuous playback, membrane crease/normals and inter-clip transitions under a bank-specific error/rate gate. V44 is not a runtime asset; V43 and the V21 source study are retained.

## V2 Idle and Walk runtime review, 8 October 2026

Flight Lab now leaves the authored V2 `idle` and `walk` actions free of the V2-only procedural flight-rig overlay. That overlay had added a 2.5 Hz spine/tail wave and ground leg motion on top of Idle, plus a second gait on Walk; V1 does not receive this controller. The exact current runtime GLB audit reports Idle loop seam 0.0008 rad and root travel 0, and Walk seam 0.0008 rad and root travel 0.0005 rig units. Walk wingtip asymmetry is 10.2968 m in the validator's deliberately exempt walk metric and remains a visual review item. The saved Blender handoff still records pronounced longitudinal membrane ridges and acute panel creases during Walk; stance contact, planted-foot sliding, and Idle-to-Walk support handoff remain unqualified. Do not change the pinned V2 GLB or promote it to the gameplay player from this preview-only runtime fix.

## Earlier bank interpolation note, superseded 7 October 2026

The 145.954-unit comparison was invalid and is withdrawn. See the current handoff above and document 33 for slot-correct measurements: 150.421 units left and 160.104 units right near frame 48, against diagnostic target interpolation. The old right target and right safety scan used a mismatched Action Slot and are invalid.

## Original-skin discrete bank correctives, 7 October 2026

Read [32-original-skin-bank-pose-correctives.md](32-original-skin-bank-pose-correctives.md). Fixed weight strengths fail cycle-wide protection. Sixteen discrete bank pose shapes now reproduce phase-selected targets through the exact original skin within 0.001 rig units. Both matched contact sheets are inspected. Resume `v2-original-skin-bank-pose-study.blend`; keys default to zero and need continuous playback/bake qualification before export. Active assets remain unchanged.

## Local bank root studies, 7 October 2026

Read [31-local-bank-fold-experiments.md](31-local-bank-fold-experiments.md). Extra local smoothing is rejected. A separate 432-vertex weight study closes seams and improves 15/16 p95 samples but retains a phase-dependent sharp fold and changes walk geometry. It cannot replace the rig directly. Keep the original-weight bank-gated study as the baseline; refine the fold, then bake any retained bank correction against original skin weights.

## Harvested bank correction reconciled and gated, 7 October 2026

Read [30-harvested-bank-corrective-reconciliation.md](30-harvested-bank-corrective-reconciliation.md). The exact harvested bank candidate now has an isolated corrective study: all 16 sampled surface metrics improve against both the harvested and original V2 poses. Both three-way contact sheets are inspected. Correction is gated to banks across 18 copied actions; 16 other clips have zero drift, with a walk mutation proving sensitivity. Resume from `v2-harvested-bank-gated-study.blend`; local inner folds and runtime bake/qualification remain.

## Bank corrective Blender study, 7 October 2026

Read [29-bank-corrective-blender-study.md](29-bank-corrective-blender-study.md). A separate hidden authoring copy reduces bank p95 crease angles by 15.6–22.1 percent in all 16 sampled poses, with closed seams and no degenerate triangles. Both matched contact sheets are inspected; smoothing is subtle and inner folds remain pronounced. Next refine local folds, reconcile the harvested bank candidate and add animation gating before any runtime bake. Active assets remain unchanged.

## Numeric cruise transitions, 7 October 2026

Read [28-corrective-transition-audit.md](28-corrective-transition-audit.md). The optimized candidate passes 680 static blends and 272 timed warped crossfades across all 17 other clips, with closed seams, unchanged bones and complete outgoing resets. An in-memory seam mutant fails as intended. Blender MCP contact sheets now cover four representative blends in both view formats. Inner bank/ground folds still show tight ridges; next repair those local poses, then reconcile bank/body/ground harvesting and the unchanged file-size budget. Active models remain preserved.

## Optimized cruise candidate and actual GPU evidence, 7 October 2026

Read [27-corrective-compression-and-gpu-evidence.md](27-corrective-compression-and-gpu-evidence.md). The position-only 14-bit candidate is 6.48 MB, passes all 576 held-out samples (2.201 units against 2.333), preserves normals exactly and uses 6.86 MB of morph texture storage. Actual Apple M3 WebGL preview GPU p95 stays below 2.8 ms in both view formats; screenshots and an optimized Blender review copy are saved. Active assets/budgets remain unchanged. Next: blended transitions and bank/body/ground reconciliation, then any measured budget decision before promotion.

## Authored-normal cruise runtime candidate, 7 October 2026

Read [26-authored-normal-runtime-candidate.md](26-authored-normal-runtime-candidate.md). The 96 fps, 52-shape candidate passes all 576 held-out runtime-pose position samples (maximum 1.885 units against 2.333), preserves authored shader normals exactly, and resets 17 other clips. Exact GLB round-trip contact sheets are inspected and the editable review is saved. The 10.88 MB candidate still needs optimization, GPU evidence, transitions and bank/body/ground reconciliation before promotion. Active assets remain unchanged.

## Area-weighted normal study, 7 October 2026

Read [25-area-weighted-membrane-normal-study.md](25-area-weighted-membrane-normal-study.md). The worst local lighting jump was traced to tiny folded triangles. A 90% correction plus face-area normals has no undefined normals in 288 held-out samples and preserves all 17 non-cruise midpoint poses. The saved `v2-area-weighted-090-study.blend` is the next Blender authoring candidate. The separate full-strength 48 fps GLB is rejected at vertex 4601, frame 46.75; bake and qualify the retained 90% study next.

## Corrective round trip and interpolation failure, 7 October 2026

Read [24-corrective-roundtrip-and-subframe-audit.md](24-corrective-roundtrip-and-subframe-audit.md). Matched Blender MCP contact sheets and the macro retain the correction, but halfway-frame runtime checks fail: position maximum 3.836 units against 2.333, normal component maximum 1.624 against 1/127. The candidate is not playback-qualified. Densify/adapt the bake and investigate local normal discontinuities before optimization or promotion. Saved round-trip review is separate; active assets remain unchanged.

## Runtime corrective morph bake, 7 October 2026

Read [23-runtime-corrective-morph-bake.md](23-runtime-corrective-morph-bake.md). The explicit-zero GLB candidate reproduces the Blender cruise correction within measured position/normal bounds across 145 runtime samples and resets all 17 non-cruise actions. Exact rig/asset data is preserved. Round-trip visuals, blended/subframe motion and the 19.2 MB candidate cost still need qualification; active assets remain unchanged.

## Blender MCP corrective cruise rig, 7 October 2026

Read [22-blender-mcp-corrective-cruise-rig.md](22-blender-mcp-corrective-cruise-rig.md). The saved `v2-corrective-cruise-mcp.blend` contains the current 92-bone rig, 18 gated review actions and a visibly softer cruise membrane. Ground actions have zero deformation drift. The separate morph bake is recorded in document 23; no gameplay GLB has been replaced.

## Local membrane study, 7 October 2026

Read [21-local-membrane-crease-study.md](21-local-membrane-crease-study.md). Exported membrane skin seams are continuous; a 34-vertex adjustment slightly lowers local crease scores but does not resolve the visible pinches. Keep the experiment separate and use exact-parent comparisons for the next correction.

## Bank harvest continuation, 4 October 2026

Read [20-v1-bank-harvest-and-direction-gates.md](20-v1-bank-harvest-and-direction-gates.md) for the bank recipes, rejected independent transfer, corrected derived bank pair, direction regressions and matched renders. The candidate passes motion gates but membrane creases and runtime transitions remain unqualified. Active assets were preserved.

## Cruise harvest implementation, 4 October 2026

Read [19-v1-harvest-implementation.md](19-v1-harvest-implementation.md) for the operational bake/export pipeline, final 24-channel trailing-digit candidate, matched visual evidence and remaining gates. The current runtime GLB was preserved; ground/body/bank harvesting remains unqualified.

## Harvesting audit, 4 October 2026

Read [18-v1-harvest-gap-audit.md](18-v1-harvest-gap-audit.md) before resuming V1-to-V2 harvesting. It identifies incomplete bake/export and clearance tooling, unverified profile provenance, phase/ground-gating discrepancies, and the animation/design work sequence. Packaging now rejects empty or missing donors; no model promotion was made by this audit.

Updated 2026-09-15. Read this first, then open the saved Blender study. The detailed evidence is in [06-drogon-cruise-repair.md](06-drogon-cruise-repair.md).

## Export and Flight Lab plan

Read [08-animation-and-flight-lab-delivery-plan.md](08-animation-and-flight-lab-delivery-plan.md) for the complete 18-clip candidate, current Blender import, animation ledger, Flight Lab work packages and game-promotion gates. The original bundle remains prepared, and the 15 September V2 wing-shape repair is promoted to Flight Lab only, not the playable player.

## Current continuation: v2 rebuild (9 September 2026)

The user explicitly switched to improving the v2 rig in Blender. Start with [07-v2-blender-motion-handoff.md](07-v2-blender-motion-handoff.md), which records the current saved study, corrected walk, cruise reset repair, export measurements, rejected experiments and next gates. It supersedes the older continuation instructions below for model selection. Preserve the separate Fantasy Biomes player cruise repair.

The latest export-safe membrane continuation is also recorded there. Resume from `v2-membrane-export-safe-import-review.blend`; keep `v2-membrane-rebuild.blend` as the high-influence reference and do not use the rejected four-influence GLB. The clean candidate satisfies the four-influence runtime limit, has one skin, 92 bones and 18 canonical clips. Its exact GLB now imports and has 3:2 walk/cruise pose evidence, but those renders still show sharp ridges and pinched panel curvature. Rebuild the local problem weights, compare against the authored model, then capture complete-cycle and 16:9 evidence. Its 15 September cruise-only wing-shape repair has a restricted Flight Lab promotion; game-player promotion remains unapproved.

## Latest: V2 wing-shape repair promoted to Flight Lab (15 September 2026)

`public/models/wyvern-v2-rig.glb` now has SHA-256 `34b2862c7c74f77952131b612dc296d4d29215f63af2ad749e3782f333ec928f`, is 6,977,360 bytes / 49,872 triangles, and carries one shared skin, 92 bones and the 18 canonical clip names. It is a Flight Lab-only promotion: `public/models/player-wyvern.glb` remains Drogon and gameplay-player promotion is still out of scope.

The reviewed `Cruise_WingShapeRepair_v1Reference` action retains shoulder motion but eases excessive elbow/wrist/hand/digit recovery folds. The widest recorded distal fold fell from 141.01 degrees to 67.68 degrees. The exact runtime export keeps Meshopt/WebP geometry and textures while restoring the verified animation tracks after generic optimisation was found to duplicate skins and increase the cruise seam. Three.js audit: cruise peak 3.8337 degrees per 1/96 second and seam 0.0588 degrees; bank L/R 7.3861-degree peaks and 0.1123/0.1321-degree seams; walk 5.7460-degree peak and 0.0755-degree seam.

The local Flight Lab loaded the V2 rebuild with all 18 clips / 4,968 tracks and its cruise scan found no loop jump above 10 degrees. Blender review and evidence artifacts live in `/Users/ajadvanwyk/.codex/visualizations/2026/09/15/01a0a649-e79a-7fa3-9335-11d5d6c166f0/`, including the isolated study, 16:9/3:2 candidate captures and metrics JSON. This qualifies the repaired cruise shape for Flight Lab review only. Recheck the remaining flight, ground and transition gates before any game-player promotion.

## Historical user direction (8 September)

Fantasy Biomes is the main game. Wyvern3D and Wyvern3D v2 provide source assets and animation references. The immediate priority is improving a dependable playable wyvern in Blender using **Blender MCP**. Preserve Drogon's appearance. The user dislikes the v2 rebuild's animations and the Meshy young-wyvern rebuild; neither is an approved replacement.

The user wants to conserve Astra session usage for actual model/animation improvement. Reuse this investigation. Avoid another repository-wide inventory, broad game proposal, full-model rebuild, or comparison of every available creature before making progress on a specific visible defect. Do not change the task's model setting automatically.

## Start here

1. Inspect the current Blender MCP scene and unsaved state before opening anything. Do not overwrite current user work.
2. Open this study if it is not already active:

   `/Users/ajadvanwyk/.codex/visualizations/2026/09/08/01a081b7-7043-7e71-8f02-500314a5db62/wyvern-flight-audit/wyvern-flight-audit.blend`

3. Start with scene **Repaired Cruise Candidate**, armature **PlayerWyvernArmature.001**, action **FlightCruise.001**, frames **0–144 at 24 fps**. Names are from the saved study; inspect before assuming they still exist. The study also includes **Wyvern Flight Audit**, **V2 Flight Audit**, and **Biome Player Audit** for comparisons. Do not select the old `FlightCruise` by name and mistake it for the repaired action.
4. Review one complete wingbeat from front and side, then the full loop. Choose one visible issue to improve, record its clip/frame/view, and work on a separate action/model copy. Use before/after renders to judge the change.

The same artifact folder contains `comparison.html`, PNG pose sequences, probe JSON, `player-original.glb` (rollback reference), and `player-inspection.glb` (decompressed **old** player). The latter is not the repaired asset.

## What is already solved

- The game's original `FlightCruise` contained a turning performance with a **93.6066° body-orientation discontinuity** at its loop boundary. Both Blender and the real Three.js AnimationMixer reproduced it.
- Only that clip was replaced with the six-second, three-wingbeat `Sanct_Cruise` from `/Users/ajadvanwyk/wyvern3d/public/models/drogon-sanctuary.glb`. All 876 tracks match existing bone names.
- Active game asset: `public/models/player-wyvern.glb`, SHA-256 `bd9f61aa62f1534bd3dd7a58286c689154ef2e47084750aae5b89281ae174e5c`. Geometry, materials, skeleton, and other 12 clips were preserved. It is 5,917,872 bytes and 39,234 triangles.
- Flight Lab previously displayed **Drogon (Player Wyvern)**. **Changed 2026-09-09:** the Flight Lab catalogue now holds exactly one specimen — the **v2 rig** (`wyvern-v2-rig.glb`, copied from `wyvern3d-v2/public/models/wyvern-gothic.glb`, 92 bones, 18 clips). All other wyvern and egg specimens were removed from the catalogue; the GLB files themselves were left on disk and the playable player runtime still uses `player-wyvern.glb` (Drogon) unchanged.
- The repaired loop passes the <0.1° body-seam gate. This is a continuity repair, not certification of artistic quality, every bone's deformation, or all gameplay transitions.

## What remains open

1. **Blender motion quality:** inspect membrane folding, shoulder/elbow/wrist coordination, posture, and recovery at the actual problematic phases. Do not assume a mirrored skeleton or invent rotation signs. Preserve source appearance and compare rendered output.
2. **Banking:** `BankLeft` and `BankRight` are unchanged. Browser switching was tested, but their complete loops and sustained turning motion are not approved.
3. **Takeoff/landing:** the player has `Takeoff` but no dedicated `Landing` clip in its 13-clip set. Do not claim a finished landing transition. Review the intended contacts and authoring requirement before wiring one into gameplay.
4. **Neck/wing coupling:** on original Drogon, clavicles inherit `Bip002-Neck_012`. A 10° neck-only probe moved wrists by 8.34% / 10.06% of wrist span. A single-frame clavicle compensation experiment nearly eliminated that displacement; it was not integrated. V2 passed the same independence probe. Flight Lab adds no neck motion, so this was a separate rig limitation, not the cruise-snap cause. Do not reparent the entire original skeleton without preserving existing performances.

## Tools and verification shortcuts

- Use Blender MCP. It initially failed to connect, then worked. MCP screenshot response was malformed; Blender Workbench renders saved to PNG and inspected with `view_image` worked reliably.
- Blender 5.1.1 rejected `EXT_meshopt_compression`. Use a decompressed **inspection copy** when needed; keep the shipped compressed asset intact until a reviewed replacement is ready. `glTF-Transform copy` was used successfully. Blender 5 actions use slots, and imported NLA tracks must be muted when isolating a selected action.
- Source records and donor hash are pinned in the repair report. Do not substitute older v2 documentation's differently hashed donor. `tools/replace-player-cruise.mjs` is an idempotent, exact-name track transfer tool, not a general retargeter.
- Focused regression: `node --import tsx --test test/player-wyvern-cruise.test.js test/player-wyvern-animation.test.js test/flight-lab.test.js`. The first test originally failed; its final-rotation mutant now gets rejected. Cubic spline track arrays include tangent values: sample with the interpolant instead of treating the first four numbers as a quaternion.
- Last full checks: **549/549 fast tests**, lint, 16 wildlife routines, 36 mutation checks, and docs check passed. Type-check failed at `src/biomeFactory.ts:83` on unresolved `terrainHeightAt` in concurrent terrain work. Recheck only when relevant; these are historical results, not next-session guarantees. Follow current repository-required gates when changing game files.

> **Resolved 2026-09-08:** the `src/biomeFactory.ts:83` type-check failure above is
> fixed. `terrainHeightAt` was called but never imported from `./scene/terrainSystem`
> (it is exported there at line 100). Adding it to the import block takes
> `tsc --noEmit` to exit 0. The surrounding claim — "549/549 fast tests, lint, 16
> wildlife routines, 36 mutation checks" — remains a historical record, not a
> current guarantee.
- Last working preview: `http://localhost:3001/flight-lab`. Port 3000 served a different app. Inspect server availability before starting another process. **Historical note, not a convention**: this entry records a server that outlived the session that started it. Start `pnpm dev` only when a rendered page is actually required, reuse the port if it already answers, and stop it as soon as the capture is taken (`lsof -ti tcp:3000 | xargs -r kill`) — the machine has 8 GB of RAM. See [AGENTS.md § Dev Server Discipline](../../../AGENTS.md#dev-server-discipline).
- Repository has substantial unrelated uncommitted terrain, Atlas, wildlife, and documentation work. This repair was not committed. Inspect current status and preserve it.

## Short continuation prompt

> Read docs/plans/flight-lab/NEXT_SESSION.md and use Blender MCP to continue improving the saved Drogon model. Keep Fantasy Biomes as the main game and preserve the repaired cruise loop. Inspect the current scene, choose one visible animation/deformation issue, and improve a copy with before/after evidence. Spend the session on model quality rather than repeating discovery or rebuilding everything.

## Flight Lab debug surface (added 2026-09-09)

`/flight-lab` now targets v2 rig debugging. Four capabilities, all in `src/flight-lab/`:

1. **Seam / jump scan** (`motionProbe.ts` → `scanSeam`, `Scan` button in the stage toolbar). Samples every bone's local rotation at quarter-frame steps over the active clip and reports jumps above **10°**. Threshold provenance: repaired cruise candidate peaks at 4.1475° per quarter-frame; the un-repaired reset defect measured 16.1718° at frame 47.25 (`art direction/v2-rig-inspection/MOTION_REPAIR_STATUS.md`). Results land in the animation event log, top 8 by angle.
2. **Matched cameras + floor** (`camera.ts` presets `frontOrtho` / `sideOrtho` / `topOrtho` / `threeQuarterOrtho`; `environment.ts` floor plane). Orthographic presets exist so renders can be compared against the Blender panels. The floor auto-aligns to the loaded model's bounding-box minimum and is toggled from the stage toolbar.
3. **Wing landmark telemetry** (`sampleLandmarks`): live world positions for shoulders, elbows, wrists, hands, neck, head, pelvis, tail and jaw, published with telemetry and shown in a viewport overlay.
4. **Evidence export** (`Export` button): downloads a PNG of the canvas plus a JSON sidecar (specimen, clip, clip time, mode, landmarks). The renderer now runs with `preserveDrawingBuffer: true` so `toDataURL` is reliable — this costs some fill-rate, acceptable for a debug lab.

Clip resolver was re-mapped to v2's lowercase clip names (`cruise`, `bankLeft`, `bankRight`, `takeoff`, `walk`, `idle`, …); the fuzzy fallback now also matches `glide|hover|dive|soar`. One-shot buttons use `attack`, `attack2`, `attackAir2`, `breath`, `death`.

**Not verified:** no browser run was possible in the sandbox used for this change (heavy/background processes were killed). `tsc` on the flight-lab module and 17/17 `test/flight-lab.test.js` pass. A visual check of the v2 rig on `/flight-lab` at 16:9 and 3:2 is still owed.

## Session log

- **2026-10-14 (V2 Rig Architecture Audit, Runtime Kinematics Fixes & Full 18-Clip Coordination):** Audited the V2 rig across runtime contracts, 6-phase procedural flight kinematics (`src/flight-lab/rig/`), Flight Lab playback, gameplay model wiring (`src/game/playerWyvernModel.ts`), the Blender CLI (`scripts/blender/`), and all 18 canonical animation clips. Applied seven test-first fixes (verified red-then-green): (1) added `neckWeights2: [0.45, 0.55]` in `spineWave.ts` so the 2-bone V2 `NECK_CHAIN` receives 100% weight instead of truncating the 4-bone array at 45%; (2) eliminated per-frame `Vector3` heap allocations in `gazeController.ts`, added 150ms velocity lookahead (`LOOKAHEAD_SECONDS = 0.15`), biological target priority selection (`selectGazeTarget`), and progressive 2-bone neck cascade via `applyNeckOffset`; (3) isolated `wyvernFlightRig` baseline tracking in `runtime.ts` by skipping `neckSpring.tick(delta)` when `flightRig` is active, preserved explicit `'climb'`/`'bankLeft'`/`'bankRight'` modes in `wyvernFlightRig.ts`, and enabled `createWyvernFlightRig` across all `wyvern-v2-*` specimens (`isV2RigSpecimen`) and `comparisonRig.ts`; (4) implemented phase-preserving loop crossfading (`resolvePhasePreservingCrossfadeTime` in `playback.ts`) across `cruise`/`bankLeft`/`bankRight` in `runtime.ts`, `comparisonRig.ts`, and `playerWyvernModel.ts`; (5) added dual V1/V2 clip resolution and automatic V2 `createWyvernFlightRig` attachment in `playerWyvernModel.ts` while keeping `DEFAULT_PLAYER_WYVERN_MODEL = "player-wyvern.glb"` unchanged until visual promotion approval; (6) updated `scripts/blender/contract.py` and `cli.py` so `python3 scripts/blender/cli.py audit-glb public/models/wyvern-v2-rig.glb` auto-resolves and normalizes `wyvern_v2_runtime_contract.json`; and (7) executed `tools/blender/coordinate_v2_bank_panels_mcp.py`, `tools/blender/coordinate_v2_locomotion_panels_mcp.py`, and `tools/blender/coordinate_all_v2_clips.mjs` to coordinate all 18 canonical clips into `assets/harvest-candidates/2026-10-07/mcp-study/wyvern-v2-flight-panels-coordinated.glb` (SHA-256 `2ef4eb1bdbca142d224041bccf16e192258d1936ffa94cb0bf78f07c4afb1b8c`, `5,685,288 B (promoted to public/models/wyvern-v2-rig.glb, saving 316 KB vs. previous 6,001,324 B runtime asset)`, pruning `1,008` orphaned sampler accessors in `compact_v2_glb.mjs` and saving `1.23 MB`). Across all 18 clips, max panel neighbor error dropped from `18.88°–179.97°` to `0.10°–0.71°` and peak p95 membrane creases dropped to `<= 40.66°` (`takeoff` `-44.63°`, `walk` `-36.12°`, `idle` `-23.26°`, `rest` `-19.12°`, `attack2` `-13.12°`, `land` `-11.59°`, `attackAir2` `-6.70°`), with `33/33` `test/wyvern-v2-kinetics.test.js` suites and `scripts/validate-wyvern-clips.mjs` passing cleanly. Promoted to `public/models/wyvern-v2-rig.glb` and updated `scripts/blender/wyvern_v2_runtime_contract.json` and `tools/asset-budget.json`; `player-wyvern.glb` remains untouched.

- **2026-10-08 (V2 Idle + Walk Flight Lab candidate):** Traced the visible Idle shake to Flight Lab's extra V2 procedural spine/tail/ground overlay being applied on top of authored `idle` and `walk`; the runtime now skips that overlay for those authored clips. Packaged separate candidate `public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb` from the reviewed V2 folded Idle and corrected Walk donors, plus a Blender-authored subtle 16-panel Idle breath. It retains 92 joints and all 18 clips; packaging asserts the other 16 clips and rig geometry/material/skin data are unchanged. The pinned `wyvern-v2-rig.glb` remains at its existing SHA-256 `b0667a7bf5b1484a216ed9851b26ccad3fa6d833a104beb9ed59b1898f725d3c`. Candidate numerical checks pass: Idle seam 0.0008 rad / zero root travel; Walk seam 0.0006 rad, translation seam 0.0005 rig units / zero root travel. Provisional visual grades from matched Blender 16:9 and 3:2 phase sheets: Idle **6/10** (stable, but low-headed; panel breathing is hard to read and the ground-splayed wing fold is angular), Walk **4/10** (loop closes, but sharp membrane ridges/creases and large asymmetric wing poses dominate; stance support and foot planting still need continuous playback review). Compared with V1 Idle, V2 reads lower and more angular in the matched phase review. Next improve Idle posture and folded-wing silhouette, then refine Walk support timing, planted-foot readability, and membrane curvature. These are phase-sample renders, not continuous playback qualification. Flight Lab browser playback was not verified because the local page was blocked by browser security policy; do not treat the candidate as gameplay-ready.

- **2026-10-07 (Bank corrective continuation):** V21 remains the best diagnostic right-bank candidate, not qualified. V30 midpoint construction failed center reconstruction because the additive solve omitted the existing V21 state. A new triangular peak at 80.5234375 worsened the local maximum from 3.968 to 4.326 units. A framewise reachability scan on a detached, action-free copy lowered the 80.5234375 hotspot to 1.204 units with about 0.925/0.075 pair weights. Fitting a monotone cubic over the whole 80.515625–80.53125 interval reduced a 17-sample 1/1024 error maximum from 4.450 to 3.116 units, but raised sampled max speed from about 624 to 1,206 units/frame; it remains an unqualified tradeoff. A fresh two-curve Action validation failed source-pose equivalence and was discarded. Blender was restored to clean V21. A larger model is not indicated; the remaining issue is independent action construction and temporal fitting on existing corrective shapes. Original study and active player hashes remain unchanged.

- **2026-09-08:** Inspected original Drogon, v2 and actual player with Blender MCP. Isolated and replaced the turning cruise loop; verified in Blender, Three.js and browser. Saved comparison study and regression gate.
- **2026-09-08, handoff:** User requested persistent notes to reduce repeated Astra usage and prioritize Blender model improvement. No additional model edits were made during this note-writing step.
- **2026-09-09:** Flight Lab rebuilt around the v2 rig only; added seam scan, matched orthographic cameras + floor, landmark telemetry and evidence export. No Blender or asset edits.
- **2026-10-02:** V2 wing harvest, coordination, and single-skin invariant. Audited V1 Drogon harvesting mechanics (coordinate mapping, rest-delta alignment, shifted joint names, cruise window). Expanded `rigBones.ts` with all 60 wing bones. Coordinated aerodynamic flutter and dive stoop tuck across digits D0-D5 and panels Panel0-3 with chiral mirroring in `wingRefinement.ts`. Enforced strict single-skin invariant (`skins.length === 1`, 92 joints, `skin: 0` on both meshes) with new kinetic test suites. All 814 fast tests, wildlife sim, and 113/113 mutation invariants pass.
- **2026-10-02 (Systematic Animation Improvements):** Upgraded `scripts/validate-wyvern-clips.mjs` with `MeshoptDecoder` to audit compressed runtime/candidate packages directly. Built `tools/audit-all-clips.mjs` and `tools/blender/splice_improved_clips.mjs`. Diagnosed 10 baseline defects in `public/models/wyvern-v2-rig.glb` across hover, scout, idle, and takeoff. Created candidate package `/tmp/wyvern-v2-systematic-candidate.glb`, reducing all 10 defects to zero (hover mirror 0.0010m, scout mirror 0.0010m, active idle/takeoff panel battens >0.005 rad, all loop seams <0.0012 rad). All 819 fast tests, 32 kinetics tests, and 16 wildlife routines pass cleanly.
- **2026-10-02 (Feet & Toes Dynamic Articulation):** Expanded `LEFT_LEG_CHAIN` and `RIGHT_LEG_CHAIN` in `rigBones.ts` with `L_Toes` and `R_Toes`. Added aerodynamic talon tuck in `boneOffsets.ts` (`LEG_TUCK_WEIGHTS = [0.45, -0.65, 0.25, -0.35]`) and dive mode stoop ($-0.25$ rad curl). Added pre-landing touchdown splay ($+0.35 \times \text{landingPrep}$) and ground clearance gating in `legPhysics.ts` and `wyvernFlightRig.ts` to zero procedural offsets when grounded. Added unit tests in `wyvern-flight-rig.test.js` and live model kinetics checks in `wyvern-v2-kinetics.test.js`.
- **2026-10-02 (Wing Tear & Creasing Corrections):** Resolved torn wing visual defect in Flight Lab. Decoupled ground locomotion domain from flight kinematics in `runtime.ts`: selecting `walk`, `idle`, `rest`, `death`, or melee attacks automatically sets `mode = "ground"`, pins altitude to `GROUND_ALTITUDE_Y`, and forces procedural airspeed and clearance to 0. Locked Digit 5 (`Alula / Thumb Claw`) rigid in `wingRefinement.ts` to prevent pulling the wrist membrane pocket away from the arm. Clamped procedural deflection angles to $[-0.25, +0.25]$ rad. Enforced `DoubleSide` rendering and shadow biasing on skinned meshes in `modelProcessor.ts`.

- **2026-10-08 (Membrane repair exported to Flight Lab):** Select **V2 Membrane Repair Candidate**. Separate GLB preserves the pinned source geometry, skin, materials and all 18 authored clips, with added membrane surface metadata. Flight Lab reproduces the Blender post-skin Smooth repair, including pinned boundaries and welded seam neighborhoods. All 306 Blender poses improve p95 crease angles by at least 23.44%; runtime positional comparison passes at every pose. Browser checks cover all 18 clips and wire/silhouette toggles in both viewport formats without errors. Evidence and editable Blender file: `assets/rig-audits/2026-10-08-membrane-fix/`. This is a Lab-supported candidate, not a vanilla GLB modifier bake or player replacement. Remaining work: tiny acute folds/self-intersections, Walk foot planting and Idle posture.
