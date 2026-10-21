import type { Object3D } from 'three'
import type { FlightLoopState } from '../kinematics/flightPose'
import { applyBoneOffset } from './boneOffsets'

export const TAIL_CONFIG = {
  BASE_FREQUENCY: 2.5,
  MIN_SWING_AMPLITUDE: 0.03,
  MAX_SWING_AMPLITUDE: 0.12,
  MIN_VERTICAL_AMPLITUDE: 0.01,
  MAX_VERTICAL_AMPLITUDE: 0.06,
  PHASE_DELAY_PER_BONE: 0.14,
  SPEED_FOR_RIGID: 35,
  SPEED_FOR_FLUID: 8,
  MAX_TURN_INFLUENCE: 0.25,
  COUNTERWEIGHT_FACTOR: 0.85,
  ANTICIPATION_LEAD: 0.3,
  BONE_WEIGHTS_10: [0.06, 0.09, 0.12, 0.14, 0.14, 0.13, 0.11, 0.09, 0.07, 0.05],
  DIVE_EXTEND_FACTOR: 1.4,
  HOVER_DROP_FACTOR: 0.6,
  GLIDE_STREAMLINE_FACTOR: 0.7,
  SPEED_STIFFEN_FACTOR: 1.5,
} as const

export interface TailState {
  swing: number
  lift: number
  smoothedTurnRate: number
  smoothedBank: number
  phase: number
}

export function createTailState(): TailState {
  return {
    swing: 0,
    lift: 0,
    smoothedTurnRate: 0,
    smoothedBank: 0,
    phase: 0,
  }
}

export interface TailInputs {
  horizontalSpeed: number
  verticalSpeed: number
  turnRate: number
  bank: number
  flightMode: FlightLoopState
  aggression?: number
}

export function dynamicTailController(
  tailBones: Object3D[],
  state: TailState,
  inputs: TailInputs,
  dt: number,
): void {
  if (tailBones.length === 0) return

  const smoothingRate = 6.0
  state.smoothedTurnRate += (inputs.turnRate - state.smoothedTurnRate) * Math.min(1, smoothingRate * dt)
  state.smoothedBank += (inputs.bank - state.smoothedBank) * Math.min(1, smoothingRate * dt)

  // Speed-dependent stiffness
  const speedRange = TAIL_CONFIG.SPEED_FOR_RIGID - TAIL_CONFIG.SPEED_FOR_FLUID
  const stiffness = Math.max(0, Math.min(1, (inputs.horizontalSpeed - TAIL_CONFIG.SPEED_FOR_FLUID) / speedRange))
  const fluidity = 1 - stiffness

  // Counterweight: Newton's 3rd Law opposes bank
  const counterweightYaw = -state.smoothedBank * TAIL_CONFIG.COUNTERWEIGHT_FACTOR

  // Turn anticipation
  const anticipatedTurn = state.smoothedTurnRate * (1 + TAIL_CONFIG.ANTICIPATION_LEAD)
  const turnSwing = anticipatedTurn * TAIL_CONFIG.MAX_TURN_INFLUENCE

  // Mode multipliers
  let modePitchMultiplier = 1.0
  let modeStiffnessMultiplier = 1.0
  if (inputs.flightMode === 'dive') {
    modePitchMultiplier = TAIL_CONFIG.DIVE_EXTEND_FACTOR
  } else if (inputs.flightMode === 'hover') {
    modePitchMultiplier = TAIL_CONFIG.HOVER_DROP_FACTOR
  } else if (inputs.flightMode === 'speed') {
    modeStiffnessMultiplier = TAIL_CONFIG.SPEED_STIFFEN_FACTOR
  } else if (inputs.flightMode === 'glide') {
    modeStiffnessMultiplier = TAIL_CONFIG.GLIDE_STREAMLINE_FACTOR
  }

  // Phase oscillation
  state.phase = (state.phase + dt * TAIL_CONFIG.BASE_FREQUENCY) % 1

  const weights = tailBones.length === 10 ? TAIL_CONFIG.BONE_WEIGHTS_10 : [0.08, 0.14, 0.20, 0.24, 0.20, 0.14]

  for (let i = 0; i < tailBones.length; i++) {
    const bone = tailBones[i]
    if (!bone) continue

    const bonePhase = (state.phase - i * TAIL_CONFIG.PHASE_DELAY_PER_BONE) % 1
    const oscSwing = Math.sin(bonePhase * Math.PI * 2) * TAIL_CONFIG.MIN_SWING_AMPLITUDE * fluidity
    const oscLift = Math.cos(bonePhase * Math.PI * 2) * TAIL_CONFIG.MIN_VERTICAL_AMPLITUDE * fluidity

    const boneWeight = weights[i] ?? 0.1
    const totalYaw = (counterweightYaw + turnSwing + oscSwing) * boneWeight * modeStiffnessMultiplier
    const totalPitch = (inputs.verticalSpeed * 0.01 + oscLift) * boneWeight * modePitchMultiplier

    applyBoneOffset(bone, totalPitch, totalYaw, 0)
  }
}
