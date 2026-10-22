# Wyvern Flight Lab & 3D Rig Studio

A dedicated, standalone repository isolating the **Wyvern Flight Lab** interactive inspection suite, full test gates, Blender rigging/automation tools, and authoritative **V1 & V2 3D Wyvern models**.

---

## 🐲 3D Wyvern Models & Assets

Located in `public/models/` and `models/source/`:

| Asset File | Version | Role / Description |
|---|---|---|
| `public/models/player-wyvern.glb` (aliased by `wyvern-v1-rig.glb`) | **V1 / Rig 1** | Canonical Drogon juvenile wyvern rig with 13 CUBICSPLINE clips, 2 skins, 39,234 tris, and integrated human rider (baseline reference for motion, wing shape, and dynamics). |
| `public/models/wyvern-v2-rig.glb` | **V2 / Rig 2** | Canonical Gothic rebuild runtime rig (`6,368,564 B`, `sha256: bef7a09a…`): 92 skin joints (85 weighted, 7 zero-weight), single-skin invariant, 2 meshes (`WyvernBody_Rebuild` + `WyvernMembrane_ExportSafe`, 49,872 tris), 18 canonical clips, and coordinated membrane panel chains. |
| `public/models/wyvern-rider.glb` | **V2 Rider** | Standalone 24-bone (`RDR_*`), 2,860-tri armored rider asset with 4 clips (`idle`, `leanLeft`, `leanRight`, `brace`), mounted at `Spine3`. |
| `public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb` | **V2 Candidate** | Review candidate for revised Idle and Walk loops (currently synced to `wyvern-v2-rig.glb`). |
| `public/models/wyvern-v2-membrane-lab-candidate.glb` | **V2 Candidate** | Membrane repair candidate with relaxed wing curvature and surface normal handling (currently synced to `wyvern-v2-rig.glb`). |
| `assets/blender/wyvern-gothic.glb` | **Source GLB** | Uncompressed 92-bone, single-mesh (`SKM_DaenerysDragon.001`, 39,238 tris) reference export before 2-mesh split and panel coordination. |
| `models/source/wyvern-rig.blend` | **Blender V2 (Legacy)** | 56-bone (39 weighted) legacy 3-finger V2 Blender source file with 16 actions (`idle`/`walk`/`rest` rest-pose & neck donor; missing `WingD0..5` and `WingPanel` chains — see [doc 41](docs/flight-lab/41-v2-and-blender-rig-audit-task-list.md) Task C1 for 92-bone master `.blend` reconstruction). |
| `models/source/wyvern-rig-v1wing.blend` | **Blender V1 Wing** | 124-bone (106 weighted) rigging study with 33 actions (`18` V2 + `15` `v1_*`), missing the 16 `WingPanel0..3_0..1` bones. |
| `models/source/drogon-v1-rig.blend` | **Blender V1** | 292-bone Drogon V1 Blender rig source file with 27 `Sanct_*` actions. |
| `models/source/wyvern_animated.blend` | **Blender Anim** | 70-bone (`Bip001`) action library with 9 animated takeoff, glide, fly, and walk cycles. |

---

## ✈️ Flight Lab Inspection Suite

The Flight Lab is an interactive Next.js + Three.js application for real-time inspection, telemetry, and kinetic debugging:

- **Avionics HUD & Telemetry**: Live airspeed, altitude, bank angle, climb rate, and clip progress.
- **Flight Kinematics & Wing Procedural Overlays**: Real-time secondary physics, procedural spine waves, tail stabilization, gaze tracking, and dynamic wing membrane deformation (`src/flight-lab/rig/`).
- **Specimen Comparison Matrix**: Live side-by-side (`Formation`), superimposed (`Ghost`), or instant switching between V1 reference and V2 rigs.
- **Micro-Timeline Scrubber & Step Control**: Frame-by-frame stepping (1/24s), playback rate modulation (0.1x to 2.0x), and looping seam / pose-anomaly analysis.
- **Landmark & Pin Inspection**: Named spatial pins on wing tips, carpal joints, jaw, neck, and tail with AI diagnostic export (`Copy for AI`).

---

## 🛠️ Blender Automation, Tools & Quality Gates

Located in `scripts/blender/` and `tools/`:

- `scripts/blender/cli.py`: Unified CLI for headless GLB audits, joint contracts, and review scenes.
- `scripts/blender/wyvern_v2_runtime_contract.json`: Pinned numeric contract covering 92 canonical joints, single-skin topology, 0 orphaned samplers, and clip signatures.
- `tools/blender/runtime_rig_contract.mjs`: Pure runtime contract validator preventing corrupted or bloated rig exports from shipping.
- `tools/audit-all-clips.mjs` & `scripts/validate-wyvern-clips.mjs`: Measures root motion, loop seams, floor clearance, and bank symmetry across all 18 clips.
- `tools/audit-dynamics.mjs` & `tools/diagnose-clip-dynamics.mjs`: World-space 60 Hz angular velocity & travel gates against the V1 reference baseline (`assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json`).

---

## 📚 Current Roadmap, Audits & 3D History Documentation

Start with the active roadmap and handoff documents in `docs/flight-lab/`:

- **[`docs/flight-lab/NEXT_SESSION.md`](docs/flight-lab/NEXT_SESSION.md)**: Live cross-session handoff log and immediate next steps.
- **[`docs/flight-lab/39-v2-development-roadmap.md`](docs/flight-lab/39-v2-development-roadmap.md)**: Master V2 development roadmap (`Milestones M1–M11`), V2 vs V1 capability matrix, and error/anomaly handling plan.
- **[`docs/flight-lab/40-architecture-audit-and-prioritized-path.md`](docs/flight-lab/40-architecture-audit-and-prioritized-path.md)**: Codebase architecture audit, technical debt register (`D1–D16`), and verified mobile reachability closure.
- **[`docs/flight-lab/41-v2-and-blender-rig-audit-task-list.md`](docs/flight-lab/41-v2-and-blender-rig-audit-task-list.md)**: Full V2 runtime GLB audit, Step 5 note verification, Blender `.blend` mismatch matrix, Flight Lab AI/detector design, and coding-agent task list (`Workstreams A–E`).
- **[`docs/flight-lab/37-stage3-clip-defect-taxonomy.md`](docs/flight-lab/37-stage3-clip-defect-taxonomy.md)** & **[`37-v2-idle-neck-audit-note.md`](docs/flight-lab/37-v2-idle-neck-audit-note.md)**: Stage 3 clip dynamics taxonomy (`UNIFORM`, `CONCENTRATED`, `BUZZ`) and the V2 idle neck-raise source audit note.
- **Blender & 3D History** (`docs/blender-and-3d-history/`):
  - `WYVERN_ANIMATION_BASELINE.md`, `WYVERN_ANIMATION_PLAN.md`, `BLENDER_CRASH_LOG.md`, `WYVERN_V1_REAUTHORING_SOURCE_OF_TRUTH.md`, `BLENDER_RIG_WORKFLOW.md`, and `BLENDER_AUTOMATION_PLAYBOOK.md`.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Run Flight Lab Locally
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Run Quality Gates & Rig Tests
```bash
npm run test:fast
npm run assets:validate-wyvern
npm run assets:audit-clips
npm run assets:audit-dynamics:v2
```
