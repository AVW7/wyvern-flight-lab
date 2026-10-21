import type { Object3D } from 'three'
import type { FlightLoopState } from '../kinematics/flightPose'
import { applyBoneOffset } from './boneOffsets'
import {
  sampleHarvestedDigitCurl,
  sampleHarvestedPanelFlex,
} from './harvestedWingProfiles'

export const WING_CONFIG = {
  GROUND_CLEARANCE: 0.5,
  GROUND_SPEED: 2,
  MAX_FLUTTER_FREQ: 7,
  MIN_FLUTTER_FREQ: 4,
  MAX_FLUTTER_AMP: 0.06,
  MIN_FLUTTER_AMP: 0.015,
  MEMBRANE_SPEED_THRESHOLD: 15,
  MAX_MEMBRANE_STRETCH: 0.08,
  DIVE_FOLD_THRESHOLD: 0.25,
  MAX_DIVE_FOLD: 0.25,
  TURN_FOLD_GAIN: 0.08,
  MAX_TURN_FOLD: 0.12,
} as const

export interface WingState {
  flutterPhase: number
  foldAmount: number
}

export interface WingsState {
  left: WingState
  right: WingState
}

export function createWingsState(): WingsState {
  return {
    left: { flutterPhase: 0, foldAmount: 0 },
    right: { flutterPhase: 0, foldAmount: 0 },
  }
}

export interface WingInputs {
  horizontalSpeed: number
  pitch: number
  flightMode: FlightLoopState
  turnRate: number
  groundClearance?: number
}

function applyWingBoneProceduralOffset(
  bone: Object3D,
  flutter: number,
  fold: number,
  phaseNormalized: number,
  isRight: boolean,
): void {
  const name = bone.name
  let pitchOffset = 0
  let yawOffset = 0

  if (name.includes('Shoulder')) {
    pitchOffset = fold * 0.08
  } else if (name.includes('Elbow')) {
    pitchOffset = fold * 0.20
  } else if (name.includes('Wrist')) {
    pitchOffset = fold * 0.35
    yawOffset = flutter * 0.05
  } else if (name.includes('Hand')) {
    pitchOffset = fold * 0.45
    yawOffset = fold * 0.15 + flutter * 0.10
  } else if (name.includes('Panel')) {
    const panelIdx = Number(name.match(/Panel(\d)/)?.[1] ?? 0)
    const isP1 = name.endsWith('_1')
    // Panel{p}_0 is parented to WingD{p}P0; midpoint between Digit p and Digit p+1
    const midDigitSpread = (panelIdx + 0.5) / 5.0
    const segmentWeight = isP1 ? 0.55 : 0.45
    const progress = (0.2 + 0.8 * midDigitSpread) * segmentWeight
    const harvestedFlex = sampleHarvestedPanelFlex(panelIdx, phaseNormalized, flutter)
    pitchOffset = fold * 0.35 * segmentWeight + (flutter * 0.35 + harvestedFlex * 0.45) * progress
    yawOffset = fold * 0.15 * segmentWeight
  } else if (name.includes('D')) {
    const digitIdx = Number(name.match(/D(\d)/)?.[1] ?? 0)
    const pIdx = Number(name.match(/P(\d)/)?.[1] ?? 0)
    const phalanxProgress = (pIdx + 1) / 3.0
    const harvestedCurl = sampleHarvestedDigitCurl(digitIdx, phaseNormalized, flutter)

    if (digitIdx === 0) {
      // Leading spar: high stiffness with subtle aerodynamic flutter
      const billow = flutter * 0.15 * phalanxProgress
      pitchOffset = fold * 0.30 * phalanxProgress + billow
      yawOffset = fold * 0.20 * phalanxProgress + (flutter * 0.05 + harvestedCurl * 0.05) * phalanxProgress
    } else if (digitIdx === 5) {
      // Digit 5 is the Alula / Thumb claw. Keeping it rigid with the hand
      // prevents twisting the membrane attachment at the wrist.
      pitchOffset = 0
      yawOffset = 0
    } else {
      const digitSpread = digitIdx / 5.0
      // Trailing digits flex with aeroelastic billow during downstrokes
      const billow =
        (flutter * 0.35 + harvestedCurl * 0.45) *
        (0.2 + 0.8 * digitSpread) *
        phalanxProgress
      pitchOffset = fold * 0.35 * phalanxProgress + billow
      yawOffset =
        fold * 0.25 * phalanxProgress +
        (flutter * 0.5 + harvestedCurl * 0.5) * (0.2 + 0.6 * digitSpread) * (phalanxProgress * phalanxProgress)
    }
  }

  // Rig axis rule: wing bones mirror on Z, not on X!
  // Local +X raises both wings symmetrically; local +Z sweeps in opposite directions.
  // Mirroring must negate Z on the right wing.
  const finalYaw = isRight ? -yawOffset : yawOffset

  // Clamp deflection offsets to prevent membrane triangles from penetrating or inverting
  const clampedPitch = Math.max(-0.25, Math.min(0.25, pitchOffset))
  const clampedYaw = Math.max(-0.25, Math.min(0.25, finalYaw))

  if (Math.abs(clampedPitch) > 1e-5 || Math.abs(clampedYaw) > 1e-5) {
    applyBoneOffset(bone, clampedPitch, clampedYaw, 0)
  }
}

export function dynamicWingController(
  leftWingBones: readonly Object3D[],
  rightWingBones: readonly Object3D[],
  state: WingsState,
  inputs: WingInputs,
  dt: number,
): void {
  const smoothBand = (value: number, cutoff: number): number => {
    const t = Math.max(0, Math.min(1, (value - cutoff) / cutoff))
    return t * t * (3 - 2 * t)
  }
  // Fade over one existing cutoff-width; retain the exact authored contact boundary.
  const clearanceBlend = inputs.groundClearance === undefined
    ? 1 : smoothBand(inputs.groundClearance, WING_CONFIG.GROUND_CLEARANCE)
  const speedBlend = inputs.flightMode === 'hover'
    ? 1 : smoothBand(inputs.horizontalSpeed, WING_CONFIG.GROUND_SPEED)
  const flightBlend = clearanceBlend * speedBlend
  const isGround =
    flightBlend === 0

  if (isGround) {
    state.left.foldAmount = 0
    state.right.foldAmount = 0
    return
  }

  // Dive stoop fold + banking turn inside-wing tuck / outside-wing flare
  const isDiving =
    !isGround && (inputs.flightMode === 'dive' || inputs.pitch > WING_CONFIG.DIVE_FOLD_THRESHOLD)
  const baseFold = isDiving ? WING_CONFIG.MAX_DIVE_FOLD : 0
  const turnFoldDelta = Math.max(
    -WING_CONFIG.MAX_TURN_FOLD,
    Math.min(WING_CONFIG.MAX_TURN_FOLD, (inputs.turnRate || 0) * WING_CONFIG.TURN_FOLD_GAIN),
  )
  const targetLeftFold = Math.max(0, Math.min(WING_CONFIG.MAX_DIVE_FOLD, baseFold + turnFoldDelta))
  const targetRightFold = Math.max(0, Math.min(WING_CONFIG.MAX_DIVE_FOLD, baseFold - turnFoldDelta))

  state.left.foldAmount += (targetLeftFold - state.left.foldAmount) * Math.min(1, 6.0 * dt)
  state.right.foldAmount += (targetRightFold - state.right.foldAmount) * Math.min(1, 6.0 * dt)

  // Speed-dependent flutter frequency & amplitude
  const speedRatio = isGround ? 0 : Math.min(1, Math.max(0, (inputs.horizontalSpeed - 2) / 28))
  const flutterFreq =
    WING_CONFIG.MIN_FLUTTER_FREQ +
    (WING_CONFIG.MAX_FLUTTER_FREQ - WING_CONFIG.MIN_FLUTTER_FREQ) * speedRatio
  const flutterAmp =
    isGround ? 0 : WING_CONFIG.MIN_FLUTTER_AMP +
    (WING_CONFIG.MAX_FLUTTER_AMP - WING_CONFIG.MIN_FLUTTER_AMP) * speedRatio

  state.left.flutterPhase =
    (state.left.flutterPhase + dt * flutterFreq * Math.PI * 2) % (Math.PI * 2)
  state.right.flutterPhase =
    (state.right.flutterPhase + dt * flutterFreq * Math.PI * 2) % (Math.PI * 2)

  const leftFlutter = Math.sin(state.left.flutterPhase) * flutterAmp
  const rightFlutter = Math.sin(state.right.flutterPhase) * flutterAmp
  const leftPhaseNorm = state.left.flutterPhase / (Math.PI * 2)
  const rightPhaseNorm = state.right.flutterPhase / (Math.PI * 2)

  const applyWing = (
    bones: readonly Object3D[],
    flutter: number,
    fold: number,
    phaseNorm: number,
    isRight: boolean,
  ) => {
    if (Math.abs(flutter) < 0.0001 && Math.abs(fold) < 0.0001) return
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i]
      if (!bone) continue
      applyWingBoneProceduralOffset(bone, flutter, fold, phaseNorm, isRight)
    }
  }

  applyWing(leftWingBones, leftFlutter * flightBlend, state.left.foldAmount * flightBlend, leftPhaseNorm, false)
  applyWing(rightWingBones, rightFlutter * flightBlend, state.right.foldAmount * flightBlend, rightPhaseNorm, true)
}
