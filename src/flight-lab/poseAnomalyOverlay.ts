import * as THREE from "three";
import type { PoseAnomaly } from "./poseEnvelope";

/**
 * Viewport readout for `poseEnvelope` findings (Task E1.2).
 *
 * The detector already writes the numbers to the animation log, but a log line
 * does not say *where* the rig is wrong. This paints a pulsing `#ef4444` sonar
 * ring on every bone the last `Scan` flagged, and keeps the ring on the bone
 * while the clip plays — the ring is a bone follower, not a one-shot ping, so
 * the same ring reads as "this joint" for the whole clip.
 *
 * Three deliberate choices:
 *
 *   - **Camera-facing, not ground-plane.** `createPingVisualManager` lays its
 *     ripple flat (`rotation.x = -PI/2`) because a ping marks a point on a
 *     surface. A failing joint is a point in space and can be seen from below,
 *     so these rings billboard instead.
 *   - **Depth test off, additive.** A neck defect is usually inside the
 *     silhouette of the animal; a depth-tested ring would be hidden exactly
 *     when it matters. Same convention as the anatomical probes (`renderOrder`
 *     997–999).
 *   - **One ring per bone, not per anomaly.** `idle`'s historical defect
 *     produced four anomalies on three bones (`Neck1`, `Neck2`, `Head` plus the
 *     cumulative horizon line on `Head`). Three rings is the honest picture;
 *     four would double-draw the head.
 */

export interface PoseAnomalyOverlay {
  readonly group: THREE.Group;
  /** Replace the current rings. Bones the model does not have are skipped. */
  setAnomalies(anomalies: readonly PoseAnomaly[], model: THREE.Object3D | null): void;
  clear(): void;
  /** Advance the pulse and re-anchor every ring on its bone. */
  tick(delta: number, camera?: THREE.Camera | null): void;
  /** Bones currently ringed, in the order they were added. */
  getRingedBones(): string[];
  dispose(): void;
}

export const POSE_ANOMALY_RING_COLOR = "#ef4444";
/** Seconds for one full sonar expansion. */
const PULSE_PERIOD = 1.4;

interface Ring {
  boneName: string;
  bone: THREE.Object3D;
  holder: THREE.Group;
  halo: THREE.Mesh;
  pulse: THREE.Mesh;
  pulseMaterial: THREE.MeshBasicMaterial;
  /** Phase offset so several rings do not pulse in lockstep. */
  offset: number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function createPoseAnomalyOverlay(scene: THREE.Scene): PoseAnomalyOverlay {
  const group = new THREE.Group();
  group.name = "PoseAnomalyOverlay";
  group.visible = false;
  scene.add(group);

  const haloGeometry = new THREE.RingGeometry(0.72, 0.98, 40);
  const pulseGeometry = new THREE.RingGeometry(0.9, 1.0, 48);

  let rings: Ring[] = [];
  let elapsed = 0;

  const clear = () => {
    for (const ring of rings) {
      ring.holder.removeFromParent();
      (ring.halo.material as THREE.Material).dispose();
      ring.pulseMaterial.dispose();
    }
    rings = [];
    group.visible = false;
  };

  const positionRing = (ring: Ring) => {
    ring.bone.updateWorldMatrix(true, false);
    ring.bone.getWorldPosition(ring.holder.position);
  };

  const setAnomalies = (anomalies: readonly PoseAnomaly[], model: THREE.Object3D | null) => {
    clear();
    if (!model || anomalies.length === 0) return;

    // Worst finding per bone: `value / threshold` is the same ranking the log
    // and the detector use, so the ring and the log agree on which one wins.
    const worst = new Map<string, PoseAnomaly>();
    for (const anomaly of anomalies) {
      const severity = Math.abs(anomaly.value) / Math.max(anomaly.threshold, 1e-6);
      const current = worst.get(anomaly.boneName);
      if (!current || severity > Math.abs(current.value) / Math.max(current.threshold, 1e-6)) {
        worst.set(anomaly.boneName, anomaly);
      }
    }

    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const height = box.isEmpty() ? 8.4 : box.getSize(new THREE.Vector3()).y;
    // Sized against the model, not in absolute units: the lab normalizes every
    // specimen to ~8.4 units, and the candidates are 100x apart at source.
    const radius = THREE.MathUtils.clamp(height * 0.028, 0.1, 0.32);

    let index = 0;
    for (const [boneName] of worst) {
      const bone = model.getObjectByName(boneName);
      if (!bone) continue;

      const holder = new THREE.Group();
      holder.name = `PoseAnomaly:${boneName}`;

      const haloMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(POSE_ANOMALY_RING_COLOR),
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.scale.setScalar(radius);
      halo.renderOrder = 997;
      holder.add(halo);

      const pulseMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(POSE_ANOMALY_RING_COLOR),
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
      pulse.scale.setScalar(radius);
      pulse.renderOrder = 998;
      holder.add(pulse);

      group.add(holder);
      rings.push({
        boneName,
        bone,
        holder,
        halo,
        pulse,
        pulseMaterial,
        offset: index * 0.37,
      });
      index += 1;
    }

    group.visible = rings.length > 0;
    elapsed = 0;
    for (const ring of rings) positionRing(ring);
  };

  const tick = (delta: number, camera?: THREE.Camera | null) => {
    if (rings.length === 0) return;
    elapsed += delta;

    for (const ring of rings) {
      positionRing(ring);
      if (camera) ring.holder.quaternion.copy(camera.quaternion);

      const phase = ((elapsed + ring.offset) % PULSE_PERIOD) / PULSE_PERIOD;
      const scale = THREE.MathUtils.lerp(0.9, 1.9, easeOutCubic(phase));
      ring.pulse.scale.setScalar(scale);
      ring.pulseMaterial.opacity = (1 - phase) * 0.85;
      (ring.halo.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.25 * Math.sin(elapsed * 4 + ring.offset);
    }
  };

  const getRingedBones = () => rings.map((ring) => ring.boneName);

  const dispose = () => {
    clear();
    haloGeometry.dispose();
    pulseGeometry.dispose();
    group.removeFromParent();
  };

  return { group, setAnomalies, clear, tick, getRingedBones, dispose };
}
