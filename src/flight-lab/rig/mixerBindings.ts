/**
 * Mixer binding flush.
 *
 * `AnimationMixer` writes each animated property into an internal ring buffer
 * and only applies it to the object when the binding's accumulator index moves.
 * With `mixer.update(0)` -- which is what scrubbing and pausing use -- the index
 * does not move, so a bone with a static keyframe track keeps whatever value
 * procedural code last wrote into it. Over many frames that compounds: the pose
 * drifts away from the clip and never comes back.
 *
 * Forcing `setValue` on the accumulated slot fixes it, at the cost of reaching
 * into three.js internals. Those fields are private, so this is version-fragile
 * by nature: if a future three.js renames them, the loop silently does nothing
 * and the drift returns. `mixerBindingsAreSupported()` exists so callers can
 * surface that instead of shipping the bug again.
 *
 * Shared by the wyvern and the rider mixers: both are driven by the same
 * frame loop, and the rider has the same static-track problem.
 */

import type { AnimationMixer } from "three";

interface MixerInternals {
  _bindings?: Array<{
    valueSize: number;
    buffer: unknown;
    binding: { setValue(buffer: unknown, offset: number): void };
  }>;
  _accuIndex?: number;
}

/** Whether the private fields this module depends on are present. */
export function mixerBindingsAreSupported(mixer: AnimationMixer): boolean {
  const internals = mixer as unknown as MixerInternals;
  return Array.isArray(internals._bindings) && typeof internals._accuIndex === "number";
}

/**
 * Re-apply every binding's accumulated value to its target object.
 * Returns the number of bindings flushed, so callers and tests can tell
 * "nothing to do" apart from "the private API moved".
 */
export function flushMixerBindings(mixer: AnimationMixer): number {
  const internals = mixer as unknown as MixerInternals;
  const bindings = internals._bindings;
  if (!Array.isArray(bindings)) return 0;
  const offset = internals._accuIndex ?? 0;
  for (let i = 0, n = bindings.length; i < n; i++) {
    const binding = bindings[i];
    if (!binding) continue;
    const stride = binding.valueSize;
    binding.binding.setValue(binding.buffer, offset * stride + stride);
  }
  return bindings.length;
}
