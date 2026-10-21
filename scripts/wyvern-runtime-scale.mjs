/**
 * Metres per rig unit, derived the way the runtime derives it.
 *
 * A rig's units are not a property of the rig. `normalizedClone`
 * (`src/scene/modelProcessor.ts:99`) rescales every loaded specimen by
 * `target / largestBindExtent`, so the same GLB is 5.8 m across in gameplay and
 * 8.4 m across in Flight Lab. Any tool that wants to talk about metres has to
 * pick a target and say which one it picked.
 *
 * Both audits previously hardcoded 0.0072 m/unit, citing
 * `src/sanctuary-studio/catalogData.ts:4697`. That line is the *tent's*
 * `importScale`, and it made every metre figure 5.4x too large on this asset.
 * Rig units are the honest primary unit; metres are a convenience that has to
 * carry its target with it.
 */

import { Vector3 } from 'three'

/** `TARGET_SIZE` in `src/game/playerWyvernModel.ts:30`. Gameplay scale. */
export const PLAYER_TARGET_SIZE = 5.8

/** `targetSize` for every v2 specimen in `src/flight-lab/catalog.ts`. */
export const FLIGHT_LAB_TARGET_SIZE = 8.4

/**
 * Bounds of the skinned bind pose, in rig units.
 *
 * Matches `measureBounds` in `src/scene/modelProcessor.ts`: the bind-space
 * vertex is skinned by `boneWorld x boneInverse` and accumulated per weight.
 * Only the extent is needed, so this walks every vertex rather than a stride.
 *
 * The `min` is load-bearing beyond the extent: `normalizedClone` grounds a
 * specimen by subtracting `bounds.min.y`, so this is the height the runtime
 * treats as "the floor" -- measured once, on the bind pose, for every clip.
 *
 * @param {Array<import('three').SkinnedMesh>} meshes
 */
export function bindBounds(meshes) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  // `applyBoneTransform` writes back through Vector3.copy, so a plain object
  // will not do.
  const vertex = new Vector3()
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position
    for (let index = 0; index < position.count; index += 1) {
      // applyBoneTransform mutates in place and needs the bind vertex in hand.
      vertex.fromBufferAttribute(position, index)
      mesh.applyBoneTransform(index, vertex)
      const world = mesh.matrixWorld.elements
      const x = world[0] * vertex.x + world[4] * vertex.y + world[8] * vertex.z + world[12]
      const y = world[1] * vertex.x + world[5] * vertex.y + world[9] * vertex.z + world[13]
      const z = world[2] * vertex.x + world[6] * vertex.y + world[10] * vertex.z + world[14]
      if (x < min[0]) min[0] = x
      if (y < min[1]) min[1] = y
      if (z < min[2]) min[2] = z
      if (x > max[0]) max[0] = x
      if (y > max[1]) max[1] = y
      if (z > max[2]) max[2] = z
    }
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  return {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
    extent: Number.isFinite(extent) && extent > 0 ? extent : 1,
  }
}

/**
 * Largest extent of the skinned bind pose, in rig units.
 *
 * @param {Array<import('three').SkinnedMesh>} meshes
 * @returns {number} rig units; never zero
 */
export function largestBindExtent(meshes) {
  return bindBounds(meshes).extent
}

/**
 * @param {number} extent largest bind extent, rig units
 * @param {number} targetSize the display size a consumer normalises to, metres
 * @returns {number} metres per rig unit
 */
export function metresPerUnit(extent, targetSize) {
  return targetSize / extent
}
