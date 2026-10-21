import type { Object3D } from 'three'
import { applyBoneOffset } from './boneOffsets'

export const SPINE_WAVE_CONFIG = {
  baseFrequency: 2.5,
  phaseDelayPerBone: 0.12,
  minAmplitude: 0.02,
  maxAmplitude: 0.08,
  speedForMaxAmplitude: 30,
  speedForMinAmplitude: 5,
  turnAsymmetryFactor: 0.15,
  // Spine1 (0.02) keeps leg root planting stable while Spine2 and Spine3 articulate
  spineWeights3: [0.02, 0.22, 0.32],
  // V2 92-bone rig uses a 2-bone neck chain (Neck1, Neck2) matching boneOffsets.ts
  neckWeights2: [0.45, 0.55],
  neckWeights: [0.20, 0.25, 0.30, 0.25],
} as const

export function propagateSpineWave(
  spineBones: Object3D[],
  basePhase: number,
  horizontalSpeed: number,
  turnRate: number,
  options?: Partial<typeof SPINE_WAVE_CONFIG>,
): void {
  if (spineBones.length === 0) return

  const config = { ...SPINE_WAVE_CONFIG, ...options }
  const speedRange = config.speedForMaxAmplitude - config.speedForMinAmplitude
  const speedNormalized = Math.max(
    0,
    Math.min(1, (horizontalSpeed - config.speedForMinAmplitude) / speedRange),
  )
  const amplitude =
    config.minAmplitude + (config.maxAmplitude - config.minAmplitude) * speedNormalized
  const weights =
    spineBones.length === 3 ? config.spineWeights3 : [0.08, 0.18, 0.25, 0.30, 0.19]

  for (let i = 0; i < spineBones.length; i++) {
    const bone = spineBones[i]
    if (!bone) continue

    const bonePhase = (basePhase - i * config.phaseDelayPerBone) % 1
    const phaseRad = bonePhase * Math.PI * 2
    const baseWave = Math.sin(phaseRad)
    const asymmetry = turnRate * config.turnAsymmetryFactor
    const weight = weights[i] ?? 0.2
    const yawOffset = (baseWave + asymmetry) * amplitude * weight

    applyBoneOffset(bone, 0, yawOffset, 0)
  }
}

export function propagateFullBodyWave(
  spineBones: Object3D[],
  neckBones: Object3D[],
  basePhase: number,
  horizontalSpeed: number,
  turnRate: number,
): void {
  propagateSpineWave(spineBones, basePhase, horizontalSpeed, turnRate)

  if (neckBones.length > 0) {
    const config = SPINE_WAVE_CONFIG
    const speedRange = config.speedForMaxAmplitude - config.speedForMinAmplitude
    const speedNormalized = Math.max(
      0,
      Math.min(1, (horizontalSpeed - config.speedForMinAmplitude) / speedRange),
    )
    const amplitude = (config.minAmplitude + (config.maxAmplitude - config.minAmplitude) * speedNormalized) * 0.7
    const neckWeights =
      neckBones.length === 2 ? config.neckWeights2 : config.neckWeights

    for (let i = 0; i < neckBones.length; i++) {
      const bone = neckBones[i]
      if (!bone) continue
      const bonePhase = (basePhase + (neckBones.length - i) * config.phaseDelayPerBone) % 1
      const yawOffset = Math.sin(bonePhase * Math.PI * 2) * amplitude * (neckWeights[i] ?? 0.25)
      applyBoneOffset(bone, 0, yawOffset, 0)
    }
  }
}

export function calculatePhase(
  currentTime: number,
  baseFrequency: number,
  speedMultiplier = 1,
): number {
  return (currentTime * baseFrequency * speedMultiplier) % 1
}
