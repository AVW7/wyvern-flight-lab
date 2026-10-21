# Wyvern Flight Lab & 3D Rig Studio

A dedicated, standalone repository isolating the **Wyvern Flight Lab** interactive inspection suite, full test gates, Blender rigging/automation tools, and authoritative **V1 & V2 3D Wyvern models**.

---

## 🐲 3D Wyvern Models & Assets

Located in `public/models/` and `models/source/`:

| Asset File | Version | Role / Description |
|---|---|---|
| `public/models/player-wyvern.glb` | **V1** | Canonical Drogon juvenile wyvern rig with 13 clips (baseline for motion, wing shape, and proportion comparison). |
| `public/models/wyvern-v2-rig.glb` | **V2** | Canonical Gothic rebuild focus rig: 92 bones, single-skin invariant, 18 canonical flight/locomotion/combat clips, and coordinated membrane panel chains. |
| `public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb` | **V2 Candidate** | Review candidate for revised Idle and Walk loops. |
| `public/models/wyvern-v2-membrane-lab-candidate.glb` | **V2 Candidate** | Membrane repair candidate with relaxed wing curvature and surface normal handling. |
| `assets/blender/wyvern-gothic.glb` | **Source GLB** | Unquantized reference export before runtime mesh optimization. |
| `models/source/wyvern-rig.blend` | **Blender V2** | Authoritative 92-bone V2 Blender rig source file with full rest pose and FCurve data. |
| `models/source/wyvern-rig-v1wing.blend` | **Blender V1 Wing** | Rigging study with historical V1 wing geometry and bone constraints. |
| `models/source/wyvern_animated.blend` | **Blender Anim** | Action library with animated takeoff, glide, fly, and walk cycles. |

---

## ✈️ Flight Lab Inspection Suite

The Flight Lab is an interactive Next.js + Three.js application for real-time inspection, telemetry, and kinetic debugging:

- **Avionics HUD & Telemetry**: Live airspeed, altitude, bank angle, climb rate, and clip progress.
- **Flight Kinematics & Wing Procedural Overlays**: Real-time secondary physics, procedural spine waves, tail stabilization, gaze tracking, and dynamic wing membrane deformation.
- **Specimen Comparison Matrix**: Live side-by-side or instant switching between V1 reference and V2 rigs.
- **Micro-Timeline Scrubber & Step Control**: Frame-by-frame stepping (1/24s), playback rate modulation (0.1x to 2.0x), and looping seam analysis.
- **Landmark & Pin Inspection**: Named spatial pins on wing tips, carpal joints, jaw, and tail to inspect trajectory smoothness.

---

## 🛠️ Blender Automation, Tools & Quality Gates

Located in `scripts/blender/` and `tools/`:

- `scripts/blender/cli.py`: Unified CLI for headless GLB audits, joint contracts, and review scenes.
- `scripts/blender/wyvern_v2_runtime_contract.json`: Pinned numeric contract covering 92 canonical joints, single-skin topology, and clip signatures.
- `tools/blender/runtime_rig_contract.mjs`: Pure runtime contract validator preventing corrupted rig exports from shipping.
- `tools/audit-all-clips.mjs`: Measures root motion, loop seams, and bank symmetry across all 18 clips.
- `tools/blender/harvest_v1_to_v2.py`: Blender script for harvesting motion profiles from V1 actions into V2 digit hierarchies.

---

## 📚 Blender, Rigging & 3D History Documentation

Comprehensive technical archives preserved in `docs/`:

- **Flight Lab Delivery Plans** (`docs/flight-lab/`):
  - Stages 01 through 34 detailing flight playback, camera controls, interactive flight, cruise repair, wing harvesting, membrane crease studies, and runtime morph bakes.
  - Baseline audits (`docs/flight-lab/34-v2-repair-baseline.md`).
- **Blender & 3D History** (`docs/blender-and-3d-history/`):
  - `WYVERN_ANIMATION_BASELINE.md`: Rig axes, bone coordinate conventions, and clip contract signatures.
  - `WYVERN_ANIMATION_PLAN.md`: Rig refactoring and animation enhancement milestones.
  - `BLENDER_CRASH_LOG.md`: Deep investigation into macOS Metal capability detection, IlmThread wait-loops, and long-session allocator behavior.
  - `WYVERN_V1_REAUTHORING_SOURCE_OF_TRUTH.md`: Frame-by-frame reference logs for original Drogon clips.
  - `BLENDER_RIG_WORKFLOW.md` & `BLENDER_AUTOMATION_PLAYBOOK.md`: Headless scripting workflows and MCP tooling protocols.

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
pnpm test
pnpm assets:validate-wyvern
pnpm assets:audit-clips
```
