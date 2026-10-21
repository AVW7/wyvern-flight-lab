import { clamp, damp } from '../../core/math/vec'

export const MAX_PITCH = 0.38
export const MAX_BANK = 0.58
export const BANK_FROM_YAW_RATE = 0.65
export const MIN_PITCH_SPEED = 10

export const BANK_ANIMATION_ENTER = 0.14
export const BANK_ANIMATION_EXIT = 0.07

export const HOVER_ENTER_SPEED = 2.0
export const HOVER_EXIT_SPEED = 4.0

export const DIVE_ENTER_ANGLE = 0.40
export const DIVE_EXIT_ANGLE = 0.26
export const DIVE_ENTER_SPEED = 9.0
export const DIVE_EXIT_SPEED = 7.0

export const CLIMB_ENTER_ANGLE = 0.35
export const CLIMB_EXIT_ANGLE = 0.22
export const CLIMB_ENTER_SPEED = 6.0
export const CLIMB_EXIT_SPEED = 4.5

export const SPEED_ENTER_RATIO = 1.20
export const SPEED_EXIT_RATIO = 1.05

export const LEG_TUCK_RELEASE = -0.40
export const LEG_TUCK_MAX = 0.45
export const BOOST_ENTER_RATIO = 0.80
export const BOOST_EXIT_RATIO = 0.65

export type FlightLoopState =
  | 'cruise'
  | 'scout'
  | 'speed'
  | 'glide'
  | 'dive'
  | 'climb'
  | 'bankLeft'
  | 'bankRight'
  | 'hover'

export interface FlightPose {
  pitch: number
  bank: number
}

export interface HeadNeckPose {
  pitch: number
  yaw: number
}

export function flightPoseTargets(
  horizontalSpeed: number,
  verticalSpeed: number,
  yawRate: number,
): FlightPose {
  const pitchTarget =
    horizontalSpeed < MIN_PITCH_SPEED
      ? 0
      : clamp(-Math.atan2(verticalSpeed, horizontalSpeed), -MAX_PITCH, MAX_PITCH)

  const bankTarget = clamp(yawRate * BANK_FROM_YAW_RATE, -MAX_BANK, MAX_BANK)

  return { pitch: pitchTarget, bank: bankTarget }
}

export function dampFlightPose(
  current: FlightPose,
  target: FlightPose,
  pitchRate: number,
  bankRate: number,
  dt: number,
): FlightPose {
  return {
    pitch: damp(current.pitch, target.pitch, pitchRate, dt),
    bank: damp(current.bank, target.bank, bankRate, dt),
  }
}

export function angleDelta(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2)
  if (diff > Math.PI) diff -= Math.PI * 2
  if (diff < -Math.PI) diff += Math.PI * 2
  return diff
}

export function legTuckTarget(speed: number, referenceSpeed: number): number {
  if (referenceSpeed <= 0) return 0
  const ratio = speed / referenceSpeed
  if (ratio <= 0.2) return LEG_TUCK_RELEASE
  if (ratio >= 1.0) return LEG_TUCK_MAX
  const t = (ratio - 0.2) / 0.8
  return LEG_TUCK_RELEASE + t * (LEG_TUCK_MAX - LEG_TUCK_RELEASE)
}

export function dampLegTuck(current: number, target: number, rate: number, dt: number): number {
  return damp(current, target, rate, dt)
}

export function headNeckTargets(
  flightPitch: number,
  flightBank: number,
  yawRate: number,
): HeadNeckPose {
  return {
    pitch: clamp(-flightPitch * 0.6, -0.3, 0.3),
    yaw: clamp(yawRate * 0.4 - flightBank * 0.2, -0.4, 0.4),
  }
}

export function dampHeadNeckPose(
  current: HeadNeckPose,
  target: HeadNeckPose,
  rate: number,
  dt: number,
): HeadNeckPose {
  return {
    pitch: damp(current.pitch, target.pitch, rate, dt),
    yaw: damp(current.yaw, target.yaw, rate, dt),
  }
}

export function evaluateFlightLoopState(
  currentState: FlightLoopState,
  horizontalSpeed: number,
  verticalSpeed: number,
  yawRate: number,
  referenceSpeed = 18,
): FlightLoopState {
  const flightPathAngle = Math.atan2(Math.abs(verticalSpeed), Math.max(horizontalSpeed, 0.001))
  const speedRatio = referenceSpeed > 0 ? horizontalSpeed / referenceSpeed : 1

  // Hover hysteresis
  if (currentState === 'hover') {
    if (horizontalSpeed > HOVER_EXIT_SPEED) return 'cruise'
    return 'hover'
  }
  if (horizontalSpeed < HOVER_ENTER_SPEED && Math.abs(verticalSpeed) < 3.0) {
    return 'hover'
  }

  // Dive hysteresis
  if (currentState === 'dive') {
    if (verticalSpeed > -1 || flightPathAngle < DIVE_EXIT_ANGLE || horizontalSpeed < DIVE_EXIT_SPEED) {
      return 'cruise'
    }
    return 'dive'
  }
  if (verticalSpeed < -4 && flightPathAngle >= DIVE_ENTER_ANGLE && horizontalSpeed >= DIVE_ENTER_SPEED) {
    return 'dive'
  }

  // Climb hysteresis
  if (currentState === 'climb') {
    if (verticalSpeed < 1 || flightPathAngle < CLIMB_EXIT_ANGLE || horizontalSpeed < CLIMB_EXIT_SPEED) {
      return 'cruise'
    }
    return 'climb'
  }
  if (verticalSpeed > 4 && flightPathAngle >= CLIMB_ENTER_ANGLE && horizontalSpeed >= CLIMB_ENTER_SPEED) {
    return 'climb'
  }

  // Bank turns
  const bankMagnitude = Math.abs(yawRate * BANK_FROM_YAW_RATE)
  if (currentState === 'bankLeft' || currentState === 'bankRight') {
    if (bankMagnitude < BANK_ANIMATION_EXIT) return 'cruise'
    return yawRate > 0 ? 'bankLeft' : 'bankRight'
  }
  if (bankMagnitude >= BANK_ANIMATION_ENTER) {
    return yawRate > 0 ? 'bankLeft' : 'bankRight'
  }

  // Speed sprint
  if (currentState === 'speed') {
    if (speedRatio < SPEED_EXIT_RATIO) return 'cruise'
    return 'speed'
  }
  if (speedRatio >= SPEED_ENTER_RATIO) {
    return 'speed'
  }

  return 'cruise'
}
