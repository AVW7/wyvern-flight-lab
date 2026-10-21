import { Vector3, type Object3D } from 'three'
import { clamp, damp } from '../../core/math/vec'
import type { FlightLoopState } from '../kinematics/flightPose'
import { applyBoneOffset, applyNeckOffset, holdStreamlinedHeadPose } from './boneOffsets'

export const LOOKAHEAD_SECONDS = 0.15

export const GAZE_PRIORITY_WEIGHTS = {
  prey: 1.0,
  threat: 0.85,
  waypoint: 0.6,
  player: 0.5,
  neighbor: 0.35,
  horizon: 0.2,
} as const

export interface GazeTarget {
  position: Vector3 | null
  velocity?: Vector3 | null
  urgency: number
  type: keyof typeof GAZE_PRIORITY_WEIGHTS
}

export interface FlightContext {
  horizontalSpeed: number
  verticalSpeed: number
  turnRate: number
  flightMode: FlightLoopState
  time: number
}

export interface HeadNeckState {
  neckPitch: number
  neckYaw: number
  headPitch: number
  headYaw: number
  headRoll: number
}

const _headWorldPos = new Vector3()
const _targetWorldPos = new Vector3()
const _toTarget = new Vector3()

export function createHeadNeckState(): HeadNeckState {
  return {
    neckPitch: 0,
    neckYaw: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
  }
}

export function selectGazeTarget(candidates: readonly GazeTarget[]): GazeTarget | null {
  let best: GazeTarget | null = null
  let bestScore = -Infinity

  for (const candidate of candidates) {
    if (!candidate.position) continue
    const priorityWeight = GAZE_PRIORITY_WEIGHTS[candidate.type] ?? 0.2
    const score = clamp(candidate.urgency, 0, 1) * priorityWeight
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}

export function intelligentHeadNeckController(
  headBone: Object3D | null,
  neckBones: readonly Object3D[],
  state: HeadNeckState,
  gazeTarget: GazeTarget | null,
  bodyYaw: number,
  bodyPitch: number,
  bodyBank: number,
  context: FlightContext,
  dt: number,
): void {
  // If diving at high speed without a specific target, lock streamlined head pose
  if (context.flightMode === 'dive' && (!gazeTarget || gazeTarget.type === 'horizon')) {
    holdStreamlinedHeadPose(headBone)
    for (const neck of neckBones) {
      applyBoneOffset(neck, 0, 0, 0)
    }
    return
  }

  let targetPitch = 0
  let targetYaw = 0

  if (gazeTarget?.position && headBone) {
    headBone.getWorldPosition(_headWorldPos)
    _targetWorldPos.copy(gazeTarget.position)
    if (gazeTarget.velocity) {
      _targetWorldPos.addScaledVector(gazeTarget.velocity, LOOKAHEAD_SECONDS)
    }
    _toTarget.copy(_targetWorldPos).sub(_headWorldPos)

    // Desired look yaw relative to body forward
    const lookYaw = Math.atan2(_toTarget.x, _toTarget.z)
    let deltaYaw = lookYaw - bodyYaw
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2

    const flatDist = Math.hypot(_toTarget.x, _toTarget.z)
    const lookPitch = -Math.atan2(_toTarget.y, Math.max(0.1, flatDist))
    const deltaPitch = lookPitch - bodyPitch

    targetYaw = clamp(deltaYaw, -0.65, 0.65)
    targetPitch = clamp(deltaPitch, -0.45, 0.45)
  } else {
    // Lead into turns slightly when free-flying
    targetYaw = clamp(context.turnRate * 0.35, -0.4, 0.4)
    targetPitch = clamp(-bodyPitch * 0.5, -0.3, 0.3)
  }

  // Vestibulo-ocular reflex: head rolls to oppose steep body bank
  const targetRoll = clamp(-bodyBank * 0.4, -0.3, 0.3)

  // Tracking damping speed scales with target urgency and biological priority
  const priorityWeight = gazeTarget ? (GAZE_PRIORITY_WEIGHTS[gazeTarget.type] ?? 0.5) : 0.5
  const urgency = clamp((gazeTarget?.urgency ?? 0.5) * (0.5 + 0.5 * priorityWeight), 0, 1)
  const trackingRate = 4.0 + urgency * 6.0

  state.headPitch = damp(state.headPitch, targetPitch * 0.6, trackingRate, dt)
  state.headYaw = damp(state.headYaw, targetYaw * 0.6, trackingRate, dt)
  state.headRoll = damp(state.headRoll, targetRoll, trackingRate, dt)

  state.neckPitch = damp(state.neckPitch, targetPitch * 0.4, trackingRate * 0.8, dt)
  state.neckYaw = damp(state.neckYaw, targetYaw * 0.4, trackingRate * 0.8, dt)

  // Apply to head and progressive neck cascade ([0.40, 0.60] pitch, [0.45, 0.55] yaw)
  if (headBone) {
    applyBoneOffset(headBone, state.headPitch, state.headYaw, state.headRoll)
  }

  if (neckBones.length === 2) {
    applyNeckOffset(neckBones, state.neckPitch, state.neckYaw)
  } else if (neckBones.length > 0) {
    const perBonePitch = state.neckPitch / neckBones.length
    const perBoneYaw = state.neckYaw / neckBones.length
    for (const neck of neckBones) {
      applyBoneOffset(neck, perBonePitch, perBoneYaw, 0)
    }
  }
}
