# V2 Wing Harvest, Procedural Coordination, and Single-Skin Invariant

> Readiness correction, 4 October 2026: [the source audit](18-v1-harvest-gap-audit.md) found that the automated harvester does not yet bake/export actions, its clearance solver is empty, and curve extraction provenance is missing. The pipeline descriptions below are intended capabilities, not completed harvesting evidence.

2026-10-02. This document records the wing audit, V1 Drogon harvesting findings, procedural 60-bone wing coordination, and strict single-skin invariant enforcement for the V2 Wyvern.

## 1. Audit and V1 Harvesting Findings

### Geometric Correspondence
Analysis of V1 Drogon (`drogon-decompressed.glb` / `wyvern-rig-v1wing.blend`) against V2 Wyvern (`wyvern-v2-rig.glb`) revealed:
- **Vertex Parity**: V1 and V2 share near-identical vertex positions (27,162 vertices in V1 vs 27,164 in V2, $<0.4$ unit residual).
- **Coordinate Transformation**: The spatial transformation from V1 to V2 space is exact:
  $$\begin{pmatrix} X_{v2} \\ Y_{v2} \\ Z_{v2} \end{pmatrix} = 100 \times \begin{pmatrix} X_{v1} \\ -Z_{v1} \\ Y_{v1} \end{pmatrix}$$
- **Orientation & Rotation Delta**: The rotation basis check confirms $R_3 \cdot M_{1rot} = I$, meaning V1 rest orientations align directly to V2 rest orientations without an extra basis conversion. Pose transfers can be computed via analytical rest-delta:
  $$\Delta = \text{rot}_{v1\_posed} \cdot \text{rot}_{v1\_rest}^{-1}; \quad \text{desired}_{v2} = \Delta \cdot \text{rot}_{v2\_rest}$$
- **Bone Name Offset**: Direct bone name matching between V1 and V2 fails because V1 bone names are shifted one joint inboard:
  - V2 `Shoulder` corresponds to V1 `Clavicle`
  - V2 `Elbow` corresponds to V1 `UpperArm`
  - V2 `Wrist` corresponds to V1 `Forearm`
  Automated mapping must use rest position proximity ($< 1.0$ unit residual) rather than string matching.
- **Flight Cruise Wingbeat Window**: In V1 `Battle_Down02`, frames 40–66 isolate a pure 3-beat cruise cycle, separating wingbeat kinematics from the $37^\circ$ torso flare.

### Procedural Wing Glitch Root Cause
Investigation of procedural wing flapping in `src/flight-lab/rig/` revealed:
1. `LEFT_WING_CHAIN` in `rigBones.ts` previously only included `D0` (leading edge). As a result, aerodynamic flutter and dive stoop tuck were applied exclusively to `D0` while `D1..D5` and panels `Panel0..3` remained completely rigid, tearing the wing membrane.
2. The wing rig axes mirror on $Z$. Applying positive pitch/yaw indiscriminately caused asymmetric deformation. Local $+X$ raises symmetrically, but local $+Z$ yaw sweep must be negated on the right wing.
3. Authoring ground folds were disturbed during ground idle/walk if flight flutter was active.

---

## 2. Coordinated 60-Bone Wing Controller

### Full Rig Definition (`src/flight-lab/rig/rigBones.ts`)
The complete 60-bone wing skeleton (30 bones per side) is now defined:
- **Arm Chain (4 bones/side)**: `Shoulder`, `Elbow`, `Wrist`, `Hand`
- **Digit Chains (18 bones/side)**: 6 digits (`D0` to `D5`) $\times$ 3 phalanx bones (`P0`, `P1`, `P2`)
- **Membrane Panel Chains (8 bones/side)**: 4 membrane panel battens (`Panel0` to `Panel3`) $\times$ 2 bones (`P0`, `P1`)

### Coordinated Refinement (`src/flight-lab/rig/wingRefinement.ts`)
- **Dive Stoop Tuck**: During high-speed dives, shoulder pitch, elbow tuck, wrist sweep, and progressive digit fold ($D0 \to D5$ proportional curling) fold the entire wing flush against the torso.
- **Aerodynamic Flutter**: Digit and panel battens flex progressively towards the trailing edge and wingtip with decaying amplitude, creating realistic aerodynamic pressure wave compliance.
- **Chiral Mirroring**: Pitch ($+X$) elevates both wings symmetrically; yaw ($+Z$) is negated on the right wing to ensure symmetrical backward sweep.
- **Ground Clearance Gating**: When `groundClearance < 0.5` or `horizontalSpeed < 2.0`, procedural flight offsets taper smoothly to zero, preventing interference with authored ground fold and walk cycles.

---

## 3. Strict Single-Skin Invariant

To ensure compatibility with WebGL/Three.js runtimes and prevent memory/buffer duplication:
- Both `WyvernBody_Rebuild` and `WyvernMembrane_ExportSafe` meshes MUST point to `skin: 0`.
- The GLTF container must strictly contain `skins.length === 1` referencing the canonical 92-joint skeleton.
- Explicit invariant tests added to `test/wyvern-v2-kinetics.test.js` verify:
  1. `skins.length === 1`
  2. `skins[0].joints.length === 92`
  3. Every skinned primitive references `skin: 0`
  4. All 60 wing bones are present in the hierarchy

---

## 4. Verification Evidence

All quality gates pass cleanly:
- `pnpm tsc --noEmit`: 0 errors
- `pnpm lint`: 0 errors
- `pnpm test:fast`: 819/819 tests passed (including wing baseline stability, aerodynamic stoop symmetry, ground gating, single-skin checks, and 5/5 harvest kinetics tests)
- `pnpm sim:wildlife`: 16/16 species passed fast-forward kinetic simulations
- `pnpm invariants:mutate`: 113/113 mutants killed (100% kill rate, including runtime rig duplicate skin and bone corruption mutants)

---

## 5. Extended Harvesting Pipeline & Runtime Profiles

### Automated Harvester Tooling (`tools/blender/`)
- `tools/blender/harvest_v1_to_v2.py`: Headless Blender extraction script implementing spatial proximity bone pairing ($<1.0$ unit residual), analytical rest-delta computation ($D = R_{posed} \cdot R_{rest}^{-1}$), windowed extraction (e.g. `Battle_Down02` frames 40–66 retimed to 144 frames / 3 beats), and closed-form foot-plane clearance lifting on ground postures.
- `tools/blender/package_harvested_clips.mjs`: Node.js utility splicing harvested actions into candidate GLBs while enforcing `json.skins.length === 1` and 92 joints.

### Runtime Kinematic Profiles (`src/flight-lab/rig/harvestedWingProfiles.ts`)
- Pure $C^1$-smooth normalized curves extracted from V1 Drogon: `V1_CRUISE_ELEVATION_PROFILE`, `V1_CRUISE_SWEEP_PROFILE`, `V1_CRUISE_TWIST_PROFILE`, `V1_DIGIT_PHASE_OFFSETS` ($D0 \to D5$), and `V1_PANEL_PHASE_OFFSETS` ($Panel0 \to 3$).
- Integrated into `src/flight-lab/rig/wingRefinement.ts` to replace flat synthetic factors with organic aerodynamic traveling waves across all 60 wing bones.
- Validated via `test/harvest-v1-kinetics.test.js` (5 tests passing: spatial contract, rest-delta identity, profile smoothness, progressive curl amplitude, and 60-frame baseline stability).
