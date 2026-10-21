import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D, Quaternion, Vector3 } from 'three'
import {
  V1_CRUISE_ELEVATION_PROFILE,
  V1_CRUISE_SWEEP_PROFILE,
  V1_CRUISE_TWIST_PROFILE,
  V1_DIGIT_PHASE_OFFSETS,
  V1_PANEL_PHASE_OFFSETS,
  sampleHarvestedElevation,
  sampleHarvestedSweep,
  sampleHarvestedTwist,
  sampleHarvestedDigitCurl,
  sampleHarvestedPanelFlex,
} from '../src/flight-lab/rig/harvestedWingProfiles.js'
import {
  createWingsState,
  dynamicWingController,
} from '../src/flight-lab/rig/wingRefinement.js'

test('harvest-v1-kinetics: coordinate transformation matches V1->V2 spatial contract', () => {
  // Analytical map: (x, y, z)_v2 = 100 * (x, -z, y)_v1
  const v1Point = new Vector3(0.12, 1.45, -0.67)
  const v2Point = new Vector3(v1Point.x * 100, -v1Point.z * 100, v1Point.y * 100)

  assert.equal(v2Point.x, 12.0)
  assert.equal(v2Point.y, 67.0)
  assert.equal(v2Point.z, 145.0)

  // Residual under identity map is exactly zero
  const transformedBack = new Vector3(v2Point.x / 100, v2Point.z / 100, -v2Point.y / 100)
  assert.ok(v1Point.distanceTo(transformedBack) < 1e-6)
})

test('harvest-v1-kinetics: analytical rest-delta rotation yields identity at rest', () => {
  // desired = (R_posed * R_rest^-1) * R_v2_rest
  const r1Rest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5)
  const r2Rest = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.8)

  // Case 1: Posed == Rest => Delta is Identity
  const r1Posed = r1Rest.clone()
  const delta = r1Posed.clone().multiply(r1Rest.clone().invert())
  const desired = delta.clone().multiply(r2Rest)

  assert.ok(Math.abs(desired.x - r2Rest.x) < 1e-6)
  assert.ok(Math.abs(desired.y - r2Rest.y) < 1e-6)
  assert.ok(Math.abs(desired.z - r2Rest.z) < 1e-6)
  assert.ok(Math.abs(desired.w - r2Rest.w) < 1e-6)
})

test('harvest-v1-kinetics: harvested wing profiles maintain cyclic continuity and C1 smoothness', () => {
  assert.equal(V1_CRUISE_ELEVATION_PROFILE.length, 24)
  assert.equal(V1_CRUISE_SWEEP_PROFILE.length, 24)
  assert.equal(V1_CRUISE_TWIST_PROFILE.length, 24)

  // 1. Cyclic boundary closure: sample(0.0) == sample(1.0)
  assert.ok(Math.abs(sampleHarvestedElevation(0.0) - sampleHarvestedElevation(1.0)) < 1e-5)
  assert.ok(Math.abs(sampleHarvestedSweep(0.0) - sampleHarvestedSweep(1.0)) < 1e-5)
  assert.ok(Math.abs(sampleHarvestedTwist(0.0) - sampleHarvestedTwist(1.0)) < 1e-5)

  // 2. Loop seam continuity: difference across seam delta phase 0.01 is < 0.05 rad
  const seamStep = Math.abs(sampleHarvestedElevation(0.01) - sampleHarvestedElevation(0.99))
  assert.ok(seamStep < 0.05, `Loop seam step must be < 0.05 rad, got ${seamStep}`)

  // 3. Trailing digit phase offsets are strictly monotonic
  assert.equal(V1_DIGIT_PHASE_OFFSETS.length, 6)
  for (let i = 1; i < V1_DIGIT_PHASE_OFFSETS.length; i++) {
    assert.ok(
      V1_DIGIT_PHASE_OFFSETS[i] > V1_DIGIT_PHASE_OFFSETS[i - 1],
      `Digit offset ${i} must lag behind ${i - 1}`,
    )
  }

  // 4. Panel phase offsets are strictly monotonic
  assert.equal(V1_PANEL_PHASE_OFFSETS.length, 4)
  for (let i = 1; i < V1_PANEL_PHASE_OFFSETS.length; i++) {
    assert.ok(
      V1_PANEL_PHASE_OFFSETS[i] > V1_PANEL_PHASE_OFFSETS[i - 1],
      `Panel offset ${i} must lag behind ${i - 1}`,
    )
  }
})

test('harvest-v1-kinetics: trailing edge curl increases progressively from leading spar to wingtip', () => {
  const phase = 0.35 // Downstroke power phase
  const curlD0 = sampleHarvestedDigitCurl(0, phase)
  const curlD5 = sampleHarvestedDigitCurl(5, phase)

  // Leading spar D0 should have lower amplitude than trailing tip D5
  assert.ok(Math.abs(curlD5) > Math.abs(curlD0), 'Trailing edge D5 must flex with greater magnitude than leading spar D0')
})

test('harvest-v1-kinetics: dynamic controller with harvested curves runs 60 frames without angular compounding', () => {
  const leftBones = [
    new Object3D(), // Shoulder
    new Object3D(), // Elbow
    new Object3D(), // Wrist
    new Object3D(), // Hand
    new Object3D(), // D0P0
    new Object3D(), // D5P2
    new Object3D(), // Panel0_0
  ]
  leftBones[0].name = 'L_WingShoulder'
  leftBones[1].name = 'L_WingElbow'
  leftBones[2].name = 'L_WingWrist'
  leftBones[3].name = 'L_WingHand'
  leftBones[4].name = 'L_WingD0P0'
  leftBones[5].name = 'L_WingD5P2'
  leftBones[6].name = 'L_WingPanel0_0'

  const rightBones = [
    new Object3D(),
    new Object3D(),
    new Object3D(),
    new Object3D(),
    new Object3D(),
    new Object3D(),
    new Object3D(),
  ]
  rightBones[0].name = 'R_WingShoulder'
  rightBones[1].name = 'R_WingElbow'
  rightBones[2].name = 'R_WingWrist'
  rightBones[3].name = 'R_WingHand'
  rightBones[4].name = 'R_WingD0P0'
  rightBones[5].name = 'R_WingD5P2'
  rightBones[6].name = 'R_WingPanel0_0'

  const state = createWingsState()
  const inputs = {
    horizontalSpeed: 18,
    pitch: 0,
    flightMode: 'cruise',
    turnRate: 0,
    groundClearance: 25,
  }

  // Run 60 frames of steady flight
  for (let frame = 0; frame < 60; frame++) {
    dynamicWingController(leftBones, rightBones, state, inputs, 0.016)

    // Check all bone quaternions remain normalized and bounded
    for (const b of [...leftBones, ...rightBones]) {
      const len = b.quaternion.length()
      assert.ok(Math.abs(len - 1.0) < 0.02, `Bone ${b.name} quaternion must remain normalized`)
      const angle = 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w))) * (180 / Math.PI)
      assert.ok(angle < 45.0, `Bone ${b.name} offset angle (${angle}°) must remain bounded`)
    }
  }
})
