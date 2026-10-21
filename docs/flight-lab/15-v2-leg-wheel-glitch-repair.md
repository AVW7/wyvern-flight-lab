# V2 Wyvern Flight Rig: Leg Wheel-Spinning Glitch Repair

**Date**: 2026-10-02  
**Scope**: `src/flight-lab/rig/wyvernFlightRig.ts`, `src/flight-lab/runtime.ts`  
**Tests**: `test/wyvern-flight-rig.test.js`, `test/wyvern-v2-kinetics.test.js`  

---

## 1. Problem Statement & Exact Symptom

In the Wyvern Flight Lab (`/flight-lab`), when playing or scrubbing flight clips (e.g. `cruise`, `glide`, `hover`), the wyvern's hind legs exhibited a severe rotational glitch: instead of remaining in a streamlined flight tuck, the legs continuously rotated 360° around their pitch axes multiple times per second, spinning forward/upward like bicycle wheels.

---

## 2. Root Cause Analysis

The bug was caused by a compounding multiplier interaction between procedural bone offsets and Three.js `PropertyMixer`:

1. **Three.js Optimization / Skip Behavior**:
   In Three.js `PropertyMixer.prototype.apply`, scene graph values are only set if the evaluated track value changes between frames:
   ```javascript
   for ( let i = stride, e = stride + stride; i !== e; ++ i ) {
     if ( buffer[ i ] !== buffer[ i + stride ] ) {
       binding.setValue( buffer, offset );
       break;
     }
   }
   ```
   In flight loops (`cruise`, `glide`, `hover`), the wyvern holds its legs tucked at constant keyframe values across the clip duration ($t = 0..6\text{s}$). Consequently, `buffer[i] === buffer[i + stride]` on every frame after frame 0, and Three.js completely skips calling `binding.setValue()`.

2. **Procedural Multiplicative Accumulation**:
   `src/flight-lab/rig/wyvernFlightRig.ts` invokes `applyLegTuck` and `dynamicLegController`, which call:
   ```typescript
   export function applyBoneOffset(bone, pitch, yaw, roll) {
     offset.setFromAxisAngle(LOCAL_PITCH, pitch);
     bone.quaternion.multiply(offset);
   }
   ```
   Because Three.js never restored `bone.quaternion` back to the clip's evaluated pose, the procedural pitch offset ($\approx 0.45\text{ rad} \approx 25.8^\circ$) was multiplied into the previous frame's quaternion 60 times per second:
   $$q_n = q_{n-1} \cdot q_{\text{offset}} = q_{\text{base}} \cdot (q_{\text{offset}})^n$$
   Within 14 frames ($\approx 0.23\text{s}$), the leg completed a full $360^\circ$ rotation, creating the continuous wheel-spinning motion reported by the user.

---

## 3. The Solution

A comprehensive two-tier architecture was implemented to ensure mathematical stability:

### A. Rig Baseline Pose Tracking (`src/flight-lab/rig/wyvernFlightRig.ts`)
`createWyvernFlightRig` tracks all procedurally controlled bones (`trackedBones`). At the start of each frame in `update()`:
- If `bone.quaternion` matches `lastWritten` (within $10^{-4}$ tolerance), no external animation track updated the bone; `bone.quaternion` is restored to `baseQuat` before computing offsets.
- If `bone.quaternion` changed (an active animation clip evaluated a new frame pose), `baseQuat` adopts the new frame pose.
- Procedural offsets are composed cleanly onto `baseQuat`.
- At the end of `update()`, `lastWritten` records the final composite pose.
- In `reset()`, all bones are cleanly restored to `baseQuat`.

### B. Runtime Animation Mixer Pose Guarantee (`src/flight-lab/runtime.ts`)
`updateMixer(delta)` was added to `createFlightLabRuntime`. Every time `mixer.update` runs (in the render loop, frame stepping, or timeline seeking), all active property bindings flush their evaluated buffer into the scene graph node. This guarantees that `neckSpring` and `flightRig` always start from the current frame's exact authored keyframe pose.

---

## 4. Verification & Quality Gates

1. **Deterministic Regression Tests Added**:
   - `test/wyvern-flight-rig.test.js`: Proves that 60 frames of steady flight maintain bounded leg rotation ($\Delta \theta < 45^\circ$, late-frame delta $< 1^\circ/\text{frame}$). Verified that it failed RED before the fix ($\text{max angle } 176.9^\circ$) and passes GREEN after.
   - `test/wyvern-v2-kinetics.test.js`: Proves that 120 frames of continuous cruise playback on the real V2 model maintain pitch strictly bounded between $-90^\circ$ and $-50^\circ$ with drift $< 0.5^\circ$.

2. **Quality Gates Status**:

| Gate | Command | Result |
| :--- | :--- | :--- |
| **Kinetics Suite** | `tsx --test test/wyvern-v2-kinetics.test.js` | **30 / 30 PASS** |
| **Flight Rig Suite** | `tsx --test test/wyvern-flight-rig.test.js` | **4 / 4 PASS** |
| **Fast Tests** | `pnpm test:fast` | **809 / 809 PASS** (100%) |
| **TypeScript** | `pnpm tsc --noEmit` | **0 errors** |
| **ESLint** | `pnpm lint` | **0 errors** |
| **Wildlife Simulation** | `pnpm sim:wildlife` | **16 / 16 species PASS** |
| **Mutation Invariants** | `pnpm invariants:mutate` | **113 / 113 killed** (100.0%) |
| **Documentation Sync** | `pnpm docs:check` | **PASS (Synchronized)** |
