import { Quaternion, type Object3D } from 'three'
import {
  HEAD_BONE,
  JAW_BONE,
  LEFT_LEG_CHAIN,
  NECK_CHAIN,
  RIGHT_LEG_CHAIN,
  SPINE_CHAIN,
  TAIL_CHAIN,
  LEFT_WING_CHAIN,
  RIGHT_WING_CHAIN,
  findBone,
  findChain,
} from './rigBones'
import { applyLegTuck } from './boneOffsets'
import {
  evaluateFlightLoopState,
  legTuckTarget,
  type FlightLoopState,
} from '../kinematics/flightPose'
import { calculatePhase, propagateFullBodyWave } from './spineWave'
import { createTailState, dynamicTailController, type TailState } from './tailController'
import { createLegsState, dynamicLegController, type LegsState } from './legPhysics'
import { createWingsState, dynamicWingController, type WingsState } from './wingRefinement'
import {
  createHeadNeckState,
  intelligentHeadNeckController,
  type GazeTarget,
  type HeadNeckState,
} from './gazeController'
import {
  captureClosedJawPose,
  sealFlightJaw,
  type ClosedJawPose,
} from './flightMouth'

export type FlightKinematics = WyvernFlightKinematics
export interface WyvernFlightKinematics {
  horizontalSpeed: number
  verticalSpeed: number
  acceleration?: number
  yaw: number
  turnRate: number
  pitch: number
  bank: number
  groundClearance?: number
  flightMode?: FlightLoopState | string
  isMouthActionActive?: boolean
  clipName?: string
  clipTime?: number
  wingStrokePhase?: number
}

export interface WyvernFlightRig {
  update(kinematics: WyvernFlightKinematics, gazeTarget: GazeTarget | null, dt: number): void
  reset(): void
}

export function createWyvernFlightRig(modelRoot: Object3D): WyvernFlightRig {
  const head = findBone(modelRoot, HEAD_BONE)
  const jaw = findBone(modelRoot, JAW_BONE)
  const neckBones = findChain(modelRoot, NECK_CHAIN)
  const spineBones = findChain(modelRoot, SPINE_CHAIN)
  const tailBones = findChain(modelRoot, TAIL_CHAIN)
  const leftLegBones = findChain(modelRoot, LEFT_LEG_CHAIN)
  const rightLegBones = findChain(modelRoot, RIGHT_LEG_CHAIN)
  const leftWingBones = findChain(modelRoot, LEFT_WING_CHAIN)
  const rightWingBones = findChain(modelRoot, RIGHT_WING_CHAIN)

  // Track base poses for all controlled bones to prevent rotational compounding
  // when tracks are static or when running without per-frame mixer resets.
  const allControlledBones: Object3D[] = [
    ...(head ? [head] : []),
    ...(jaw ? [jaw] : []),
    ...neckBones,
    ...spineBones,
    ...tailBones,
    ...leftLegBones,
    ...rightLegBones,
    ...leftWingBones,
    ...rightWingBones,
  ]
  const trackedBones = allControlledBones.map((bone) => ({
    bone,
    baseQuat: bone.quaternion.clone(),
    lastWritten: bone.quaternion.clone(),
    hasOffset: false,
  }))

  const tailState: TailState = createTailState()
  const legsState: LegsState = createLegsState()
  const wingsState: WingsState = createWingsState()
  const headNeckState: HeadNeckState = createHeadNeckState()
  let closedJawPose: ClosedJawPose | null = captureClosedJawPose(jaw)

  let currentFlightMode: FlightLoopState = 'cruise'
  let currentLegTuck = 0
  let elapsedTime = 0

  return {
    update(kinematics: WyvernFlightKinematics, gazeTarget: GazeTarget | null, dt: number): void {
      elapsedTime += dt

      // Restore baseline pose for bones where scene graph was not updated by an animation track
      for (const tb of trackedBones) {
        if (!tb.hasOffset) {
          tb.baseQuat.copy(tb.bone.quaternion)
        } else {
          const q = tb.bone.quaternion
          const lw = tb.lastWritten
          const diff =
            Math.abs(q.x - lw.x) + Math.abs(q.y - lw.y) + Math.abs(q.z - lw.z) + Math.abs(q.w - lw.w)
          if (diff < 1e-4) {
            tb.bone.quaternion.copy(tb.baseQuat)
          } else {
            tb.baseQuat.copy(tb.bone.quaternion)
          }
        }
      }

      // Capture bind jaw pose if not yet cached
      if (!closedJawPose && jaw) {
        closedJawPose = captureClosedJawPose(jaw)
      }

      // 1. Evaluate flight mode with hysteresis
      const rawMode = kinematics.flightMode as FlightLoopState | undefined
      currentFlightMode =
        (rawMode === 'cruise' ||
          rawMode === 'glide' ||
          rawMode === 'hover' ||
          rawMode === 'dive' ||
          rawMode === 'climb' ||
          rawMode === 'speed' ||
          rawMode === 'scout' ||
          rawMode === 'bankLeft' ||
          rawMode === 'bankRight')
          ? rawMode
          : evaluateFlightLoopState(
              currentFlightMode,
              kinematics.horizontalSpeed,
              kinematics.verticalSpeed,
              kinematics.turnRate,
            )

      // 2. Airspeed-driven leg tuck
      const groundClearance = kinematics.groundClearance ?? 20
      const isGroundContact = groundClearance < 0.5 || (kinematics.horizontalSpeed < 2 && groundClearance < 2.0)
      const isTakeoffPush =
        (kinematics.flightMode === 'takeoff' || kinematics.clipName === 'takeoff') &&
        (kinematics.clipTime ?? 0) < 1.4
      const effectiveGroundContact = isGroundContact || isTakeoffPush
      const targetTuck = effectiveGroundContact ? 0 : legTuckTarget(kinematics.horizontalSpeed, 18)
      currentLegTuck += (targetTuck - currentLegTuck) * Math.min(1, 5.0 * dt)
      if (effectiveGroundContact && Math.abs(currentLegTuck) < 0.005) {
        currentLegTuck = 0
      }
      applyLegTuck(leftLegBones, currentLegTuck)
      applyLegTuck(rightLegBones, currentLegTuck)

      // 3. Traveling spine & neck wave (airborne only; preserve authored ground spine/neck curves)
      const isGroundedMode = effectiveGroundContact || (rawMode as string | undefined) === 'ground'
      if (!isGroundedMode) {
        const phase = calculatePhase(elapsedTime, 2.5)
        propagateFullBodyWave(
          spineBones,
          neckBones,
          phase,
          kinematics.horizontalSpeed,
          kinematics.turnRate,
        )

        // 4. Dynamic tail counterweight & active rudder (airborne only; preserve authored ground tail wave)
        dynamicTailController(
          tailBones,
          tailState,
          {
            horizontalSpeed: kinematics.horizontalSpeed,
            verticalSpeed: kinematics.verticalSpeed,
            turnRate: kinematics.turnRate,
            bank: kinematics.bank,
            flightMode: currentFlightMode,
          },
          dt,
        )
      }

      // 5. Centrifugal leg physics, walk gait articulation & takeoff/landing
      dynamicLegController(
        leftLegBones,
        rightLegBones,
        legsState,
        {
          horizontalSpeed: kinematics.horizontalSpeed,
          verticalSpeed: kinematics.verticalSpeed,
          acceleration: kinematics.acceleration ?? 0,
          turnRate: kinematics.turnRate,
          groundClearance: kinematics.groundClearance ?? 20,
          flightMode: kinematics.flightMode ?? currentFlightMode,
          clipName: kinematics.clipName,
          clipTime: kinematics.clipTime,
          strokePhase: kinematics.wingStrokePhase,
          elapsedTime,
        },
        dt,
      )

      // 6. Dynamic wing turbulence & stoop fold
      dynamicWingController(
        leftWingBones,
        rightWingBones,
        wingsState,
        {
          horizontalSpeed: kinematics.horizontalSpeed,
          pitch: kinematics.pitch,
          flightMode: currentFlightMode,
          turnRate: kinematics.turnRate,
          groundClearance: kinematics.groundClearance ?? 20,
        },
        dt,
      )

      // 7. Intelligent gaze tracking with VOR stabilization
      intelligentHeadNeckController(
        head,
        neckBones,
        headNeckState,
        gazeTarget,
        kinematics.yaw,
        kinematics.pitch,
        kinematics.bank,
        {
          horizontalSpeed: kinematics.horizontalSpeed,
          verticalSpeed: kinematics.verticalSpeed,
          turnRate: kinematics.turnRate,
          flightMode: currentFlightMode,
          time: elapsedTime,
          isGroundedMode,
        },
        dt,
      )

      // 8. Flight jaw seal
      sealFlightJaw(jaw, closedJawPose, {
        isMouthActionActive: kinematics.isMouthActionActive ?? false,
        flightMode: currentFlightMode,
        horizontalSpeed: kinematics.horizontalSpeed,
      })

      // Record final pose after all procedural offsets
      for (const tb of trackedBones) {
        tb.lastWritten.copy(tb.bone.quaternion)
        tb.hasOffset = true
      }
    },

    reset(): void {
      for (const tb of trackedBones) {
        if (tb.hasOffset) {
          tb.bone.quaternion.copy(tb.baseQuat)
          tb.hasOffset = false
        }
      }
      tailState.swing = 0
      tailState.lift = 0
      tailState.smoothedTurnRate = 0
      tailState.smoothedBank = 0
      currentLegTuck = 0
      currentFlightMode = 'cruise'
    },
  }
}
