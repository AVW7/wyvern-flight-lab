import type { Object3D } from 'three'
import type { FlightLoopState } from '../kinematics/flightPose'
import { applyBoneOffset } from './boneOffsets'

export const LEG_CONFIG = {
  PENDULUM_FREQUENCY: 1.2,
  MAX_PENDULUM_SWING: 0.25,
  TURN_RATE_THRESHOLD: 0.3,
  DECEL_THRESHOLD: -8,
  AIR_BRAKE_EXTENSION: 0.15,
  LANDING_CLEARANCE_THRESHOLD: 5,
  LANDING_EXTENSION: 0.2,
  DAMPING: 0.7,
  ASYMMETRY_FACTOR: 1.4,
  BONE_WEIGHTS: {
    thigh: 0.35,
    calf: 0.30,
    foot: 0.20,
    toes: 0.15,
  },
  DIVE_TUCK_FACTOR: 1.3,
  HOVER_DROP_FACTOR: 0.5,
  SPEED_TUCK_FACTOR: 1.5,
  // Walk gait cadence
  WALK_CYCLE_DURATION: 2.458,
  // Takeoff sequence milestones
  TAKEOFF_CROUCH_END: 0.75,
  TAKEOFF_PUSHOFF_END: 1.4,
  TAKEOFF_RETRACT_END: 2.5,
  // Flap suspension
  DOWNSTROKE_LEG_SUSPENSION: 0.045,
  DOWNSTROKE_TOE_SUSPENSION: 0.035,
  UPSTROKE_TUCK_TIGHTEN: -0.025,
  // Ground idle breathing
  BREATH_FREQUENCY: 0.33,
} as const

export interface LegState {
  swing: number
  extension: number
  smoothedTurnRate: number
  phase: number
}

export interface LegsState {
  left: LegState
  right: LegState
}

export function createLegsState(): LegsState {
  return {
    left: { swing: 0, extension: 0, smoothedTurnRate: 0, phase: 0 },
    right: { swing: 0, extension: 0, smoothedTurnRate: 0, phase: Math.PI },
  }
}

export interface LegInputs {
  horizontalSpeed: number
  verticalSpeed: number
  acceleration: number
  turnRate: number
  groundClearance: number
  flightMode: FlightLoopState | 'ground' | 'takeoff' | 'land' | string
  clipName?: string
  clipTime?: number
  strokePhase?: number // +1 downstroke, -1 upstroke, 0 glide
  elapsedTime?: number
}

export function dynamicLegController(
  leftLegBones: readonly Object3D[],
  rightLegBones: readonly Object3D[],
  state: LegsState,
  inputs: LegInputs,
  dt: number,
): void {
  const clip = (inputs.clipName ?? '').toLowerCase()
  const isTakeoff = inputs.flightMode === 'takeoff' || clip.includes('takeoff')
  const isLand = inputs.flightMode === 'land' || clip.includes('land')
  const isWalk = clip.includes('walk') || (inputs.groundClearance < 0.5 && inputs.horizontalSpeed > 1.5)
  const isGroundRest =
    inputs.flightMode === 'ground' ||
    clip.includes('idle') ||
    clip.includes('rest') ||
    (inputs.groundClearance < 0.5 && inputs.horizontalSpeed <= 1.5)

  // 1. TAKEOFF MODE: Crouch load -> Explosive push-off toe drive -> Airborne flight tuck
  if (isTakeoff) {
    const t = inputs.clipTime ?? 0
    let thighPitch = 0
    let calfPitch = 0
    let footPitch = 0
    let toesPitch = 0

    if (t <= LEG_CONFIG.TAKEOFF_CROUCH_END) {
      // Crouch loading: legs compress, claws grip floor
      const p = Math.min(1, Math.max(0, t / LEG_CONFIG.TAKEOFF_CROUCH_END))
      const s = p * p * (3 - 2 * p)
      thighPitch = 0.12 * s
      calfPitch = -0.15 * s
      footPitch = 0.08 * s
      toesPitch = 0.14 * s
    } else if (t <= LEG_CONFIG.TAKEOFF_PUSHOFF_END) {
      // Explosive push-off: thighs/calves/feet extend, toes drive down into ground
      const p = (t - LEG_CONFIG.TAKEOFF_CROUCH_END) / (LEG_CONFIG.TAKEOFF_PUSHOFF_END - LEG_CONFIG.TAKEOFF_CROUCH_END)
      const impulse = Math.sin(p * Math.PI)
      thighPitch = -0.22 * impulse
      calfPitch = 0.26 * impulse
      footPitch = -0.34 * impulse
      toesPitch = -0.38 * impulse
    } else if (t <= LEG_CONFIG.TAKEOFF_RETRACT_END) {
      // Airborne climb: retract toes and legs into aerodynamic flight tuck
      const p = (t - LEG_CONFIG.TAKEOFF_PUSHOFF_END) / (LEG_CONFIG.TAKEOFF_RETRACT_END - LEG_CONFIG.TAKEOFF_PUSHOFF_END)
      const s = p * p * (3 - 2 * p)
      toesPitch = -0.32 * s
    } else {
      toesPitch = -0.32
    }

    const applyTakeoffLeg = (bones: readonly Object3D[]) => {
      if (bones[0]) applyBoneOffset(bones[0], thighPitch, 0, 0)
      if (bones[1]) applyBoneOffset(bones[1], calfPitch, 0, 0)
      if (bones[2]) applyBoneOffset(bones[2], footPitch, 0, 0)
      if (bones[3]) applyBoneOffset(bones[3], toesPitch, 0, 0)
    }
    applyTakeoffLeg(leftLegBones)
    applyTakeoffLeg(rightLegBones)
    return
  }

  // 2. LANDING MODE: Air-brake flare reach -> Touchdown impact cushion -> Quadrupedal settle
  if (isLand) {
    const t = inputs.clipTime ?? 0
    let thighPitch = 0
    let calfPitch = 0
    let footPitch = 0
    let toesPitch = 0

    if (t <= 0.6) {
      // Flight approach
      toesPitch = -0.25
    } else if (t <= 2.0) {
      // Touchdown reach and talon flare
      const p = (t - 0.6) / 1.4
      const s = p * p * (3 - 2 * p)
      thighPitch = -0.28 * s
      calfPitch = 0.22 * s
      footPitch = -0.25 * s
      toesPitch = 0.38 * s // Forward splay
    } else if (t <= 2.6) {
      // Touchdown impact absorption
      const p = (t - 2.0) / 0.6
      const impact = Math.sin(p * Math.PI)
      thighPitch = 0.18 * impact
      calfPitch = -0.20 * impact
      footPitch = 0.10 * impact
      toesPitch = 0.15 * (1 - p) // Ground grip
    }

    const applyLandLeg = (bones: readonly Object3D[]) => {
      if (bones[0]) applyBoneOffset(bones[0], thighPitch, 0, 0)
      if (bones[1]) applyBoneOffset(bones[1], calfPitch, 0, 0)
      if (bones[2]) applyBoneOffset(bones[2], footPitch, 0, 0)
      if (bones[3]) applyBoneOffset(bones[3], toesPitch, 0, 0)
    }
    applyLandLeg(leftLegBones)
    applyLandLeg(rightLegBones)
    return
  }

  // 3. GROUND WALK GAIT ARTICULATION
  if (isWalk) {
    const omega = (Math.PI * 2) / LEG_CONFIG.WALK_CYCLE_DURATION
    state.left.phase = (state.left.phase + dt * omega) % (Math.PI * 2)
    state.right.phase = (state.right.phase + dt * omega) % (Math.PI * 2)

    const phiL = inputs.clipTime !== undefined ? (inputs.clipTime * omega) % (Math.PI * 2) : state.left.phase
    const phiR = (phiL + Math.PI) % (Math.PI * 2)

    const computeWalkLeg = (phi: number) => {
      const s = Math.sin(phi)
      const c = Math.cos(phi)
      let thighP = 0
      let calfP = 0
      let footP = 0
      let toeP = 0

      if (s > 0) {
        // Swing phase (foot lifted off ground)
        if (c > 0) {
          // Early swing: foot drops, toes curl under gravity
          toeP = -0.15 * s
          footP = -0.08 * s
          calfP = 0.06 * s
          thighP = 0.05 * s
        } else {
          // Late swing: forward reach, toes flare / dorsiflex to clear floor
          toeP = 0.16 * s
          footP = 0.06 * s
          calfP = -0.04 * s
          thighP = -0.05 * s
        }
      } else {
        // Stance phase (foot on ground)
        const absS = Math.abs(s)
        if (c < 0) {
          // Heel/claw strike cushion
          toeP = 0.12 * absS
          footP = 0.04 * absS
          calfP = -0.05 * absS
          thighP = 0.04 * absS
        } else {
          // Push-off drive
          toeP = -0.16 * absS
          footP = -0.10 * absS
          calfP = 0.08 * absS
          thighP = -0.06 * absS
        }
      }
      return { thighP, calfP, footP, toeP }
    }

    const lWalk = computeWalkLeg(phiL)
    const rWalk = computeWalkLeg(phiR)

    const applyWalkOffsets = (bones: readonly Object3D[], offsets: ReturnType<typeof computeWalkLeg>) => {
      if (bones[0]) applyBoneOffset(bones[0], offsets.thighP, 0, 0)
      if (bones[1]) applyBoneOffset(bones[1], offsets.calfP, 0, 0)
      if (bones[2]) applyBoneOffset(bones[2], offsets.footP, 0, 0)
      if (bones[3]) applyBoneOffset(bones[3], offsets.toeP, 0, 0)
    }
    applyWalkOffsets(leftLegBones, lWalk)
    applyWalkOffsets(rightLegBones, rWalk)
    return
  }

  // 4. GROUND REST / IDLE POSTURE & COMPLIANCE
  if (isGroundRest) {
    // Preserve exact baseline 0 for static mock rig without active clip/mode
    if (
      inputs.horizontalSpeed === 0 &&
      inputs.groundClearance < 0.5 &&
      !inputs.clipName &&
      inputs.flightMode !== 'ground'
    ) {
      return
    }

    const t = inputs.elapsedTime ?? inputs.clipTime ?? 0
    const breath = Math.sin(t * Math.PI * 2 * LEG_CONFIG.BREATH_FREQUENCY)
    const thighP = 0.016 * breath
    const calfP = -0.020 * breath
    const footP = 0.008 * breath
    const toesP = 0.045 + 0.015 * Math.cos(t * 0.6) // Active claw grip into ground
    const weightShiftYaw = 0.010 * Math.sin(t * Math.PI * 2 * 0.12)

    const applyRestLeg = (bones: readonly Object3D[], yawSign: number) => {
      if (bones[0]) applyBoneOffset(bones[0], thighP, 0, 0)
      if (bones[1]) applyBoneOffset(bones[1], calfP, 0, 0)
      if (bones[2]) applyBoneOffset(bones[2], footP, weightShiftYaw * yawSign, 0)
      if (bones[3]) applyBoneOffset(bones[3], toesP, 0, 0)
    }
    applyRestLeg(leftLegBones, 1.0)
    applyRestLeg(rightLegBones, -1.0)
    return
  }

  // 5. AIRBORNE FLIGHT: CENTRIFUGAL SWING, FLAP SUSPENSION, AIR BRAKING & TOUCHDOWN EXTENSION
  // Air-brake check on rapid deceleration
  let airBrake = 0
  if (inputs.acceleration < LEG_CONFIG.DECEL_THRESHOLD) {
    const intensity = Math.min(1, Math.abs(inputs.acceleration - LEG_CONFIG.DECEL_THRESHOLD) / 10)
    airBrake = intensity * LEG_CONFIG.AIR_BRAKE_EXTENSION
  }

  // Pre-landing touchdown extension
  let landingPrep = 0
  if (inputs.groundClearance < LEG_CONFIG.LANDING_CLEARANCE_THRESHOLD && inputs.verticalSpeed < 0) {
    const proximity = 1 - inputs.groundClearance / LEG_CONFIG.LANDING_CLEARANCE_THRESHOLD
    landingPrep = proximity * LEG_CONFIG.LANDING_EXTENSION
  }

  const baseExtension = airBrake + landingPrep

  // Wingbeat flap suspension: downward inertial compliance on downstroke, tuck tighten on upstroke
  const stroke = inputs.strokePhase ?? 0
  let flapThighPitch = 0
  let flapCalfPitch = 0
  let flapFootPitch = 0
  let flapToesPitch = 0

  if (stroke > 0) {
    // Power downstroke: inertial downward suspension
    flapThighPitch = LEG_CONFIG.DOWNSTROKE_LEG_SUSPENSION * stroke
    flapCalfPitch = 0.035 * stroke
    flapFootPitch = -0.020 * stroke
    flapToesPitch = LEG_CONFIG.DOWNSTROKE_TOE_SUSPENSION * stroke
  } else if (stroke < 0) {
    // Recovery upstroke: tuck tighten against belly
    const absStroke = Math.abs(stroke)
    flapThighPitch = LEG_CONFIG.UPSTROKE_TUCK_TIGHTEN * absStroke
    flapToesPitch = -0.020 * absStroke
  }

  // Centrifugal turn swing (outer leg swings outward more)
  const isTurningLeft = inputs.turnRate > 0
  const leftTurnScale = isTurningLeft ? 1.0 : LEG_CONFIG.ASYMMETRY_FACTOR
  const rightTurnScale = isTurningLeft ? LEG_CONFIG.ASYMMETRY_FACTOR : 1.0

  const updateFlightLeg = (legState: LegState, bones: readonly Object3D[], turnScale: number) => {
    legState.smoothedTurnRate += (inputs.turnRate - legState.smoothedTurnRate) * Math.min(1, 8.0 * dt)
    legState.phase = (legState.phase + dt * LEG_CONFIG.PENDULUM_FREQUENCY * Math.PI * 2) % (Math.PI * 2)

    const turnSwing = legState.smoothedTurnRate * turnScale * LEG_CONFIG.MAX_PENDULUM_SWING
    const weights = [
      LEG_CONFIG.BONE_WEIGHTS.thigh,
      LEG_CONFIG.BONE_WEIGHTS.calf,
      LEG_CONFIG.BONE_WEIGHTS.foot,
      LEG_CONFIG.BONE_WEIGHTS.toes,
    ]
    const flapPitches = [flapThighPitch, flapCalfPitch, flapFootPitch, flapToesPitch]

    for (let i = 0; i < Math.min(bones.length, weights.length); i++) {
      const bone = bones[i]
      if (!bone) continue
      const w = weights[i] ?? 0.2
      let pitch = baseExtension * w + (flapPitches[i] ?? 0)
      const yaw = turnSwing * w

      // Specific toe articulation:
      // In dive/speed, toes curl backward (-pitch) into streamlined talon tuck.
      // In landing prep, toes flare forward (+pitch) to cushion touchdown impact.
      if (i === 3) {
        if (inputs.flightMode === 'dive' || inputs.horizontalSpeed > 22) {
          pitch -= 0.25
        } else if (landingPrep > 0.02) {
          pitch += landingPrep * 0.35
        }
      }

      applyBoneOffset(bone, pitch, yaw, 0)
    }
  }

  updateFlightLeg(state.left, leftLegBones, leftTurnScale)
  updateFlightLeg(state.right, rightLegBones, rightTurnScale)
}

