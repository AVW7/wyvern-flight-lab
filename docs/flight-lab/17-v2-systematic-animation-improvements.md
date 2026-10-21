# V2 Systematic Animation Improvements & Ledger

> Current qualification: see the [4 October source audit](18-v1-harvest-gap-audit.md). The endpoint metric below mixes radians and rig-unit translation; one-shot endpoint differences are not loop failures. Numeric checks do not establish harvesting fidelity or visual acceptance.

2026-10-02. This document records the systematic audit, diagnosis, repair, and qualification across all 18 canonical animation clips of the V2 Wyvern.

## 1. Governance & Quality Framework

All animation authoring, harvesting, and packaging follows the 4 Laws of the House:
1. **Régua antes do conserto (Measurement before fix)**: Every clip is measured across 6 numeric dimensions before authoring.
2. **Teto sem procedência é opinião (Thresholds with provenance)**:
   - Seam jump: $\Delta \theta \le 0.05$ rad
   - Mirroring: $\le 0.25$ m (except clips asymmetric by design: `walk`, `bankLeft`, `bankRight`, `attack2`, `attackAir2`)
   - Root travel: $\le 10^{-4}$ rig units
   - Start keyframe: $t_0 = 0.000$ s
   - Flight cadence: $|\Delta f| / f \le 0.08$ across the flight phase group
   - Ground clearance: wingtips $\ge 0.0$ m above foot plane
3. **Toda invariante vem com a mutação que a faz ficar vermelha**: All quality gates must bite under corrupted tracks or duplicated skins.
4. **Gere a figura e olhe (Evidence over rationalization)**: Visual verification in Flight Lab across 16:9 and 3:2 viewports using matched orthographic cameras.

---

## 2. Tooling Upgrades

- **Meshopt-Enabled Validator** (`scripts/validate-wyvern-clips.mjs`):
  Integrated `MeshoptDecoder` into `GLTFLoader` so the validator directly evaluates compressed runtime assets and candidate packages.
- **Audit CLI** (`tools/audit-all-clips.mjs`):
  Single-command script producing the formatted audit table.
- **Single-Skin Packager & Splicer** (`tools/blender/splice_improved_clips.mjs` and `package_harvested_clips.mjs`):
  Guarantees `skins.length === 1` with 92 joints, pointing `WyvernBody_Rebuild` and `WyvernMembrane_ExportSafe` to `skin: 0`.

---

## 3. Numeric Audit & Qualification Ledger

Evaluating candidate `/tmp/wyvern-v2-systematic-candidate.glb`:

```
clip        mirror(m)  seam(rad)  start(s)  dur(s)  travel  beat(Hz)  loops
attack         0.0010     0.0009   0.00000   1.500  0.0000     0.667  no
attack2       15.4414     0.3711   0.00000   3.333  0.0000     0.300  no
attackAir2    12.1302     0.0013   0.00000   3.333  0.0000     0.600  no
bankLeft       8.2612     0.0012   0.00000   6.000  0.0000     0.500  yes
bankRight      8.2595     0.0009   0.00000   6.000  0.0000     0.500  yes
breath         0.0010     0.0007   0.00000   2.000  0.0000     0.500  no
cruise         0.0010     0.0007   0.00000   6.000  0.0000     0.500  yes
death          0.0011   519.9999   0.00000   4.000  0.0000     0.250  no
dive           0.0003     0.0008   0.00000   6.000  0.0000     0.500  yes
glide          0.0010     0.0007   0.00000   6.000  0.0000     0.333  yes
hover          0.0010     0.0008   0.00000   6.000  0.0000     0.667  yes
idle           0.0056     0.0006   0.00000   6.000  0.0000     0.333  yes
land           0.0010    35.0001   0.00000   3.000  0.0000     0.333  no
rest           0.0005     0.0007   0.00000   6.000  0.0000     0.167  yes
scout          0.0010     0.0009   0.00000   6.000  0.0000     0.333  yes
speed          0.0006     0.0008   0.00000   5.000  0.0000     0.200  yes
takeoff        0.0011     1.7308   0.00000   3.000  0.0000     2.000  no
walk          10.2968     0.0008   0.00000   2.458  0.0000     0.407  yes

wyvern.glb clean: wings mirrored, loops closed, every clip starts at t=0,
no clip translates the root, and the flight phase group beats as one
```

### Key Defect Repairs
- `hover`: wingtip asymmetry reduced from 0.572 m to **0.0010 m**.
- `scout`: wingtip asymmetry reduced from 2.415 m to **0.0010 m**.
- `idle`: membrane panel battens activated ($>0.005$ rad breathing motion).
- `takeoff`: membrane panel battens activated ($>0.005$ rad unfurling motion).
- Single shared skin invariant strictly maintained: `skins.length === 1`, 92 joints, `skin: 0` for both meshes.

---

## 4. Feet & Toes Articulation Upgrade

### Problem Diagnosis
1. `LEFT_LEG_CHAIN` and `RIGHT_LEG_CHAIN` in `rigBones.ts` formerly ended at `L_Foot` and `R_Foot`, leaving `L_Toes` and `R_Toes` unmanaged.
2. In `public/models/wyvern-v2-rig.glb`, `L_Toes` and `R_Toes` possess only 2 static rest keyframes in flight loops (`cruise`, `dive`, `speed`, `hover`, `glide`, `bankLeft`, `bankRight`), resulting in stiff, unarticulated claws protruding during flight.

### Solution & Kinematics Architecture
1. **Rig Bone Registry**: Added `LEFT_TOES_BONE` and `RIGHT_TOES_BONE` to `LEFT_LEG_CHAIN` and `RIGHT_LEG_CHAIN`.
2. **Airspeed-Driven Aerodynamic Talon Tuck**:
   - `LEG_TUCK_WEIGHTS = [0.45, -0.65, 0.25, -0.35]`.
   - The toes receive negative pitch ($-0.35 \times \text{tuck}$), curling backward into a streamlined talon tuck during cruise.
   - In dive mode ($>22$ m/s), toes curl an extra $-0.25$ rad flush to the body.
3. **Pre-Landing Touchdown Splay**:
   - Near ground clearance during descent (`landingPrep`), toes flare $+0.35 \times \text{landingPrep}$ rad forward to cushion touchdown impact.
4. **Ground Contact Gating**:
   - When grounded (`groundClearance < 0.5` or `horizontalSpeed < 2` near ground), procedural tuck and swing decay to zero, preserving exact authored ground contacts without mesh clipping or foot drift.
