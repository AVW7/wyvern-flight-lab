# 43 — Crimson Desert Wyvern Benchmark & Mod-Harvesting Study for V2 Rig

**Date:** 2026-10-22
**Target Asset:** `public/models/wyvern-v2-rig.glb` (`models/source/wyvern-v2-master.blend`, 92 bones / 90 weighted, 18 clips) + `src/flight-lab/rig/`
**Companion Docs:** [39-v2-development-roadmap.md](39-v2-development-roadmap.md) · [41-v2-and-blender-rig-audit-task-list.md](41-v2-and-blender-rig-audit-task-list.md) · [42-blender-rig-audit-and-pipeline-reference.md](42-blender-rig-audit-and-pipeline-reference.md)

## 1. Executive Summary

To make our V2 Wyvern rig (`wyvern-v2-rig.glb`) play at *Crimson Desert* quality, we evaluated both **how *Crimson Desert*'s Wyvern operates in gameplay** (across Patch 1.08.00 and Patch 1.10.00) and **what the *Crimson Desert* modding toolchain can expose as technical reference**.

1. **Mod-Harvesting Reality Check**:
   - *Crimson Desert* runs on Pearl Abyss's proprietary **BlackSpace Engine**, which stores assets inside encrypted/compressed `.paz` and `.pamt` archives containing `.pac` (character/rigged mesh), `.pam` / `.pamlod` (static/LOD mesh), `.pab` (skeleton/bone hierarchy), and `.paa` (skeletal animation) binaries.
   - Community tools on Nexus Mods—specifically **CrimsonForge — Crimson Desert Blender Pipeline** (by `hz33m`, Blender 4.2–5.1 add-on), **Crimson Desert Model Browser** (`Altair200333`), **Crimson Desert Forge** (modding studio), and **PAM to FBX-OBJ** (`Lathiel`)—can load `.pac` + `.pab` skeletons and bake `.paa` animations onto an imported armature inside Blender when pointed at a local Windows Steam install of *Crimson Desert*.
   - **Why Direct Asset Ripping Is Out, and Parametric Curve/Kinematics Harvesting Is In**: Even aside from copyright/ToS restrictions on redistributing proprietary `.pac`/`.paa` game assets (and Nexus mod permissions prohibiting cross-game asset conversion), *Crimson Desert*'s Wyvern skeleton uses proprietary `.pab` bone hashes rather than our 92-bone V2 glTF contract (`Root`, `Body`, `Spine1..3`, `Neck1..2`, `Head`, `Jaw`, `Tail1..10`, `L/R_WingD0..5P0..2`, `L/R_WingPanel0..3_0..1`). However, our existing donor-harvesting architecture (`tools/blender/harvest_v1_to_v2.py` + `src/flight-lab/rig/harvestedWingProfiles.ts`) is **purpose-built** to extract normalized, non-copyrighted biomechanical envelopes (24-point cyclic wing elevation/sweep/twist tables, phase lag profiles, acceleration/deceleration damping constants, and state-machine transition timings) and apply them to V2's 92-bone rig.

2. **What "Playing on *Crimson Desert* Level" Means for V2**:
   - In *Crimson Desert* (Patch 1.10.00), the adult Wyvern is not a static animation-clip switcher; it is a **continuous ground-to-air locomotion and combat mount** with chained hop-to-flight launches, grapple-to-saddle mid-air mounting, double-tap thrust bursts (`speed`), double-tap braking into `hover`, dive-stoop folding, and free-aimed ranged projectile/breath attacks while airborne.
   - Our V2 rig already has a **stronger wing-membrane bone topology** than standard game wyverns (90 deforming bones including 5 three-phalanx digits `D0..D4`, alula `D5`, and 16 inter-digital `WingPanel0..3_0..1` battens), plus procedural spine waves, VOR gaze stabilization, and a `Spine3`-calibrated rider mount (`src/flight-lab/rider/`), and all 9 mapped clips now pass the V1 dynamics gate (`f5d768a2…`).
   - What holds V2 back from *Crimson Desert* gameplay feel are **five concrete locomotion, physics, and combat-layering gaps**—specified below as **Workstream F (`Tasks F1–F5`)**.

## 2. *Crimson Desert* Modding Ecosystem & Format Architecture

### 2.1 BlackSpace Engine Asset Formats

| Extension | Content | Relevance to V2 Wyvern Study |
| :--- | :--- | :--- |
| `.paz` / `.pamt` | Encrypted & LZ4-compressed virtual file system (VFS) containers (~1.4M indexed files) | Root archives holding creature, mount, and boss assets |
| `.pac` / `.pam` / `.pamlod` | Skinned character/mount meshes (`.pac`) and LOD geometry (`.pam`/`.pamlod`) | Inspecting polygon density distribution across shoulder girdle, wing web, and saddle contact zone |
| `.pab` | Binary skeleton definition (bone hierarchy, bind matrices, and PAB bone-ID hashes) | Studying joint placement for mandible hinge, scapular wing root, digit count, and rider attachment socket |
| `.paa` | Skeletal animation tracks mapped by `.pab` bone hash | Measuring wingbeat frequency (Hz), downstroke-to-upstroke duty ratio, takeoff hop timing, and landing compression |
| `.app_xml` | Character assembly manifest linking body, saddle, and accessory `.pac` parts to one `.pab` armature | Reference for modular `Wyvern Saddle` (+20 Defense) and `Small Wyvern Aviator Hat` attachment architecture |

### 2.2 Available Community Modding Tools (2026)

| Tool / Mod | Author & Source | Capabilities & Limitations |
| :--- | :--- | :--- |
| **CrimsonForge (Blender Add-on)** | `hz33m` ([Nexus Mods #2532](https://www.nexusmods.com/crimsondesert/mods/2532)) | Native Blender 4.2–5.1 add-on that searches the 1.4M-file `.paz` VFS, imports `.pac` meshes + `.pab` skeletons + `.dds` textures, and bakes `.paa` animations onto the armature via PAB-hash mapping. Requires a local Steam installation of *Crimson Desert*. |
| **Crimson Desert Model Browser** | `MikeStacenko` / `Altair200333` ([Nexus Mods #669](https://www.nexusmods.com/crimsondesert/mods/669)) | Standalone Python viewer that previews `.pac`/`.pam` models from `.paz` archives and exports max-LOD `.obj + .mtl + .dds` (geometry only, no skeleton or `.paa` animations). |
| **PAM to FBX-OBJ** | `PhorgeForge` / `Lathiel` ([Nexus Mods #79](https://www.nexusmods.com/crimsondesert/mods/79)) | Converts extracted `.pam`/`.pamlod` meshes to FBX/OBJ; geometry-only (no armatures or animations). |
| **Crimson Desert Forge & CDMW** | [Nexus Mods #446](https://www.nexusmods.com/crimsondesert/mods/446) / [#826](https://www.nexusmods.com/crimsondesert/mods/826) | Archive unpackers, string/audio editors, and mesh/texture patchers for `.paz` containers. |
| **Wyvern Mods on Nexus** | e.g., *Black Wyvern Dragon* ([Nexus Mods #3026](https://www.nexusmods.com/crimsondesert/mods/3026)), *Baby and Adult Wyvern Vanilla Skins* | Almost exclusively `.dds` texture recolors or vanilla model swaps between the Baby Wyvern pet and Adult Wyvern mount; they do not ship standalone `.glb`/`.fbx` rigs outside the game archives. |

### 2.3 Clean-Room Harvesting Protocol (`harvest_v1_to_v2.py` Pattern)

Rather than importing proprietary mesh or animation binaries into the repository:
1. **Clean-Room Biomechanical Telemetry Extraction**: If a developer with a local *Crimson Desert* install loads a Wyvern `.pab + .paa` in Blender via `CrimsonForge`, run a read-only measurement script (modeled on `tools/diagnose-clip-dynamics.mjs`) that outputs **only dimensionless biomechanical scalars and 24-point normalized phase envelopes** (stroke frequency in Hz, downstroke/upstroke asymmetry ratio, shoulder/elbow/wrist phase lag, pitch-to-fold coupling gain, and hop-to-flight transition timing).
2. **Direct Parameter Injection into `harvestedWingProfiles.ts` & `tools/blender/`**: Feed those normalized curves into `src/flight-lab/rig/harvestedWingProfiles.ts` and `tools/blender/harvest_v1_to_v2.py` to drive V2's native 92-bone rig and 18 clips.

## 3. Gap Analysis: V2 Rig vs. *Crimson Desert* Wyvern Gameplay

| Gameplay Pillar | *Crimson Desert* Wyvern (Patch 1.10.00 Benchmark) | V2 Wyvern Rig (`wyvern-v2-rig.glb` + `src/flight-lab/`) | Gap to Close (`Workstream F`) |
| :--- | :--- | :--- | :--- |
| **1. Ground-to-Flight Chained Launch** | Runs on ground (`walk`), chains small momentum hops, and transitions seamlessly into full `takeoff` → `cruise` without foot pops | Clips are isolated (`idle`, `walk`, `takeoff`, `cruise`, `land`); boundary pose jumps exist (`takeoff(end) → cruise(start)`, `walk ↔ takeoff`) | Build chained Ground-Run → Hop → Takeoff → Cruise & Approach → Land → Idle crossfade state machine with boundary pose matching (`Task F1`) |
| **2. Thrust Burst, Hover Brake & Dive Stoop Momentum** | Double-tap `A`/`X` triggers high-impulse `speed` thrust; double-tap `B`/`O` flares wings into `hover` brake; diving tucks wings (`dive`) and pulling up converts dive speed into glide momentum (`glide`) | `wingRefinement.ts` has basic `DIVE_FOLD_THRESHOLD` (`0.25`) and sinusoidal flutter, but lacks dive-to-glide energy retention, flare-braking wing pitch, and effort-scaled climb stroke | Upgrade `kinematics/flightPose.ts` and `wingRefinement.ts` with momentum conservation (dive → pull-up boost), brake-flare wing pitch, and climb effort (`Task F2`) |
| **3. Mounted Aerial Aiming & Breath/Projectile Combat** | Player free-aims with right stick (`L2/LT` + `R2/RT`) while flying; Wyvern turns head/neck toward reticle and fires ranged fire/projectile blasts without breaking wingbeat rhythm | `breath`, `attack`, `attack2`, and `attackAir2` are full-body clips that replace `cruise`; no additive upper-body/neck/jaw breath-fire layer over active flight | Add additive `Head`/`Neck1..2`/`Jaw` aerial breath & bite layering over `cruise`/`hover`/`glide` steered by `gazeController.ts` (`Task F3`) |
| **4. Rider Saddle, Grapple Mount & Mid-Air Summon** | Optional **Wyvern Saddle** (+20 Defense), ground grapple-hook pull-up mount animation, and mid-air summon/mount catch | `src/flight-lab/rider/riderRuntime.ts` attaches `wyvern-rider.glb` to `Spine3` and crossfades rider clips, but has no saddle mesh socket or grapple-mount impulse response | Add Spine3 recoil/weight-shift spring on rider mount/grapple catch and optional saddle attachment socket metadata (`Task F4`) |
| **5. Ground Turn-in-Place & Heavy Landing Impact** | Heavy quadruped/biped ground presence with turning steps and high-impact landing compression | V2 lacks `GroundTurnLeft`/`GroundTurnRight` (present on V1) and `land` has static foot contact without procedural shock absorption | Synthesize/author ground turn-in-place and procedural landing-impact suspension compression in `legPhysics.ts` + `spineWave.ts` (`Task F5`) |

## 4. Workstream F — Coding Agent Task List for *Crimson Desert* Gameplay Parity

### Task F1 (P1) — Seamless Locomotion State-Machine & Chained Hop-to-Flight Transitions
- **Files**: `tools/blender/match_locomotion_transitions.mjs` (new), `src/flight-lab/kinematics/flightPose.ts`, `src/flight-lab/runtime.ts`
- **Action**:
  1. Audit and smooth boundary pose deltas (`< 5.0°` max bone jump) across the *Crimson Desert* locomotion chain: `idle(0) ↔ walk(0)`, `walk(end) → takeoff(0)`, `takeoff(end) → cruise(0)`, `cruise(0) ↔ glide(0) ↔ hover(0)`, and `cruise(0) → land(0) → idle(0)`.
  2. Add a playable **Chained Launch / Landing Sequencer** in Flight Lab (`Ground Run → Hop → Takeoff → Cruise → Hover Brake → Land → Idle`) so users and AI agents can test full *Crimson Desert*-style transitions instead of isolated single-clip loops.

### Task F2 (P1) — Dive-Stoop Momentum Boost, Hover Flare-Brake & Effort-Scaled Climb Physics
- **Files**: `src/flight-lab/kinematics/flightPose.ts`, `src/flight-lab/rig/wingRefinement.ts`, `src/flight-lab/rig/tailController.ts`
- **Action**:
  1. **Dive-to-Glide Energy Conversion**: Track vertical potential energy converted during `dive` (`pitch > 0.25`); when pulling up into `glide` or `cruise`, apply a decaying forward speed boost (`speedBoost`) and wing-loading billow on `WingPanel0..3_0..1`.
  2. **Hover Flare-Brake**: On rapid deceleration (`acceleration < -4 m/s²` or double-tap brake into `hover`), pitch `L/R_WingShoulder` and `L/R_WingHand` forward (`+18°..+28°`) and fan `Tail1..10` downward as an airbrake before settling into the `hover` loop.
  3. **Climb Effort Scaling**: Scale wingbeat playback speed (`1.0× → 1.35×`) and `Spine1..3` heave amplitude when `verticalSpeed > 2 m/s`.

### Task F3 (P1) — Additive Aerial Breath & Bite Combat Layer Over Active Flight
- **Files**: `src/flight-lab/rig/flightMouth.ts`, `src/flight-lab/rig/gazeController.ts`, `src/flight-lab/rig/wyvernFlightRig.ts`, `src/flight-lab/runtime.ts`
- **Action**:
  1. Extract the `Neck1`, `Neck2`, `Head`, and `Jaw` delta curves from `breath` and `attackAir2` relative to bind pose.
  2. Allow triggering **Aerial Breath (`breath`)** and **Aerial Bite (`attackAir2` upper-body)** as an **additive procedural/masked layer** on `Neck1..2`, `Head`, and `Jaw` while the wings, body, and tail continue playing `cruise`, `glide`, `hover`, or `bankLeft`/`bankRight`, aimed toward the active `gazeTarget` reticle—matching *Crimson Desert*'s `L2 + R2` saddle fire-breath combat.

### Task F4 (P2) — Rider Grapple-Mount Impulse, Saddle Socket & Weight Shift Coupling
- **Files**: `src/flight-lab/rider/riderMount.ts`, `src/flight-lab/rider/riderRuntime.ts`, `src/flight-lab/rig/spineWave.ts`
- **Action**:
  1. Add a damped `Spine2..3` + `Body` vertical/roll spring impulse when the rider mounts (simulating *Crimson Desert*'s grapple-to-saddle pull-up and mid-air mount catch).
  2. Couple rider lean (`FlightLabRider`) into `bank` and `turnRate` so the rider and `Spine3` bank cohesively during high-G turns and dive pull-ups.

### Task F5 (P2) — Ground Turn-in-Place & Touchdown Suspension Compression
- **Files**: `src/flight-lab/rig/legPhysics.ts`, `src/flight-lab/rig/spineWave.ts`
- **Action**:
  1. Add procedural `L/R_Hip..Foot` + `L/R_WingWrist` knuckle weight-shift stepping when `turnRate != 0` in grounded `idle` mode (matching V1's `GroundTurnLeft`/`GroundTurnRight` capability).
  2. Add a damped vertical pelvis/leg compression impulse on `flightMode → land` touchdown proportional to vertical descent rate.
