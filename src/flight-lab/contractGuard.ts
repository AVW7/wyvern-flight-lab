/**
 * Load-time contract guard (Milestone M4).
 *
 * The node gates (`npm run assets:validate-wyvern`, the provenance test) validate
 * the **pinned file on disk**. Nothing validated the file the browser actually
 * fetched: swap in an old GLB, a half-written export, or a three.js upgrade that
 * moves the mixer internals, and every gate still passes while the app misbehaves.
 *
 * This module is the browser-side half. It is deliberately free of DOM/WebGL so
 * `test/flight-lab.test.js` can call it with a plain `THREE.Group`.
 */

import type * as THREE from "three";
import type { AnimationMixer } from "three";
import { PINNED_RUNTIME_MODEL, V2_RIG_CLIPS, V2_RIG_JOINT_COUNT, type FlightLabSpecimen } from "./catalog";
import { mixerBindingsAreSupported } from "./rig/mixerBindings";

/** The widest skeleton on the model — the V2 rig is two meshes over one skeleton. */
export function countSkinJoints(root: THREE.Object3D): number {
  let max = 0;
  root.traverse((child) => {
    const skinned = child as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      max = Math.max(max, skinned.skeleton.bones.length);
    }
  });
  return max;
}

export interface ContractGuardParams {
  specimen: FlightLabSpecimen | null;
  model: THREE.Object3D | null;
  clipNames: readonly string[];
  mixer: AnimationMixer | null;
}

/**
 * Every reason the loaded asset cannot be trusted, as sentences a human can act
 * on. Empty array means "in contract". Never throws: a guard that fails the load
 * would hide the very drift it is meant to report.
 */
export function validateLoadedContract(params: ContractGuardParams): string[] {
  const { specimen, model, clipNames, mixer } = params;
  const issues: string[] = [];

  if (mixer && !mixerBindingsAreSupported(mixer)) {
    issues.push(
      "three.js AnimationMixer no longer exposes `_bindings` / `_accuIndex`, so `flushMixerBindings` cannot re-apply static tracks — poses will drift while scrubbing or paused.",
    );
  }

  // Only the pinned runtime asset is held to the V2 signature. The candidates are
  // partial on purpose, and a V1 specimen never claimed these clips.
  const isPinnedAsset = specimen?.modelFile === PINNED_RUNTIME_MODEL;
  if (!isPinnedAsset || !model) return issues;

  const joints = countSkinJoints(model);
  if (joints !== V2_RIG_JOINT_COUNT) {
    issues.push(
      `Skin exposes ${joints || "no"} joints; the contract pins ${V2_RIG_JOINT_COUNT}. Every per-bone detector (pose envelope, pins, landmarks) is measuring a different rig than the one it was calibrated on.`,
    );
  }

  const normalize = (value: string) => value.toLowerCase();
  const available = new Set(clipNames.map(normalize));
  const expected = new Set(V2_RIG_CLIPS.map(normalize));
  const missing = V2_RIG_CLIPS.filter((name) => !available.has(normalize(name)));
  const extra = clipNames.filter((name) => !expected.has(normalize(name)));

  if (missing.length > 0) {
    issues.push(`Missing ${missing.length} of ${V2_RIG_CLIPS.length} contract clips: ${missing.join(", ")}.`);
  }
  if (extra.length > 0) {
    issues.push(`Carries ${extra.length} clip(s) the contract does not list: ${extra.join(", ")}.`);
  }

  return issues;
}
