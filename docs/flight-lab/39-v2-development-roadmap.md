# FlightLab V2 Development Roadmap

**Date:** 2026-10-21 (Updated 23:16)
**Companion docs:** [40-architecture-audit-and-prioritized-path.md](40-architecture-audit-and-prioritized-path.md) (codebase & architecture audit) · [41-v2-and-blender-rig-audit-task-list.md](41-v2-and-blender-rig-audit-task-list.md) (V2 rig, Step 5 audit review, Blender rig anatomy audit & Flight Lab AI task list, Workstreams A–E)
**Status legend:** Priority **P0** (blocking quality/shipping) · **P1** (high leverage) · **P2** (polish/scale). Dependencies reference milestone IDs.
**Rig legend:** ✅ available on both rigs · **~~struck~~** = greyed out, **not available on the V1 rig**.

---

## 1. Baseline (what exists today)

| Layer | State |
|---|---|
| Runtime asset | `public/models/wyvern-v2-rig.glb` — 95 nodes, 92 skin joints (**90 weighted deforming bones**, 2 non-deforming root joints: `Root`, `RootMotion`), 1 skin, 2 meshes (`WyvernBody_Rebuild` 34,614 tris + `WyvernMembrane_ExportSafe` 15,258 tris = 49,872 tris), 18 clips, meshopt **6.37 MB (`6,368,564 B`)**, sha256 `950c4321…`, contract-pinned |
| Review candidates | `wyvern-v2-membrane-lab-candidate.glb`, `wyvern-v2-idle-walk-flight-lab-candidate.glb` (byte-identical to runtime asset, sha256 `950c4321…`, marked as `promotedAliasOf: "wyvern-v2-rig"` in `catalog.ts`) |
| V1 reference | `player-wyvern.glb` — 13 clips, 2 skins, 39,234 tris, integrated human rider + 17 cloak bones, CUBICSPLINE tracks, 100× different unit scale (`62.7` vs `6,266.8` raw units) |
| Blender sources | **`models/source/wyvern-v2-master.blend` reconstructed (`Task C1` ✅)**: 92 deform bones in `00 Deform`, 2 meshes, 18 canonical actions, 1 clean scene. Legacy files: `wyvern-rig.blend` (56 bones / 39 weighted, 1 mesh, 16 actions, 12 junk `ENE_PT_*` scenes); `wyvern-rig-v1wing.blend` (124 bones / 106 weighted, missing 16 `WingPanel` bones, L/R roll & length asymmetries on `R_WingD0..3P0` and `R_WingBatten061..066`). |
| Procedural rig | `src/flight-lab/rig/` — spine/neck wave, gaze + VOR, tail, wing refinement, leg physics, jaw seal; **V2-only** (`isV2RigSpecimen`); **Workstream B (`Tasks B1–B3`) bug fixes landed** |
| Runtime | `src/flight-lab/runtime.ts` (+ `comparisonRig.ts`, `playback.ts`, `camera.ts`, `kinematics/`), clip-name helper in `src/game/playerWyvernModel.ts` |
| Tests | **165 fast tests (`npm run test:fast`)**, `tsc --noEmit` clean, `validate-wyvern-clips --strict` clean (`0` problems, `0` warnings); **no lint config, no CI** |
| Asset governance | Runtime contract (`scripts/blender/wyvern_v2_runtime_contract.json` + `tools/blender/runtime_rig_contract.mjs` — enforces `0` orphaned samplers per clip), promotion protocol in doc 14, shared GLB edit helpers (`tools/blender/glb_clip_edit.mjs`), headless Blender CLI |
| Recent wins | **Workstreams A (`A1–A3`), B (`B1–B3`), C (`C1–C3`), and D (`D1`, `D2`, `D3`, `D5`, `D4-attack`) completed**: orphaned-sampler leak fixed; `idle` horizon eyeline leveled (`+0.4°`); `walk` `+8.6°` jaw closed; `land → idle` snap smoothed to `0.0000°`; 4 runtime procedural-rig bugs fixed (`B1–B3`); 92-bone `wyvern-v2-master.blend` reconstructed (`C1`); `L/R_WingPanel0_0`, `1_0`, and `Tail1` weighted (`C2`, `85 → 90` deforming bones); `cli.py`/`gltf.py`/`control_rig.py` fixed (`C3`); 10-clip `Body` drift, grounded `footY` (`-184`), and `attack2`/`attackAir2` floor penetration fixed (`D1`); Stage 3 `BUZZ` (`takeoff`, `death` — `D2`), `CONCENTRATED` (`idle`, `walk`, `attack2` — `D3`), and `attack` (`D4`) passed dynamics gate; M2 mobile reachability verified (`0/107` unreachable) |

Open technical & rigging debts carried into this roadmap (detailed in [doc 40](40-architecture-audit-and-prioritized-path.md) and [doc 41](41-v2-and-blender-rig-audit-task-list.md)):
- **Blender Rig Anatomy, Control-Rig & Skinning Refinements (`Tasks C4–C7` in [doc 41](41-v2-and-blender-rig-audit-task-list.md))**:
  1. **`scripts/blender/rigging/control_rig.py` IK/FK & Slotted-Action Bugs (`Task C4` ✅ done 2026-10-21)**: contact plane corrected to the measured skinned sole (**`-2.6549`**, not `-184.0` and not the bone-tail `+142.2`); `CTRL_Pole_Elbow_L/R` added on the geometric bend bisector with `pole_angle` `164.0° / 9.5°` (uncalibrated it displaced the wing `176.47°` at rest); panels solved by `apply_panel_bisect()` instead of constraints (a LOCAL `COPY_ROTATION` pair over-rotates to `28.20°` where `10.00°` is required); `ActionCompat.setup_slotted_action()` now precedes `bpy.ops.nla.bake()`. **`0.0°` rest deviation across all 92 deform bones with `ground_contact_ik = 1.0`** (`assets/rig-audits/2026-10-21-control-rig/`).
  2. **Thoracic (`Spine1..3`), Scapular (`L/R_WingRoot`), and Distal Membrane Panel Weight Imbalances (`Task C5 ✅ done 2026-10-21`)**: `L/R_WingPanel0_1`, `2_0`, `3_0` had only `36–53` vertices (`w = 0.3–1.1`) in `WyvernMembrane_ExportSafe`; `L_WingRoot` (`8` verts, `w = 0.9`) vs `R_WingRoot` (`24` verts, `w = 2.2`) had a 3× L/R asymmetry. All 16 panels now own `26.8–57.2%` of their inter-digital web, `WingRoot` is `118/127` verts (`ratio 0.0066`), and no paired bone exceeds `|L−R|/(L+R) = 0.0165`. **Measured correction:** the `Spine3` "rigid chest block" reading was wrong — 92% of its mass is above `Neck1.head` and the chest carries ~63 of it, so C5 rebalanced `Spine3 → Neck1/Neck2/Head` instead of `→ Spine1/Spine2` (neck-slab `dominant==nearest` agreement `20.1% → 59.9%`).
  3. **Off-Center/Inverted `Jaw` Hinge & Degenerate `0.05`-Unit `Body` Stub (`Task C6`)**: `Jaw.head` is at `[3.6, -583.7, 867.8]` (`3.6` units left of midline and `74.5` units *above* `Head` `[0.0, -547.3, 793.3]`), causing lateral jaw yaw when opening; `Body` is a `0.05`-unit stub (`[0, 432.1, 711.6] → [0, 432.1, 711.7]`) co-located with `Tail1`; and `RootMotion` stretches diagonally (`length = 832.57`) to the back instead of lying flat on the ground plane.
  4. **L/R Roll & Length Asymmetry in `wyvern-rig-v1wing.blend` (`Task C7` ✅ done 2026-10-22)**: `R_WingD0..3P0` had `14.9°–22.5°` roll errors and `9.1–16.4` unit length mismatches vs `L_WingD0..3P0`, and `R_WingBatten061..066` pointed forward (`roll = +128.9°..+132.5°`). Fixed: 32 pairs mirrored (`0` failing), 18 orphan vertex groups and 2 zero-user materials purged.
- **Stage 3 Flight Group Remainder (`Task D4` partial — `cruise`, `bankLeft`, `bankRight`)**: Amplification alone breaks two product invariants (`cruise` single-frame `t = 1.0s` `maxMembraneX > 2500` check folds to `2256.4` at `1.68×` gain; `bankLeft`/`bankRight` `6.7×` gain + smoothing shifts wingbeat cadence from `0.500 Hz` to `1.500 Hz`, violating the `8%` flight phase group lock). Requires authoring motion across unkeyed channels and/or replacing the single-frame `t = 1.0s` `maxMembraneX` proxy with the pose-independent `maxMembraneX >= wingTipPos.x` check.
- **Flight Lab AI & Anomaly Detection Blind Spots (`Workstream E / Tasks E1–E4`)**: `Scan` (`motionProbe.ts:scanSeam`) only checks quarter-frame jumps `> 10°`; Inspection Pins report raw `bone.quaternion` Euler instead of **Bind Delta**, **Procedural Offset**, and **World Horizon Pitch** and lack a UI note field; `Export` downloads to `~/Downloads` outside the repo sandbox.

---

## 2. Capability matrix — V2 vs V1 (greyed = V1-unavailable)

Structural reason most items are V2-only: V1 uses `Bip002-*` bone names, a 100× different unit scale, and no `Neck1/Neck2/Head`-named chain — the procedural rig, rider mount, and splice tooling are all keyed to V2's skeleton.

| Action / capability | V1 | V2 |
|---|---|---|
| Authored clip playback, camera presets, telemetry, landmark pins, evidence export | ✅ | ✅ |
| Runtime contract validation, dynamics audit (V1 = reference baseline) | ✅ | ✅ |
| Mesh metrics, seam scan, wire/silhouette toggles | ✅ | ✅ |
| ~~Procedural flight rig: spine/neck wave~~ | ~~greyed~~ | ✅ |
| ~~Gaze controller + vestibulo-ocular reflex~~ | ~~greyed~~ | ✅ |
| ~~Tail counterweight / rudder, wing turbulence & stoop fold~~ | ~~greyed~~ | ✅ |
| ~~Leg tuck, gait articulation, touchdown splay~~ | ~~greyed~~ | ✅ |
| ~~Flight jaw seal~~ | ~~greyed~~ | ✅ |
| ~~Rider mount + rider runtime (Spine3-calibrated)~~ | ~~greyed~~ | ✅ |
| ~~Membrane surface runtime (panel bones)~~ | ~~greyed~~ | ✅ |
| ~~Bank corrective shape-key surfaces~~ | ~~greyed~~ | ✅ |
| ~~Neck/head channel splice tooling~~ | ~~greyed~~ | ✅ |
| Clips: `land`, `rest`, `walk`, `breath`, `dive`, `glide`, `hover`, `scout`, `speed`, `attack2`, `attackAir2` | ~~greyed~~ | ✅ |
| Ground-mode procedural overlay suppression for authored clips | ~~greyed~~ | ✅ |
| V1-only: integrated human rider mesh under Spine3, 17 cloak bones, `Roar`/`Hit`/`GroundTurnLeft`/`GroundTurnRight`, CUBICSPLINE authored curves | ✅ | — |

**Consolidated greyed-out list (V1 cannot do these):** the entire procedural flight rig and its sub-controllers; rider mount/runtime; membrane surface runtime; bank correctives; neck/head splice tooling; 11 of the 18 V2 clips (listed above); ground-mode overlay suppression. Mode→clip resolution on V1 therefore falls back for `land`, `rest`, `boost`, and `scout` — M4 makes those fallbacks explicit instead of silent.

---

## 3. Milestones

### M1 — Error handling & failure visibility · P0 · deps: none

**Scope.** No silent failures anywhere on the load→play path.
- Typed error model with stable codes for: asset fetch/parse failure, contract drift, clip-unavailable-for-rig, WebGL context loss, camera-framing loss.
- Asset load failure: keep the previous specimen visible, show a banner with retry + "switch to V2 rig" recovery (today's "V1 missing" report was a camera-state dead end with no recovery affordance — that class of dead end is what this kills).
- Contract drift at load (**Gap A in doc 40**): validate fetched GLB against the pinned contract in `loadSpecimen` and fail loud with the exact remediation command (`node tools/blender/runtime_rig_contract.mjs … --candidate` / re-pin procedure from doc 14).
- Clip resolution (**Gap B in doc 40**): wire the existing `resolveModeCapability()` `ClipResolutionStatus` (`exact`/`alias`/`fallback`/`unavailable`) through `runtime.ts` → `FlightControls` badge instead of dropping `status` via `resolveFlightLabClip`.
- WebGL `contextlost`/`contextrestored` handling with a user-visible notice.
- Camera: auto-refit on model load (exists) + out-of-frustum detection that offers the reset (the Fit/Reset affordance exists but nothing detects the need).
- Error-path tests: corrupt GLB, missing clip, aborted load, contract mismatch.

**Exit criteria.** Zero silent catch blocks in `src/`; every failure mode above has a test and a visible recovery action.

### M2 — Mobile reachability verification · P0 · ✅ CLOSED (verified 2026-10-21)

**Scope & Outcome.** Re-measured at 390×844 and 360×800 across Chromium and WebKit after the afternoon panel rework (`4c2d104`):
- `scripts/probe-mobile-reachability.mjs`: **107 controls, 0 unreachable** in all four engine×viewport combinations (drawers scroll internally via `overflow-y: auto`).
- `scripts/probe-mobile-drawers.mjs`: `document.elementFromPoint` hit-test with each drawer open individually → **0 covered, 0 unreachable** (proven red against pre-rework CSS `2b8373d` where 4 controls failed).
- **Remaining action**: wire both probe scripts into CI under M3.

**Exit criteria.** ✅ Met — all controls reachable at 360×800 without horizontal scroll; measurement scripted in `scripts/probe-mobile-*.mjs`.

### M3 — Test, lint & CI foundation · P0/P1 · deps: none

**Scope.**
- ESLint config (strict TS rules, zero-new-`any` budget locking the 7 existing sites, no floating promises) — currently absent.
- GitHub Actions on PR: `tsc --noEmit` + `test:fast` + `assets:validate-wyvern` + clip validator + mobile reachability probes.
- Fix the self-healing `test/rider-mount.test.js` ("`mountData.ts is generated from the assets`" currently rewrites the file it checks, failing once and then passing).
- Per-test failure capture with names and flake-quarantine policy.
- Resolve the Playwright version mismatch between `~/.workbuddy-ai/harness/bin/render.mjs` (1.63.0 / build 1243) and the managed workspace (`1.64.0-alpha` / build 1247) before scheduling the multi-engine screenshot harness.

**Exit criteria.** PRs run the full gate; `rider-mount.test.js` is read-only in test mode; the flake class from 2026-10-21 is impossible to reproduce unnamed.

### M4 — Runtime hardening, procedural-rig bug fixes & V1/V2 parity · P0/P1 · deps: M1 (Workstream B ✅ done)

**Scope.** Includes **Workstream B (`Tasks B1–B3` in [doc 41](41-v2-and-blender-rig-audit-task-list.md), ✅ completed in `5fb3ab1`)** and **Gaps C/D in [doc 40](40-architecture-audit-and-prioritized-path.md)**:
- ✅ **Task B1 — `jaw` baseline tracking & respiratory motion (`wyvernFlightRig.ts`, `flightMouth.ts`, `runtime.ts`)**: `jaw` added to `allControlledBones`; `sealFlightJaw()` now accepts context and only clamps on `dive`/`speed`/`> 12 m/s` or `> 2°` static drift, preserving `±0.4°` breathing; `isMouthActionActive` includes `roar` and `death`.
- ✅ **Task B2 — Ground-mode gaze gating & `dive` head composition (`wyvernFlightRig.ts`, `gazeController.ts`)**: `holdStreamlinedHeadPose` hard overwrite removed; grounded-no-target and dive-no-target smoothly damp toward zero via `FlightContext.isGroundedMode`.
- ✅ **Task B3 — Wire `bankRightHotspotFrame` at runtime (`runtime.ts`, `comparisonRig.ts`, `membraneSurfaceRuntime.ts`)**: `bankRightHotspotFrame` populated at both `runtime.ts` call sites and `comparisonRig.ts`, with cache invalidation on hotspot iteration changes.
- **Remaining M4 items**:
  - **Harden `mixerBindings.ts` (do NOT delete)**: Call `mixerBindingsAreSupported()` at load and add a dedicated unit test so any Three.js private-field rename fails loud.
  - **Consolidate clip-alias tables**: Merge `runtime.ts:271`'s inline 17-entry `aliases` map into `clipResolver.ts` (`MODE_CLIPS` + `ONESHOT_ALIASES`) so clip resolution uses a single source of truth.
  - **V1 clip-data safety & scale normalization**: Enforce `track.clone()` deep-copy discipline on V1's 429 shared CUBICSPLINE buffers and assert normalized extents per specimen at load.

**Exit criteria.** Tasks B1–B3 ✅ green; `mixerBindings.ts` guarded and tested; single clip-resolution table; V1 loads validated clip data.

### M5 — Clip-dynamics measurement trust · P1 · deps: M3 (mostly complete)

**Scope.** Substantially landed in `tools/diagnose-clip-dynamics.mjs` and `scripts/wyvern-dynamics.mjs`:
- `range` saturation at 180° is documented in-code with `travel` (cumulative `|dq|`, unbounded) alongside `rate` and duty cycle.
- V1 reference baseline (`assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json`) is frozen and SHA-256 pinned.
- **Remaining closure items**:
  - Codify one-shot vs loop seam policy (`takeoff` seam 3.13 rad is a one-shot, not a loop) and document why `accents` is report-only.
  - Re-examine the single-frame `t = 1.0s` `maxMembraneX > 2500` proxy in `test/wyvern-v2-kinetics.test.js` (which blocks `cruise` `1.68×` wing amplification even though the pose-independent `maxMembraneX >= wingTipPos.x` invariant holds across all frames).

**Exit criteria.** Closure note + one-shot seam exemption rule + pose-independent wing-span invariant check landed.

### M6 — Stage 3 clip dynamics re-authoring · P1 · deps: M4, M5 (D2, D3, D4-attack ✅ done; cruise/banks open)

**Scope.** Detailed in **Workstream D (`Tasks D2–D4` in [doc 41](41-v2-and-blender-rig-audit-task-list.md))** and [doc 37 taxonomy](37-stage3-clip-defect-taxonomy.md):
- ✅ **Task D2 — `BUZZ` clips (`takeoff`, `death` — completed in `c968a24`)**: `takeoff` peak `0.27× → 1.68×` V1, `death` peak `0.47× → 1.16×` V1 via `tools/blender/reshape_buzz_clips.mjs`.
- ✅ **Task D3 — `CONCENTRATED` clips (`idle`, `walk`, `attack2` — completed in `562131d`)**: Travelling secondary-motion floor added via `tools/blender/reshape_d3_clips.mjs` (`idle` `p95` `19 → 197 deg/s`, `walk` `p95` `315 → 929 deg/s`, `attack2` `accelMax` `83,690 → 37,710 deg/s²`).
- 🔄 **Task D4 — `UNIFORM` clips (`attack` ✅ done in `541b3e8`; `cruise`, `bankLeft`, `bankRight` open)**:
  - ✅ `attack` amplified (`0.09× → 0.91×` V1 peak via `11.1×` gain + strike accent in `tools/blender/reshape_d4_clips.mjs`).
  - **Remaining (`cruise`, `bankLeft`, `bankRight`)**:
    1. **`cruise`**: Either update the single-frame `t = 1.0s` `maxMembraneX > 2500` test proxy to sample peak wing extension across the stroke cycle (while preserving `maxMembraneX >= wingTipPos.x`), or phase-shift `cruise` / distribute angular velocity across `Spine2..3`, `Neck1..2`, and `Tail2..10` so `cruise` clears `1.68×` without folding the wingtip at `t = 1.0s`.
    2. **`bankLeft` / `bankRight` (`mean` channel `0.586×` vs `>= 0.70×` target)**: Because a `6.7×` gain + smoothing shifts measured wingbeat cadence from `0.500 Hz` to `1.500 Hz` (breaking the `8%` flight phase group lock with `cruise`), author continuous mid-stroke recovery motion and `0.500 Hz`-locked secondary body/tail/neck banking roll across the unkeyed channels (`WingShoulder..WingHand`, `Spine2..3`, `Neck1..2`, `Tail2..10`) so `mean >= 0.70×` at the native `0.500 Hz` wingbeat frequency.
    3. Invert `assert.equal(result.passed, true)` in `test/wyvern-v2-dynamics.test.js` once `cruise`, `bankLeft`, and `bankRight` pass alongside the 6 already-passing clips.

**Exit criteria.** All 9 mapped clips pass `npm run assets:audit-dynamics:v2` and `test/wyvern-v2-kinetics.test.js` simultaneously; `test/wyvern-v2-dynamics.test.js` inverted to assert pass.

### M7 — Animation polish, Blender rig anatomy & skinning weight refinement · P1/P2 · deps: M6 (Tasks A2, A3, C2, C5, C6, C7, D1 ✅ done)

**Scope.** Combines completed GLB stabilization tasks (`A2`, `A3`, `C2`, `D1`) with the **new Blender rig & skinning refinement tasks (`Tasks C5–C6`)** uncovered in the Blender DNA/skin audit ([doc 41 Part 3 & Workstream C](41-v2-and-blender-rig-audit-task-list.md)):
- ✅ **Completed (`Tasks A2, A3, C2, D1`, 2026-10-21)**:
  - `idle` world horizon eyeline leveled (`+0.4°`); `walk` `+8.6°` jaw closed; `land → idle` snap smoothed to `0.0000°` (`Tasks A2–A3`).
  - Zero-weight `L/R_WingPanel0_0`, `L/R_WingPanel1_0`, and `Tail1` bound in `tools/blender/bind_missing_panel_and_tail1_weights.mjs` (`1,411` membrane + `815` body vertices updated; `nonDeformingJoints` reduced from `7` to `2`: `["Root", "RootMotion"]` — `Task C2`).
  - Horizontal `Body` drift flattened across 10 clips, grounded `footY` aligned to `-184`, and `attack2`/`attackAir2` underground wing penetration lifted (`1703 → 1.3` / `1495 → 3.1` rig units) in `tools/blender/stabilize_v2_body_and_feet.mjs` (`validate-wyvern-clips --strict` exits `0` with `0` problems and `0` warnings — `Task D1`).
- ✅ **Completed (`Task C5`, 2026-10-21)** — `tools/blender/rebalance_v2_skin_weights.mjs` + `audit_v2_skin_weights.mjs` (evidence `assets/rig-audits/2026-10-21-skin-weights/`):
  - **Distal/mid membrane panels (`WyvernMembrane_ExportSafe`)**: all 16 panels now own **26.8–57.2%** of their inter-digital web (was `0.0–12.0%`); 2,319 web vertices handed `20–35%` graded batten weight, `437.94` mass moved with the 8,249 total preserved. `L/R_WingPanel0_1` `0.45/0.43 → 50.70/50.17`, `2_0` `0.60/0.58 → 12.27/11.87`, `3_0` `0.26/0.28 → 22.90/23.07`.
  - **Scapular `L/R_WingRoot` symmetry & falloff (`WyvernBody_Rebuild`)**: `110` new vertices per side with a `0.15→0.35` distance falloff. `L_WingRoot` `8 verts / 0.95` → **`118 / 26.90`**, `R_WingRoot` `24 / 2.16` → **`127 / 27.26`**; the 3× asymmetry is now `ratio 0.0066`.
  - **"Thoracic" cliff — corrected by measurement**: `Spine3`'s `5,624.8` mass is **92% above `Neck1.head`**; the chest carries only `~63`, so the `Spine2 → Spine3` hinge framing was a metric artifact. `Spine3` was instead over-owning the `Neck1` span (**3,832 vertices** whose nearest bone segment is `Neck1`, which held only `284` of 8,194 neck-slab vertices). C5 hands `50%` of `Spine3`'s mass to the geometrically nearest of `Neck1/Neck2/Head`: `2,150.69` mass over 5,311 verts, `Spine3 5,624.78 → 3,531.4`, `Neck1 412.85 → 2,539.9` (body-only). Neck-slab `dominant==nearest` agreement **20.1% → 59.9%**.
  - **Gates**: `audit_v2_skin_weights` `passed: false` (4 failing pairs) → **`true`** (worst `0.0165`); `audit-wyvern-rig --check` exit 0; `npm run test:fast` **165/165**; `tsc` clean. `cruise` `maxMembraneX` **2780.9 → 2780.9**, so D4's cruise blocker is untouched.
  - **Root cause of the silent no-ops**: `readSkin` compared raw `POSITION` against `bindWorldPos()` across two different spaces (bind scale `2187.9565`, plus normalized-`SHORT` body positions under `KHR_mesh_quantization`). Fixed in the shared `tools/blender/glb_skin_io.mjs` (`bindMeshToWorld()` asserts the joint-invariance of `jointWorld(j)·IBM(j)`; `readSkin` now returns bind-world positions).
- **Task C6 — Recenter `Jaw` Hinge Pivot & Normalize `Body` / `RootMotion` Edit-Bone Geometry in Blender**:
  - **Fix `Jaw` off-center & inverted hinge**: In `models/source/wyvern-v2-master.blend`, `Jaw.head` sits at `[3.6, -583.7, 867.8]` — **`3.6` rig units left of the sagittal midline (`X != 0`) and `74.5` rig units *above* `Head.head` (`[0.0, -547.3, 793.3]`)**, with a skewed rest quaternion (`[0.1180, -0.0180, 0.0031, 0.9928]`) that yaws the lower jaw sideways when opening. Recenter `Jaw.head` to `[0.0, -565.0, 785.0]` (`roll = 0.0°`) at the anatomical mandible hinge and compensate `Jaw:rotation` tracks across all 18 clips.
  - **Fix `0.05`-unit `Body` stub & diagonal `RootMotion` bone**: Extend `Body.tail` in Blender Edit Mode from `[0.0, 432.1, 711.7]` (`length = 0.05`) to `Spine1.head` (`[0.0, 268.5, 724.2]`, `length = 164.1`), and place `RootMotion.tail` flat on the ground plane (`[0.0, -200.0, 0.0]`) instead of stretching diagonally to `[0.0, 117.7, 824.2]` (`length = 832.57`), preserving exported glTF node `translation`/`rotation`.
  - ✅ **Completed 2026-10-22, blend *and* runtime.** `Jaw.head` → `[0.0, -565.0, 785.0]`, local `X` `2.0896° → 0.0000°` off world `X`, `Body.length` `0.0505 → 164.0669`; `RootMotion` deferred (a `98.13°` rest change that rotates every clip) and reported as a `SKIP` with its reason. The wording above overstated the jaw defect — it was **not** a gross yaw: the axis was `2.09°` off lateral, giving `3.26` units of drift per 45° of opening, and the real fault was the pivot sitting `82.8` units above the joint. Promoted to the shipped GLB by `tools/blender/recenter_v2_jaw_pivot.mjs` (`b5f1c1ef…` → `04dbda5c…`), which touches exactly three fields and is byte-idempotent; hinge axis is now `0.0000°` in every clip that opens the jaw and jaw-mesh lateral drift at 45° is `2.816 → 0.000000` over 947 vertices. **The jaw's amplitude is authored again too** (`04dbda5c…` → `f5d768a2…`): the D2/D3/D4 gain passes had been amplifying the mouth with the rig, so `attack` / `attack2` / `death` opened `176.9°` / `53.7°` / `179.1°` against the blend's `32.0°` / `24.0°` / `50.0°`. `death` could not simply be restored — the mouth set the maximum angular rate in 158 of its 240 frames, so that clip's dynamics gate was being paid for by an impossible pose — so its non-jaw gain was re-solved at `1.9×` capped at `165°` from bind (`peak 1728 / p95 862 / mean 418`, `17.4%` worst margin). See `tools/blender/restore_jaw_amplitude.mjs` and doc 41 notes 13–19.

**Exit criteria.** Symmetrical `L/R_WingRoot` weights, smooth `Spine1..3` and `WingPanel0..3_0..1` weight gradients, centered `Jaw` pivot (`X = 0.0`), and continuous-playback visual qualification for `idle`, `walk`, and `bankRight`.

### M8 — Asset pipeline hygiene, Blender master source & `control_rig.py` hardening · P0/P1 · deps: none (Tasks A1–A3, C1, C3, C4, C7, D5 ✅ done)

**Scope.** Combines completed pipeline tasks (`A1–A3`, `C1`, `C3`, `D5`) with the **new Blender control-rig and donor-rig fixes (`Tasks C4, C7`)** from [doc 41](41-v2-and-blender-rig-audit-task-list.md):
- ✅ **Completed (`Tasks A1–A3, C1, C3, D5`, 2026-10-21)**:
  - `splice_neck_head_channels.mjs` sampler leak fixed and `runtime_rig_contract.mjs` orphaned-sampler assertion added (`Task A1`); `-32°` neck-lift regression bomb removed from `upgrade_v2_rig_ground_and_membrane.mjs` (`Task A2`); `walk` jaw and `land → idle` handoff fixed (`Task A3`).
  - Canonical 92-bone, 2-mesh `models/source/wyvern-v2-master.blend` reconstructed via `tools/blender/build_v2_master_blend.py` with 1 clean scene and 18 actions (`Task C1`).
  - `scripts/blender/cli.py` positional `glb` forwarding fixed, `scripts/blender/export/gltf.py` updated for 2-mesh auto-detection and `export_def_bones=False`, and `WING_FOLD_RATIOS` in `control_rig.py` expanded with all 16 `WingPanel` bones (`Task C3`).
  - Candidate specimens marked with `promotedAliasOf` in `src/flight-lab/catalog.ts` and unreferenced `wyvern-v1-rig.glb` symlink removed (`Task D5`).
- **Task C4 — Fix the 6 `scripts/blender/rigging/control_rig.py` IK/FK, Floor-Plane & Slotted-Action Bugs**:
  1. *(Staged in working tree — commit & test)* Calibrate `CTRL_FootIK_L/R` `ik.pole_angle` (`-70.18°` L / `-109.81°` R) with `CTRL_Pole_Knee_L/R` (`offset = (0, -200, 0)`), default `ground_contact_ik = 0.0`, and replace `Tail1..10` `DAMPED_TRACK` (`CTRL_TailTrack_*`, which bent the tail upward toward `+50 Z` even at rest) with local-space `COPY_ROTATION` (`mix_mode = "ADD"`, `target_space = "LOCAL"`, `owner_space = "LOCAL"`) and zero-offset `CTRL_Tail_Base/Mid/Tip`.
  2. **Fix `CANONICAL_CONTACT_PLANE_Z = -184.0` coordinate-space bug (`control_rig.py:29`)**: `-184.0` is the glTF `Body`-relative foot height, whereas in Blender world space (`Root` at `Z = 0`, `Body` at `Z = +711.6`), the rest-pose feet sit at **`Z = +142.2`**. Update `CANONICAL_CONTACT_PLANE_Z` and `compute_canonical_contact_plane()` so `CTRL_FloorPlane` clamps at the actual Blender world-space foot plane (`+142.2` in rest pose or evaluated per-action stance minimum).
  3. **Fix `CTRL_WingKnuckleIK_L/R` target & elbow pole (`control_rig.py:242-255`)**: Move `CTRL_WingKnuckleIK_L/R` onto `L/R_WingWrist` (or add `CTRL_Pole_Elbow_L/R` pole targets and calibrate `pole_angle`) so enabling `ground_contact_ik` solves the knuckle contact without twisting `WingShoulder`.
  4. **Add automatic inter-digital Pair-Bisect Constraints on `L/R_WingPanel0..3_0..1`**: In `build_control_rig()`, add dual `COPY_ROTATION` constraints on each `WingPanel{K}_0` and `WingPanel{K}_1` (`0.5` influence to `WingD{K}P0/1` and `0.5` influence to `WingD{K+1}P0/1` in `LOCAL` space) so membrane panels automatically bisect adjacent fingers live in the Blender viewport and bake cleanly into deform tracks on export.
  5. **Fix Blender 5.1 slotted-action baking in `bake_control_rig_to_deform()` (`control_rig.py:345-365`)**: Call `ActionCompat.setup_slotted_action(action, armature)` before `bpy.ops.nla.bake()` so multi-slot actions in Blender 5.1 always bind the active `OBWyvernRig` slot before baking.
 - **Task C7 — Symmetrize `models/source/wyvern-rig-v1wing.blend` Edit-Bone Rolls & Lengths ✅ DONE 2026-10-22**:
   - 32 failing L/R pairs mirrored across `+X → -X` (`R'_right = S · R_left · S`), eliminating the `14.9°–22.5°` roll errors and `9.1–25.6` unit length mismatches on `R_WingD0..5P0`, `R_WingHand`'s `179.99°` roll and the inverted `R_WingBatten061..066` tails. Audit now reads **0 failing pairs / `passed`** (`tools/blender/audit_v1wing_symmetry.py`, `assets/rig-audits/2026-10-22-c7-v1wing-symmetry/`). The 18 orphaned `WingFinger*`/`WingClaw`/`WingMembrane*` vertex groups and 2 zero-user materials are purged; the doc's "15 junk `ENE_PT_*` scenes" was measured stale (1 scene, and `wyvern-rig.blend` is entirely clean). No fcurve was modified — see doc 41 Task C7 for why.
- **Blend↔GLB sync check in CI**: Headless export from `models/source/wyvern-v2-master.blend` and compare clip/joint/target signatures against `public/models/wyvern-v2-rig.glb`.

**Exit criteria.** `tools/blender/tests/test_control_rig.py` verifies `0.00°` rest-pose drift when `build_control_rig()` is applied, automatic panel bisection under digit rotation, and slotted-action baking; CI sync check green.

### M9 — Game-side V2 integration & promotion · P2 · deps: M6, M7, visual approval

**Scope.** *(Rescoped per [doc 40 §2.3](40-architecture-audit-and-prioritized-path.md): `src/game/playerWyvernModel.ts` is currently a 46-line pure clip-name resolver with no `DEFAULT_PLAYER_WYVERN_MODEL` constant and no game runtime in this standalone repo.)*
- Decide whether game-side integration lives in the external game repository (Fantasy Biomes / Sanctuary) or requires a playable harness route in this repo; only promote V2 as the default player wyvern after M6/M7 qualification and recorded visual approval.

**Exit criteria.** V2 is promoted with verified clip/rig wiring in the target game runtime; V1 remains loadable as the reference specimen in Flight Lab.

### M10 — Performance, tooling consolidation & packaging · P2 · deps: M8

**Scope.**
- Reinstate or remove `tools/asset-budget.json` (now guarded with `existsSync` in `upgrade_v2_rig_ground_and_membrane.mjs`) and enforce GLB byte budgets in CI.
- Collapse the 60-file `bankright` script ladder (`9,633 LOC` in `tools/blender/`) into a single parameterized script (**Gap F in doc 40**), and clean up porting scars (`src/sanctuary-studio/webglContext.ts`, duplicate `GLTFLoader` setup in `gltfLoader.ts` vs `modelLoader.ts`).
- Document and harden dev-server HMR remount recovery on the 8 GB machine.

**Exit criteria.** Asset budget enforced in CI; `bankright` tool ladder consolidated; porting scars cleaned up.

### M11 — Flight Lab AI Co-Pilot, Pose-Anomaly Detector & Blender-to-Runtime Bridge · P0/P1 · deps: M1, M4

**Scope.** Directly addresses why the `-65°` `idle` neck raise, `+8.6°` `walk` open jaw, and `15.9°` `land → idle` transition snap passed all existing Flight Lab scans without an error (**Workstream E / `Tasks E1–E4` in [doc 41](41-v2-and-blender-rig-audit-task-list.md)**):
- **Task E1 — Upgrade `Scan` (`motionProbe.ts` + `validate-wyvern-clips.mjs`) into `scanClipAnomalies()`**:
  - **Bind-Delta & Horizon Pitch Envelope**: Compute per-bone delta from bind (`q_bind^-1 * q_clip`) and cumulative `Body + Spine1..3 + Neck1..2 + Head` world pitch (`netHeadPitchDeg`). Flag any non-combat/non-dive clip where `|bonePitchVsBind| > 18°` (catches `idle`'s `-21.1°/-24.2°/-19.3°` neck raise) or any grounded clip with `netHeadPitchDeg` outside `[-12°, +12°]`.
  - **Unintended Open Jaw Detector**: Flag any non-mouth clip (`!['attack','attack2','attackAir2','breath','roar','death'].includes(clip)`) where `Jaw` pitch vs bind exceeds `2.0°` (catches `walk`'s `+8.6°` jaw).
  - **Inter-Clip Transition Handoff Scanner**: Check boundary pose deltas across `takeoff(end) → cruise(start)`, `cruise(0) ↔ bankLeft(0)/bankRight(0)`, `land(end) → idle(start)`, and `idle(0) ↔ walk(0)`, flagging any bone jump `> 8.0°` (catches `land → idle`'s `15.9°` `Neck2` and `17.0°` `Foot` snap).
  - **Floor Penetration & Root Drift**: Flag frames where skinned vertices drop below `footY - 15` rig units (`attack2`/`attackAir2`) or `Body` horizontal drift exceeds `0.5` rig units, and highlight failing bones with pulsing `#ef4444` sonar rings in the 3D viewport.
- **Task E2 — Upgrade Inspection Pins (`anatomicalMap.ts`, `inspectionPins.ts`, `ActivePinBanner.tsx`) with Bind-Delta, Layer Attribution & User Notes**:
  - Decompose every pinned bone's rotation into **Clip Bind Delta (`q_bind^-1 * q_mixer`)**, **Procedural Controller Offset (`q_mixer^-1 * q_final`)**, and **World Horizon Pitch (`Body → ... → bone`)** so an AI agent immediately knows whether a pose defect lives in the `.glb` track or in `src/flight-lab/rig/`.
  - Add an inline text input on `ActivePinBanner.tsx` bound to `pin.note` so the user can type what looks wrong before clicking **Copy for AI**, and make **Dump Rig** copy the full rig report directly to the clipboard with a toast.
- **Task E3 — Stage Toolbar `"Proc"` Toggle (`flightRig` ON/OFF) & `"Raw vs Procedural"` Ghost Mode (`StageViewport.tsx`, `runtime.ts`, `comparisonRig.ts`)**:
  - Add a `Proc` toolbar button (and shortcut `G`) that bypasses `flightRig.update()` and `neckSpring.tick()` to show the pure `.glb` animation tracks, plus a Ghost mode option superimposing the raw clip against the procedural rig on the same specimen.
- **Task E4 — 1-Click Repo Evidence Export (`/api/flight-lab/report`) & Live Blender Hot-Reload**:
  - Add a dev-only `POST /api/flight-lab/report` endpoint so clicking `Export` writes `docs/flight-lab/inbox/latest-issue.md` and `docs/flight-lab/inbox/latest-capture.png` directly inside the repo workspace (instead of browser downloads to `~/Downloads`), and add a `blender:sync-clip` command that exports an action from Blender, runs `validateRuntimeRig` + `scanClipAnomalies`, and hot-reloads the candidate in Flight Lab.

**Exit criteria.** `scanClipAnomalies` unit-tested against the pre-fix `-65°` `idle` neck, `+8.6°` `walk` jaw, and `15.9°` `land → idle` snap; `Copy for AI` outputs bind delta + procedural offset + world horizon pitch + user note; `Export` writes directly to `docs/flight-lab/inbox/`.

### M12 — Crimson Desert Gameplay Parity & Clean-Room Mod Reference Harvesting · P1/P2 · deps: M4, M6, M7

**Scope.** Closes the gameplay, locomotion-chaining, flight-physics, and mounted-combat gaps between the V2 rig (`wyvern-v2-rig.glb` + `src/flight-lab/rig/`) and *Crimson Desert*'s Patch 1.10.00 Wyvern mount (**Workstream F / `Tasks F1–F5` in [doc 43](43-crimson-desert-wyvern-benchmark-and-mod-harvest-study.md)**):
- **Clean-room biomechanical harvesting protocol (`harvestedWingProfiles.ts`)**: Use normalized 24-point phase envelopes (downstroke/upstroke duty asymmetry, digit `D0..D5` / `Panel0..3` phase lag, pitch-to-fold coupling, and hop-to-flight timing) rather than raw BlackSpace Engine `.pac`/`.pab`/`.paa` binary imports.
- **Task F1 — Seamless Locomotion State-Machine & Chained Hop-to-Flight Transitions**: Smooth boundary pose deltas (`< 5.0°` max bone jump) across `idle ↔ walk → takeoff → cruise ↔ glide ↔ hover → land → idle` and add a playable **Chained Launch / Landing Sequencer** in Flight Lab.
- **Task F2 — Dive-Stoop Momentum Boost, Hover Flare-Brake & Effort-Scaled Climb Physics**: Convert `dive` potential energy into decaying `glide`/`cruise` speed boosts and `WingPanel0..3_0..1` billow; pitch wings (`+18°..+28°`) and fan `Tail1..10` on rapid deceleration into `hover`; scale wingbeat speed (`1.0× → 1.35×`) during climbs.
- **Task F3 — Additive Aerial Breath & Bite Combat Layer Over Active Flight**: Layer `Neck1..2`, `Head`, and `Jaw` delta curves from `breath` and `attackAir2` additively over active flight clips (`cruise`, `glide`, `hover`, `bankLeft`/`bankRight`) steered by `gazeController.ts`.
- **Task F4 — Rider Grapple-Mount Impulse, Saddle Socket & Weight Shift Coupling**: Add a damped `Spine2..3` + `Body` recoil spring on rider mount/grapple catch and couple `FlightLabRider` lean to `bank` and `turnRate`.
- **Task F5 — Ground Turn-in-Place & Touchdown Suspension Compression**: Synthesize grounded `turnRate` stepping on `L/R_Hip..Foot` + `L/R_WingWrist` and vertical pelvis/leg shock absorption on `land` touchdown.

**Exit criteria.** Chained `walk → hop → takeoff → cruise → hover → land → idle` sequence executes with `< 5.0°` boundary bone jumps; additive aerial breath fires during active flight without interrupting wingbeat cadence; dive pull-up and hover flare-brake verified in Flight Lab.

---

## 4. Error-handling & anomaly-detection plan (cross-cutting, lands in M1, M4, M8, M11)

**Principles.** (1) No silent failures — every catch either recovers or reports with a code. (2) Contract violations fail loud with the remediation command, never auto-heal. (3) Degrade to the last known-good state (previous specimen, previous clip) instead of an empty viewport. (4) Every user-visible error or pose anomaly carries layer attribution (`GLB track` vs `procedural rig`) and a concrete remediation command.

| Failure / anomaly mode | Today | Target | Lands in |
|---|---|---|---|
| GLB fetch/parse failure on switch | empty viewport, no message | banner + retry + stay on previous specimen | M1 |
| Contract hash/signature drift at load | unvalidated in `src/` | load-time check + exact re-pin command | M1 |
| Orphaned GLB animation samplers on splice | ✅ Fixed (`inspectRuntimeRig` asserts `0` orphaned samplers) | keep enforced | M8 (Task A1 ✅) |
| Mode has no clip on this rig (V1: `land`/`rest`/`boost`/`scout`) | silent fallback clip (`resolveFlightLabClip` drops status) | "unavailable on this rig" badge via `resolveModeCapability` | M1, M4 |
| WebGL context loss | blank canvas | `contextlost` handler + restore notice | M1 |
| Camera framing lost (today's V1 report) | dead end | out-of-frustum detection → offer Fit/Reset | M1 |
| Mixer internals (`_bindings`, `_accuIndex`) | relocated to `mixerBindings.ts`, `mixerBindingsAreSupported()` uncalled & untested | call feature-detect at load + unit test | M4 |
| Procedural rig corrupts authored motion (`jaw` untracked, grounded `gaze`, `dive` head copy, dead `bankRightHotspotFrame`) | ✅ Fixed in `5fb3ab1` + unit tests | keep covered | M4 (Tasks B1–B3 ✅) |
| Blender `control_rig.py` rest-pose distortion & unslotted bake | `CANONICAL_CONTACT_PLANE_Z = -184` wrong space, `WingElbow` IK target mismatch, missing panel bisection & slot setup | ✅ Fixed: measured sole plane (`-2.6549`), elbow pole `164.0°/9.5°`, `apply_panel_bisect()` solve, `ActionCompat.setup_slotted_action` — `0.0°` rest drift | M8 (Task C4 ✅) |
| Skinning weight imbalances (membrane web, scapular, neck) | panels owned `0–12%` of their web; `L_WingRoot` `8` vs `R_WingRoot` `24` verts; `Spine3` owned the whole `Neck1` span (3,832 verts) | ✅ Fixed: panels `26.8–57.2%` of web, `WingRoot` `118/127` (`ratio 0.0066`), worst L/R `0.0165`, neck-slab `dominant==nearest` `20.1% → 59.9%`; `cruise` `maxMembraneX` unchanged at `2780.9` | M7 (Task C5 ✅) |
| Weight tools comparing two coordinate spaces | `readSkin` returned raw `POSITION`; body is normalized-`SHORT` (`KHR_mesh_quantization`) and meshes bind at scale `2187.9565`, so spatial tests selected `0` of 14,544 vertices and silently no-op'd | `glb_skin_io.mjs` owns `bindMeshToWorld()` (asserts `jointWorld·IBM` invariance) + `normalizationScale()`; `readSkin` returns bind-world positions | M7 (Task C5 ✅) |
| Static pose defects (`-65°` `idle` neck, `+8.6°` `walk` jaw) & transition snaps (`15.9°` `land → idle`) | `Scan` (`scanSeam`) only checks quarter-frame jumps `> 10°` → reports 0 issues | `scanClipAnomalies` checks bind-delta envelopes, open jaw, transition handoffs & floor penetration | M11 (Task E1) |
| AI pin telemetry (`Copy for AI`) | raw `bone.quaternion` Euler (`YXZ`), no bind delta, no clip-vs-procedural attribution, no note input | Bind Delta + Procedural Offset + World Horizon Pitch + editable user note + repo inbox save | M11 (Tasks E2–E4) |
| V1 CUBICSPLINE shared-buffer mutation | silent neighbour corruption | deep-copy discipline + load-time validation | M4 |
| `cli.py` headless arg forwarding | ✅ Fixed in `5fb3ab1` | keep covered in `test_mcp_cli.py` | M8 (Task C3 ✅) |
| Unnamed test flake (1/161 on 2026-10-21) | unidentifiable | per-test names + flake quarantine | M3 |
| Dev-server HMR blank | blank page | documented reload recovery; remount investigation | M10 |

---

## 5. Explicitly not planned

- **Runtime neck clamp for the ground-mode head lift** — rejected 2026-10-21; the raise was corrupted clip data and was fixed at the source (doc 37 audit note + Workstream A horizon leveling). A clamp would have papered over a data bug and fought procedural motion.
- **Full re-export of the runtime asset from legacy `models/source/wyvern-rig.blend`** — that blend has only 56 bones (39 weighted joints with `export_def_bones=True`, missing `WingHand`, all 36 `WingD0..5` bones, and all 16 `WingPanel` bones) and 1 mesh (`SKM_DaenerysDragon.001`), and would drop `attack2`/`attackAir2`. Full re-exports must only come from `models/source/wyvern-v2-master.blend` (**M8 / Task C1 ✅**).
- **Backporting the procedural rig to V1** — bone naming, the 100× unit scale, and the parented human rider make this disproportionate; V1 stays the motion reference (its accents are the authoring target, not its skeleton).

---

## 6. Sequencing

```
M2 (mobile) ✅ DONE
M4 Workstream B (Tasks B1–B3: jaw, gaze, bankRightHotspotFrame) ✅ DONE
M8 Workstream A + C1–C4 + C7 + D5 (sampler leak, master .blend, 5 bone weights, cli/gltf, control rig, v1wing symmetry) ✅ DONE
M6/M7 Workstream D1–D3 + D4-attack (Body/footY, BUZZ, CONCENTRATED, attack) ✅ DONE
M7 Workstream C5 + C6 (skin weights, jaw pivot/Body edit-bone geometry) ✅ DONE

Next up:
M6 Task D4 remainder (cruise + bankLeft/bankRight) ──────────────────────────────────────────────────┐
M11 Workstream E (Tasks E1–E4: Flight Lab AI Co-Pilot & Pose-Anomaly Scanner) ──────────────────────┼─→ M9 (game)
M1 + M3 + M4 remainder (load contract, ClipResolutionStatus, CI/lint, mixerBindings guard) ─────────┤
M10 (performance + 60-file bankright tool-ladder cleanup) after M8 ──────────────────────────────────┘
```

**Suggested next four actions for coding agents:**
1. **M8 / Task C4 (`scripts/blender/rigging/control_rig.py`) ✅ DONE 2026-10-21**: contact plane, elbow pole, panel bisect and slotted-action bake all fixed and measured (`0.0°` rest drift, `assets/rig-audits/2026-10-21-control-rig/`). **M8 / Task C7 ✅ DONE 2026-10-22**: 32 failing L/R pairs mirrored in `wyvern-rig-v1wing.blend` (`0` failing, `passed`), 18 orphan vertex groups and 2 zero-user materials purged (`assets/rig-audits/2026-10-22-c7-v1wing-symmetry/`). M8's open items are now the CI blend↔GLB sync check and the BG-4 controller extraction.
2. **M7 / Task C5 (Blender Skinning) ✅ DONE 2026-10-21**: all 16 membrane panels now own `26.8–57.2%` of their inter-digital web, `L/R_WingRoot` is `118/127` verts (`ratio 0.0066`), and no paired bone exceeds `0.0165` (`assets/rig-audits/2026-10-21-skin-weights/`). The "thoracic cliff" was measured to be `Spine3` over-owning the `Neck1` span, not a chest hinge, and was rebalanced accordingly. **Task C6 ✅ DONE 2026-10-22**: `Jaw.head` recentred to `[0.0, -565.0, 785.0]` with a lateral local `X`, and `Body` extended to `Spine1.head`; the `RootMotion` flattening was deferred because it rotates every clip by `98.13°`. The pivot is now in the **shipped GLB** too (`04dbda5c…` → `f5d768a2…`, jaw amplitude restored), not just the blend. **Task C7 ✅ DONE 2026-10-22**: `wyvern-rig-v1wing.blend` symmetrized (32 pairs, pure rest fix — no fcurve touched) and its orphaned datablocks purged. M7's remaining exit criterion is the continuous-playback visual qualification for `idle`, `walk`, and `bankRight`.
3. **M6 / Task D4 Remainder (`cruise`, `bankLeft`, `bankRight`)**: Replace the single-frame `t = 1.0s` `maxMembraneX > 2500` proxy with the cycle-peak / `maxMembraneX >= wingTipPos.x` invariant for `cruise`, author `0.500 Hz`-locked mid-stroke recovery and secondary body/tail/neck motion on `bankLeft`/`bankRight` so `mean >= 0.70×`, and invert `test/wyvern-v2-dynamics.test.js`.
4. **M11 / Workstream E (`Tasks E1–E4` in [doc 41](41-v2-and-blender-rig-audit-task-list.md))**: Upgrade `Scan` (`motionProbe.ts`) into `scanClipAnomalies()` (`E1`), add Bind Delta + Procedural Offset + World Horizon Pitch + user note input to `Copy for AI` pins (`E2`), add the `Proc` (`flightRig` ON/OFF) toolbar toggle (`E3`), and add `/api/flight-lab/report` repo export (`E4`).
