import * as THREE from "three";

/**
 * Pose-envelope detectors for authored clip defects that a frame-to-frame seam
 * scan cannot see.
 *
 * `scanSeam` (motionProbe.ts) measures |dq| between adjacent quarter-frames. A
 * pose that is wrong but *constant* has no adjacent-frame difference at all, so
 * three defects that shipped in the V2 rig were invisible to it:
 *
 *   - `idle` held a -65 deg neck raise (Neck1 -21.1, Neck2 -24.2, Head -19.3),
 *     seam 0.0000 deg, so Scan reported 0 issues.
 *   - `walk` held a +8.6 deg open jaw on a 2-key STEP track.
 *   - `land` ended 15.9 deg (Neck2) / 17.0 deg (Foot) away from where `idle`
 *     started, which is an inter-clip defect: no single clip contains it.
 *
 * Everything here is measured against the **bind pose**, not against the clip's
 * own first frame, because a clip that is uniformly offset is exactly the class
 * of defect that motivated this module.
 *
 * Threshold provenance: docs/flight-lab/41-v2-and-blender-rig-audit-task-list.md
 * section 4.1 / Task E1. The static-offset detectors use the **median** over the
 * clip rather than the peak: an authored strike or a wingbeat legitimately
 * swings 60 deg for a few frames, while a postural defect is held for the whole
 * clip. Peak-based envelopes flag every healthy flight clip; median-based ones
 * flag the pose.
 */

/** Bones whose held offset is a posture, not a motion. */
export const POSTURAL_CHAIN = ["Body", "Spine1", "Spine2", "Spine3", "Neck1", "Neck2", "Head"] as const;

/** Clips in which an open jaw is the point. Lowercased for lookup. */
export const MOUTH_ACTIVE_CLIPS: ReadonlySet<string> = new Set([
  "attack",
  "attack2",
  "attackair2",
  "breath",
  "roar",
  "death",
]);

/**
 * Clips exempt from the postural envelope: they are authored to hold a strong
 * pose (a strike coil, a death sprawl, a stoop), so an 18 deg held offset is the
 * intent rather than a defect.
 */
export const POSTURE_EXEMPT_CLIPS: ReadonlySet<string> = new Set([
  "attack",
  "attack2",
  "attackair2",
  "breath",
  "roar",
  "death",
  "dive",
]);

/** Clips that stand on the ground, where the head should hold the horizon. */
export const GROUNDED_CLIPS: ReadonlySet<string> = new Set(["idle", "walk", "rest", "land", "takeoff"]);

export const POSE_ENVELOPE_THRESHOLDS = {
  /** Held |pitch vs bind| on a postural bone. */
  bindDeltaPitchDeg: 18,
  /** Held cumulative head pitch outside +/- this on a grounded clip. */
  horizonPitchDeg: 12,
  /** Held |jaw pitch vs bind| on a clip where the mouth should be shut. */
  openJawDeg: 2,
  /** Per-bone boundary delta between two clips of a canonical handoff. */
  transitionHandoffDeg: 8,
  /** Peak horizontal `Body` translation within one clip, in rig units. */
  rootDriftRigUnits: 0.5,
} as const;

export type PoseEnvelopeThresholds = typeof POSE_ENVELOPE_THRESHOLDS;

export type PoseAnomalyKind =
  | "bind_delta"
  | "horizon_pitch"
  | "open_jaw"
  | "transition_handoff"
  | "root_drift";

export interface PoseAnomaly {
  kind: PoseAnomalyKind;
  /** Clip name, or `from -> to` for a handoff. */
  clip: string;
  boneName: string;
  /** Measured value. Degrees unless `unit` is `"rig"`. */
  value: number;
  unit: "deg" | "rig";
  threshold: number;
  /** Frame of the worst sample, at the scan fps. */
  frame: number;
  time: number;
  message: string;
}

export interface PoseSample {
  time: number;
  /** Local bone quaternions exactly as the mixer wrote them. */
  rotations: Map<string, THREE.Quaternion>;
  /** Local `Body` translation, or null when the rig has no `Body` bone. */
  bodyPosition: THREE.Vector3 | null;
}

export interface PoseBindings {
  rotations: Map<string, THREE.Quaternion>;
}

export interface ClipAnomalyScan {
  clip: string;
  samples: PoseSample[];
  anomalies: PoseAnomaly[];
}

/**
 * Handoffs the state machine actually cuts: a one-shot clip finishes and the next
 * mode starts, so the one-shot's last pose is meant to land on the loop's first.
 *
 * Measured on the shipped `bef7a09a…` asset, and the list is deliberately short:
 *
 *   takeoff -> cruise    0 bones > 8°
 *   land    -> idle      0 bones > 8°   (A3 smoothed this from 15.9°)
 *   cruise  -> bankLeft  8 bones, worst R_WingElbow 39.9°   <- excluded
 *   cruise  -> bankRight 8 bones, worst L_WingElbow 39.9°   <- excluded
 *   idle    <-> walk     22 bones, worst L_Toes 44.2°       <- excluded
 *
 * The excluded pairs are loop-to-loop: `runtime.ts` phase-aligns and crossfades
 * them, so a boundary delta there is a stance/phase difference, not a snap. On a
 * healthy asset it never drops below the threshold, so including them would make
 * the detector permanently red and therefore unread.
 */
export const CANONICAL_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ["takeoff", "cruise"],
  ["land", "idle"],
];

/** Zero-weight control joints — a boundary delta here deforms nothing. */
export const NON_DEFORMING_BONES: ReadonlySet<string> = new Set(["Root", "RootMotion"]);

const PITCH_ORDER = "YXZ";

function pitchDeg(q: THREE.Quaternion): number {
  return THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(q, PITCH_ORDER).x);
}

/** Angle between two orientations, degrees. */
function angleDeg(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const dot = Math.min(1, Math.abs(a.dot(b)));
  return THREE.MathUtils.radToDeg(2 * Math.acos(dot));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Snapshot the bind pose. Call before any mixer action touches the bones.
 */
export function captureBindRotations(model: THREE.Object3D): PoseBindings {
  const rotations = new Map<string, THREE.Quaternion>();
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) rotations.set(child.name, (child as THREE.Bone).quaternion.clone());
  });
  return { rotations };
}

/**
 * Sample a clip's local rotations at `step`-frame resolution.
 *
 * Two things here are load-bearing and were both measured:
 *
 *   - **A private `AnimationMixer`, not the playback one.** Writing a bone
 *     rotation and then calling `mixer.update(0)` on a paused action leaves that
 *     action unable to write the pose again: a second seek on the same mixer
 *     reads the untouched bone instead of the clip. Reusing the live mixer would
 *     therefore make the *second* Scan of a session measure nothing, and would
 *     leave playback's own action in that state. A throwaway mixer cannot.
 *   - **Bind values for bones the clip does not animate.** A static-track bone
 *     would otherwise report whatever `wyvernFlightRig` last wrote as if it were
 *     authored motion. Substituting the bind rotation in the sample (rather than
 *     resetting the scene) keeps the scene untouched.
 */
export function sampleClipPoses(
  model: THREE.Object3D,
  clip: THREE.AnimationClip,
  bind: PoseBindings,
  options: { fps?: number; step?: number } = {}
): PoseSample[] {
  const fps = options.fps ?? 24;
  const step = options.step ?? 0.25;
  const duration = clip.duration;
  const stepsPerFrame = Math.max(1, Math.round(1 / step));
  const totalSteps = Math.max(1, Math.ceil(duration * fps)) * stepsPerFrame;

  const bones: THREE.Bone[] = [];
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone);
  });
  const body = bones.find((bone) => bone.name === "Body") ?? null;

  // Which bones this clip actually owns. Everything else reports bind.
  const animated = new Set<string>();
  for (const track of clip.tracks) animated.add(track.name.split(".")[0] ?? "");

  const previousPose = new Map<string, THREE.Quaternion>();
  for (const bone of bones) previousPose.set(bone.name, bone.quaternion.clone());
  const previousBodyPosition = body ? body.position.clone() : null;

  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();

  const samples: PoseSample[] = [];
  try {
    for (let s = 0; s <= totalSteps; s += 1) {
      const time = Math.min(s / stepsPerFrame / fps, duration);
      action.time = time;
      mixer.update(0);

      const rotations = new Map<string, THREE.Quaternion>();
      for (const bone of bones) {
        const authored = animated.has(bone.name) ? bone.quaternion : bind.rotations.get(bone.name);
        rotations.set(bone.name, (authored ?? bone.quaternion).clone());
      }
      // An unanimated `Body` is never written by the scan mixer, so this reads
      // the pre-scan position and reports zero drift, which is the truth.
      samples.push({
        time: Number(time.toFixed(4)),
        rotations,
        bodyPosition: body ? body.position.clone() : null,
      });
    }
  } finally {
    mixer.stopAllAction();
    for (const bone of bones) {
      const q = previousPose.get(bone.name);
      if (q) bone.quaternion.copy(q);
    }
    if (body && previousBodyPosition) body.position.copy(previousBodyPosition);
  }

  return samples;
}

function worstSample(samples: PoseSample[], values: number[]): PoseSample {
  let index = 0;
  let worst = -1;
  for (let i = 0; i < values.length; i += 1) {
    const magnitude = Math.abs(values[i]!);
    if (magnitude > worst) {
      worst = magnitude;
      index = i;
    }
  }
  return samples[Math.min(index, samples.length - 1)]!;
}

/**
 * Pure detector over already-sampled poses.
 *
 * Kept free of the mixer so a regression test can feed it the exact defect
 * shape (a held -65 deg neck, a +8.6 deg jaw) without building a rig.
 */
export function detectPoseAnomalies(input: {
  clip: string;
  samples: PoseSample[];
  bind: PoseBindings;
  fps?: number;
  thresholds?: Partial<PoseEnvelopeThresholds>;
}): PoseAnomaly[] {
  const { clip, samples, bind } = input;
  const thresholds = { ...POSE_ENVELOPE_THRESHOLDS, ...input.thresholds };
  const anomalies: PoseAnomaly[] = [];
  if (samples.length === 0) return anomalies;

  const key = clip.toLowerCase();
  const fps = input.fps ?? 24;
  const reportFrame = (sample: PoseSample) => Math.max(0, Math.round(sample.time * fps));

  // --- Held postural offset vs bind -----------------------------------------
  if (!POSTURE_EXEMPT_CLIPS.has(key)) {
    for (const boneName of POSTURAL_CHAIN) {
      const bindRotation = bind.rotations.get(boneName);
      if (!bindRotation) continue;
      const inverseBind = bindRotation.clone().invert();
      const values: number[] = [];
      for (const sample of samples) {
        const rotation = sample.rotations.get(boneName);
        if (!rotation) break;
        values.push(pitchDeg(inverseBind.clone().multiply(rotation)));
      }
      if (values.length !== samples.length || values.length === 0) continue;
      const held = median(values);
      if (Math.abs(held) <= thresholds.bindDeltaPitchDeg) continue;
      const worst = worstSample(samples, values);
      anomalies.push({
        kind: "bind_delta",
        clip,
        boneName,
        value: Number(held.toFixed(2)),
        unit: "deg",
        threshold: thresholds.bindDeltaPitchDeg,
        frame: reportFrame(worst),
        time: worst.time,
        message: `${boneName} holds ${held.toFixed(1)}° pitch vs bind (limit ${thresholds.bindDeltaPitchDeg}°)`,
      });
    }
  }

  // --- Held cumulative head pitch on a grounded clip ------------------------
  if (GROUNDED_CLIPS.has(key)) {
    const cumulative: number[] = [];
    for (const sample of samples) {
      const composed = new THREE.Quaternion();
      let complete = true;
      for (const boneName of POSTURAL_CHAIN) {
        const bindRotation = bind.rotations.get(boneName);
        const rotation = sample.rotations.get(boneName);
        if (!bindRotation || !rotation) {
          complete = false;
          break;
        }
        composed.multiply(bindRotation.clone().invert().multiply(rotation));
      }
      if (!complete) break;
      cumulative.push(pitchDeg(composed));
    }
    if (cumulative.length === samples.length && cumulative.length > 0) {
      const held = median(cumulative);
      if (Math.abs(held) > thresholds.horizonPitchDeg) {
        const worst = worstSample(samples, cumulative);
        anomalies.push({
          kind: "horizon_pitch",
          clip,
          boneName: "Head",
          value: Number(held.toFixed(2)),
          unit: "deg",
          threshold: thresholds.horizonPitchDeg,
          frame: reportFrame(worst),
          time: worst.time,
          message: `grounded head holds ${held.toFixed(1)}° off the horizon (limit ±${thresholds.horizonPitchDeg}°)`,
        });
      }
    }
  }

  // --- Jaw held open on a clip where the mouth should be shut ---------------
  if (!MOUTH_ACTIVE_CLIPS.has(key)) {
    const jawBind = bind.rotations.get("Jaw");
    if (jawBind) {
      const inverseBind = jawBind.clone().invert();
      const values: number[] = [];
      for (const sample of samples) {
        const rotation = sample.rotations.get("Jaw");
        if (!rotation) break;
        values.push(pitchDeg(inverseBind.clone().multiply(rotation)));
      }
      if (values.length === samples.length && values.length > 0) {
        const held = median(values);
        if (Math.abs(held) > thresholds.openJawDeg) {
          const worst = worstSample(samples, values);
          anomalies.push({
            kind: "open_jaw",
            clip,
            boneName: "Jaw",
            value: Number(held.toFixed(2)),
            unit: "deg",
            threshold: thresholds.openJawDeg,
            frame: reportFrame(worst),
            time: worst.time,
            message: `jaw holds ${held.toFixed(1)}° open on a closed-mouth clip (limit ${thresholds.openJawDeg}°)`,
          });
        }
      }
    }
  }

  // --- Horizontal `Body` drift inside one clip ------------------------------
  const positions = samples.map((sample) => sample.bodyPosition);
  if (positions.every((position) => position !== null) && positions.length > 1) {
    const first = positions[0] as THREE.Vector3;
    const drift = positions.map((position) => {
      const p = position as THREE.Vector3;
      return Math.hypot(p.x - first.x, p.z - first.z);
    });
    const peak = Math.max(...drift);
    if (peak > thresholds.rootDriftRigUnits) {
      const worst = worstSample(samples, drift);
      anomalies.push({
        kind: "root_drift",
        clip,
        boneName: "Body",
        value: Number(peak.toFixed(3)),
        unit: "rig",
        threshold: thresholds.rootDriftRigUnits,
        frame: reportFrame(worst),
        time: worst.time,
        message: `Body drifts ${peak.toFixed(2)} rig units horizontally (limit ${thresholds.rootDriftRigUnits})`,
      });
    }
  }

  return anomalies.sort((a, b) => Math.abs(b.value) / b.threshold - Math.abs(a.value) / a.threshold);
}

/**
 * Boundary check across a canonical handoff: the last pose of `from` against the
 * first pose of `to`. No single clip contains this defect — `land` ended 15.9 deg
 * from `idle`'s start while both clips were internally continuous.
 */
export function detectTransitionAnomalies(input: {
  from: { clip: string; samples: PoseSample[] };
  to: { clip: string; samples: PoseSample[] };
  thresholds?: Partial<PoseEnvelopeThresholds>;
}): PoseAnomaly[] {
  const thresholds = { ...POSE_ENVELOPE_THRESHOLDS, ...input.thresholds };
  const fromSamples = input.from.samples;
  const toSamples = input.to.samples;
  if (fromSamples.length === 0 || toSamples.length === 0) return [];
  const end = fromSamples[fromSamples.length - 1]!;
  const start = toSamples[0]!;

  const anomalies: PoseAnomaly[] = [];
  for (const [boneName, endRotation] of end.rotations) {
    if (NON_DEFORMING_BONES.has(boneName)) continue;
    const startRotation = start.rotations.get(boneName);
    if (!startRotation) continue;
    const delta = angleDeg(endRotation, startRotation);
    if (delta <= thresholds.transitionHandoffDeg) continue;
    anomalies.push({
      kind: "transition_handoff",
      clip: `${input.from.clip} -> ${input.to.clip}`,
      boneName,
      value: Number(delta.toFixed(2)),
      unit: "deg",
      threshold: thresholds.transitionHandoffDeg,
      frame: 0,
      time: start.time,
      message: `${boneName} snaps ${delta.toFixed(1)}° at ${input.from.clip} → ${input.to.clip} (limit ${thresholds.transitionHandoffDeg}°)`,
    });
  }
  return anomalies.sort((a, b) => b.value - a.value);
}

/** Sample one clip and run every single-clip detector. */
export function scanClipAnomalies(
  model: THREE.Object3D,
  clip: THREE.AnimationClip,
  bind: PoseBindings,
  options: { fps?: number; step?: number; thresholds?: Partial<PoseEnvelopeThresholds> } = {}
): ClipAnomalyScan {
  const fps = options.fps ?? 24;
  const samples = sampleClipPoses(model, clip, bind, { fps, step: options.step });
  return {
    clip: clip.name,
    samples,
    anomalies: detectPoseAnomalies({ clip: clip.name, samples, bind, fps, thresholds: options.thresholds }),
  };
}
