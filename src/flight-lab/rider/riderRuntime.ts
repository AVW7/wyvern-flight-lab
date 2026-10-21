/**
 * The rider as a runtime object.
 *
 * Lifecycle: loaded once, cloned per specimen (the asset is skinned, so a plain
 * `Object3D.clone()` would share the skeleton and both copies would play the
 * same pose), then driven each frame from Spine3's world matrix.
 *
 * The rider owns its own `AnimationMixer`. Sharing the wyvern's would work
 * mechanically but couples the two clip clocks: pausing the wyvern to inspect a
 * pose would freeze the rider mid-breath, and a rider clip's `finished` event
 * would arrive on the wyvern's listener.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RIDER_MOUNT } from "./mountData";
import { riderMatrix } from "./riderMount";
import { riderClipFor, type RiderClip } from "./riderClip";
import { flushMixerBindings } from "../rig/mixerBindings";

export const RIDER_URL = "/models/wyvern-rider.glb";
const FADE_SECONDS = 0.25;

export interface RiderHandle {
  /** Sibling of the wyvern in `world`; not parented to it. */
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly clipNames: string[];
  /** Follow Spine3 and advance the rider's own clip clock. */
  update(step: number, spine3: THREE.Object3D, uniformScale: number): void;
  /** Switch rider clip for a given wyvern clip, crossfading. */
  setClipForWyvernClip(wyvernClip: string): void;
  currentRiderClip(): RiderClip | null;
  dispose(): void;
}

let assetPromise: Promise<THREE.Group> | null = null;

/** Load and cache the rider GLB, carrying its clips on the scene. */
export function loadRiderAsset(url: string = RIDER_URL): Promise<THREE.Group> {
  if (!assetPromise) {
    assetPromise = new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => withClips(gltf.scene, gltf.animations))
      .catch((error: unknown) => {
        assetPromise = null;
        throw error;
      });
  }
  return assetPromise;
}

export interface CreateRiderOptions {
  /** Object that owns the mount joint (the normalised wyvern model). */
  spine3: THREE.Object3D;
  /** The scale factor `normalizedClone` applied to the wyvern. */
  uniformScale: number;
  /** Clip to start on. */
  initialWyvernClip: string;
  /** Override for tests. */
  asset?: THREE.Group;
}

export async function createRider(options: CreateRiderOptions): Promise<RiderHandle> {
  const asset = options.asset ?? (await loadRiderAsset());

  // Skinned clone: shares geometry, not skeletons.
  const root = cloneSkinned(asset) as THREE.Object3D;
  root.name = "FlightLabRider";
  root.matrixAutoUpdate = false;

  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of collectClips(asset)) {
    actions.set(clip.name, mixer.clipAction(clip));
  }
  const clipNames = [...actions.keys()];

  let current: RiderClip | null = null;
  let currentAction: THREE.AnimationAction | null = null;

  const play = (name: RiderClip, fade = FADE_SECONDS) => {
    const next = actions.get(name);
    if (!next || current === name) return;
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (currentAction && currentAction !== next) {
      next.crossFadeFrom(currentAction, fade, false);
    }
    currentAction = next;
    current = name;
  };

  const handle: RiderHandle = {
    root,
    mixer,
    clipNames,
    update(step, spine3, uniformScale) {
      spine3.updateWorldMatrix(true, false);
      riderMatrix(spine3.matrixWorld, RIDER_MOUNT.offsetLocal, uniformScale, root.matrix);
      root.matrixWorldNeedsUpdate = true;
      mixer.update(step);
      // Same static-track problem as the wyvern: without this, a bone with no
      // keys in the current rider clip keeps whatever the last clip left there.
      flushMixerBindings(mixer);
    },
    setClipForWyvernClip(wyvernClip) {
      play(riderClipFor(wyvernClip));
    },
    currentRiderClip() {
      return current;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      root.removeFromParent();
    },
  };

  play(riderClipFor(options.initialWyvernClip), 0);
  return handle;
}

/**
 * Clips on the cached asset.
 *
 * `GLTFLoader` hangs animations off `gltf.animations`, but `cloneSkinned` only
 * returns the scene graph, so the clips have to be carried alongside. Stashing
 * them on the scene keeps one cache and one clone path.
 */
function collectClips(asset: THREE.Group): THREE.AnimationClip[] {
  const stashed = asset.userData?.animations as THREE.AnimationClip[] | undefined;
  return stashed ?? [];
}

/** Attach clip data to a loaded asset so clones can find it. */
export function withClips(scene: THREE.Group, animations: THREE.AnimationClip[]): THREE.Group {
  scene.userData.animations = animations;
  return scene;
}
