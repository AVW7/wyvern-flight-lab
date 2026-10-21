/**
 * Ground-contact measures for an exported wyvern clip.
 *
 * Split out of `validate-wyvern-clips.mjs` so both measures can be exercised
 * without loading a 5.7 MB GLB: the gate spawns a subprocess per mutant, and a
 * unit test that has to parse meshopt geometry first costs seconds it does not
 * need to spend. The pure parts live here; the sampler and the meshes stay in
 * the gate.
 */

import { Vector3 } from 'three'

/**
 * Canonical ground contact plane in rig units (glTF +Y up / Blender +Z up),
 * measured directly from the skinned footpad, toe, and wing-knuckle vertices
 * in grounded locomotion (`idle`, `walk`, `takeoff`) rather than bone heads.
 */
export const CANONICAL_GROUND_CONTACT_PLANE_Y = -184

/**
 * Peak-to-peak translation authored on a joint, in rig units.
 *
 * The magnitude is the diagonal of the three per-axis ranges, not the largest
 * axis: a joint that drifts 0.4 units on each of three axes has moved 0.69
 * units, and a budget expressed on the largest axis alone would let it pass a
 * 0.5-unit limit.
 *
 * Range, not start-to-end displacement. Those differ on exactly the clips this
 * matters for: `walk` returns to its first pose, so its displacement is 0 while
 * the joint travels 227 rig units mid-stride.
 *
 * @param {{ tracks: Array<{ name: string, values: ArrayLike<number> }> }} clip
 * @param {string} boneName
 * @returns {number} rig units; 0 when the joint has no translation track
 */
export function jointTranslationRange(clip, boneName) {
  const track = clip.tracks.find(candidate => candidate.name === `${boneName}.position`)
  if (!track) return 0
  const ranges = [0, 1, 2].map((axis) => {
    let minimum = Infinity
    let maximum = -Infinity
    for (let offset = axis; offset < track.values.length; offset += 3) {
      const value = track.values[offset]
      if (value < minimum) minimum = value
      if (value > maximum) maximum = value
    }
    return maximum - minimum
  })
  return Math.hypot(...ranges)
}

/**
 * Lowest world Y of the skinned foot surface over the clip, in rig units.
 *
 * Skinned, not the foot bones' own positions: a bone is a joint *inside* the
 * mesh, so the surface sits a pad's thickness below it and that gap changes
 * with the pose. `applyBoneTransform` reads `skeleton.bones[i].matrixWorld`
 * directly, so a `poseAt` that refreshes world matrices is all the preparation
 * this needs -- no renderer, and no `skeleton.update()`.
 *
 * @param {{
 *   poseAt: (time: number) => void,
 *   footMeshes: Array<{ mesh: import('three').SkinnedMesh, indices: number[] }>,
 *   duration: number,
 *   frames: number,
 * }} options
 * @returns {number} rig units relative to the scene origin
 */
export function footSurfaceHeight({ poseAt, footMeshes, duration, frames }) {
  const vertex = new Vector3()
  let lowest = Infinity
  for (let frame = 0; frame < frames; frame += 1) {
    // Exact endpoints, so a pose held only at t=duration is not missed by a
    // grid that stops one step short of it.
    poseAt(frames === 1 ? 0 : (frame / (frames - 1)) * duration)
    for (const { mesh, indices } of footMeshes) {
      const position = mesh.geometry.attributes.position
      for (const index of indices) {
        vertex.fromBufferAttribute(position, index)
        mesh.applyBoneTransform(index, vertex)
        vertex.applyMatrix4(mesh.matrixWorld)
        if (vertex.y < lowest) lowest = vertex.y
      }
    }
  }
  return lowest
}

/**
 * Lowest world Y of the skinned wing-knuckle surface (`WingWrist` / `WingHand`)
 * over the clip, in rig units.
 */
export function wingKnuckleSurfaceHeight({ poseAt, knuckleMeshes, duration, frames }) {
  return footSurfaceHeight({ poseAt, footMeshes: knuckleMeshes, duration, frames })
}

/**
 * Measures vertical floor-lock jitter on planted toe/foot joints during their
 * lowest stance window across a gait cycle.
 */
export function stanceVerticalJitter({
  poseAt,
  bone,
  duration,
  frames = 48,
  stanceFraction = 0.25,
}) {
  const pos = new Vector3()
  const heights = []
  for (let i = 0; i < frames; i += 1) {
    poseAt(frames === 1 ? 0 : (i / (frames - 1)) * duration)
    bone.getWorldPosition(pos)
    heights.push(pos.y)
  }
  const sorted = [...heights].sort((a, b) => a - b)
  const count = Math.max(2, Math.floor(frames * stanceFraction))
  const stanceSamples = sorted.slice(0, count)
  return stanceSamples[stanceSamples.length - 1] - stanceSamples[0]
}
