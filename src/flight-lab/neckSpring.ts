/**
 * neckSpring.ts
 *
 * Spring-physics secondary motion for upper-body / neck / head bones.
 *
 * After AnimationMixer writes the authored keyframe pose each frame, this
 * module applies an exponential lag to the target bones so they exhibit
 * natural follow-through instead of instant mechanical snapping.
 *
 * Design notes:
 * - Runs entirely in the render loop; no setState, no React.
 * - Mutates bone.quaternion directly, which is the correct Three.js pattern.
 * - Per-bone lambda controls the lag feel (lower = more lag / organic).
 * - Safe to attach/detach across specimen swaps.
 */

import * as THREE from "three";

const SPRING_CONFIG = [
  // bone name,  lambda (higher = snappier, less lag)
  { name: "Spine3", lambda: 35 },
  { name: "Neck1",  lambda: 20 },
  { name: "Neck2",  lambda: 12 },
  { name: "Head",   lambda:  7 },
] as const;

interface BoneState {
  bone: THREE.Bone;
  lambda: number;
  /** Lagged quaternion — what we apply to the bone each frame */
  lagQuat: THREE.Quaternion;
}

export function createNeckSpring() {
  let boneStates: BoneState[] = [];
  let attached = false;

  /** Call once after a model is loaded to discover the target bones. */
  function attach(root: THREE.Object3D): void {
    detach();
    const byName = new Map<string, THREE.Bone>();
    root.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) byName.set(obj.name, obj as THREE.Bone);
    });

    for (const cfg of SPRING_CONFIG) {
      const bone = byName.get(cfg.name);
      if (!bone) continue;
      boneStates.push({
        bone,
        lambda: cfg.lambda,
        // Seed lag at the current rest pose so there's no jump on first frame.
        lagQuat: bone.quaternion.clone(),
      });
    }
    attached = boneStates.length > 0;
  }

  /**
   * Call every frame AFTER mixer.update(delta) but BEFORE renderer.render().
   * Reads each bone's animated quaternion as the spring target and drives
   * lagQuat toward it with exponential smoothing, then writes lagQuat back.
   */
  function tick(delta: number): void {
    if (!attached || delta <= 0) return;
    const dt = Math.min(delta, 0.05); // clamp step to avoid instability

    for (const state of boneStates) {
      const { bone, lambda, lagQuat } = state;
      // bone.quaternion == target written by the animation mixer
      const target = bone.quaternion;

      // Smooth each component independently then normalise.
      // THREE.MathUtils.damp(current, target, lambda, dt) is equivalent to
      // exponential decay: current * exp(-lambda*dt) + target*(1-exp(-lambda*dt))
      lagQuat.x = THREE.MathUtils.damp(lagQuat.x, target.x, lambda, dt);
      lagQuat.y = THREE.MathUtils.damp(lagQuat.y, target.y, lambda, dt);
      lagQuat.z = THREE.MathUtils.damp(lagQuat.z, target.z, lambda, dt);
      lagQuat.w = THREE.MathUtils.damp(lagQuat.w, target.w, lambda, dt);
      lagQuat.normalize();

      // Write back — replaces the mixer's pose with the lagged version.
      bone.quaternion.copy(lagQuat);
    }
  }

  /** Release all state when the model is unloaded. */
  function detach(): void {
    boneStates = [];
    attached = false;
  }

  return { attach, tick, detach };
}
