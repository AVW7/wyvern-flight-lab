import * as THREE from "three";
import type { AnatomicalCategory, FlightLabStrokePhase, ResolvedLandmark } from "./anatomicalMap";

export interface EulerDegXYZ {
  x: number;
  y: number;
  z: number;
}

export interface FlightLabPin {
  id: string;
  index: number;
  label: string;
  boneName: string;
  category: AnatomicalCategory;
  worldPos: { x: number; y: number; z: number };
  localPos: { x: number; y: number; z: number };
  rotDeg: EulerDegXYZ;
  /** Authored by the baked clip, relative to bind (`q_bind⁻¹ · q_mixer`). */
  clipDeltaEulerDeg: EulerDegXYZ;
  /** Added by `wyvernFlightRig` / `neckSpring` (`q_mixer⁻¹ · q_final`). */
  proceduralDeltaEulerDeg: EulerDegXYZ;
  /** World orientation with the specimen heading removed. */
  worldHorizonEulerDeg: EulerDegXYZ;
  /** Share of the local rotation the baked clip authored, 0..1. */
  clipShare: number;
  /** `Math.round(clipTime * 24)` — the frame an artist will scrub to. */
  frame: number;
  parentBoneName?: string;
  clipName: string;
  clipTime: number;
  clipProgress: number;
  strokePhase: FlightLabStrokePhase;
  specimenId: string;
  specimenName: string;
  specimenFile: string;
  timestamp: string;
  note?: string;
  aiSnippet: string;
}

const fmtDeg = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(1)}°`;

/** Tools that can act on a bone, keyed by the channel a pin blames. */
const SPLICE_BONES = new Set(["Neck1", "Neck2", "Head"]);

/**
 * One self-contained repair ticket. Everything an agent needs is in here: which
 * file, which clip, which frame, which bone, *which layer* is at fault, and what
 * the human saw. A ticket that names the wrong layer sends the next session into
 * the wrong file, which is exactly the failure this pin exists to prevent.
 */
export function formatPinForAI(pin: FlightLabPin): string {
  const clip = pin.clipDeltaEulerDeg;
  const proc = pin.proceduralDeltaEulerDeg;
  const horizon = pin.worldHorizonEulerDeg;
  const clipPercent = Math.round(pin.clipShare * 100);

  const lines = [
    `[Wyvern Rig Pin #${pin.index}: ${pin.label} | Bone: \`${pin.boneName}\`]`,
    `- Specimen: ${pin.specimenName} (\`${pin.specimenId}\`) — file \`${pin.specimenFile}\``,
    `- Action / Clip: "${pin.clipName}" @ ${pin.clipTime.toFixed(2)}s · Frame #${pin.frame} · ${Math.round(pin.clipProgress * 100)}% · Stroke Phase: ${pin.strokePhase.toUpperCase()}`,
    `- World Coord: X: ${pin.worldPos.x.toFixed(2)}, Y: ${pin.worldPos.y.toFixed(2)}, Z: ${pin.worldPos.z.toFixed(2)}`,
    `- Parent Hierarchy: ${pin.parentBoneName ? `\`${pin.parentBoneName}\`` : "None (Root/Disconnected)"}`,
    `- Bind Delta (clip vs bind, ΔX ΔY ΔZ): ${fmtDeg(clip.x)} / ${fmtDeg(clip.y)} / ${fmtDeg(clip.z)}`,
    `- Procedural Delta (flight rig vs mixer, ΔX ΔY ΔZ): ${fmtDeg(proc.x)} / ${fmtDeg(proc.y)} / ${fmtDeg(proc.z)}`,
    `- World Horizon Pitch: ${fmtDeg(horizon.x)} (roll ${fmtDeg(horizon.z)}, yaw ${fmtDeg(horizon.y)})`,
    `- Culpability: ${clipPercent}% from baked GLB track \`${pin.clipName}\` \`${pin.boneName}.quaternion\`; ${100 - clipPercent}% from \`wyvernFlightRig\``,
  ];

  // Only name a tool that can actually act on this bone — the splice script
  // rewrites Neck1/Neck2/Head and nothing else.
  if (SPLICE_BONES.has(pin.boneName)) {
    lines.push(
      `- Suggested command: node tools/blender/splice_neck_head_channels.mjs public/models/wyvern-v2-rig.glb <donor.glb> <out.glb> ${pin.clipName}`
    );
  }

  lines.push(`- Timestamp: ${pin.timestamp}`);
  lines.push(`- User Feedback: ${pin.note?.trim() ? pin.note.trim() : "(none)"}`);
  return lines.join("\n");
}

export interface PinSpecimenRef {
  id: string;
  name: string;
  modelFile: string;
}

export function createPinRecord(
  index: number,
  landmark: ResolvedLandmark,
  specimen: PinSpecimenRef,
  clipName: string,
  clipTime: number,
  clipProgress: number,
  strokePhase: FlightLabStrokePhase,
  note?: string
): FlightLabPin {
  const layers = landmark.layers;
  const pin: FlightLabPin = {
    id: `pin-${index}-${landmark.id}-${Date.now()}`,
    index,
    label: landmark.label,
    boneName: landmark.boneName,
    category: landmark.category,
    worldPos: {
      x: Number(landmark.worldPosition.x.toFixed(3)),
      y: Number(landmark.worldPosition.y.toFixed(3)),
      z: Number(landmark.worldPosition.z.toFixed(3)),
    },
    localPos: {
      x: Number(landmark.localPosition.x.toFixed(3)),
      y: Number(landmark.localPosition.y.toFixed(3)),
      z: Number(landmark.localPosition.z.toFixed(3)),
    },
    rotDeg: {
      x: Number(landmark.rotationEulerDeg.x.toFixed(1)),
      y: Number(landmark.rotationEulerDeg.y.toFixed(1)),
      z: Number(landmark.rotationEulerDeg.z.toFixed(1)),
    },
    clipDeltaEulerDeg: {
      x: Number(layers.clipDeltaEulerDeg.x.toFixed(1)),
      y: Number(layers.clipDeltaEulerDeg.y.toFixed(1)),
      z: Number(layers.clipDeltaEulerDeg.z.toFixed(1)),
    },
    proceduralDeltaEulerDeg: {
      x: Number(layers.proceduralDeltaEulerDeg.x.toFixed(1)),
      y: Number(layers.proceduralDeltaEulerDeg.y.toFixed(1)),
      z: Number(layers.proceduralDeltaEulerDeg.z.toFixed(1)),
    },
    worldHorizonEulerDeg: {
      x: Number(layers.worldHorizonEulerDeg.x.toFixed(1)),
      y: Number(layers.worldHorizonEulerDeg.y.toFixed(1)),
      z: Number(layers.worldHorizonEulerDeg.z.toFixed(1)),
    },
    clipShare: Number(layers.clipShare.toFixed(3)),
    frame: Math.round(clipTime * 24),
    parentBoneName: landmark.parentBoneName,
    clipName,
    clipTime: Number(clipTime.toFixed(2)),
    clipProgress: Number(clipProgress.toFixed(3)),
    strokePhase,
    specimenId: specimen.id,
    specimenName: specimen.name,
    specimenFile: specimen.modelFile,
    timestamp: new Date().toLocaleTimeString(),
    note,
    aiSnippet: "",
  };

  pin.aiSnippet = formatPinForAI(pin);
  return pin;
}

interface ActiveSonarRing {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  createdAt: number;
  duration: number;
  startScale: number;
  maxScale: number;
}

export interface PingVisualManager {
  group: THREE.Group;
  triggerPing(position: THREE.Vector3, colorHex?: string): void;
  addPinMarker(pin: FlightLabPin): void;
  removePinMarker(pinId: string): void;
  clearPins(): void;
  tick(delta: number): void;
  dispose(): void;
}

export function createPingVisualManager(): PingVisualManager {
  const group = new THREE.Group();
  group.name = "FlightLabPingVisuals";

  const rings: ActiveSonarRing[] = [];
  const pinMarkers = new Map<string, THREE.Group>();

  // Shared geometries
  const ringGeom = new THREE.RingGeometry(0.08, 0.16, 32);
  const sphereGeom = new THREE.SphereGeometry(0.1, 16, 16);

  const triggerPing = (position: THREE.Vector3, colorHex = "#38bdf8") => {
    // Spawn 2 concentric sonar ripple waves slightly staggered
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex),
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const mesh = new THREE.Mesh(ringGeom, mat);
      mesh.position.copy(position);
      // Billboard towards general top/perspective
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);

      rings.push({
        mesh,
        material: mat,
        createdAt: performance.now() + i * 140,
        duration: 1200,
        startScale: 0.2,
        maxScale: 2.8 + i * 0.8,
      });
    }
  };

  const addPinMarker = (pin: FlightLabPin) => {
    // Remove existing if any
    if (pinMarkers.has(pin.id)) {
      const old = pinMarkers.get(pin.id)!;
      group.remove(old);
    }

    const markerGroup = new THREE.Group();
    markerGroup.name = `PinMarker:${pin.id}`;
    markerGroup.position.set(pin.worldPos.x, pin.worldPos.y, pin.worldPos.z);

    // Glowing core sphere
    const coreMat = new THREE.MeshBasicMaterial({
      color: "#38bdf8",
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const core = new THREE.Mesh(sphereGeom, coreMat);
    core.renderOrder = 999;
    markerGroup.add(core);

    // Outer halo
    const haloMat = new THREE.MeshBasicMaterial({
      color: "#0284c7",
      wireframe: true,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), haloMat);
    halo.renderOrder = 999;
    markerGroup.add(halo);

    group.add(markerGroup);
    pinMarkers.set(pin.id, markerGroup);
  };

  const removePinMarker = (pinId: string) => {
    const marker = pinMarkers.get(pinId);
    if (marker) {
      group.remove(marker);
      pinMarkers.delete(pinId);
    }
  };

  const clearPins = () => {
    pinMarkers.forEach((m) => group.remove(m));
    pinMarkers.clear();
  };

  const tick = () => {
    const now = performance.now();

    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i]!;
      if (now < ring.createdAt) continue;

      const elapsed = now - ring.createdAt;
      const progress = Math.min(1, elapsed / ring.duration);

      if (progress >= 1) {
        group.remove(ring.mesh);
        ring.material.dispose();
        rings.splice(i, 1);
        continue;
      }

      // Ease out expansion
      const ease = 1 - Math.pow(1 - progress, 3);
      const scale = THREE.MathUtils.lerp(ring.startScale, ring.maxScale, ease);
      ring.mesh.scale.set(scale, scale, scale);

      // Fade out
      ring.material.opacity = (1 - progress) * 0.85;
    }
  };

  const dispose = () => {
    rings.forEach((r) => {
      group.remove(r.mesh);
      r.material.dispose();
    });
    rings.length = 0;
    clearPins();
    ringGeom.dispose();
    sphereGeom.dispose();
    group.removeFromParent();
  };

  return {
    group,
    triggerPing,
    addPinMarker,
    removePinMarker,
    clearPins,
    tick,
    dispose,
  };
}
