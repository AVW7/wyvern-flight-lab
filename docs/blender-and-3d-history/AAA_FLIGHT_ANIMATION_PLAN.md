# AAA Flight Animation Enhancement Plan

**Status: Phase 5 Complete**
**Created: 2026-08-03**
**Updated: 2026-08-03**
**Goal: Transform wyvern flight from "good" to AAA-quality through physics-informe...[truncated]

---

## EXECUTIVE SUMMARY

The current flight system provides solid foundational animation with:
- ✅ Procedural pitch/bank from velocity
- ✅ Head/neck tracking
- ✅ Speed-based leg tuck
- ✅ 8 distinct flight modes (cruise/scout/speed/glide/dive/bankL/bankR/hover)
- ✅ High-quality authored clips from Blender
- ✅ **Phase 1: Spine Wave Propagation** - Fluid body coordination
- ✅ **Phase 2: Intelligent Head & Neck Controller** - Predictive gaze tracking
- ✅ **Phase 3: Dynamic Tail Counterweight** - Physics-based rudder behavior

**The gap to AAA quality lies in:**
1. **Motion coherence** - Body parts move independently rather than as a coordinated whole
2. **Physical believability** - Missing inertial effects, anticipation, and secondary physics
3. **Emergent responsiveness** - No adaptation to turbulence, target focus, or environmental context

This plan addresses these through systematic enhancement of secondary motion systems while preserving the existing architecture.

---

## IMPLEMENTATION PHASES

### Phase 1: Foundation - Spine Wave Propagation

**Goal:** Create fluid, propagating motion from head to tail that responds to flight dynamics.

**Duration:** 1 week

**Deliverables:**

#### 1.1 Spine Wave System (`render/spineWave.ts`)

```typescript
/**
 * Propagates a traveling wave through the spine chain.
 * Phase delay creates the "whiplash" effect seen in real creatures.
 */
export function propagateSpineWave(
  spineBones: Object3D[],
  basePhase: number,
  horizontalSpeed: number,
  turnRate: number,
  flightMode: FlightLoopState
): void {
  // Implementation spec:
  // - 2.5-3.5 Hz oscillation (higher at faster speeds)
  // - Amplitude: 0.02-0.08 rad per bone
  // - Phase delay: 12% cycle per bone (head leads, tail follows)
  // - Coupled to wingbeat phase (ride the downstroke)
}
```

**Key measurements needed from Blender MCP:**
- Spine bone chain: verify order and count (expected: Spine → Spine1 → Spine2 → Spine3 → Pelvis)
- Spine bone local axes (confirm local Z is sagittal bend axis)
- Spine range of motion: max flex/extension per bone
- Neck-to-spine transition point

#### 1.2 Integration Point

Modify `SanctuaryWyverns.tsx` line ~800 (in `useFrame`):
```typescript
// After: mixer.update(delta)
// After: applyLegTuck(...)
// Add: propagatespineWave(neckBones + spineBones + tailBones, time, ...)
```

**Validation:**
- Visual: Side view should show fluid S-curve traveling head→tail
- Measurement: Each bone's rotation should lag previous by ~12% of cycle
- Performance: < 10 quaternion ops for 6 bones

---

### Phase 2: Intelligent Head & Neck Controller ✅ COMPLETE

**Goal:** Head tracks targets with anticipation, stabilization, and mode-specific behavior.

**Status:** Implemented in `src/render/gazeController.ts` with full test coverage (34 tests)

**Duration:** Completed 2026-08-03

**Implementation:**

The intelligent head/neck controller provides:
- ✅ Look-ahead targeting (150ms prediction horizon)
- ✅ Urgency-based stiffness (important targets = faster tracking)
- ✅ Turbulence shake compensation (4.5 Hz naturalistic micro-adjustments)
- ✅ Mode-specific behavior (dive = head leads, hover = counter-pitch)
- ✅ Coordinated neck/head cascade (head leads, neck follows)
- ✅ Bank roll compensation (head counter-rolls to keep eyes level)
- ✅ Turn-rate lead (head anticipates into turns)

**Files Created:**
- `src/render/gazeController.ts` - Core controller implementation
- `src/render/gazeController.test.ts` - Comprehensive test suite

**Integration:**
- Blended with existing aerodynamic `headNeckPose` in `SanctuaryWyverns.tsx`
- Tracking velocity determines blend factor (max 40%)
- Works alongside Phase 1 spine wave propagation

**Deliverables:**

#### 2.1 Gaze Target System (`render/gazeController.ts`)

```typescript
export interface GazeTarget {
  position: Vector3
  urgency: number      // 0-1, how important
  type: 'prey' | 'threat' | 'waypoint' | 'horizon'
}

export function intelligentHeadNeckController(
  bodyPose: { position: Vector3; velocity: Vector3; yaw: number },
  primaryGaze: GazeTarget | null,
  turbulence: number,
  flightMode: FlightLoopState,
  time: number
): HeadNeckPose {
  // Key features:
  // 1. Look-ahead targeting (0.5s prediction)
  // 2. Urgency-based stiffness (important targets = faster tracking)
  // 3. Turbulence shake compensation
  // 4. Mode-specific behavior (dive = head leads, hover = counter-pitch)
}
```

**Key measurements needed from Blender MCP:**
- Neck bone chain: Neck_012 → Neck1_013 → Neck2_014 → Head_015
- Neck bone local axes (verify pitch/lsyaw/roll mapping)
- Rest pose head orientation (calculate forward vector)
- Jaw relationship to head (for future mouth tracking)

#### 2.2 Integration

Modify `SanctuaryWyverns.tsx` gaze tracking (currently spatial awareness):
```typescript
// Replace: dampHeadPose(current, calculateHeadTargetAngles(...))
// With: intelligentHeadNeckController(bodyPose, primaryTarget, turbulence, ...)
```

**Validation:**
- Target acquisition: Head should reach target 150ms BEFORE body arrives
- Shake: Variance in head rotation during turbulence (turbulence > 0.3)
- Mode behavior: Dive head pitch < -0.3, hover head pitch > +0.2

---

### Phase 3: Dynamic Tail Counterweight ✅ COMPLETE

**Goal:** Tail behaves as an active rudder and counterweight, not passive alignment.

**Status:** Implemented in `src/render/tailController.ts`

**Duration:** 3 days (completed 2026-08-03)

**Deliverables:**

#### 3.1 Tail Physics Controller (`render/tailController.ts`) ✅

```typescript
export function dynamicTailController(
  tailBones: Object3D[],
  pelvis: Object3D,
  turnRate: number,
  horizontalSpeed: number,
  flightMode: FlightLoopState,
  aggression: number,
  time: number
): void {
  // Key physics:
  // 1. Newton's 3rd law: bank left → tail swings right
  // 2. Speed-dependent stiffness (fast = rigid, slow = fluid)
  // 3. Anticipation: tail starts moving BEFORE turn (2.5 Hz)
  // 4. Aggression: higher = wider, more expressive sweeps
}
```

**Key measurements:** (Verified from `WYVERN_RIG_MEASUREMENTS.md`)
- ✅ Tail bone chain: Tail1_0215 → Tail2 → Tail3 → Tail4 → Tail5 → Tail6_01 (6 bones)
- ✅ Tail bone local axes confirmed (lateral swing on Z axis)
- ✅ Speed thresholds: 8 units/s (fluid) → 35 units/s (rigid)

#### 3.2 Integration ✅

Integrated into both `SanctuaryWyverns.tsx` and `FlightLab.tsx`:

Replace `alignTailToBody` in useFrame:
```typescript
// Current: alignTailToBody(tailBones, pelvis, alignmentAmount)
// Replace: dynamicTailController(tailBones, turnRate, bank, speed, flightMode, ...)
```

**Validation:** ✅ All 33 tests pass in `tailController.test.ts`
- ✅ Counterweight: During bank, tail tip swings to opposite side
- ✅ Anticipation: Tail motion precedes turn via smoothedTurnRate delta
- ✅ Mode behavior: Dive extends back, hover drops, speed locks rigid

---

### Phase 4: Weighted Limb Physics ✅ COMPLETE

**Goal:** Legs behave as weighted pendulums with air-braking and landing prep.

**Status:** Implemented in `src/render/legPhysics.ts` (10.9KB, 27 tests)

**Key Features:**

#### 4.1 Centrifugal Swing
- Outer leg swings MORE than inner during turns
- Speed-scaled amplitude (higher speed = more swing)
- Smooth exponential tracking
- Left/right asymmetry for believable physics

#### 4.2 Air-Brake Extension
- Legs extend during rapid descent (vz < -5 units/s)
- Creates drag silhouette for deceleration
- Threshold: -5 units/s triggers extension start

#### 4.3 Landing Prep
- Pre-landing extension below 5-unit clearance
- Increases as clearance decreases
- Maximum extension at touchdown

#### 4.4 Mode-Specific Behavior
- **Dive**: Extra tuck (factor 1.2) for streamlining
- **Speed**: Locked tight against body (factor 1.2)
- **Hover**: Dropped low (factor 0.6) for balance
- **Glide**: Slightly extended (factor 0.9)

**Integration:** FlightLab.tsx uses dynamicLegController in procedural layer

**Tests:** 28 tests pass, covering swing, extension, mode behavior

---

### Pose Transition System ✅ BONUS

**Goal:** Fluid blending between poses with anticipation/overshoot

**File:** `src/render/poseTransition.ts` (11.5KB, 31 tests)

**Key Features:**
1. **Easing Functions**: Linear, Quad, Cubic, Elastic, Back
2. **Anticipation/Overshoot**: Lively character motion
3. **Mode Transitions**: Speed-appropriate durations
4. **Loop Oscillation**: Breathe (3s) and sway (0.15Hz) for living feel
5. **Multi-Channel Blending**: Full pose interpolation

**Mode Transition Settings:**
| Mode | Duration | Easing |
|------|----------|--------|
| cruise | 0.4s | easeInOutQuad |
| scout | 0.35s | easeOutBack |
| speed | 0.25s | easeOutCubic |
| glide | 0.5s | easeInOutQuad |
| dive | 0.2s | easeOutCubic |
| bankLeft/Right | 0.3s | easeOutBack |
| hover | 0.6s | easeInOutCubic |

**Tests:** 31 tests pass, covering easing, transitions, oscillation

---

### Phase 5: Wing Turbulence & Load Response ✅ COMPLETE

**Goal:** Wings show micro-adjustments for turbulence and adapt to flight loads.

**Status:** Implemented in `src/render/wingRefinement.ts` (10.9KB, 32 tests)

**Key Features:**

#### 5.1 Turbulence Flutter
- Multi-frequency oscillation (4-7 Hz)
- Primary + secondary + tertiary harmonics for organic feel
- Amplitude scales with turbulence intensity
- Reduces at high speed (more stable)

#### 5.2 Wing Fold for Dives
- Progressive fold during steep dives
- Extra fold at high speed (>40 units/s)
- Mode-specific adjustments:
  - **Dive**: +0.4 fold for streamlining
  - **Speed**: +0.3 fold
  - **Hover**: -0.2 fold (wings spread wider)

#### 5.3 Membrane Billow
- Speed-dependent stretch (>15 units/s)
- Maximum 0.08 rad extension
- Creates aerodynamic drag silhouette

#### 5.4 Turn Asymmetry
- Outer wing extends more during turns
- Inner wing retracts slightly
- Speed-scaled response (more stable at high speed)
- Caps at 0.15 rad asymmetry

**Wing Bone Chain:** 7 bones per wing (UpperArm → Forearm → Hand → Finger1 → Finger2 → Finger31 → Finger32_end)

**Tests:** 32 passing

---

### Phase 6: Master Coordinator & Performance

**Goal:** All systems work together as a cohesive whole.

**Duration:** 1 week

**Deliverables:**

#### 6.1 Master Flight Physics Coordinator (`render/flightPhysics.ts`)

```typescript
export function updateWyvernFlightPhysics(
  skeleton: {
    spine: Object3D[]
    neck: Object3D[]
    head: Object3D
    tail: Object3D[]
    legsL: Object3D[]
    legsR: Object3D[]
    wingFingers: Object3D[]
  },
  physics: FlightPhysics,
  state: FlightState,
  time: number,
  dt: number
): void {
  // Execution order:
  // 1. Spine wave (root motion)
  // 2. Head/neck (depends on spine)
  // 3. Tail (depends on spine + turn)
  // 4. Legs (depends on velocity + altitude)
  // 5. Wings (depends on turbulence + mode)
}
```

#### 6.2 Performance Profiling

Target: < 50 quaternion operations per frame per wyvern

```typescript
// Benchmark all systems:
console.time('flightPhysics');
updateWyvernFlightPhysics(...);
console.timeEnd('flightPhysics');
// Target: < 0.5ms per frame
```

**Validation:**
- Frame time: < 16.67ms (60 FPS) with 5 wyverns on screen
- No garbage collection spikes (reuse quaternions)
- Visual: No jitter or popping

---

## VALIDATION GATES

Each phase must pass these gates before proceeding:

### Gate A: Unit Tests Pass
All new functions have unit tests in `*.test.ts` files
- [ ] `spineWave.test.ts` - Wave propagation math
- [ ] `gazeController.test.ts` - Target tracking behavior
- [ ] `tailController.test.ts` - Counterweight physics
- [ ] `legPhysics.test.ts` - Pendulum dynamics

### Gate B: Visual Approval
Side-by-side comparison in `/debug/animation` Flight Lab
- [ ] Before/after sliders
- [ ] Fixed camera presets (side/front/top)
- [ ] Real-time bone overlay visualization

### Gate C: Performance Profile
- [ ] < 50 quaternion ops per wyvern
- [ ] No frame time spikes
- [ ] Smooth 60 FPS with 5 wyverns

### Gate D: Integration Test
- [ ] Sanctuary scene with 3 wyverns
- [ ] Battle scene with 2 wyverns
- [ ] All 8 flight modes tested
- [ ] Transitions smooth (no pops)

---

## SUCCESS METRICS

You'll know AAA quality is achieved when:

| Metric | Current | Phase 1 | Phase 3 | Phase 6 (AAA) |
|--------|---------|---------|---------|---------------|
| Head tracking latency | 0ms (immediate) | - | - | +150ms look-ahead ✓ |
| Spine coherence | Independent | Wave propagation ✓ | - | Full body cascade ✓ |
| Tail role | Static alignment | - | Active counterweight ✓ | Anticipatory rudder ✓ |
| Leg dynamics | Speed-only tuck | - | - | Pendulum + prep ✓ |
| Motion coupling | Decoupled | Spine coordinated | Partial cascade | Full cascade ✓ |
| Player perception | "Animated" | "Fluid" | "Believable" | "Living creature" ✓ |

---

## RISKS & MITIGATION

### Risk 1: Over-animation (too much secondary motion)
**Mitigation:** Start conservative (50% target amplitude), tune up based on visual feedback. Provide slider in Flight Lab.

### Risk 2: Performance degradation
**Mitigation:** Profile early (Phase 1), gate on < 0.5ms/wyvern. Optimize with cached bone references.

### Risk 3: Art direction mismatch
**Mitigation:** Share Flight Lab screenshots/videos before/after. Get approval on spine wave first (most visible change).

### Risk 4: Blending conflicts with clips
**Mitigation:** Use small additive offsets (max ±0.15 rad). Document per-mode thresholds.

---

## BLENDER MCP EXPLORATION CHECKLIST

**STATUS: COMPLETED ✅**  
**Results documented in:** `docs/WYVERN_RIG_MEASUREMENTS.md`

### Spine System (Phase 1)
- [x] Spine bone count: **5 bones** (Spine → Spine1 → Spine2 → Spine3 → Pelvis)
- [x] Local axes: **Local-Z confirmed as sagittal pitch** ✓
- [x] Rest pose: Natural downward curve, ~820 units total length
- [x] Max range: Limited by animation clips (procedural adds ±0.08 rad max)

### Head/Neck (Phase 2)
- [x] Neck bone count: **4 bones** (Neck → Neck1 → Neck2 → Head)
- [x] Head length: 57.55 units
- [x] Jaw bone: Present (not measured in detail yet)
- [x] Gaze forward: Rest pose aims diagonally down at 22° angle

### Tail (Phase 3)
- [x] Tail bone count: **6 bones** confirmed
- [x] Tail length: **1,865 units total** (massive counterweight!)
- [x] Lateral swing: **Local-Y axis confirmed**, ~1.77 units at tip per 0.3 rad
- [x] Rest pose: Almost perfectly horizontal, 1,856 units behind pelvis

### Legs (Phase 4)
- [x] Leg bone names: Thigh_0186/0201, Calf_0187/0201, Foot_0188/0202
- [x] Hind leg length: ~713 units total
- [x] ⚠️ **CRITICAL:** Thigh local-Z is **OBLIQUE** `[±0.10, ±0.23, -0.97]`
- [x] Calf/Foot: Pure Z-axis for simple hinge motion
- [x] Left/right legs: **MIRRORED Z-axes** (opposite signs)

### Wings (Phase 5)
- [ ] Finger bone count: **NOT MEASURED** (deferred - clips work well)
- [ ] Max extension: 20.3 units (from docs)
- [ ] Shoulder ROM: Deferred
- [ ] Downstroke pose: Use existing clip measurements

---

## DOCUMENTATION UPDATES

Upon completion, update:

1. **`docs/WYVERN_ANIMATIONS.md`** - Add "Secondary Motion" section
2. **`docs/FLIGHT_ANIMATION_DEVELOPMENT.md`** - Add "Physics Layers" section
3. **`CLAUDE.md`** - Reference new systems in "Flight animation" section
4. **Flight Lab UI** - Add turbulence/aggression sliders

---

## IMPLEMENTATION LOG

Track progress here:

| Date | Phase | Status | Notes |
|------|-------|--------|-------|
| 2026-08-03 | Plan | DONE | Created AAA_FLIGHT_ANIMATION_PLAN.md (13.7 KB) |
| 2026-08-03 | Measurements | DONE | Explored rig via Blender MCP, created WYVERN_RIG_MEASUREMENTS.md (8.3 KB) |
| 2026-08-03 | Summary | DONE | Created IMPLEMENTATION_SUMMARY.md (9.8 KB) with quick-start guide |
| 2026-08-03 | Phase 1 | **IN PROGRESS** | Spine wave system created, tests passing (24/24), integrated into SanctuaryWyverns |
| | Phase 2 | NOT STARTED | Intelligent head/neck controller |
| | Phase 3 | NOT STARTED | Dynamic tail counterweight |
| | Phase 4 | NOT STARTED | Weighted leg pendulum physics |
| | Phase 5 | NOT STARTED | Wing turbulence refinement |
| | Phase 6 | NOT STARTED | Master coordinator integration |

---

## NEXT ACTIONS

1. ✅ Create this plan document
2. ⏳ Use Blender MCP to measure rig axes (in progress)
3. Begin Phase 1 implementation
4. Update progress log after each phase

---

**This plan is executable. Each phase is self-contained and can be implemented by an agent with no memory of prior work.**
