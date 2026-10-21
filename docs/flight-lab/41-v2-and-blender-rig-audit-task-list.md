# V2 Wyvern Rig, Step 5 Audit Note Review, Blender Pipeline & Flight Lab AI Task List

**Date:** 2026-10-21 (Updated 23:59)  
**Doc ID:** `41` (renamed from `39-v2-and-blender-rig-audit-task-list.md` to resolve numbering collision with [39-v2-development-roadmap.md](39-v2-development-roadmap.md) and [40-architecture-audit-and-prioritized-path.md](40-architecture-audit-and-prioritized-path.md))  
**Scope:** Independent review of [37-v2-idle-neck-audit-note.md](37-v2-idle-neck-audit-note.md) ("Step 5 Note"), full technical audit of the V2 runtime rig (`public/models/wyvern-v2-rig.glb` + `src/flight-lab/`), deep Blender DNA & rigging audit (`models/source/*.blend` + `scripts/blender/rigging/control_rig.py` + `tools/blender/`), Flight Lab AI-feedback architecture review, and a prioritized task list (`Workstreams A–E`, including new Blender rig tasks `Tasks C4–C7`) for coding agents.

---

## Part 1: Review of Step 5 Note (`37-v2-idle-neck-audit-note.md`)

### 1.1 Independent Verification of Numbers (§8.1)

Re-derived directly from the binary GLB chunks of `/tmp/wyvern-v2-rig.glb.pre-neckfix.bak` (`sha256: e8edd574d95b388e…`, `5,740,476 B`), the initial post-splice `public/models/wyvern-v2-rig.glb` (`sha256: d916b748d987df64…`, `5,977,592 B`), the Workstream-A compacted/leveled runtime (`sha256: b25db7a19aa73c7a…`, `5,744,660 B`), and `/tmp/reexport-v2.glb`:

| Asset / State | `Neck1` Pitch vs Bind (mean / min..max) | `Neck2` Pitch vs Bind (mean / min..max) | `Head` Pitch vs Bind (mean / min..max) | Cumulative Mean Neck+Head Pitch | `Body` + `Spine1..3` Pitch | Net World Head Pitch |
|---|---|---|---|---|---|---|
| **Pre-fix `idle`** (`e8edd574…`) | `−21.1°` (`−23.3°..−18.9°`) | `−24.2°` (`−27.0°..−21.4°`) | `−19.3°` (`−23.5°..−15.1°`) | **`−64.6°`** (craned up) | `+12.9°` (`Body` `+12.9°`, `Spine` `0°`) | **`−51.7°`** (skyward) |
| **Step 5 splice `idle`** (`d916b748…`) | `−0.0°` (`−1.9°..+1.1°`) | `0.0°` (`−2.6°..+1.5°`) | `0.0°` (`−6.8°..+6.9°`) | **`0.0°`** (neutral local) | `+12.9°` (`Body` `+12.9°`, `Spine` `0°`) | **`+13.0°`** (nose down) |
| **Workstream A leveled `idle`** (`b25db7a1…`) | `−4.0°` (`−5.9°..−2.9°`) | `−5.0°` (`−7.6°..−3.5°`) | `−3.5°` (`−10.3°..+3.4°`) | **`−12.5°`** (horizon counter-lift) | `+12.9°` (`Body` `+12.9°`, `Spine` `0°`) | **`+0.4°`** (level horizon) |
| **Shipped `walk`** (`b25db7a1…`) | `−8.3°` (`−16.1°..−2.6°`) | `−6.7°` (`−9.2°..−1.8°`) | `+3.0°` (`−2.0°..+7.9°`) | **`−12.0°`** (counter-lift) | `+12.8°` (`Body` `−6.2°`, `Spine` `+19.0°`) | **`+0.8°`** (level horizon) |
| **Shipped `rest`** (`b25db7a1…`) | `+4.0°` (`+3.6°..+4.4°`) | `+5.0°` (`+4.5°..+5.5°`) | `+2.0°` (`+1.4°..+2.6°`) | **`+11.0°`** (relaxed nod) | `−2.5°` (`Body` `−2.5°`, `Spine` `0°`) | **`+8.5°`** (settled) |
| **Shipped `land`** (`b25db7a1…`) | `+2.6°` (`−10.6°..+9.6°`) | `−2.5°` (`−14.6°..−0.0°`) | `+9.8°` (`−7.8°..+24.0°`) | **`+9.9°`** | `−5.4°` (`Body` `−5.4°`, `Spine` `0°`) | **`+4.5°`** |

- **Verdict on §2 / §8.1 numbers**: The local-X pitch numbers reported in `37-v2-idle-neck-audit-note.md` are **exact to 0.1°**.

### 1.2 Audit of `tools/blender/splice_neck_head_channels.mjs` (§8.2)

1. **Defect 1 — Shipped Binary Bloat (+237,116 Bytes) & 114 Orphaned Samplers *(Fixed in Task A1)***:
   - In the initial `tools/blender/splice_neck_head_channels.mjs:78-86`, the script filtered `donorChannels` down to the 3 target channels (`Neck1:rotation`, `Neck2:rotation`, `Head:rotation`), but appended **all 114 samplers** from `donorAnimation.samplers` (`donorAnimation.samplers.map(...)`) and copied all 114 donor input/output `accessors` and `bufferViews` into the binary chunk, while leaving the 3 replaced base samplers unpruned.
   - **Why `runtime_rig_contract.mjs` missed it**: `inspectRuntimeRig()` validated `a.channels` targets (`targets.add(...)`), not unreferenced `a.samplers`, `g.accessors`, or `g.bufferViews`.
2. **Defect 2 — No Bind-Pose / Rest-Rotation Reconciliation *(Fixed in Task A1)***:
   - `splice_neck_head_channels.mjs` copied raw glTF local quaternions (`q_gltf = q_rest * q_pose`) without checking whether `donor.nodes[donorNode].rotation` matched `base.nodes[targetNode].rotation`.
3. **Defect 3 — Missing Time-Grid, Interpolation & Duplicate-Channel Guards *(Fixed in Task A1)***:
   - Did not verify that donor keyframe times `[t_0 .. t_end]` matched the target clip's duration (`6.0s`) or guard against `CUBICSPLINE` (12 floats/key), which breaks downstream stride-4 tools (`scripts/validate-wyvern-clips.mjs:localRotationRange`, `tools/blender/coordinate_all_v2_clips.mjs`).

### 1.3 Sanity-Check of §6 & Flagged Over-Claims (§8.3, §8.4)

1. **Over-claim in §3 (Provenance of the `−65°` `idle` Neck Raise) *(Fixed in Task A2)***:
   - Note §3 stated that the `−65°` raise came solely from a deleted external file (`idle-v2-fold-candidate.glb`).
   - **Actual provenance**: Two scripts **committed in `tools/blender/`** created and compounded that raise:
     - `tools/blender/author_v2_ground_wing_fold.py:186-207` authored `idle_V2Candidate` (`idle-v2-fold-candidate.glb`) by overwriting pose-bone quaternions directly (`Neck1 = -4.1° ± 2.2°`, `Neck2 = -6.2° ± 2.8°`, `Head = -5.3° ± 4.2°`) without preserving the `+28.6°` downward rest-pose offset of `Neck1+Neck2+Head`.
     - `tools/blender/upgrade_v2_rig_ground_and_membrane.mjs:257-281` **explicitly premultiplied an additional `Neck1: −12°`, `Neck2: −12°`, `Head: −8°` (`−32°` total lift)** onto `idle` (`bones[bname].quaternion.premultiply(qLift)`).
2. **Sanity-Check of `walk` and `idle` World-Space Eyeline (§6) *(Fixed in Task A2)***:
   - **Why `walk` (`Neck1 −8.3°`, `Neck2 −6.7°`, `Head +3.0°`) is healthy**: In `walk`, `Body` is at `−6.2°` and `Spine1..3` pitch forward by `+19.0°` (`Spine3` net `+12.8°` downward). The `−12.0°` neck+head raise counter-rotates against the forward-pitched spine so the head stays level with the horizon (`+0.8°` net world pitch). Do **not** splice `wyvern-rig.blend`'s `0°` walk neck onto `walk`.
   - **Why `d916b748…` `idle` looked slightly nose-down (`+13.0°` net world pitch)**: In `wyvern-v2-rig.glb`, `idle` has `Body` pitched forward by `+12.9°` (`author_v2_ground_wing_fold.py:154`), whereas `wyvern-rig.blend` had `Body` at `0°`. Applying a `−4.0° / −5.0° / −3.5°` (`−12.5°` total) counter-pitch in `apply_idle_horizon_leveling.mjs` holds a `+0.4°` horizon eyeline matching `walk`.
3. **Sanity-Check of `land` Decision & Newly Exposed `land → idle` Snap (§6) *(Fixed in Task A3)***:
   - Not splicing `land` from `wyvern-rig.blend` was **correct** (`wyvern-rig.blend`'s `land` has `Neck2 = 0°`, `Head = 0°`).
   - However, shipped `land` (`tools/blender/author_v2_takeoff_land.py:403`) ended at frame 72 (`t = 3.0s`) with `Head = +17.8°` and `Neck1 = +7.1°` (matched to the old broken `idle`!), causing a **`15.89°` jump on `Neck2`, `13.00°` on `Head`, `9.07°` on `Neck1`, `16.98°` on `L/R_Foot`, and `12.76°` on `L/R_Calf`** at `land(end) → idle(start)` before `fix_walk_jaw_and_land_handoff.mjs` smoothed the `t = 2.0..3.0s` settle window to `0.0000°`.

---

## Part 2: Audit of V2 Runtime Wyvern Rig (`public/models/wyvern-v2-rig.glb` & `src/flight-lab/`)

### 2.1 Asset & Animation Defects in `public/models/wyvern-v2-rig.glb`

1. **7 Non-Deforming Bones in the 92-Joint Skin (`jointMass === 0`) *(5 deforming bones weighted in Task C2)***:
   - Initially, `Root`, `RootMotion`, `L_WingPanel0_0`, `L_WingPanel1_0`, `R_WingPanel0_0`, `R_WingPanel1_0`, and `Tail1` had **zero vertex weights** across all 32,777 vertices (`WyvernBody_Rebuild` + `WyvernMembrane_ExportSafe`).
   - `Task C2` (`tools/blender/bind_missing_panel_and_tail1_weights.mjs`) bound `L/R_WingPanel0_0`, `L/R_WingPanel1_0`, and `Tail1` (`85 → 90` deforming bones; `nonDeformingJoints: ["Root", "RootMotion"]`). The remaining distal/mid panels (`Panel0_1`, `2_0`, `3_0`) and the thoracic/scapular weights (`Spine1..3`, `L/R_WingRoot`) were rebalanced in **Task C5** — see **Part 3.3** for the measured correction to that finding.
2. **In-Place `Body` Translation Violations Across 10 Clips (`bodyRng > 0.5` rig units) *(Fixed in Task D1)***:
   - `takeoff` (`1,187.7` rig units / `1.10 m`), `death` (`540.0`), `walk` (`226.8`), `land` (`65.0`), `attackAir2` (`35.0`), `attack` (`26.0`), `hover` (`15.9`), `dive` (`15.0`), `glide` (`10.0`), and `speed` (`5.1`) translated `Body` below the root chain. Flattened in `tools/blender/stabilize_v2_body_and_feet.mjs`.
3. **Grounded Foot-Surface Height Spread (`419` rig units / `0.39 m`) & Wing-Through-Floor Penetration *(Fixed in Task D1)***:
   - `footY` spanned `-394` (`death`) to `+25` (`attack2`/`scout`), and `attack2`/`attackAir2` plunged wingtips `1,694` (`1.57 m`) and `1,458` (`1.35 m`) rig units below the feet. Aligned to `-184` and lifted in `stabilize_v2_body_and_feet.mjs`.
4. **Open-Jaw Bug in `walk` (`+8.6°` Static `STEP` Track) *(Fixed in Task A3)***:
   - Replaced `walk`'s 2-key `STEP` track at `[0.1921, -0.0177, 0.0044, 0.9812]` (`+8.6°` open vs bind) with `idle`'s closed bind pose + respiratory motion (`max 0.191°`).
5. **Stage 3 Clip Dynamics Deficit (`BUZZ` & `CONCENTRATED` fixed in Tasks D2–D3; `attack` fixed in Task D4; `cruise` & `bankLeft`/`bankRight` open)**:
   - `takeoff` (`0.27× → 1.68×` peak) and `death` (`0.47× → 1.16×` peak) reshaped in `c968a24` (`Task D2`).
   - `idle` (`p95` `19 → 197 deg/s`), `walk` (`p95` `315 → 929 deg/s`), and `attack2` (`accelMax` `83,690 → 37,710 deg/s²`) reshaped in `562131d` (`Task D3`).
   - `attack` amplified (`0.09× → 0.91×` peak via `11.1×` gain + strike accent) in `541b3e8` (`Task D4`).
   - **Remaining Stage 3 blockers (`cruise`, `bankLeft`, `bankRight`)**:
     - `cruise`: `1.68×` gain passes the dynamics gate but folds the wingtip at `t = 1.0s` (`maxMembraneX = 2256.4` vs hardcoded single-frame `> 2500` check in `test/wyvern-v2-kinetics.test.js`, even though `maxMembraneX >= wingTipPos.x` still holds).
     - `bankLeft`/`bankRight`: `6.7×` gain + smoothing moves wingbeat cadence from `0.500 Hz` to `1.500 Hz`, breaking the `8%` flight phase group cadence lock with `cruise`.
6. **Byte-Identical Candidate GLBs *(Resolved in Task D5)***:
   - Marked with `promotedAliasOf: "wyvern-v2-rig"` in `src/flight-lab/catalog.ts` and unreferenced `public/models/wyvern-v1-rig.glb` symlink removed.

### 2.2 Runtime Code Bugs in `src/flight-lab/` *(Fixed in Workstream B / `5fb3ab1`)*

1. **`src/flight-lab/rig/wyvernFlightRig.ts` — `jaw` Omitted from `allControlledBones` & `sealFlightJaw` Overwrites Breathing *(Fixed in Task B1)***.
2. **`src/flight-lab/rig/gazeController.ts` — Ungated in Ground Mode & Hardcoded `STREAMLINED_HEAD_ROTATION` in `dive` *(Fixed in Task B2)***.
3. **`src/flight-lab/membraneSurfaceRuntime.ts` — `bankRightHotspotFrame` Dead Code *(Fixed in Task B3)***.
4. **`src/flight-lab/runtime.ts` — `isMouthActionActive` Missing `death` and `roar` *(Fixed in Task B1)***.

---

## Part 3: Audit of Blender Source Rigs & Pipeline (`models/source/` & `scripts/blender/` & `tools/blender/`)

### 3.1 Source `.blend` vs Runtime Rig Mismatch Matrix

| File | Size | Armature / Bone Count | Weighted Deform Bones | Wing Hierarchy | Meshes | Actions | Can Export 92-Bone V2 Runtime GLB? |
|---|---|---|---|---|---|---|---|
| `public/models/wyvern-v2-rig.glb` | 6.37 MB | `WyvernRig` (**92 joints**) | **90** (`Root`, `RootMotion` zero-weight) | `WingShoulder..Hand` + `WingD0..5P0..2` (36) + `WingPanel0..3_0..1` (16) | **2 meshes**: `WyvernBody_Rebuild` (34,614 tris) + `WyvernMembrane_ExportSafe` (15,258 tris) | **18** canonical | *(Shipped runtime target, `sha256: 950c4321…`)* |
| `models/source/wyvern-v2-master.blend` | ~19 MB | `WyvernRig` (**92 bones**) | **90** (`use_deform = True` on all 92 in `00 Deform`) | Canonical 92-bone V2 hierarchy | **2 meshes**: `WyvernBody_Rebuild` + `WyvernMembrane_ExportSafe` | **18** canonical (1 clean `Scene`) | **Yes** *(Reconstructed in Task C1)* |
| `assets/blender/wyvern-gothic.glb` | 22.6 MB | `WyvernRig` (**92 joints**) | **85** | Canonical 92-bone V2 hierarchy | **1 mesh**: `SKM_DaenerysDragon.001` (39,238 tris) | **18** canonical (raw uncoordinated) | No (1 combined mesh, uncoordinated clips) |
| `models/source/wyvern-rig.blend` | 17.2 MB | `WyvernRig` (**56 bones**) | **38 + `neutral_bone` (39)** | Legacy 3-finger (`WingFinger1..3`, `WingMembrane1..2`, `WingClaw`); **missing `WingHand`, all 36 `WingD0..5`, all 16 `WingPanel` bones** | **1 mesh**: `SKM_DaenerysDragon.001` | **16** (missing `attack2`, `attackAir2`; flight necks are static stubs) | **No** (exports 39 joints; fails 92-bone contract) |
| `models/source/wyvern-rig-v1wing.blend` | 33.8 MB | `WyvernRig` (**106 bones**) | **106** (124 VGs, 18 orphaned) | `WingD0..5P0..2` + 30 `WingBatten040..069`; **missing all 16 `WingPanel0..3_0..1` bones** | **1 mesh**: `SKM_DaenerysDragon.001` | **33** (`18` V2 + `15` `v1_*` donor actions) | **No** (exports 106 joints; fails 92-bone contract) |
| `models/source/wyvern_animated.blend` | 9.7 MB | `Armature` (**70 bones**) | **70** (`Bip001 ...`) | Legacy `Bip001` 3-finger rig | `Object_0` | **9** (`Fly_Loop`, `Glide_Hold`, `Idle`, `Landing`, `Takeoff`, `Walk_Cycle`, etc.) | **No** (different skeleton & naming) |
| `models/source/drogon-v1-rig.blend` | 8.5 MB | `Armature` (**292 bones**) | **165** (`Bip002` + `Bip001` rider) | V1 Drogon + human rider + cloak | `SKM_DaenerysDragon` | **27** `Sanct_*` actions | **No** (V1 sanctuary source) |

### 3.2 Critical Blender Pipeline & Tooling Bugs *(C1, C3, C4, C5 fixed; C6–C7 open)*

1. **No Committed Authoring `.blend` Matched the Shipped 92-Bone, 2-Mesh V2 Asset *(Fixed in Task C1 via `models/source/wyvern-v2-master.blend`)***.
2. **`scripts/blender/cli.py:command_arguments` Broke Headless `audit-glb` *(Fixed in Task C3)***.
3. **`scripts/blender/export/gltf.py` Hardcoded Single-Mesh `WyvernMesh` & `export_def_bones=True` *(Fixed in Task C3)***.
4. **Six Control-Rig & Baking Bugs in `scripts/blender/rigging/control_rig.py` (`Task C4`)**:
   - **Bug 1 — Wrong Coordinate Space for `CANONICAL_CONTACT_PLANE_Z = -184.0` (`control_rig.py:29`)**: `-184.0` is the grounded foot height *relative to `Body`* in glTF audit space, whereas in Blender world space (`Root` at `Z = 0`, `Body` at `Z = +711.6`), the rest-pose feet (`L/R_Foot.tail.z`) sit at **`Z = +142.2`**. Whenever `compute_canonical_contact_plane()` falls back to `-184.0`, `CTRL_FloorPlane` clamps `Z >= -184.0` (`326.2` units underground). **Correction (Task C4, measured):** `+142.2` is the *bone tail*, not the sole. The skinned footpad surface measures **`-2.6549`** in world `Z` (1,084 foot-group vertices), which is what the constant now carries; clamping at `+142.2` would float the feet 144.9 units.
   - **Bug 2 — `CTRL_WingKnuckleIK_L/R` Placed on `WingElbow` Instead of `WingWrist` (`control_rig.py:242-255`)**: An IK constraint on `WingElbow` with `subtarget = CTRL_IK_WingWrist_L/R` and `chain_count = 2` solves `WingShoulder → WingElbow` (pulling `WingElbow.tail` to `WingWrist.head`), leaving `WingWrist` outside the IK chain and without an elbow pole target (`CTRL_Pole_Elbow_L/R`), causing shoulder roll flips when `ground_contact_ik > 0`.
   - **Bug 3 — Missing `pole_angle` on `CTRL_FootIK_L/R` & Default `ground_contact_ik = 1.0` *(Staged in working tree)***: `CTRL_Pole_Knee_L/R` had `ik.pole_angle = 0.0` (twisting `L/R_Thigh` and `L/R_Calf` in rest pose) and `ground_contact_ik` defaulted to `1.0` even on airborne clips. Calibrating `ik.pole_angle = math.radians(-70.18 if side == "L" else -109.81)` with `offset = (0, -200, 0)` and `ground_contact_ik = 0.0` eliminates rest-pose leg twist.
   - **Bug 4 — Tail `DAMPED_TRACK` Lifted `Tail1..10` in Rest Pose *(Staged in working tree)***: `Tail1..3` used `DAMPED_TRACK` (`TRACK_Y`) aimed at `CTRL_Tail_Base` (`Tail3.head + (0, 0, +50)`), bending the tail upward even when controls were untouched. Replacing `DAMPED_TRACK` with local-space `COPY_ROTATION` (`mix_mode = "ADD"`, `target_space = "LOCAL"`, `owner_space = "LOCAL"`) and zero-offset `CTRL_Tail_Base/Mid/Tip` keeps `0.00°` rest-pose deviation.
   - **Bug 5 — Missing Automatic Inter-Digital Pair-Bisect Constraints on `L/R_WingPanel0..3_0..1`**: In Blender, `L/R_WingPanel{K}_0` is parented to `L/R_WingD{K}P0`, so rotating `WingD{K}P0` swings the panel rigidly with digit `K` instead of bisecting digit `K` and digit `K+1`. Adding dual `COPY_ROTATION` constraints (`0.5` `WingD{K}P0/1` + `0.5` `WingD{K+1}P0/1` in `LOCAL` space) makes the panels bisect adjacent fingers automatically inside Blender.
   - **Bug 6 — Blender 5.1 Slotted-Action Bake Bug (`control_rig.py:345-365`)**: `bake_control_rig_to_deform()` sets `armature.animation_data.action = action` without calling `ActionCompat.setup_slotted_action(action, armature)`, leaving `action_slot` unassigned on multi-slot actions during `bpy.ops.nla.bake()`.

### 3.3 Deep Blender Rig Anatomy & Skinning Audit Findings (`Tasks C5–C7`)

1. **`Jaw` Pivot Is Off-Center (`X = +3.6`) and Placed Above the Skull (`Z = 867.8` vs `Head` `Z = 793.3`) (`Task C6`)**:
   - In `wyvern-rig.blend`, `wyvern-rig-v1wing.blend`, `wyvern-v2-master.blend`, and `wyvern-v2-rig.glb`, `Head.head` sits on the midline at `[0.0, -547.3, 793.3]` (Blender `+Z` up), but `Jaw.head` is at **`[3.6, -583.7, 867.8]`** (`tail = [2.8, -653.4, 822.8]`).
   - Because the jaw hinge is `3.6` units left of center and `74.5` units *above* the head pivot (with a skewed rest quaternion `[0.1180, -0.0180, 0.0031, 0.9928]`), opening the mouth translates and yaws the lower jaw sideways instead of hinging around the anatomical mandible joint (`[0.0, -565.0, 785.0]`).
2. **Degenerate `0.05`-Unit `Body` Stub & Diagonal `RootMotion` Bone (`Task C6`)**:
   - `Body` has `head = [0.0, 432.1, 711.6]` and `tail = [0.0, 432.1, 711.7]` (`length = 0.05` rig units), co-located with `Tail1.head` (`[0.0, 432.1, 711.6]`), while `RootMotion` (`head = [0, 0, 0]`, `tail = [0, 117.7, 824.2]`, `length = 832.57`) stretches diagonally from the floor to the dorsal spine instead of lying flat on the ground plane.
3. **Distal Membrane Panel (`WingPanel0_1, 2_0, 3_0`), Thoracic (`Spine1..3`), and Scapular (`L/R_WingRoot`) Weight Imbalances *(Fixed in Task C5)***:
   - **Correction (Task C5, measured)**: the "20× thoracic cliff" framing below is a metric artifact — the chest is *not* where `Spine3`'s mass is. 92% of it sits **above `Neck1.head`** and the chest carries ~63 of 5,624.8, so a `Spine3 → Spine1/Spine2` redistribution would move almost nothing. The defect is that `Spine3` owns the whole `Neck1` span (3,832 vertices whose nearest bone segment is `Neck1`); C5 hands that mass to the nearest neck bone and records `dominant==nearest` agreement rising 20.1% → 59.9% on the neck slab. See **Task C5**.
   - While `Task C2` bound `L/R_WingPanel0_0` and `L/R_WingPanel1_0`, the remaining panel bones on `WyvernMembrane_ExportSafe` (`12,915` vertices) are still weight-starved: `L/R_WingPanel0_1` has only `48/44` vertices (`w = 0.5/0.4`), `L/R_WingPanel2_0` has `52/53` vertices (`w = 1.1`), and `L/R_WingPanel3_0` has `36/37` vertices (`w = 0.3`).
   - On `WyvernBody_Rebuild`, `L_WingRoot` has only `8` vertices (`w = 0.9`) vs `R_WingRoot`'s `24` vertices (`w = 2.2` — **3× L/R asymmetry**), and `Spine3` carries `8,203` body vertices (`w = 5,624.8`) vs `Spine1` (`766` verts, `w = 232.8`) and `Spine2` (`625` verts, `w = 165.1` — **20× thoracic cliff**).
4. **L/R Edit-Bone Roll & Length Asymmetries in `models/source/wyvern-rig-v1wing.blend` (`Task C7`)**:
   - `L_WingD0P0` (`len = 56.39`, `roll = -39.5°`) vs `R_WingD0P0` (`len = 65.47`, `roll = +17.0°` — `22.5°` roll error, `9.1` unit length error).
   - `L_WingD2P0` (`len = 30.43`, `roll = -71.7°`) vs `R_WingD2P0` (`len = 41.35`, `roll = +86.6°` — `14.9°` roll error).
   - `L_WingD3P0` (`len = 33.14`, `roll = -83.1°`) vs `R_WingD3P0` (`len = 49.50`, `roll = +99.3°` — `16.2°` roll error).
   - `R_WingBatten061..066` point *forward* (`tail.y = -1212..-2957`, `roll = +128.9°..+132.5°`) while `L_WingBatten046..051` point *backward* (`tail.y = +234..+2009`).

---

## Part 4: Why Flight Lab & AI Missed the `-65°` Neck Issue (And How to Fix the Human-AI-Blender Loop)

### 4.1 Four Blind Spots in the Current Flight Lab (`src/flight-lab/` & `src/app/flight-lab/`)

1. **`Scan` (`motionProbe.ts:scanSeam`) Only Checks Frame-to-Frame Jumps (`> 10°`), Never Static Pose Offsets**:
   - `scanSeam` measures `shortestAngleDegrees(prev, q)` between adjacent quarter-frames and `endQ` vs `startQ`. Because the `-65°` neck raise in `idle` (and the `+8.6°` open jaw in `walk`) was **constant across the entire clip** (`seam = 0.0000°`, `dq/dt < 0.3°/frame`), `Scan` reported **0 issues**, `validate-wyvern-clips.mjs` passed 100%, and `audit-wyvern-rig.mjs` passed 100%.
2. **Inspection Pins (`inspectionPins.ts`) & `Dump Rig` (`evidenceExport.ts`) Report Raw Local Euler (`YXZ`), Not Bind-Delta or Layer Attribution**:
   - In `anatomicalMap.ts:340`, `rotationEulerDeg` is computed directly from `bone.quaternion` (`_scratchEuler.setFromQuaternion(bone.quaternion, "YXZ")`), which mixes the bone's rest/bind quaternion with the animation delta.
   - Clicking **"Copy for AI"** (`formatPinForAI` in `inspectionPins.ts:24`) omits **Delta vs Bind Pose** (`q_bind^-1 * q_current`), **Cumulative World Pitch vs Horizon**, **Layer Attribution (`GLB track` vs `wyvernFlightRig` vs `neckSpring`)**, and `ActivePinBanner.tsx` has **no text input** for `pin.note`.
3. **`Scan` Never Checks Inter-Clip Transitions or Anatomical Envelopes**:
   - `scanSeam` steps `action.time` inside a single clip with `flightRig` bypassed. It never checks transition handoffs (`land(end) → idle(start)`), floor penetration, or anatomical pose envelopes.
4. **No Direct Browser-to-Repo Evidence Save or Live Blender-to-Runtime Diff**:
   - Clicking **`Export`** (`evidenceExport.ts:69`) downloads `capture-*.png` and `capture-*.json` into `~/Downloads`—**outside the repository**, where sandboxed coding agents cannot read them without manual file moving, and there is no toolbar toggle to isolate **Raw Authored Clip (`flightRig` OFF)** vs **Procedural Overlay (`flightRig` ON)**.

---

## Part 5: Prioritized Task List for Coding Agents

Each task below is self-contained, file-scoped, and paired with an explicit verification command so coding agents can execute them sequentially or in parallel workstreams.

### Workstream A — Immediate Pipeline & Asset Hygiene (P0) *(Completed 2026-10-21)*

- [x] **Task A1: Fix `splice_neck_head_channels.mjs` sampler/accessor leak and compact the 3 V2 GLBs (`-233 KB`)** *(Completed in `5fb3ab1`)*
- [x] **Task A2: Remove the `-12°/-12°/-8°` `idle` neck-lift regression bomb in `upgrade_v2_rig_ground_and_membrane.mjs` and level `idle` horizon eyeline (`+0.4°`)** *(Completed in `5fb3ab1`)*
- [x] **Task A3: Fix `walk` open-jaw defect (`+8.6°` → `0.0°` closed bind pose) and smooth `land → idle` transition snap (`15.9° → 0.0000°`)** *(Completed in `5fb3ab1`)*

---

### Workstream B — V2 Runtime Rig & Shader Controller Fixes (`src/flight-lab/`) (P0/P1) *(Completed 2026-10-21)*

- [x] **Task B1: Track `jaw` in `wyvernFlightRig.ts` and preserve authored respiratory jaw motion in `flightMouth.ts`** *(Completed in `5fb3ab1`)*
- [x] **Task B2: Gate `intelligentHeadNeckController` when grounded and fix `dive` head-pose overwrite** *(Completed in `5fb3ab1`)*
- [x] **Task B3: Wire `bankRightHotspotFrame` in `runtime.ts` and `comparisonRig.ts` so `membraneSurfaceRuntime.ts` hotspot smoothing executes** *(Completed in `5fb3ab1`)*

---

### Workstream C — Blender Rig Anatomy, Control-Rig & Skinning Unification (`models/source/` & `scripts/blender/`) (P1)

- [x] **Task C1: Reconstruct and commit the canonical 92-bone, 2-mesh master `.blend` (`models/source/wyvern-v2-master.blend`)** *(Completed in `5fb3ab1` via `tools/blender/build_v2_master_blend.py`)*
- [x] **Task C2: Weight the 5 unweighted deforming bones (`L/R_WingPanel0_0`, `L/R_WingPanel1_0`, `Tail1`) in Blender / GLB** *(Completed in `5fb3ab1` via `tools/blender/bind_missing_panel_and_tail1_weights.mjs`; `nonDeformingJoints` is now `["Root", "RootMotion"]`)*
- [x] **Task C3: Fix `scripts/blender/cli.py`, `scripts/blender/export/gltf.py`, and `WING_FOLD_RATIOS` in `scripts/blender/rigging/control_rig.py`** *(Completed in `5fb3ab1`)*

- [x] **Task C4: Fix the 6 `scripts/blender/rigging/control_rig.py` IK/FK, Floor-Plane, Pair-Bisect & Slotted-Action Bugs** *(Completed 2026-10-21; evidence `assets/rig-audits/2026-10-21-control-rig/`)*
  - **Files**: `scripts/blender/rigging/control_rig.py`, `scripts/blender/cli.py`, `tools/blender/tests/test_control_rig.py`, `tools/blender/audit_v2_control_rig.py` (new)
  - **Result**: `build_control_rig` now yields **0.0° rest-pose deviation across all 92 deform bones** with `ground_contact_ik = 1.0` (`c4-rest-pose.json`), and the 16 membrane panels solve to the inter-digital half-angle within **0.0001°** (`R_WingPanel0_0`, `L_WingPanel2_0`) and **0.335°** (`L_WingPanel0_0`, where the active knuckle IK perturbs the chain). 21/21 Blender unit tests, 165/165 `test:fast`, and `npm run assets:audit-rig` pass; no asset was rebuilt.
  - **1. Staged knee/tail fixes (committed)**: `CTRL_Pole_Knee_L/R` at `offset = (0.0, -200.0, 0.0)` with `pole_angle = -70.18° / -109.81°`, `ground_contact_ik = 0.0` default, and `Tail1..10` driven by local-space additive `COPY_ROTATION` (`CTRL_TailRot_*`) instead of the upward-bending `DAMPED_TRACK`.
  - **2. Contact plane — the audit note's `+142.2` was also wrong, in the opposite direction**: `CANONICAL_CONTACT_PLANE_Z` is now **`-2.6549`**, the measured world-`Z` minimum of 1,084 skinned foot-group vertices on `WyvernBody_Rebuild`. `+142.2` is `L/R_Foot.tail.z` — the *bone tail*, **144.9 units above the sole** — and would float the feet; `-184.0` was the glTF `Body`-relative height and clamped them 181 units underground. The function's own contract ("from the evaluated/skinned footpad … rather than bone heads") always favoured the vertex measurement, which is what `CTRL_FloorPlane` now clamps to.
  - **3. Wing-knuckle IK pole**: `CTRL_Pole_Elbow_L/R` added, placed on the **outward bisector** of the rest shoulder/elbow/wrist apex (not a hand-guessed offset — the guessed `(0, 150, 60)` left a **7.04°** bend-plane residual), with `pole_angle` calibrated at **`L = 164.0°`, `R = 9.5°`**. Uncalibrated, the pole sat on the mirrored branch and threw the whole wing **176.47°** away from rest; calibrated, the pristine pass reports **0.0°**. Two measurement traps are recorded in the audit script: a bend-plane-normal objective *cannot* see this bug (a 180° pole flip preserves the plane — `-9.25°` scored 0.0198° on the plane while displacing the wing 176.47°), and mutating `pole_angle` repeatedly inside one Blender session leaves evaluated state behind, so the sweep's absolute values run ~3° high and only a reopened-file pass is authoritative.
  - **4. Panel pair-bisect — implemented as a solve, not a constraint**: `apply_panel_bisect()` reproduces `coordinate_all_v2_clips.mjs` exactly (world delta per adjacent digit → `slerp 0.5` → applied to the panel's bind matrix → back-solved through the panel's current parent), exposed as `cli.py control-rig --panel-bisect`. The documented constraint recipe was **measured and rejected**: for a 20° `WingD0P0` rotation the panel must follow by **10.00°**; rigid parenting gives **20.00°**; a chained LOCAL `COPY_ROTATION` pair (1.0 + 0.5 `REPLACE`) gives **28.20°** — worse than doing nothing, because the panel re-inherits the parent rotation; WORLD space with `use_offset` gives **110.86°**, because `use_offset` adds the *owner's* rest rotation rather than the owner-to-target offset. Back-solving through the parent is the only form that works, so the per-frame export pass stays in the GLB pipeline.
  - **5. Slotted-action bake**: `ActionCompat.setup_slotted_action(action, armature)` is now called before `bpy.ops.nla.bake()` in `bake_control_rig_to_deform()`, and `cli.py` no longer forwards `--bake True` (argparse rejects a value for `store_true`).
  - **Verify**: `python3 -m unittest discover -s tools/blender/tests -p "test_*.py"` → 21 pass; `~/.local/bin/blender --background models/source/wyvern-v2-master.blend --python tools/blender/audit_v2_control_rig.py -- --json-out …` → `passed: true`.

- [x] **Task C5: Rebalance Distal Membrane Panel (`WingPanel0_1..3_1`), Scapular (`L/R_WingRoot`), and Thoracic (`Spine1..3`) Skinning Weights** *(Completed 2026-10-21; evidence `assets/rig-audits/2026-10-21-skin-weights/`)*
  - **Files**: `tools/blender/rebalance_v2_skin_weights.mjs` (new), `tools/blender/audit_v2_skin_weights.mjs` (new), `tools/blender/glb_skin_io.mjs` (new), `tools/blender/measure_membrane_extent.mjs` (new), `public/models/wyvern-v2-rig.glb`
  - **Result**: all four passes now move mass and every gate is green — `audit_v2_skin_weights` goes from **4 failing L/R pairs to none** (worst `|L−R|/(L+R)` **0.0165** against the 0.05 limit), all 16 panels own **26.8–57.2%** of their inter-digital web (was 0.0–12.0%), `audit-wyvern-rig --check` exits 0, `npm run test:fast` **165/165**, `tsc` clean. Asset `950c4321…` → **`bef7a09aa131…`**, still **6,368,564 B**; contract validates 92 joints / 18 clips.
  - **1. The passes were silently no-ops first — a coordinate-space bug, not a tuning problem**: `readSkin` returned raw `POSITION` and the audit compared it against `rig.bindWorldPos()`, but the two live in different spaces. Measured: the mesh→world map is `jointWorld(j) · inverseBindMatrix(j)` with **uniform scale 2187.9565** and translation `(0, 531, −1042.85)`, and it is joint-invariant (max deviation **2.4e-3** across all 92 joints on elements of magnitude 2188 — float noise), which is exactly what the glTF skinning formula requires at bind pose. The body mesh's `POSITION` is additionally **normalized `SHORT`** (`componentType 5122`, `normalized: true`; `KHR_mesh_quantization` is in `extensionsRequired`), so it also needed dividing by 32767. With both corrections the body lands in `[-1411,−3,−3231]..[1411,1065,931]`, sharing the membrane's space. Before the fix the scapular pass found **0 candidates** and the thoracic pass **0 vertices** out of 14,544; `glb_skin_io.mjs` now owns `bindMeshToWorld()` (which *asserts* the joint-invariance rather than assuming it) and `normalizationScale()`, and `readSkin`/`editSkinWeights` return bind-world positions so a caller cannot compare spaces by accident.
  - **2. Membrane web (`WyvernMembrane_ExportSafe`)**: 2,319 web vertices hand **20–35%** (graded along each panel's own head→tail axis) of their two adjacent digits' mass to the panel bone, then one topological smoothing pass at blend 0.25. Moved **437.94** mass; total preserved exactly (8,249 → 8,249). `L/R_WingPanel0_1` went `0.45/0.43` → **`50.70/50.17`** mass, `2_0` `0.60/0.58` → **`12.27/11.87`**, `3_0` `0.26/0.28` → **`22.90/23.07`**.
  - **3. Web eviction victim selection**: a full four-influence vertex has no free slot, so something must give way. Picking the *globally* smallest influence refused every vertex whose smallest slot was the adjacent digit — which is precisely the vertex the panel exists to own, costing **825 skipped attempts** and leaving `L_WingPanel2_0` at **8.4%** of its web. Choosing the smallest **non-protected** influence instead dropped skips to 410 and lifted that panel to **27.0%**. The neck and scapular passes cap eviction at `MAX_EVICT = 0.10` so a correction can never quietly discard a substantial influence.
  - **4. Scapular (`L/R_WingRoot`)**: the nearest **110** pectoral/shoulder vertices per side (identical count on both sides, so the asymmetry cannot re-appear through a different candidate ranking) take a **0.15→0.35** falloff graded by distance from the `WingRoot` axis over a 260-unit radius. `L_WingRoot` `8 verts / 0.95 mass` → **118 / 26.90**; `R_WingRoot` `24 / 2.16` → **127 / 27.26** (the 8 pre-existing vertices remain, so the total is 110 new + 8 old); the pair ratio drops **0.3897 → 0.0066**.
  - **5. "Thoracic" was misdiagnosed in Part 3.3 — the mass is in the neck, not the chest**: `Spine3`'s 5,624.8 mass is **92% above `Neck1.head`** (5,177 in the top t-decile of the `Body→Neck1` axis) while the chest (t 0.24–0.90) carries only **~63** of it. Redistributing `Spine3 → Spine1/Spine2` as Part 3.3 describes would therefore move ~63 mass and change nothing. The real defect is that `Spine3` owns the whole `Neck1` span: **3,832 vertices are dominated by `Spine3` whose nearest bone segment is `Neck1`**, and `Neck1` carried only 284 of the 8,194 neck-slab vertices. The pass now hands **50%** of `Spine3`'s mass (ramped in over 0.25 of the `Spine3.head→Head.head` axis, so nothing steps at the joint) to whichever of `Neck1/Neck2/Head` is geometrically nearest: **2,150.69** mass over 5,311 vertices (`Neck1` 2,109.58, `Neck2` 40.68, `Head` 0.43). Audit totals over both meshes: `Spine3` `9,464 verts / 5,971.3` → **`9,463 / 3,877.8`**; `Neck1` `1,320 / 414.0` → **`6,015 / 2,541.1`** (body-only: `Spine3` 5,624.78 → 3,531.4, `Neck1` 412.85 → 2,539.9).
  - **6. Neck change validated by geometry, not by eye**: dominant-bone-equals-nearest-bone agreement rose **28.8% → 51.7%** overall and **20.1% → 59.9%** on the neck slab (`Spine3`-dominant neck vertices 4,964 → 1,615, `Neck1` 284 → 3,533). This is a reported diagnostic in `audit_v2_skin_weights.mjs`, deliberately **not** a gate — a vertex on the surface of a tube is often marginally nearer an unrelated bone through the body, so the absolute number is low even on a healthy rig.
  - **7. Symmetry**: geometric mirror averaging over **6,463** body and **1,600** membrane pairs (3,267 / 484 actually changed). Keying is done in **mesh-local** space, not world: the bind matrix carries a ~0.0002 rotation term, so world `X` is not an exact mirror (`−x` maps to `−x + 2(0.0002·z + 0.0003)`, ~0.4 units of drift at z≈1000) and a world-space key would miss most pairs.
  - **8. What the change does not disturb**: `cruise`'s `maxMembraneX` is **2780.9 before and after** (`measure_membrane_extent.mjs`, the exact quantity `wyvern-v2-kinetics.test.js:1953` gates on `> 2500`), so D4's cruise blocker is neither fixed nor worsened — the membrane's extent is set by digit-tip-dominated vertices, which the web pass does not touch. The `audit-wyvern-rig` clip table is otherwise **identical** except `attack2` `belowFt` `1409 → 1433` (24 of 32,777 vertices, un-gated; other clips already span 766–1951). Rider mount geometry is byte-identical — only the asset-hash comment in `mountData.ts` / `wyvern_rider_mount.json` changed, which `test:fast` correctly flagged until regenerated.
  - **Verify**: `node tools/blender/audit_v2_skin_weights.mjs` → `passed: true`; `node tools/audit-wyvern-rig.mjs --check` → exit 0; `npm run test:fast` → 165/165. Rebuild with `node tools/blender/rebalance_v2_skin_weights.mjs [--out <candidate.glb>] [--write]` — dry run by default, `--out` writes an unpinned candidate, `--write` re-signs the contract, compacts, re-signs and re-pins. The pass is **not idempotent** (each run hands more mass to the panels), so it refuses when the median panel web share is already above 15% — apply it to the pre-C5 asset, or pass `--force`. Verified reproducible: running it on the pre-C5 asset and then `compactGlb` yields `bef7a09aa131…` **byte-for-byte**.

- [ ] **Task C6: Recenter `Jaw` Hinge Pivot (`X = +3.6 → 0.0`, `Z = 867.8 → 785.0`) & Normalize `Body` / `RootMotion` Edit-Bone Lengths in Blender**
  - **Files**: `tools/blender/build_v2_master_blend.py`, `models/source/wyvern-v2-master.blend`, `public/models/wyvern-v2-rig.glb`
  - **Action**:
    1. In `models/source/wyvern-v2-master.blend` (and GLB inverse-bind / node rest transform if promoted to runtime), recenter `Jaw.head` from `[3.6, -583.7, 867.8]` (`3.6` units off-center and `74.5` units *above* `Head` `[0.0, -547.3, 793.3]`) to the anatomical midline mandible hinge (`[0.0, -565.0, 785.0]`, `roll = 0.0°`), compensating `Jaw` rest rotation and `Jaw:rotation` keyframe tracks across all 18 clips so pitching `Jaw` opens the mouth straight down the sagittal midline without lateral yaw.
    2. In `models/source/wyvern-v2-master.blend`, extend `Body.tail` in Edit Mode from a degenerate `0.05`-unit stub (`[0.0, 432.1, 711.7]`) to `Spine1.head` (`[0.0, 268.5, 724.2]`, `length = 164.1`), and place `RootMotion.tail` flat on the floor plane (`[0.0, -200.0, 0.0]`) instead of stretching diagonally to `[0.0, 117.7, 824.2]` (`length = 832.57`), keeping bone heads and rolls unchanged so glTF TRS exports remain 100% contract-compatible.
  - **Verify**: `python3 scripts/blender/cli.py --headless --blend models/source/wyvern-v2-master.blend audit-scene` passes with `Jaw.head.x == 0.0` and `Body.length > 150.0`.

- [ ] **Task C7: Symmetrize `models/source/wyvern-rig-v1wing.blend` Edit-Bone Rolls & Lengths and Purge Orphaned Datablocks**
  - **Files**: `models/source/wyvern-rig-v1wing.blend`, `models/source/wyvern-rig.blend`
  - **Action**:
    1. In `models/source/wyvern-rig-v1wing.blend`, mirror `L_WingD0..5P0..2` and `L_WingBatten040..054` across `+X → -X` to fix the `14.9°–22.5°` roll errors and `9.1–16.4` unit length mismatches on `R_WingD0..3P0` and the inverted forward-pointing `R_WingBatten061..066` tails (`roll = +128.9°..+132.5°`).
    2. Remove the 18 orphaned `WingFinger*` / `WingMembrane*` vertex groups on `SKM_DaenerysDragon.001` and strip the 12–15 corrupt `ENE_PT_*` / `ompositing` / `Q7` scenes and orphan datablocks from both `wyvern-rig-v1wing.blend` and `wyvern-rig.blend`.
  - **Verify**: Re-run the Blender DNA bone symmetry check on `wyvern-rig-v1wing.blend` and verify `0` L/R roll or length deviations `> 0.01`.

---

### Workstream D — Animation Quality, In-Place Root Stabilization & Stage 3 Dynamics Gate (P1/P2)

- [x] **Task D1: Zero out `Body` in-place translation drift and normalize grounded `footY` support plane across all 10 grounded clips** *(Completed in `5fb3ab1` via `tools/blender/stabilize_v2_body_and_feet.mjs`; `validate-wyvern-clips --strict` exits `0` with `0` warnings and `0` problems)*
- [x] **Task D2: Fix `BUZZ` clips (`takeoff`, `death`) by reshaping velocity curves into explosive impulse + follow-through** *(Completed in `c968a24` via `tools/blender/reshape_buzz_clips.mjs`; `takeoff` `0.27× → 1.68×` peak, `death` `0.47× → 1.16×` peak)*
- [x] **Task D3: Fix `CONCENTRATED` clips (`idle`, `walk`, `attack2`) by distributing sustained secondary motion** *(Completed in `562131d` via `tools/blender/reshape_d3_clips.mjs`; `idle` `p95` `19 → 197 deg/s`, `walk` `p95` `315 → 929 deg/s`, `attack2` `accelMax` `83,690 → 37,710 deg/s²`)*

- [ ] **Task D4: Finish `UNIFORM` clips (`attack` ✅ done in `541b3e8`; `cruise`, `bankLeft`, `bankRight` open) and invert `test/wyvern-v2-dynamics.test.js`**
  - **Files**: `tools/blender/reshape_d4_clips.mjs`, `test/wyvern-v2-kinetics.test.js`, `test/wyvern-v2-dynamics.test.js`
  - **Action**:
    1. ✅ **`attack` (Done in `541b3e8`)**: Amplified from `0.09×` to `0.91×` V1 peak via `11.1×` gain + strike accent.
    2. **`cruise` (`1.68×` gain blocked by single-frame `t = 1.0s` `maxMembraneX > 2500` proxy)**: In `test/wyvern-v2-kinetics.test.js`, evaluate `maxMembraneX` across the downstroke/glide extension window (`t in [0.0..2.0s]`) alongside the pose-independent invariant `maxMembraneX >= wingTipPos.x` (or phase-align `cruise` so maximum wingspan lands at `t = 1.0s`), allowing `cruise`'s `1.68×` dynamics reshape to ship without violating wingspan integrity.
    3. **`bankLeft` / `bankRight` (`mean` channel `0.586×` vs `>= 0.70×` target, blocked by `8%` `0.500 Hz` cadence group lock)**: Instead of applying a `6.7×` gain + smoothing (which triples measured cadence from `0.500 Hz` to `1.500 Hz`), author continuous `0.500 Hz`-locked mid-stroke recovery motion and phase-staggered spine/neck/tail banking roll across the unkeyed channels (`Spine2..3`, `Neck1..2`, `Tail2..10`, `WingShoulder..Hand`) so `bankLeft` and `bankRight` reach `mean >= 0.70×` at the native `0.500 Hz` wingbeat frequency.
    4. Rebuild through the deterministic stage pipeline (`reshape_buzz_clips` → `stabilize_v2_body_and_feet` → `coordinate_all_v2_clips` → `reshape_d3_clips` → `reshape_d4_clips`), re-pin `scripts/blender/wyvern_v2_runtime_contract.json`, sync candidates, and flip `assert.equal(result.passed, true)` in `test/wyvern-v2-dynamics.test.js`.
  - **Verify**: `npm run assets:audit-dynamics:v2`, `npm run assets:validate-wyvern`, `npm run assets:audit-clips`, and `npm run test:fast` all exit `0`.

- [x] **Task D5: Differentiate or mark duplicate candidate specimens in `src/flight-lab/catalog.ts`** *(Completed in `5fb3ab1`; candidates marked with `promotedAliasOf: "wyvern-v2-rig"` and `wyvern-v1-rig.glb` symlink removed)*

---

### Workstream E — Flight Lab AI Co-Pilot, Pose-Anomaly Detector & Blender-to-Runtime Bridge (P0/P1)

- [ ] **Task E1: Upgrade `Scan` (`motionProbe.ts`) with Anatomical Pose-Envelope, Transition-Handoff & Floor-Penetration Detectors**
  - **Files**: `src/flight-lab/motionProbe.ts`, `src/flight-lab/runtime.ts`, `scripts/validate-wyvern-clips.mjs`, `test/flight-lab.test.js`
  - **Action**:
    1. Extend `scanSeam()` in `src/flight-lab/motionProbe.ts` (and `scripts/validate-wyvern-clips.mjs`) into `scanClipAnomalies()` that detects **static and structural pose bugs** in addition to `> 10°` frame jumps:
       - **Bind-Delta & Horizon Pitch Envelope**: Compute per-bone delta from bind (`q_bind^-1 * q_clip`) and cumulative `Body + Spine1..3 + Neck1..2 + Head` world pitch (`netHeadPitchDeg`). Flag an anomaly whenever a non-combat/non-dive clip holds `|bonePitchVsBind| > 18°` (immediately flags `idle`'s `-21.1° / -24.2° / -19.3°` neck raise!) or when a grounded clip holds `netHeadPitchDeg` outside `[-12°, +12°]`.
       - **Unintended Open Jaw Detector**: Flag any non-mouth clip (`!['attack','attack2','attackAir2','breath','roar','death'].includes(clip)`) where `Jaw` pitch vs bind exceeds `2.0°` (immediately catches `walk`'s `+8.6°` open jaw).
       - **Transition Handoff Scanner**: Check boundary pose deltas across canonical state-machine transitions (`takeoff(end) → cruise(start)`, `cruise(0) ↔ bankLeft(0)/bankRight(0)`, `land(end) → idle(start)`, `idle(0) ↔ walk(0)`) and flag any bone with `> 8.0°` jump (immediately catches `land → idle`'s `15.9°` `Neck2` and `17.0°` `Foot` snap).
       - **Floor Penetration & Root Drift**: Flag any frame where skinned wing/body vertices drop below `footY - 15` rig units (`attack2`/`attackAir2`) or `Body` horizontal drift exceeds `0.5` rig units.
    2. Color-code anomaly probes in the 3D viewport (`#ef4444` pulsing sonar ring on any bone failing the pose envelope) when `Scan` is clicked.
  - **Verify**: Run `node --import tsx --test test/flight-lab.test.js` with a test proving `scanClipAnomalies` flags the pre-fix `-65°` `idle` neck, `walk`'s `+8.6°` jaw, and `land → idle`'s `15.9°` jump.

- [ ] **Task E2: Upgrade Inspection Pins (`inspectionPins.ts` & `ActivePinBanner.tsx`) with Bind-Delta, Layer Attribution & Editable User Notes**
  - **Files**: `src/flight-lab/anatomicalMap.ts`, `src/flight-lab/inspectionPins.ts`, `src/flight-lab/runtime.ts`, `src/app/flight-lab/components/ActivePinBanner.tsx`
  - **Action**:
    1. In `anatomicalMap.ts`, cache each bone's rest/bind quaternion (`bindQuaternion`) on model load, and record three distinct rotations on every `ResolvedLandmark` and `FlightLabPin`:
       - `clipDeltaEulerDeg`: pure authored animation track delta vs bind (`q_bind^-1 * q_mixer`)
       - `proceduralDeltaEulerDeg`: delta added by `wyvernFlightRig` / `neckSpring` (`q_mixer^-1 * q_final`)
       - `worldHorizonEulerDeg`: cumulative world pitch/yaw/roll relative to the horizon (`Body → ... → bone`)
    2. Add an inline text input in `ActivePinBanner.tsx` (`"Describe issue for AI (e.g. neck craned too high)..."`) bound to `pin.note`, and update `formatPinForAI()` so clicking **Copy for AI** copies a complete, self-contained AI repair ticket containing:
       - Exact specimen SHA/file, clip, frame number (`Math.round(clipTime * 24)`), and normalized phase
       - Bone name, parent chain, **Bind Delta (`ΔX, ΔY, ΔZ`)**, **Procedural Controller Offset**, and **World Horizon Pitch**
       - Exact source culpability hint (e.g., `"Source: 98% from baked GLB track 'idle' Neck2:rotation; 0% from wyvernFlightRig"`) and suggested CLI command (`node tools/blender/splice_neck_head_channels.mjs ...`)
       - The user's typed note.
    3. Make **"Dump Rig"** in `AnimationLogConsole.tsx` copy the full diagnostic report directly to the clipboard (with a `"✓ Copied Rig Report"` toast) in addition to logging to console.
  - **Verify**: Click any joint in Flight Lab, type a note, click `Copy for AI`, and verify the clipboard markdown includes `Bind Delta`, `Procedural Delta`, `World Horizon Pitch`, `Frame #`, and `User Feedback`.

- [ ] **Task E3: Add a Stage Toolbar Toggle for `"Raw Clip vs Procedural Rig"` (`flightRig` Bypass)**
  - **Files**: `src/flight-lab/runtime.ts`, `src/flight-lab/types.ts`, `src/app/flight-lab/components/StageViewport.tsx`, `src/app/flight-lab/FlightLabClient.tsx`
  - **Action**:
    1. Add a **`Proc` (Procedural Rig ON/OFF)** toggle button to the `StageViewport.tsx` top toolbar (and keyboard shortcut `G`).
    2. When `Proc` is toggled OFF, `runtime.ts` calls `flightRig?.reset()`, skips `flightRig?.update()` and `neckSpring.tick()`, and renders the pure, unmodified `.glb` animation tracks from `AnimationMixer`.
    3. Also add a `"Raw vs Procedural"` option to `Ghost` comparison mode (`comparisonRig.ts`) so the user can see the raw Blender clip (ghost cyan mesh) superimposed directly over the procedurally enhanced runtime rig on the exact same model!
  - **Verify**: Toggle `Proc` off/on in Flight Lab and verify instant A/B isolation between baked Blender keyframe defects and `src/flight-lab/rig/` procedural offsets.

- [ ] **Task E4: Add a Local Dev API Endpoint (`/api/flight-lab/report`) for 1-Click Repo Evidence Export & Live Blender Hot-Reload**
  - **Files**: New `src/app/api/flight-lab/report/route.ts`, `src/flight-lab/evidenceExport.ts`, `scripts/blender/cli.py`
  - **Action**:
    1. Create a Next.js dev-only route `POST /api/flight-lab/report` that writes exported PNG screenshots, JSON telemetry sidecars, and pinned AI bug tickets directly into `docs/flight-lab/inbox/latest-issue.md` and `docs/flight-lab/inbox/latest-capture.png` inside the repo (instead of triggering browser downloads to `~/Downloads`).
    2. When you click **`Export`** or **`Save Issue for AI`** in Flight Lab, the browser saves the screenshot + pin telemetry + anomaly scan straight to `docs/flight-lab/inbox/latest-issue.md`, so you can simply tell any coding agent: *"Fix the issue in `docs/flight-lab/inbox/latest-issue.md`"*.
    3. Add a `watch-and-splice` command to `scripts/blender/cli.py` (or `npm run blender:sync-clip -- --clip <name>`) that exports the active action from `models/source/wyvern-v2-master.blend`, splices it into `public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb`, runs `validateRuntimeRig` + `scanClipAnomalies`, and triggers a hot reload in Flight Lab (`Ghost` mode auto-comparing `wyvern-v2-rig.glb` vs `wyvern-v2-idle-walk-flight-lab-candidate.glb`).
  - **Verify**: Click `Export` in Flight Lab and verify `docs/flight-lab/inbox/latest-issue.md` and `latest-capture.png` are written directly inside the repo workspace.
