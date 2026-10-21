import { Quaternion, type Object3D } from 'three'

export interface ClosedJawPose {
  quaternion: Quaternion
}

export interface SealFlightJawContext {
  isMouthActionActive: boolean
  flightMode?: string
  horizontalSpeed?: number
}

// Clips whose static jaw offset from the closed bind pose exceeds this angle
// are treated as uncalibrated and sealed; sub-degree authored respiratory
// breathing (±0.2°..0.4°) always passes through.
const STATIC_JAW_SEAL_THRESHOLD_RAD = (2.0 * Math.PI) / 180

export function captureClosedJawPose(jawBone: Object3D | null): ClosedJawPose | null {
  if (!jawBone) return null
  return {
    quaternion: jawBone.quaternion.clone(),
  }
}

export function sealFlightJaw(
  jawBone: Object3D | null,
  closedPose: ClosedJawPose | null,
  context: boolean | SealFlightJawContext,
): void {
  if (!jawBone || !closedPose) return
  const { isMouthActionActive, flightMode, horizontalSpeed } =
    typeof context === 'boolean' ? { isMouthActionActive: context } : context
  if (isMouthActionActive) return

  const highSpeed =
    flightMode === 'dive' || flightMode === 'speed' || (horizontalSpeed ?? 0) > 12
  const q = jawBone.quaternion
  const c = closedPose.quaternion
  const dot = Math.abs(q.x * c.x + q.y * c.y + q.z * c.z + q.w * c.w)
  const deviation = 2 * Math.acos(Math.min(1, dot))
  if (!highSpeed && deviation <= STATIC_JAW_SEAL_THRESHOLD_RAD) return

  jawBone.quaternion.copy(closedPose.quaternion)
}
