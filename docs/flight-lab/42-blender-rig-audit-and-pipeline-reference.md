# 42: Wyvern V2 Rig Audit & Blender Pipeline Reference Log

**Date:** 2026-10-21  
**Author:** AI Pair Programmer (Antigravity)  
**Target Shipped Asset:** `public/models/wyvern-v2-rig.glb` (`sha256: 88adf57e5d769b26a382bbc94bced253473a88c87e071c4b3100cd43ce666d6d`, `5,844,968 B`)  
**Canonical Master Blend:** `models/source/wyvern-v2-master.blend` (`15,257,893 B`, single clean scene `Scene`)  
**Current Test Status:** `165/165` fast tests pass (`scripts/test-fast.mjs`), `17/17` Python rig tests pass (`tools/blender/tests/`), runtime rig contract passes.

---

## 1. Quick Reference for Other Agents

If you are an agent resuming work on the Wyvern rig, Blender animations, or Flight Lab pipeline, **read this section first**:

1. **Which `.blend` file is the master?**  
   Always use **`models/source/wyvern-v2-master.blend`**.  
   Do **NOT** use `models/source/wyvern-rig.blend` (56 bones, legacy) or `wyvern-rig-v1wing.blend` (124 bones, mixed battens). They cannot export the 92-bone V2 runtime model.
2. **Environment & Sandbox Caveat (macOS)**:  
   Running raw `/usr/bin/git` triggers an interactive Xcode license prompt in headless shells.  
   **Always use**: `DEVELOPER_DIR=/Library/Developer/CommandLineTools git <subcommand>`.  
   Always invoke Homebrew binaries directly: `/opt/homebrew/bin/node` and `/opt/homebrew/bin/python3`, and ensure `PATH="/opt/homebrew/bin:$PATH"`.
3. **Shipped Asset vs Candidates**:  
   `public/models/wyvern-v2-rig.glb` is pinned by hash and byte count in `scripts/blender/wyvern_v2_runtime_contract.json`.  
   Never overwrite `public/models/wyvern-v2-rig.glb` with unpinned candidate bytes. Always output candidates to `assets/rig-audits/2026-10-21-dynamics/candidates/wyvern-v2-dynamics-candidate.glb`.
4. **glTF 2.0 Spec §3.7.2.1 Invariant**:  
   `JOINTS_0` accessors must **NEVER** have `normalized: true`. Blender 5.1.1's `io_scene_gltf2` importer divides normalized U8 values by 255 into floats, throwing `IndexError: arrays used as indices must be of integer (or boolean) type`.

---

## 2. Source Rig Matrix & Datablock Inventory

| File | Bones / Deform | Meshes | Actions | Status & Verdict |
|---|---|---|---|---|
| **`models/source/wyvern-v2-master.blend`** | **92 bones** / 92 deform (`00 Deform`) | **2 meshes**: `WyvernBody_Rebuild` (34,614 tris) + `WyvernMembrane_ExportSafe` (15,258 tris) | **18 canonical clips** mapped to `OBWyvernRig` action slot | **Canonical Master Source**. Clean single scene (`Scene`), 0 orphan datablocks. Roundtrips cleanly to 92-bone V2 GLB in Blender 5.1.1. |
| `models/source/wyvern-rig.blend` | 56 bones / 38 deform | 1 combined mesh (`SKM_DaenerysDragon.001`) | 16 clips (missing `attack2`, `attackAir2`; static flight necks) | **Legacy / Deprecated**. Missing `WingHand`, all 36 `WingD0..5` digits, all 16 `WingPanel` bones. Exports 39 joints (fails 92-joint contract). Contains 15 corrupt scenes (`ENE_PT_*`). |
| `models/source/wyvern-rig-v1wing.blend` | 124 bones / 106 deform | 1 combined mesh | 33 clips (18 V2 + 15 legacy donor actions) | **Legacy / Deprecated**. Mixed legacy batten bones (`WingBatten040..069`); missing all 16 `WingPanel` bones. Contains 11 corrupt scenes. |
| `models/source/drogon-v1-rig.blend` | 292 bones / 165 deform | 1 combined mesh + rider + cloak | 27 `Sanct_*` actions | **Reference Only**. Drogon sanctuary asset with human rider rig. |

---

## 3. Discovered Defects & Verified Fixes

### 3.1 Hind-Leg 2-Bone IK Pole Angle Twist (Fixed in `scripts/blender/rigging/control_rig.py`)
- **Diagnosis**: In Blender, `L_Calf`'s local +X axis points laterally (+X for Left, -X for Right). Running `build_control_rig()` with `ik.pole_angle = 0.0` and the pole target offset at `(0, -180, 40)` twisted the calf by **105.9° (Left)** and **74.1° (Right)** on frame 0 rest pose.
- **Fix**: Derived and set the exact chiral pole angles:
  ```python
  ik.pole_angle = math.radians(-70.18 if side == "L" else -109.81)
  ```
  Realigned `CTRL_Pole_Knee_L/R` from `(0, -180, 40)` to `(0, -200, 0)` in front of the knee along the natural plane of flexion. Rest-pose angular twist dropped to **0.00°**.

### 3.2 Tail Spline Dislocation (Fixed in `scripts/blender/rigging/control_rig.py`)
- **Diagnosis**: `CTRL_Tail_Base` (`Tail3`), `CTRL_Tail_Mid` (`Tail6`), and `CTRL_Tail_Tip` (`Tail10`) were created at an arbitrary `+50 Z` offset, and vertebrae were constrained with `DAMPED_TRACK`. Because the natural tail arches downward, tracking toward `+50 Z` pulled `Tail10` skyward by **66.5°** at rest pose.
- **Fix**: Replaced offset bones with in-line edit bones matching the rest head/tail/roll of the vertebrae. Replaced `DAMPED_TRACK` with local-space `COPY_ROTATION` in `ADD` mix mode:
  ```python
  cr = pb.constraints.new(type="COPY_ROTATION")
  cr.name = f"CTRL_TailRot_{seg}"
  cr.target = armature
  cr.subtarget = ctrl_name
  cr.target_space = "LOCAL"
  cr.owner_space = "LOCAL"
  cr.mix_mode = "ADD"
  cr.influence = round(base_inf * ((seg - start_idx + 1) / (end_idx - start_idx + 1)), 4)
  ```
  Rest-pose tail angular error dropped from **66.5° to 0.00°**, giving animators progressive S-wave posing.

### 3.3 Neutral Ground Contact IK & Wing Fold Drivers (Fixed in `scripts/blender/rigging/control_rig.py`)
- **Default `ground_contact_ik = 0.0`**: Changed default from `1.0` to `0.0`. In flight and rest clips, wing knuckles are no longer clamped to the floor plane by default.
- **Wing Membrane Panel Fold Drivers**: Added `WingPanel0..3_0` (`0.48`) and `WingPanel0..3_1` (`0.58`) to `WING_FOLD_RATIOS`. `CTRL_WingFold_L/R` now folds the 16 membrane panels in unison with digits, preventing mesh tearing in Blender.

### 3.4 Blender Headless CLI & glTF Exporter (Fixed in `scripts/blender/`)
- **`scripts/blender/cli.py`**: Fixed `command_arguments()` so the positional `glb` argument in `audit-glb` is not erroneously prefixed with `--`.
- **`scripts/blender/export/gltf.py`**: Updated `export_wyvern_glb()` to auto-detect the two-mesh V2 structure (`WyvernBody_Rebuild` + `WyvernMembrane_ExportSafe`) instead of looking for single `WyvernMesh`, and set `export_def_bones=False` so unweighted deform bones are not stripped and no synthetic `neutral_bone` is created.

### 3.5 Candidate Isolation & Panel Re-Coordination (New Tools)
- **Candidate Contract Isolation**: Fixed [`tools/blender/reshape_buzz_clips.mjs`](file:///Users/ajadvanwyk/wyvern-flight-lab/tools/blender/reshape_buzz_clips.mjs) and [`tools/blender/stabilize_v2_body_and_feet.mjs`](file:///Users/ajadvanwyk/wyvern-flight-lab/tools/blender/stabilize_v2_body_and_feet.mjs) so they only update `scripts/blender/wyvern_v2_runtime_contract.json` when the output path is explicitly `public/models/wyvern-v2-rig.glb`. Candidate files leave the pinned runtime contract untouched.
- **Panel Re-Coordination Utility**: Created [`tools/blender/recoordinate_candidate_panels.mjs`](file:///Users/ajadvanwyk/wyvern-flight-lab/tools/blender/recoordinate_candidate_panels.mjs). Whenever digit tracks are amplified or reshaped, running this tool re-solves the 16 panel bones (`WingPanel0_0..WingPanel3_1`) using Three.js kinematics to match `q0.slerp(q1, 0.5)` of adjacent digits. Tested across all 18 clips: maximum panel error dropped from `106.0°` (in uncoordinated takeoff) down to **`0.37°`**, well within the `1.0°` gate limit.

---

## 4. Operational Commands for Agents

### Verification Commands
```bash
# 1. Verify runtime rig contract (sha256: 88adf57e5d76..., 5844968 B)
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/node tools/blender/runtime_rig_contract.mjs

# 2. Run fast test suite (165/165 tests)
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/node scripts/test-fast.mjs

# 3. Run Python rig unit tests (17/17 tests)
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/python3 -m unittest discover -s tools/blender/tests

# 4. Run strict clip validation (checks mirroring, loops, zero root travel, foot height)
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/node scripts/validate-wyvern-clips.mjs public/models/wyvern-v2-rig.glb --strict

# 5. Headless scene audit in Blender 5.1+
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/python3 scripts/blender/cli.py --headless --blend models/source/wyvern-v2-master.blend audit-scene
```

### Candidate Generation Commands
```bash
# 1. Reshape BUZZ clips (takeoff, death) on candidate
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/node tools/blender/reshape_buzz_clips.mjs <in.glb> <out.glb>

# 2. Stabilize in-place Body root drift & grounded foot-plane height
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/node tools/blender/stabilize_v2_body_and_feet.mjs <in.glb> <out.glb>

# 3. Re-coordinate wing membrane panels after digit modifications
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/node tools/blender/recoordinate_candidate_panels.mjs <in.glb> <out.glb> [clipNames...]

# 4. Measure dynamics against V1 reference gate
PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/node tools/audit-dynamics.mjs <candidate.glb> --baseline assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json
```

---

## 5. Known Open Roadmap Items (Next Milestones)

1. **Stage 3 Dynamics Full Promotion (Milestone M6)**:
   - When promoting candidates to `public/models/wyvern-v2-rig.glb`, re-run `recoordinate_candidate_panels.mjs` so panel coordination (`<= 1.0°`) and dynamics targets pass simultaneously.
   - Update `mountData.ts` via `npm run assets:calibrate-rider-mount` whenever the wyvern model bytes or spine coordinates change.
   - Invert assertion in `test/wyvern-v2-dynamics.test.js` line 107 (`assert.equal(result.passed, true)`).
2. **Unweighted Bones (Milestone M7 / Task C2)**:
   - 5 deforming bones currently carry 0 vertex weights: `L/R_WingPanel0_0`, `L/R_WingPanel1_0`, and `Tail1`.
   - Distribute smooth weights in `WyvernMembrane_ExportSafe` for proximal panel batten roots and in `WyvernBody_Rebuild` between `Body` and `Tail1`.
3. **Flight Lab AI Diagnostics (Milestone M11 / Workstream E)**:
   - Implement `scanClipAnomalies()` in `src/flight-lab/motionProbe.ts` to detect static pose drift and inter-clip boundary snaps in addition to velocity spikes.
