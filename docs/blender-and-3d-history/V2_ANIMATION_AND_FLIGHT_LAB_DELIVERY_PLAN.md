# V2 Animation and Flight Lab Delivery Plan

**Repository:** `wyvern3d-v2`  
**Target Asset:** `public/models/wyvern-gothic.glb` (92 joints, 18 actions, 5-spar wings)  
**Workbench:** `/debug/animation` (`src/app/debug/animation/`)  
**Status:** ACTIVE — Ready for Staged Execution  

---

## 1. Executive Summary & Vision

This delivery plan unifies the **Gothic V2 animation pipeline** with the **Flight Lab engineering workbench**. It supersedes the historical wishlist in `docs/FLIGHT_LAB_ENHANCEMENT_PLAN.md` and the closed vendor-rig work in `docs/WYVERN_ANIMATION_PLAN.md`, establishing a single source of truth for all wyvern motion engineering.

### The Problem It Solves
1. **Fragmented Documentation & Rig Drift**: Prior plans referenced the legacy 56-joint rig (`Bip002-*` bones, 3 wing digits). The runtime asset is now the 92-joint Gothic V2 (`L_WingD{0..4}P{0..2}`, 8 panel controls per side, 18 actions). Tooling, tests, and documentation must reflect this reality.
2. **The LLM Blindness & Spatial Guesswork Trap**: Vision LLMs and human visual review consistently miss joint roll errors, temporal clamps (42ms hitch at $t=0$), loop seam pops, and axis inversions on dark, glossy models. Review must be **numeric and probe-first**.
3. **Unconnected Workbench**: The browser Flight Lab (`/debug/animation`) possessed rich UI controls, but several sliders were disconnected from actual runtime bone mutations or drifted from Blender headless telemetry. Flight Lab must serve as the authoritative live inspection bridge.

---

## 2. Core Architectural Pillars

```mermaid
flowchart TD
    subgraph Pillar 1: Gothic V2 Animation Pipeline
        A1[18 Canonical Actions] --> A2[Secondary Physics & Dynamics]
        A2 --> A3[Seamless Phase Transitions]
        A3 --> A4[Grounded Fold & Walk Gait]
    end

    subgraph Pillar 2: Headless & CI Gates
        B1[scripts/blender/cli.py probe] --> B2[scripts/blender/audit_glb.py]
        B2 --> B3[scripts/validate-wyvern-clips.mjs]
        B3 --> B4[wyvernGothicValidation.test.ts in Vitest]
    end

    subgraph Pillar 3: Flight Lab Workbench
        C1[Live Telemetry Readout labTelemetry.ts] --> C2[Speed Dynamics 0-60 u/s]
        C2 --> C3[Combat & Prey Sandbox PreyDoe/PreyBird]
        C3 --> C4[One-Click TS Pose & JSON Export]
    end

    Pillar 1 --> Pillar 2
    Pillar 2 --> Pillar 3
    Pillar 3 -. Live Tuning .-> Pillar 1
```

---

## 3. Pillar 1: Gothic V2 Animation Pipeline & Deliverables

The baseline asset is `public/models/wyvern-gothic.glb` (23.7 MB, 92 joints, 18 actions).

### 3.1 The 18 Canonical Actions & Quality Contracts

Every action must strictly satisfy the contracts verified by `pnpm test src/render/assets/wyvernGothicValidation.test.ts`:

| Action | Kind | Target Cadence | Max Mirror Error | Max Loop Seam | Root Travel | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `cruise` | Flight Loop | 0.500 Hz (3 beats / 6.0s) | $\le 0.0010$ m | $\le 0.0010$ rad | 0.0000 m | ✅ Done |
| `bankLeft` | Flight Loop | 0.500 Hz (3 beats / 6.0s) | Asymmetric ($\sim 17.9$ m) | $\le 0.0200$ rad | 0.0000 m | ✅ Done |
| `bankRight`| Flight Loop | 0.500 Hz (3 beats / 6.0s) | Asymmetric ($\sim 17.9$ m) | $\le 0.0200$ rad | 0.0000 m | ✅ Done |
| `hover` | Flight Loop | 0.667 Hz (4 beats / 6.0s) | $\le 0.0010$ m | $\le 0.0010$ rad | 0.0000 m | ✅ Done |
| `scout` | Flight Loop | 0.333 Hz (2 beats / 6.0s) | $\le 0.0010$ m | $\le 0.0010$ rad | 0.0000 m | ✅ Done |
| `speed` | Flight Loop | 0.800 Hz (4 beats / 5.0s) | $\le 0.0010$ m | $\le 0.0300$ rad | 0.0000 m | ✅ Done |
| `glide` | Flight Loop | Held unpowered ($\sim 0.5$ Hz) | $\le 0.0012$ m | $\le 0.0010$ rad | 0.0000 m | ✅ Done |
| `dive` | Flight Loop | Held tucked ($\sim 0.17$ Hz) | $\le 0.0010$ m | $\le 0.0200$ rad | 0.0000 m | ✅ Done |
| `idle` | Ground Loop | 0.333 Hz (2 breaths / 6.0s)| $\le 0.0060$ m | $\le 0.0010$ rad | 0.0000 m | ✅ Done |
| `walk` | Ground Loop | 0.407 Hz (2.458s gait) | Asymmetric ($\sim 14.1$ m) | $\le 0.0010$ rad | 0.0000 m | ✅ Done |
| `rest` | Ground Loop | Static Fold (6.0s) | $\le 0.0006$ m | $\le 0.0010$ rad | 0.0000 m | ✅ Done |
| `takeoff` | One-Shot | 2.000 Hz burst (3.0s) | $\le 0.0012$ m | N/A (One-shot) | 0.0000 m | ✅ Done |
| `land` | One-Shot | Flare brake (3.0s) | $\le 0.0012$ m | N/A (One-shot) | 0.0000 m | ✅ Done |
| `attack` | One-Shot | Strike snap (1.5s) | $\le 0.0010$ m | $\le 0.0010$ rad (resolves) | 0.0000 m | ✅ Done |
| `attack2` | One-Shot | Retargeted strike (3.33s)| Asymmetric (15.4 m) | N/A (One-shot) | 0.0000 m | ✅ Done |
| `attackAir2`| One-Shot | Aerial talon swoop (3.33s)| Asymmetric (16.2 m) | N/A (One-shot) | 0.0000 m | ✅ Done |
| `breath` | One-Shot | Fire jet cone (2.0s) | $\le 0.0012$ m | $\le 0.0010$ rad | 0.0000 m | ✅ Done |
| `death` | One-Shot | Collapse roll (4.0s) | $\le 0.0012$ m | N/A (One-shot) | 0.0000 m | ✅ Done |

### 3.2 Secondary Physics & Real-Time Bone Dynamics Pass

The procedural overlay layer sits in `src/render/` and is applied per-frame directly onto bones without triggering React re-renders:

1. **Spine Wave Propagation (`src/render/spineWave.ts`)**:
   - Traveling S-curve from `Spine1` $\to$ `Spine3` $\to$ `Tail1..10`.
   - Driven by airspeed and wingbeat phase: each segment lags the anterior bone by 12% cycle.
   - Preserves chest stability: `Spine1` maintains leg root planting; only `Spine2` and `Spine3` articulate breathing/flex.
2. **Intelligent Gaze & Neck Stabilization (`src/render/gazeController.ts`)**:
   - Predictive look-ahead targeting (150ms horizon).
   - Mode-aware posture:
     - *Hover*: Horizon-hold counter-pitch, wide scanning yaw.
     - *Cruise*: Streamlined alignment, vibration damping.
     - *Dive*: Head tucked forward, tight tracking of target flight path.
3. **Tail Rudder Counterbalance**:
   - Aerodynamic drag simulation: at low speeds ($<10$ u/s), tail sways loosely in a fluid serpentine wave; at high speeds ($>30$ u/s), aerodynamic stiffness increases, trailing directly in the slipstream.
4. **Membrane Panel Aerodynamic Flutter**:
   - Live procedural oscillation of `L/R_WingPanel{0..3}_{0..1}` driven by airspeed and turn g-forces.

---

## 4. Pillar 2: The Modernized Flight Lab Workbench (`/debug/animation`)

The Flight Lab is the interactive test harness and telemetry bridge.

### 4.1 Modular Workbench Directory Layout

```text
src/app/debug/animation/
├── page.tsx                     # Route entrypoint
├── FlightLabClient.tsx          # Client layout, shortcut listeners, topbar dock
├── FlightLab.tsx                # Dynamic Three.js canvas loader
├── constants.ts                 # Themes, species, camera presets, speed limits
├── labBones.ts                  # Bone aliases (Gothic V2 + fallback resolution)
├── labPresets.ts                # Clip resolution, deep link search serialization
├── labDynamics.ts               # Airspeed, gaze blend, leg tuck, tail stiffness formulas
├── labTelemetry.ts              # Live contract evaluator, pose export formatting
├── labComposer.ts               # Dynamic pose overlay & wing pitch composer
├── components/
│   ├── FlightLabCanvas.tsx      # R3F Canvas, metric ground grid, shadow map
│   ├── FlightLabRigContainer.tsx# Skinned mesh loader, live bone transform mutator
│   ├── FlightLabTopbar.tsx      # Species selector, camera presets, export trigger
│   ├── FlightLabControlPanel.tsx# Main tabbed controller (Dynamics, Pose, Telemetry)
│   ├── AnimationControls.tsx    # Clip cards, playback scrubber, speed slider
│   ├── ReadoutLogPanel.tsx      # Live telemetry readout, log stream & copy code
│   └── PreyField.tsx            # Interactive hunting prey simulation container
├── systems/
│   ├── PropManager.ts           # Prey lifecycle, carcass spawning
│   └── CombatSimulator.ts       # Fire breath collision cone & hit registration
└── props/
    ├── PropBase.ts              # Abstract physical prop
    ├── PreyDoe.ts               # Ground prey entity with herd AI & panic sprint
    └── PreyBird.ts              # Flying prey entity with 3D boid flocking
```

### 4.2 Integrated Telemetry Readout & Export Panel (`ReadoutLogPanel.tsx`)

The Flight Lab UI provides direct parity with headless Blender telemetry:

- **Live Numeric Display**:
  - `airspeed`: Live value (0 to 60 u/s).
  - `bodyAxisDeg`: Measured head-to-tail pitch angle (asserted against review envelope $\pm 55^\circ$).
  - `wingSpan`: Real-time wingtip Euclidean distance.
  - `footDropL / footDropR`: Pelvis-to-foot clearance.
  - `seamRotationRad`: Live loop closure discrepancy.
- **One-Click Code & Contract Export**:
  - `Copy Pose Code`: Exports clean TypeScript pose constants formatted for `src/render/flightPose.ts`.
  - `Copy Telemetry JSON`: Generates a structured snapshot ready for automated test assertions.
  - `Copy Debug Logs`: Copies the event stream (`[SPEED_CHANGE]`, `[CONTRACT_VIOLATION]`, `[MIXER_TRANSITION]`).

### 4.3 Combat & Prey Hunting Sandbox

Testing wyvern actions requires reactive physical targets:
- **Prey Entities**:
  - `PreyDoe`: Ground-bound deer with sensory detection radius (35m), panic sprint away from wyvern shadow, and thermal death transition.
  - `PreyBird`: Airborne flocking targets with boid dynamics (separation, alignment, cohesion).
- **Combat Simulation (`CombatSimulator.ts`)**:
  - Fire breath emits a true volumetric collision cone from `SKT_MouthBreath`.
  - Collision triggers roasting shaders and spawns edible `FoodCarcass` props.
  - Talon grab trajectory aligns `L_Foot` and `R_Foot` during `attackAir2` for snatching prey.

---

## 5. Pillar 3: Overcoming LLM Limitations (The Telemetry-First Protocol)

### 5.1 Why LLM Vision Fails in 3D Engineering
- **Perspective Distortion**: 2D images flatten 3D depth; an agent cannot distinguish whether a wing spar is in front of or inside the ribcage.
- **Surface Texture Masking**: Glossy, dark obsidian scales conceal surface normals, vertex weighting collapse, and subtle clipping.
- **Temporal Blindness**: Single stills or contact sheets miss single-frame hitches (e.g. $t=0$ clamping) and velocity spikes.
- **Spatial Hallucination**: LLMs rationalize plausible-sounding descriptions while raw matrices are corrupted.

### 5.2 The 5-Step Agent Development Loop

Every agent working on animations or rigs in this repository must follow this protocol:

```text
Step 1: HEADLESS PROBE
  Run: blender -b file.blend -P scripts/blender/cli.py -- probe --bones L_WingShoulder L_WingWrist
  Read: JSON centroid deltas and displacement metrics.

Step 2: MATHEMATICAL CALCULATION
  Compute exact numeric offsets in pure Python/TypeScript using scripts/blender/core/coords.py.
  Never guess roll signs or Euler orders.

Step 3: NON-DESTRUCTIVE APPLICATION
  Apply edits to a candidate action (WIP__{clip}__{intent}__v{##}).
  Never overwrite canonical master actions directly.

Step 4: NUMERIC GATE ASSERTION
  Run: pnpm test src/render/assets/wyvernGothicValidation.test.ts
  Assert mirror error <= 0.0010m, seam <= 0.0010 rad, cadence spread <= 8%.

Step 5: METRIC ORTHOGRAPHIC INSPECTION (Optional Sanity Check)
  If visual inspection is requested, render strictly via locked orthographic cameras
  (Front XZ, Side YZ, Top XY) with a 0.5m metric grid overlay and unshaded normal matcap.
```

---

## 6. Staged Implementation & Delivery Ledger

| Stage | Focus Area | Deliverables & Scope | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **Stage 1** | **Asset & CI Hygiene** | Move loose `.blend` files to `assets/blender/source/`. Add backup ignores to `.gitignore`. Enable `wyvernGothicValidation.test.ts`. | ✅ **DONE** — `pnpm test` passes with zero skips. `public/models/` contains only `.glb`. |
| **Stage 2** | **Blender Tooling Consolidation** | Build `scripts/blender/` package (`actions_compat.py`, `coords.py`, `probe.py`, `cli.py`). Tested on Blender 5.1.1 headless. | ✅ **DONE** — `cli.py audit-glb` and `cli.py probe` run cleanly with zero errors. |
| **Stage 3** | **Flight Lab Gothic V2 Binding** | Audit `labBones.ts`, `labPresets.ts`, `labComposer.ts`, and `constants.ts` for 100% parity with Gothic V2 92-joint hierarchy and aliases. | ✅ **DONE** — Zero missing marker warnings in Flight Lab telemetry. Digits and panels articulated in pose composer. Presets resolve to exact Gothic clips. Live GLB contract tests pass. |
| **Stage 4** | **Speed Dynamics & Secondary Physics** | Wire airspeed slider (0–60 u/s) to `gazeController.ts`, `spineWave.ts`, `tailController.ts`, `legPhysics.ts`, and membrane panel flutter in `FlightLabRigContainer.tsx`. | ✅ **DONE** — Real-time S-curve wave traveling head $\to$ tail with Spine1 leg planting stability (`[0.02, 0.22, 0.32]`). High-speed tuck aligns in slipstream. 16 membrane panels articulated. Signed leg tuck drops legs in hover and tucks in sprint. |
| **Stage 5** | **Readout Panel & One-Click Export** | Complete `ReadoutLogPanel.tsx` with live numeric readouts and copy-paste buttons for TypeScript pose and JSON snapshots. | ✅ **DONE** — Full live numeric telemetry grid (speed, pitch, bank, bodyAxis with $\pm 55^\circ$ review envelope badge, wingSpan, footDrop L/R, tailExtent, seamRotationRad, markers, controllers). One-click copy for `FlightPose` & `HeadNeckPose` valid TS code, JSON snapshots, and debug event logs. |
| **Stage 6** | **Prey & Combat Sandbox** | Wire `PreyDoe` ground fleeing and `PreyBird` flocking in `PreyField.tsx`. Implement fire breath particle cone collision check. | ✅ **DONE** — `CombatSimulator` volumetric fire cone and talon swoop implemented. `PreyDoe` 35m sensory panic sprint and thermal death transition verified. `PreyBird` 3D boid flocking (separation, alignment, cohesion, predator evasion) and mid-air fall physics passing. `FoodCarcass` spawning and roasting color states verified. 15 automated tests passing in `combatSandbox.test.ts`. |
| **Stage 7** | **Final Quality & Performance Audit** | Run full verification suite across all scenes (Sanctuary, Battle, Biomes, Flight Lab). Assert 60 FPS budget. | ✅ **DONE** — Zero regressions on full gate (`pnpm typecheck && pnpm lint && pnpm test`: 104 suites passed / 971 tests). Offline audit (`cli.py audit-glb`), Three.js validation (`pnpm assets:validate-wyvern`), and combat balance simulation (`pnpm sim:battle`) certified clean. |

---

## 7. Verification & Handoff Commands

Run these gates before closing any stage in the ledger:

```bash
# 1. Full TypeScript, ESLint, and Vitest test suite
pnpm typecheck && pnpm lint && pnpm test

# 2. GLTF Rig Contract Validation (Python offline)
python3 scripts/blender/cli.py audit-glb public/models/wyvern-gothic.glb

# 3. Headless Three.js Runtime Evaluation
pnpm assets:validate-wyvern

# 4. Live Kinematic Axis Probe (Blender headless)
/Applications/Blender.app/Contents/MacOS/Blender --background assets/blender/source/wyvern-rig-v1wing.blend \
  --python scripts/blender/cli.py -- probe --bones L_WingShoulder L_WingWrist

# 5. Combat Balance Simulation
pnpm sim:battle
```
