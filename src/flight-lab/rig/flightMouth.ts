import { Quaternion, type Object3D } from 'three'

export interface ClosedJawPose {
  quaternion: Quaternion
}

export function captureClosedJawPose(jawBone: Object3D | null): ClosedJawPose | null {
  if (!jawBone) return null
  return {
    quaternion: jawBone.quaternion.clone(),
  }
}

export function sealFlightJaw(
  jawBone: Object3D | null,
  closedPose: ClosedJawPose | null,
  isMouthActionActive: boolean,
): void {
  if (!jawBone || !closedPose || isMouthActionActive) return
  jawBone.quaternion.copy(closedPose.quaternion)
}
