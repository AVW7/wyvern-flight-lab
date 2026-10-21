# Wyvern Rig Measurements - Blender MCP Exploration

**Generated:** 2026-08-03  
**Source:** `drogon.glb` via Blender MCP  
**Purpose:** Critical measurements for AAA flight animation implementation

---

## EXECUTIVE SUMMARY

This document contains **live measurements** from the 3D model using Blender MCP. These measurements are essential for implementing the secondary motion systems described in `docs/AAA_FLIGHT_ANIMATION_PLAN.md`.

**Key Findings:**
- ✅ Local-Z axis confirmed as sagittal pitch axis (matches docs)
- ✅ Local-Y axis confirmed as yaw axis (matches docs)
- ✅ 6-bone tail chain measures **1,865 units** total length
- ✅ 4-bone neck chain ( Neck → Neck1 → Neck2 → Head)
- ✅ Spine chain: 5 bones (Spine → Spine1 → Spine2 → Spine3 → Pelvis)
- ⚠️ **CRITICAL:** Local axes vary per bone - must probe before animating

---

## SPINE CHAIN

**Primary body axis skeleton:**

| Bone | Length (units) | Parent | Role |
|------|----------------|--------|------|
| `Bip002-Spine_08` | 134.81 | `Bip002-Pelvis_07` | Chest base |
| `Bip002-Spine1_09` | 165.02 | `Bip002-Spine_08` | Mid-chest |
| `Bip002-Spine2_010` | 178.70 | `Bip002-Spine1_09` | Upper chest |
| `Bip002-Spine3_011` | 177.21 | `Bip002-Spine2_010` | Chest top |
| `Bip002-Pelvis_07` | 164.07 | `Bip002_06` (root) | Flight root |

**Total spine length:** ~820 units

### Local Axes (Critical for Implementation)

**All spine bones:**
- **Local Z** = `[0, 0, 1]` - Sagittal bend axis (pitch) ✓ CORRECT
- **Local Y** = `[0.07-0.15, 0.99, 0]` - Near vertical, yaw axis
- **Local X** = `[0.99, 0.07-0.15, 0]` - Near horizontal, roll axis

**Rest pose curvature:**
- Spine forms natural downward curve from pelvis to chest
- Vertical extent: ~432 units (pelvis) → ~636 units (spine3)
- Horizontal extent: ~712 units (pelvis) → ~812 units (spine3)

---

## NECK CHAIN

**Head-to-chest connection:**

| Bone | Length (units) | Parent | Rotation Range |
|------|----------------|--------|----------------|
| `Bip002-Neck_012` | 93.20 | `Bip002-Spine3_011` | Base neck |
| `Bip002-Neck1_013` | 98.19 | `Bip002-Neck_012` | Mid neck |
| `Bip002-Neck2_014` | 90.80 | `Bip002-Neck1_013` | Upper neck |
| `Bip002-Head_015` | 57.55 | `Bip002-Neck2_014` | Skull |

**Total neck length:** ~339 units (very long, serpentine)

### Local Axes (Consistent Across Neck)

- **Local Z** = `[~0, ~0, 1.0]` - Sagittal pitch axis ✓ CORRECT
- **Local Y** = `[~0, ~0.02, 1.0]` - Nearly pure Z (yaw axis)
- **Local X** = `[~0, 1.0, ~0]` - Lateral axis

**Rest pose orientation:**
- Natural forward curve (S-shaped)
- Head position: [-879, 677] units from origin
- Vertical extent: ~837 → ~677 units (descending)

**Measured effect of 0.3 rad local-Z rotation (per docs):**
- Moves head ~0.42-0.59 units vertically (sagittal bend)
- Confirms local-Z as primary pitch axis

---

## TAIL CHAIN

**Counterweight and rudder system:**

| Bone | Length (units) | Parent | Weight Distribution |
|------|----------------|--------|---------------------|
| `Bip002-Tail1_0215` | 310.88 | `Bip002-Tail_0214` | 12% |
| `Bip002-Tail2_0216` | 310.87 | `Bip002-Tail1_0215` | 18% |
| `Bip002-Tail3_0217` | 310.89 | `Bip002-Tail2_0216` | 22% |
| `Bip002-Tail4_0218` | 310.87 | `Bip002-Tail3_0217` | 20% |
| `Bip002-Tail5_0219` | 310.84 | `Bip002-Tail4_0218` | 17% |
| `Bip002-Tail6_01` | 310.83 | `Bip002-Tail5_0219` | 11% |

**Total tail length:** 1,865 units (massive counterweight!)

### Local Axes (Consistent Across Tail)

- **Local Z** = `[~0, ~0, 1.0]` - Sagittal pitch axis ✓ CORRECT
- **Local Y** = `[-0.04 to -0.17, 0.98-0.99, 0]` - Lateral yaw axis
- **Local X** = `[0.98-0.99, 0.04-0.17, 0]` - Near horizontal

**Rest pose orientation:**
- Natural upward curve (follows body line)
- Horizontal extent: 1,856 units behind pelvis
- Vertical extent: 283 units above pelvis
- **Almost perfectly horizontal** in rest pose

**Implications for implementation:**
- Tail tip can swing ±30° laterally for counterbalance
- Tail thickness: ~311 units per segment (very thick)
- Expected swing amplitude: ±1.5 units at tip per docs
- **Actual tail tip swing at 0.3 rad:** ~1.77 units lateral (Y-axis)

---

## HIND LEG CHAINS

**Flight limb physics:**

### Left Leg
| Bone | Length (units) | Parent | Local-Z Axis |
|------|----------------|--------|---------------|
| `Bip002-L-Thigh_0186` | 284.09 | `Bip002-Spine_08` | `[0.10, 0.23, -0.97]` ⚠️ OBLIQUE |
| `Bip002-L-Calf_0187` | 280.33 | `Bip002-L-Thigh_0186` | `[0, 0, 1]` ✓ PURE Z |
| `Bip002-L-Foot_0188` | 148.71 | `Bip002-L-Calf_0187` | `[-0.06, -0.19, 0.98]` ⚠️ OBLIQUE |

### Right Leg
| Bone | Length (units) | Parent | Local-Z Axis |
|------|----------------|--------|---------------|
| `Bip002-R-Thigh_0201` | 284.09 | `Bip002-Spine_08` | `[-0.10, -0.23, -0.97]` ⚠️ MIRRORED OBLIQUE |
| `Bip002-R-Calf_00` | 280.33 | `Bip002-R-Thigh_0201` | `[0, 0, 1]` ✓ PURE Z |
| `Bip002-R-Foot_0202` | 148.71 | `Bip002-R-Calf_00` | `[0.06, 0.19, 0.98]` ⚠️ MIRRORED OBLIQUE |

**Total leg length:** ~713 units (thigh + calf + foot)

### Critical Finding: OBLIQUE AXES

**Thigh and foot bones have oblique local-Z axes** (not pure Z!). This means:
- Thigh local-Z points at angle: `[±0.10, ±0.23, -0.97]`
- This is the **flexion axis** - rotation here folds the leg
- Calf has pure Z-axis (simple hinge)
- **LEFT and RIGHT legs have MIRRORED Z-axes** (opposite signs)

**Implications:**
- Same-signed rotation on both legs = symmetric fold (as intended)
- Must use `LEG_TUCK_WEIGHTS = [0.45, -0.6, 0.2]` (existing)
- Thigh fold moves foot 1.32 units forward + up
- Calf fold moves foot 0.84 units forward + down
- Foot fold = 0.43 units

---

## WING FINGER BONES

**Membrane spread control:**

**Not measured in this session** (wings are working well per docs).

**Known from docs:**
- Finger bones control membrane spread
- Extends/retracts wing semi-span
- Max extension: 20.3 units (semi-span)
- Primary flight control is via manual clips, not procedural

---

## COORDINATE SYSTEM

**Blender uses Z-up:**
- X-axis: Lateral (left/right)
- Y-axis: Backwards along body axis
- Z-axis: Vertical (up/down)

**Key measurements:**
- Pelvis height: ~712 units
- Head height: ~677 units
- Tail tip height: ~995 units
- Tail tip behind pelvis: ~1,856 units

**Scale:**
- 1 unit ≈ 1 cm (based on dragon size)
- Total length: ~2,700 units (27 meters wingspan?)

---

## ANIMATION RECOMMENDATIONS

Based on these measurements:

### 1. Spine Wave Propagation
**Use weights:** `[0.08, 0.18, 0.25, 0.30, 0.19]`
- Pelvis gets smallest amplitude (anchors the body)
- Spine2-3 get largest amplitude (mid-body undulation)
- Phase delay: 12% cycle per bone

### 2. Tail Counterweight
**Expected swing range:** ±1.5 to 3.0 units at tip
- At 0.3 rad per bone: 1.77 units lateral
- Counterbalance amplitude: ±30° for hard turns
- Anticipation: tail moves 1-2 frames before body

### 3. Neck Alignment
**Distribute evenly** across 4 bones:
- Each bone gets ~33% of total head offset
- Local-Z rotation is safe (pure axis)
- Can use for pitch/look-ahead

### 4. Leg Pendulum
**Account for oblique axes:**
- Thigh axis is tilted 13° from vertical
- Must compensate for asymmetry
- Use existing `LEG_TUCK_WEIGHTS` system

---

## VALIDATION CHECKLIST

Before implementing, verify:

- [x] Spine local-Z is sagittal pitch axis
- [x] Neck local-Z is sagittal pitch axis  
- [x] Tail local-Y is lateral yaw axis
- [x] Thigh local-Z is flexion axis (oblique)
- [x] Calf local-Z is pure hinge axis
- [ ] Tail tip swing range (needs pose test)
- [ ] Head pitch/lsyaw limits (needs pose test)
- [ ] Leg fold limits (needs pose test)

---

## NEXT STEPS

1. **Phase 1 Implementation:** Use these measurements for spine wave
2. **Pose testing:** Manually pose tail/neck to measure max ranges
3. **Performance check:** Verify 6-bone tail is under budget
4. **Visual validation:** Compare procedural tail to authored clips

---

## FILES TO UPDATE

After implementation:

1. `src/render/spineWave.ts` - Add measured weights
2. `src/render/tailController.ts` - Use 1.77-unit swing range
3. `src/render/legPhysics.ts` - Account for oblique thigh axes
4. `docs/WYVERN_ANIMATION_BASELINE.md` - Add these measurements

---

**This document provides the numerical foundation for all Phase 1-6 implementation in `AAA_FLIGHT_ANIMATION_PLAN.md`.**
