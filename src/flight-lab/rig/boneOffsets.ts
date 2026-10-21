import { Quaternion, Vector3 } from 'three'
import type { Object3D } from 'three'

/**
 * Measured rig axes: Blender-authored rig bones run along local +Y.
 * Sagittal pitch is local X, turn yaw is local Z, longitudinal roll is local Y.
 */
export const LOCAL_PITCH = new Vector3(1, 0, 0)
export const LOCAL_YAW = new Vector3(0, 0, 1)
export const LOCAL_ROLL = new Vector3(0, 1, 0)

// Neutral forward skull pose relative to the final neck bone
const STREAMLINED_HEAD_ROTATION = new Quaternion(-0.0007635, 0.0000137, 0.0411221, 0.9991539)

// Module-level static scratch objects to eliminate per-frame allocations
const offset = new Quaternion()
const scratch = new Quaternion()

/**
 * Compose a pitch/yaw/roll offset onto whatever `bone.quaternion` already holds.
 * Angles are radians about the bone's measured local axes.
 */
export function applyBoneOffset(
  bone: Object3D | null | undefined,
  pitch: number,
  yaw = 0,
  roll = 0,
): void {
  if (!bone) return
  offset.setFromAxisAngle(LOCAL_PITCH, pitch)
  if (yaw !== 0) offset.multiply(scratch.setFromAxisAngle(LOCAL_YAW, yaw))
  if (roll !== 0) offset.multiply(scratch.setFromAxisAngle(LOCAL_ROLL, roll))
  bone.quaternion.multiply(offset)
}

const NECK_YAW_WEIGHTS = [0.45, 0.55] as const
const NECK_PITCH_WEIGHTS = [0.4, 0.6] as const

export function applyNeckOffset(neckBones: readonly Object3D[], pitch: number, yaw: number): void {
  if (neckBones.length === 0) return
  const len = Math.min(neckBones.length, NECK_YAW_WEIGHTS.length)
  for (let i = 0; i < len; i++) {
    const p = pitch * (NECK_PITCH_WEIGHTS[i] ?? 0.5)
    const y = yaw * (NECK_YAW_WEIGHTS[i] ?? 0.5)
    applyBoneOffset(neckBones[i], p, y, 0)
  }
}

/**
 * Hind leg tuck fold over thigh, calf, foot, and toes.
 * Thigh flexes up (+0.45), knee folds in (-0.65), foot extends back (+0.25),
 * toes curl backward into a compact talon tuck (-0.35) for streamlined flight.
 */
const LEG_TUCK_WEIGHTS = [0.45, -0.65, 0.25, -0.35] as const

export function applyLegTuck(legBones: readonly Object3D[], tuckAmount: number): void {
  const count = Math.min(legBones.length, LEG_TUCK_WEIGHTS.length)
  for (let i = 0; i < count; i++) {
    const angle = tuckAmount * (LEG_TUCK_WEIGHTS[i] ?? 0)
    applyBoneOffset(legBones[i], angle, 0, 0)
  }
}

export function holdStreamlinedHeadPose(headBone: Object3D | null | undefined): void {
  if (!headBone) return
  headBone.quaternion.copy(STREAMLINED_HEAD_ROTATION)
}
