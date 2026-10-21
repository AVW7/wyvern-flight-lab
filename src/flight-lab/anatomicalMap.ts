import * as THREE from "three";

export type AnatomicalCategory = "head" | "wing_left" | "wing_right" | "spine" | "tail" | "leg";
export type FlightLabStrokePhase = "apex" | "downstroke" | "bottom" | "upstroke" | "glide" | "idle" | "other";

export interface LandmarkDefinition {
  id: string;
  label: string;
  category: AnatomicalCategory;
  v2Bones: string[];
  v1Bones: string[];
  color: string;
}

export interface ResolvedLandmark {
  id: string;
  label: string;
  category: AnatomicalCategory;
  boneName: string;
  bone: THREE.Bone;
  worldPosition: THREE.Vector3;
  localPosition: THREE.Vector3;
  rotationEulerDeg: THREE.Vector3;
  parentBoneName?: string;
  color: string;
}

export interface BilateralSymmetryMetrics {
  leftTipPos: THREE.Vector3;
  rightTipPos: THREE.Vector3;
  deltaHeightMm: number;
  deltaSpanMm: number;
  symmetryAngleDeg: number;
  symmetryScorePercent: number;
}

export const CANONICAL_LANDMARKS: LandmarkDefinition[] = [
  {
    id: "head",
    label: "Cranial / Head",
    category: "head",
    v2Bones: ["Head"],
    v1Bones: ["Bip002-Head_015", "Bip001-Head_0159"],
    color: "#eab308",
  },
  {
    id: "jaw",
    label: "Mandible / Jaw",
    category: "head",
    v2Bones: ["Jaw"],
    v1Bones: ["Bip002-Head_015"],
    color: "#f59e0b",
  },
  {
    id: "neck_upper",
    label: "Upper Cervical (Neck 2)",
    category: "head",
    v2Bones: ["Neck2"],
    v1Bones: ["Bip002-Neck2_014"],
    color: "#fbbf24",
  },
  {
    id: "neck_base",
    label: "Neck Base (Cervicothoracic)",
    category: "spine",
    v2Bones: ["Neck1"],
    v1Bones: ["Bip002-Neck1_013", "Bip002-Neck_012"],
    color: "#d97706",
  },
  // Left Wing
  {
    id: "l_wing_shoulder",
    label: "Left Wing Shoulder (Glenoid)",
    category: "wing_left",
    v2Bones: ["L_WingShoulder", "L_WingRoot"],
    v1Bones: ["Bip002-L-Clavicle_049", "Bip002-L-UpperArm_050"],
    color: "#38bdf8",
  },
  {
    id: "l_wing_elbow",
    label: "Left Wing Elbow (Cubital)",
    category: "wing_left",
    v2Bones: ["L_WingElbow"],
    v1Bones: ["Bip002-L-Forearm_051"],
    color: "#0ea5e9",
  },
  {
    id: "l_wing_wrist",
    label: "Left Wing Wrist (Carpus)",
    category: "wing_left",
    v2Bones: ["L_WingWrist", "L_WingHand"],
    v1Bones: ["Bip002-L-Hand_052"],
    color: "#0284c7",
  },
  {
    id: "l_wing_thumb",
    label: "Left Alula / Thumb Claw (Digit 5)",
    category: "wing_left",
    v2Bones: ["L_WingD5P0", "L_WingD5P1", "L_WingD5P2"],
    v1Bones: ["Bip002-L-Finger5_083", "Bip002-L-Finger52_085"],
    color: "#60a5fa",
  },
  {
    id: "l_wing_tip",
    label: "Left Leading Wingtip (Digit 0)",
    category: "wing_left",
    v2Bones: ["L_WingD0P2", "L_WingD0P1", "L_WingD0P0"],
    v1Bones: ["Bip002-L-Finger02_073", "Bip002-L-Finger02_end_0249"],
    color: "#2563eb",
  },
  {
    id: "l_wing_digit1",
    label: "Left Primary Spar (Digit 1)",
    category: "wing_left",
    v2Bones: ["L_WingD1P2", "L_WingD1P1"],
    v1Bones: ["Bip002-L-Finger12_067"],
    color: "#3b82f6",
  },
  {
    id: "l_wing_digit2",
    label: "Left Mid Spar (Digit 2)",
    category: "wing_left",
    v2Bones: ["L_WingD2P2", "L_WingD2P1"],
    v1Bones: ["Bip002-L-Finger22_061"],
    color: "#6366f1",
  },
  // Right Wing
  {
    id: "r_wing_shoulder",
    label: "Right Wing Shoulder (Glenoid)",
    category: "wing_right",
    v2Bones: ["R_WingShoulder", "R_WingRoot"],
    v1Bones: ["Bip002-R-Clavicle_086", "Bip002-R-UpperArm_087"],
    color: "#f43f5e",
  },
  {
    id: "r_wing_elbow",
    label: "Right Wing Elbow (Cubital)",
    category: "wing_right",
    v2Bones: ["R_WingElbow"],
    v1Bones: ["Bip002-R-Forearm_088"],
    color: "#e11d48",
  },
  {
    id: "r_wing_wrist",
    label: "Right Wing Wrist (Carpus)",
    category: "wing_right",
    v2Bones: ["R_WingWrist", "R_WingHand"],
    v1Bones: ["Bip002-R-Hand_089"],
    color: "#be123c",
  },
  {
    id: "r_wing_thumb",
    label: "Right Alula / Thumb Claw (Digit 5)",
    category: "wing_right",
    v2Bones: ["R_WingD5P0", "R_WingD5P1", "R_WingD5P2"],
    v1Bones: ["Bip002-R-Finger5_0120", "Bip002-R-Finger52_0122"],
    color: "#fb7185",
  },
  {
    id: "r_wing_tip",
    label: "Right Leading Wingtip (Digit 0)",
    category: "wing_right",
    v2Bones: ["R_WingD0P2", "R_WingD0P1", "R_WingD0P0"],
    v1Bones: ["Bip002-R-Finger02_0110", "Bip002-R-Finger02_end_0240"],
    color: "#f43f5e",
  },
  {
    id: "r_wing_digit1",
    label: "Right Primary Spar (Digit 1)",
    category: "wing_right",
    v2Bones: ["R_WingD1P2", "R_WingD1P1"],
    v1Bones: ["Bip002-R-Finger12_0104"],
    color: "#fda4af",
  },
  {
    id: "r_wing_digit2",
    label: "Right Mid Spar (Digit 2)",
    category: "wing_right",
    v2Bones: ["R_WingD2P2", "R_WingD2P1"],
    v1Bones: ["Bip002-R-Finger22_098"],
    color: "#e11d48",
  },
  // Spine & Pelvis
  {
    id: "spine_mid",
    label: "Thoracic Spine",
    category: "spine",
    v2Bones: ["Spine2", "Spine3"],
    v1Bones: ["Bip002-Spine2_010", "Bip002-Spine1_09", "Bip001-Spine2_0137", "Bip001-Spine1_0136"],
    color: "#10b981",
  },
  {
    id: "pelvis",
    label: "Pelvis / Sacrum",
    category: "spine",
    v2Bones: ["Pelvis", "Body", "Spine1"],
    v1Bones: ["Bip002-Pelvis_07", "Bip001-Pelvis_0134", "Bip001-Spine_0135"],
    color: "#059669",
  },
  // Tail
  {
    id: "tail_root",
    label: "Tail Base (Caudal 1-2)",
    category: "tail",
    v2Bones: ["Tail1", "Tail2"],
    v1Bones: ["Bip002-Tail_0214", "Bip002-Tail1_0215", "Bip001-Tail1_0163", "Bip001-Tail_0162"],
    color: "#a855f7",
  },
  {
    id: "tail_mid",
    label: "Mid Tail (Caudal 5-6)",
    category: "tail",
    v2Bones: ["Tail5", "Tail6"],
    v1Bones: ["Bip002-Tail4_0218", "Bip002-Tail3_0217", "Bip001-Tail4_0166", "Bip001-Tail3_0165"],
    color: "#9333ea",
  },
  {
    id: "tail_tip",
    label: "Tail Rudder / Tip",
    category: "tail",
    v2Bones: ["Tail10", "Tail9", "Tail8"],
    v1Bones: ["Bip002-Tail8_03", "Bip002-Tail7_02", "Bip001-Tail10_0172", "Bip001-Tail8_0170"],
    color: "#c084fc",
  },
  // Hindlimbs / Legs
  {
    id: "l_leg_thigh",
    label: "Left Thigh (Femur)",
    category: "leg",
    v2Bones: ["L_Thigh", "L_LegRoot"],
    v1Bones: ["Bip002-L-Thigh_0186", "Bip001-L-Thigh_0176"],
    color: "#14b8a6",
  },
  {
    id: "l_leg_calf",
    label: "Left Calf (Crus)",
    category: "leg",
    v2Bones: ["L_Calf"],
    v1Bones: ["Bip002-L-Calf_0187", "Bip001-L-Calf_0177"],
    color: "#0d9488",
  },
  {
    id: "l_leg_foot",
    label: "Left Foot (Pes / Metatarsus)",
    category: "leg",
    v2Bones: ["L_Foot"],
    v1Bones: ["Bip002-L-Foot_0188", "Bip001-L-Foot_0178"],
    color: "#0f766e",
  },
  {
    id: "l_leg_toes",
    label: "Left Toes / Talons (Digits)",
    category: "leg",
    v2Bones: ["L_Toes"],
    v1Bones: ["Bip002-L-Toe0_0189", "Bip001-L-Toe0_0179"],
    color: "#2dd4bf",
  },
  {
    id: "r_leg_thigh",
    label: "Right Thigh (Femur)",
    category: "leg",
    v2Bones: ["R_Thigh", "R_LegRoot"],
    v1Bones: ["Bip002-R-Thigh_0201", "Bip001-R-Thigh_0180"],
    color: "#f97316",
  },
  {
    id: "r_leg_calf",
    label: "Right Calf (Crus)",
    category: "leg",
    v2Bones: ["R_Calf"],
    v1Bones: ["Bip002-R-Calf_00", "Bip001-R-Calf_0181"],
    color: "#ea580c",
  },
  {
    id: "r_leg_foot",
    label: "Right Foot (Pes / Metatarsus)",
    category: "leg",
    v2Bones: ["R_Foot"],
    v1Bones: ["Bip002-R-Foot_0202", "Bip001-R-Foot_0182"],
    color: "#c2410c",
  },
  {
    id: "r_leg_toes",
    label: "Right Toes / Talons (Digits)",
    category: "leg",
    v2Bones: ["R_Toes"],
    v1Bones: ["Bip002-R-Toe0_0203", "Bip001-R-Toe0_0183"],
    color: "#fb923c",
  },
];

const _landmarkCache = new WeakMap<THREE.Object3D, ResolvedLandmark[]>();
const _scratchEuler = new THREE.Euler();

function buildLandmarkCache(model: THREE.Object3D): ResolvedLandmark[] {
  const bones = new Map<string, THREE.Bone>();
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) {
      bones.set(child.name, child as THREE.Bone);
    }
  });

  const out: ResolvedLandmark[] = [];
  for (const def of CANONICAL_LANDMARKS) {
    let matchedBone: THREE.Bone | undefined;
    let matchedName = "";

    for (const name of def.v2Bones) {
      const b = bones.get(name);
      if (b) {
        matchedBone = b;
        matchedName = name;
        break;
      }
    }
    if (!matchedBone) {
      for (const name of def.v1Bones) {
        const b = bones.get(name);
        if (b) {
          matchedBone = b;
          matchedName = name;
          break;
        }
      }
    }
    if (!matchedBone) {
      for (const candidate of def.v2Bones) {
        for (const [k, b] of bones.entries()) {
          if (k.includes(candidate)) {
            matchedBone = b;
            matchedName = k;
            break;
          }
        }
        if (matchedBone) break;
      }
    }

    if (matchedBone) {
      out.push({
        id: def.id,
        label: def.label,
        category: def.category,
        boneName: matchedName,
        bone: matchedBone,
        worldPosition: new THREE.Vector3(),
        localPosition: new THREE.Vector3(),
        rotationEulerDeg: new THREE.Vector3(),
        parentBoneName:
          matchedBone.parent && (matchedBone.parent as THREE.Bone).isBone
            ? matchedBone.parent.name
            : undefined,
        color: def.color,
      });
    }
  }
  return out;
}

export function resolveAnatomicalLandmarks(model: THREE.Object3D): ResolvedLandmark[] {
  let cached = _landmarkCache.get(model);
  if (!cached) {
    cached = buildLandmarkCache(model);
    _landmarkCache.set(model, cached);
  }

  for (let i = 0; i < cached.length; i++) {
    const entry = cached[i]!;
    const bone = entry.bone;
    bone.getWorldPosition(entry.worldPosition);
    entry.localPosition.copy(bone.position);
    _scratchEuler.setFromQuaternion(bone.quaternion, "YXZ");
    entry.rotationEulerDeg.set(
      THREE.MathUtils.radToDeg(_scratchEuler.x),
      THREE.MathUtils.radToDeg(_scratchEuler.y),
      THREE.MathUtils.radToDeg(_scratchEuler.z)
    );
  }

  return cached;
}

export function findClosestLandmark(
  landmarks: ResolvedLandmark[],
  hitPoint: THREE.Vector3,
  maxDistance = 2.5
): ResolvedLandmark | null {
  let closest: ResolvedLandmark | null = null;
  let minDistance = maxDistance;

  for (const lm of landmarks) {
    const dist = lm.worldPosition.distanceTo(hitPoint);
    if (dist < minDistance) {
      minDistance = dist;
      closest = lm;
    }
  }

  return closest;
}

export function measureBilateralSymmetry(landmarks: ResolvedLandmark[]): BilateralSymmetryMetrics | null {
  const leftTip = landmarks.find((lm) => lm.id === "l_wing_tip");
  const rightTip = landmarks.find((lm) => lm.id === "r_wing_tip");

  if (!leftTip || !rightTip) return null;

  const leftPos = leftTip.worldPosition;
  const rightPos = rightTip.worldPosition;

  // Bilateral height difference (absolute mm)
  const deltaHeightMm = Math.abs(leftPos.y - rightPos.y) * 1000;

  // Bilateral radial distance difference from origin (span balance)
  const leftSpan = Math.sqrt(leftPos.x * leftPos.x + leftPos.z * leftPos.z);
  const rightSpan = Math.sqrt(rightPos.x * rightPos.x + rightPos.z * rightPos.z);
  const deltaSpanMm = Math.abs(leftSpan - rightSpan) * 1000;

  // Dihedral angle relative to horizontal plane
  const dx = rightPos.x - leftPos.x;
  const dy = rightPos.y - leftPos.y;
  const symmetryAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(Math.abs(dy), Math.abs(dx)));

  // Symmetry score: 100% when height delta is 0; decays by 1% per 10mm delta
  const symmetryScorePercent = Math.max(0, Math.min(100, Math.round(100 - (deltaHeightMm / 10))));

  return {
    leftTipPos: leftPos,
    rightTipPos: rightPos,
    deltaHeightMm: Math.round(deltaHeightMm),
    deltaSpanMm: Math.round(deltaSpanMm),
    symmetryAngleDeg: Number(symmetryAngleDeg.toFixed(2)),
    symmetryScorePercent,
  };
}

export function detectStrokePhase(
  landmarks: ResolvedLandmark[],
  prevTipY: number | null,
  dt: number,
  isFlightMode: boolean
): { phase: FlightLabStrokePhase; tipY: number } {
  if (!isFlightMode) {
    return { phase: "idle", tipY: 0 };
  }

  const leftTip = landmarks.find((lm) => lm.id === "l_wing_tip");
  const rightTip = landmarks.find((lm) => lm.id === "r_wing_tip");
  const spine = landmarks.find((lm) => lm.id === "spine_mid") || landmarks.find((lm) => lm.id === "pelvis");

  if (!leftTip || !rightTip) {
    return { phase: "other", tipY: 0 };
  }

  const spineY = spine ? spine.worldPosition.y : 0;
  const avgTipY = ((leftTip.worldPosition.y + rightTip.worldPosition.y) / 2) - spineY;

  if (prevTipY === null || dt <= 0.001) {
    return { phase: "glide", tipY: avgTipY };
  }

  const vy = (avgTipY - prevTipY) / dt;

  let phase: FlightLabStrokePhase = "glide";

  if (Math.abs(vy) < 0.15) {
    if (avgTipY > 0.8) {
      phase = "apex";
    } else if (avgTipY < -0.8) {
      phase = "bottom";
    } else {
      phase = "glide";
    }
  } else if (vy < -0.15) {
    phase = "downstroke";
  } else if (vy > 0.15) {
    phase = "upstroke";
  }

  return { phase, tipY: avgTipY };
}

export function computeCenterOfMassAnchor(
  landmarks: ResolvedLandmark[],
  model: THREE.Object3D,
  targetSize: number,
  targetOut: THREE.Vector3
): void {
  const pelvis = landmarks.find((l) => l.id === "pelvis");
  const lShoulder = landmarks.find((l) => l.id === "l_wing_shoulder");
  const rShoulder = landmarks.find((l) => l.id === "r_wing_shoulder");
  const spine = landmarks.find((l) => l.id === "spine_mid");

  if (pelvis && lShoulder && rShoulder) {
    const shoulderMidX = (lShoulder.worldPosition.x + rShoulder.worldPosition.x) * 0.5;
    const shoulderMidY = (lShoulder.worldPosition.y + rShoulder.worldPosition.y) * 0.5;
    const shoulderMidZ = (lShoulder.worldPosition.z + rShoulder.worldPosition.z) * 0.5;
    targetOut.set(
      (pelvis.worldPosition.x + shoulderMidX) * 0.5,
      (pelvis.worldPosition.y + shoulderMidY) * 0.5 - targetSize * 0.1,
      (pelvis.worldPosition.z + shoulderMidZ) * 0.5
    );
    return;
  }

  if (pelvis) {
    targetOut.copy(pelvis.worldPosition);
    targetOut.y -= targetSize * 0.1;
    return;
  }

  if (spine) {
    targetOut.copy(spine.worldPosition);
    targetOut.y -= targetSize * 0.1;
    return;
  }

  model.getWorldPosition(targetOut);
  targetOut.y += targetSize * 0.1;
}
