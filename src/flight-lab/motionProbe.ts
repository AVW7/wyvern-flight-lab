import * as THREE from "three";

export interface SeamJump {
  boneName: string;
  frame: number;
  time: number;
  angleDeg: number;
  jumpType: "interior" | "loop_closure";
  thresholdDeg: number;
  provenance: string;
}

export interface LandmarkSample {
  name: string;
  x: number;
  y: number;
  z: number;
}

const LANDMARK_BONES = [
  "L_WingShoulder",
  "L_WingElbow",
  "L_WingWrist",
  "L_WingHand",
  "R_WingShoulder",
  "R_WingElbow",
  "R_WingWrist",
  "R_WingHand",
  "Neck1",
  "Head",
  "Pelvis",
  "Tail1",
  "Jaw",
  "L_Foot",
  "L_Toes",
  "R_Foot",
  "R_Toes",
];

// 10° threshold: sits between the repaired cruise candidate peak (4.1475°/quarter-frame)
// and the un-repaired reset defect (16.1718° at frame 47.25) measured in
// "art direction/v2-rig-inspection/MOTION_REPAIR_STATUS.md".
export const SEAM_JUMP_THRESHOLD_DEG = 10;
export const SEAM_THRESHOLD_PROVENANCE = "art direction/v2-rig-inspection/MOTION_REPAIR_STATUS.md (repaired cruise peak 4.15° vs defect 16.17°)";

function shortestAngleDegrees(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const dot = Math.abs(a.dot(b));
  const clamped = Math.min(1, Math.max(-1, dot));
  return THREE.MathUtils.radToDeg(2 * Math.acos(clamped));
}

export function scanSeam(
  mixer: THREE.AnimationMixer,
  action: THREE.AnimationAction,
  model: THREE.Object3D,
  fps = 24,
  step = 0.25,
  isLooping = true
): SeamJump[] {
  const clip = action.getClip();
  const duration = clip.duration;
  const frameCount = Math.ceil(duration * fps);
  const stepsPerFrame = Math.round(1 / step);
  const totalSteps = frameCount * stepsPerFrame;

  const bones: THREE.Bone[] = [];
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone);
  });

  const prevRotations = new Map<string, THREE.Quaternion>();
  const firstRotations = new Map<string, THREE.Quaternion>();
  const lastRotations = new Map<string, THREE.Quaternion>();
  const jumps: SeamJump[] = [];

  // Store previous mixer and action state
  const prevTime = action.time;
  const wasPlaying = !action.paused;
  const prevWeight = action.getEffectiveWeight();
  const prevTimeScale = action.getEffectiveTimeScale();

  try {
    action.paused = true;

    for (let s = 0; s <= totalSteps; s++) {
      const t = (s / stepsPerFrame) / fps;
      action.time = Math.min(t, duration);
      mixer.update(0);

      for (const bone of bones) {
        const q = bone.quaternion.clone();
        if (s === 0) {
          firstRotations.set(bone.name, q);
        }
        if (s === totalSteps) {
          lastRotations.set(bone.name, q);
        }

        const prev = prevRotations.get(bone.name);
        if (prev) {
          const angle = shortestAngleDegrees(prev, q);
          if (angle > SEAM_JUMP_THRESHOLD_DEG) {
            jumps.push({
              boneName: bone.name,
              frame: s / stepsPerFrame,
              time: Number(t.toFixed(4)),
              angleDeg: Number(angle.toFixed(3)),
              jumpType: "interior",
              thresholdDeg: SEAM_JUMP_THRESHOLD_DEG,
              provenance: SEAM_THRESHOLD_PROVENANCE,
            });
          }
        }
        prevRotations.set(bone.name, q);
      }
    }

    // Measure loop closure (end-to-start) explicitly if the clip is meant to loop
    if (isLooping && duration > 0) {
      for (const bone of bones) {
        const startQ = firstRotations.get(bone.name);
        const endQ = lastRotations.get(bone.name);
        if (startQ && endQ) {
          const angle = shortestAngleDegrees(endQ, startQ);
          if (angle > SEAM_JUMP_THRESHOLD_DEG) {
            jumps.push({
              boneName: bone.name,
              frame: 0,
              time: 0,
              angleDeg: Number(angle.toFixed(3)),
              jumpType: "loop_closure",
              thresholdDeg: SEAM_JUMP_THRESHOLD_DEG,
              provenance: SEAM_THRESHOLD_PROVENANCE,
            });
          }
        }
      }
    }
  } finally {
    // Guaranteed restore of action and mixer state
    action.time = prevTime;
    action.setEffectiveWeight(prevWeight);
    action.setEffectiveTimeScale(prevTimeScale);
    mixer.update(0);
    action.paused = !wasPlaying;
  }

  // Deduplicate: keep largest angle per bone per jumpType and integer frame
  const map = new Map<string, SeamJump>();
  for (const j of jumps) {
    const key = `${j.boneName}:${j.jumpType}:${Math.floor(j.frame)}`;
    const existing = map.get(key);
    if (!existing || j.angleDeg > existing.angleDeg) {
      map.set(key, j);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.angleDeg - a.angleDeg);
}

export function sampleLandmarks(model: THREE.Object3D): LandmarkSample[] {
  const out: LandmarkSample[] = [];
  const boneMap = new Map<string, THREE.Bone>();
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) boneMap.set(child.name, child as THREE.Bone);
  });

  for (const name of LANDMARK_BONES) {
    const bone = boneMap.get(name);
    if (!bone) continue;
    const wp = new THREE.Vector3();
    bone.getWorldPosition(wp);
    out.push({ name, x: wp.x, y: wp.y, z: wp.z });
  }
  return out;
}
