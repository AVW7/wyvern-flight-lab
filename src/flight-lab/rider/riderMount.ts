/**
 * Rider mount math.
 *
 * The rider is a separate GLB driven as a world-space follower of the wyvern's
 * Spine3 joint. It is deliberately NOT a child of Spine3:
 *
 *   - `scanSeam` walks the animated model's hierarchy, and a rider inside it
 *     would be sampled as wyvern geometry;
 *   - `normalizedClone` measures bounds to fit the camera, and a rider inside it
 *     would change `largestExtent` and therefore the whole scene scale;
 *   - the landmark cache keys off node names under the model root.
 *
 * Keeping it a sibling in `world` costs one matrix multiply per frame and
 * touches none of those.
 *
 * Scale is the subtle part. `normalizedClone` scales the wyvern by
 * `targetSize / largestExtent`, where the extent is the 6266-unit wingspan. The
 * rider is authored in the same wyvern units, so it must receive that same
 * factor and must never be normalised on its own.
 */

import { Matrix4, Vector3, Quaternion } from "three";
import { RIDER_MOUNT } from "./mountData";

export type OffsetLocal = readonly [number, number, number];

const scratchScale = new Vector3();
const scratchPosition = new Vector3();
const scratchQuaternion = new Quaternion();
const scratchUniform = new Vector3();
const scratchOffset = new Matrix4();

/**
 * Scale factor a `normalizedClone`d object received.
 *
 * Reads the object's own scale rather than recomputing `targetSize / extent`,
 * because that is the number the renderer actually uses. Throws on a
 * non-uniform scale, which would mean someone applied an extra transform and
 * the rider would be distorted in a way that is hard to spot on screen.
 */
export function uniformScaleOf(object: { matrixWorld: Matrix4 }): number {
  object.matrixWorld.decompose(new Vector3(), new Quaternion(), scratchScale);
  const { x, y, z } = scratchScale;
  const spread = Math.max(x, y, z) - Math.min(x, y, z);
  if (spread > Math.abs(x) * 1e-4) {
    throw new Error(`rider mount needs a uniform scale, got ${x} ${y} ${z}`);
  }
  return x;
}

/**
 * World matrix for the rider's root.
 *
 *   result = Compose(spine3World.position, spine3World.quaternion, uniformScale)
 *          * Translate(offsetLocal)
 *
 * `offsetLocal` is in Spine3's own frame (see `mountData.ts`), so the rider
 * leans and rolls with the spine for free.
 *
 * The scale is the subtle part. `spine3.matrixWorld` ALREADY carries the
 * wyvern's normalisation factor, because Spine3 is a child of the normalised
 * model. Multiplying by `S(uniformScale)` on top of that applies it twice and
 * shrinks the rider to 1/670 of its size -- it renders, it animates, and it is
 * invisible. So the parent's scale is deliberately discarded and replaced with
 * exactly one factor: the rider's geometry and its offset then each scale once.
 */
export function riderMatrix(
  spine3World: Matrix4,
  offsetLocal: OffsetLocal = RIDER_MOUNT.offsetLocal,
  uniformScale: number = 1,
  target: Matrix4 = new Matrix4()
): Matrix4 {
  spine3World.decompose(scratchPosition, scratchQuaternion, scratchScale);
  scratchUniform.set(uniformScale, uniformScale, uniformScale);
  target.compose(scratchPosition, scratchQuaternion, scratchUniform);
  return target.multiply(scratchOffset.makeTranslation(offsetLocal[0], offsetLocal[1], offsetLocal[2]));
}

/** True when the contract's joint actually exists under `root`. */
export function hasMountJoint(root: { getObjectByName(name: string): unknown }): boolean {
  return Boolean(root.getObjectByName(RIDER_MOUNT.joint));
}
