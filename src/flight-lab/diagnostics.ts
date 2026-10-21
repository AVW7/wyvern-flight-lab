import * as THREE from "three";
import type { FlightLabMeshMetrics, FlightLabMode, FlightLabTheme } from "./types";

export function computeMeshMetrics(model: THREE.Object3D): FlightLabMeshMetrics {
  let triangles = 0;
  let vertices = 0;

  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry;
    if (geom.index) {
      triangles += geom.index.count / 3;
    } else if (geom.attributes.position) {
      triangles += geom.attributes.position.count / 3;
    }
    if (geom.attributes.position) {
      vertices += geom.attributes.position.count;
    }
  });

  const bbox = new THREE.Box3().setFromObject(model);
  const bboxSize = bbox.getSize(new THREE.Vector3());

  return {
    triangles: Math.round(triangles),
    vertices: Math.round(vertices),
    dimensions: {
      width: Number(bboxSize.x.toFixed(2)),
      height: Number(bboxSize.y.toFixed(2)),
      depth: Number(bboxSize.z.toFixed(2)),
    },
  };
}

export function applyWireframe(model: THREE.Object3D | null, enabled: boolean): void {
  if (!model) return;
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((m) => {
      if ("wireframe" in m) {
        (m as THREE.MeshStandardMaterial).wireframe = enabled;
      }
    });
  });
}

export interface SkeletonDiagnostics {
  update(model: THREE.Object3D | null, enabled: boolean): void;
  tick(): void;
  setTheme(theme: FlightLabTheme): void;
  dispose(): void;
}

export function createSkeletonDiagnostics(scene: THREE.Scene, initialTheme: FlightLabTheme): SkeletonDiagnostics {
  let skeletonHelper: THREE.SkeletonHelper | null = null;
  let currentTheme = initialTheme;
  let isEnabled = false;

  const rebuild = (model: THREE.Object3D | null) => {
    if (skeletonHelper) {
      skeletonHelper.removeFromParent();
      (skeletonHelper.material as THREE.Material).dispose();
      skeletonHelper = null;
    }
    if (isEnabled && model) {
      skeletonHelper = new THREE.SkeletonHelper(model);
      (skeletonHelper.material as THREE.LineBasicMaterial).color.set(currentTheme === "light" ? "#111111" : "#ffffff");
      (skeletonHelper.material as THREE.LineBasicMaterial).transparent = true;
      (skeletonHelper.material as THREE.LineBasicMaterial).opacity = 0.85;
      (skeletonHelper.material as THREE.LineBasicMaterial).depthTest = false;
      scene.add(skeletonHelper);
    }
  };

  return {
    update(model: THREE.Object3D | null, enabled: boolean) {
      isEnabled = enabled;
      rebuild(model);
    },
    tick() {
      if (skeletonHelper) {
        skeletonHelper.updateMatrixWorld(true);
      }
    },
    setTheme(theme: FlightLabTheme) {
      currentTheme = theme;
      if (skeletonHelper) {
        (skeletonHelper.material as THREE.LineBasicMaterial).color.set(theme === "light" ? "#111111" : "#ffffff");
      }
    },
    dispose() {
      if (skeletonHelper) {
        skeletonHelper.removeFromParent();
        (skeletonHelper.material as THREE.Material).dispose();
        skeletonHelper = null;
      }
    },
  };
}

export interface SilhouetteDiagnostics {
  apply(model: THREE.Object3D | null, enabled: boolean): void;
  setTheme(theme: FlightLabTheme): void;
  clear(): void;
}

export function createSilhouetteDiagnostics(initialTheme: FlightLabTheme): SilhouetteDiagnostics {
  const silhouetteMaterial = new THREE.MeshBasicMaterial({
    color: initialTheme === "light" ? "#0a0a0a" : "#ffffff",
  });

  return {
    apply(model: THREE.Object3D | null, enabled: boolean) {
      if (!model) return;
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (enabled) {
          if (!mesh.userData.__origMaterial) {
            mesh.userData.__origMaterial = mesh.material;
          }
          mesh.material = silhouetteMaterial;
        } else if (mesh.userData.__origMaterial) {
          mesh.material = mesh.userData.__origMaterial;
        }
      });
    },
    setTheme(theme: FlightLabTheme) {
      silhouetteMaterial.color.set(theme === "light" ? "#0a0a0a" : "#ffffff");
    },
    clear() {
      // Nothing needed on clear; original materials are saved on mesh.userData
    },
  };
}

export interface VortexTrails {
  update(
    model: THREE.Object3D | null,
    enabled: boolean,
    targetSpan: number,
    delta: number,
    mode: FlightLabMode
  ): void;
  setTheme(theme: FlightLabTheme): void;
  dispose(): void;
}

export function createVortexTrails(scene: THREE.Scene, initialTheme: FlightLabTheme): VortexTrails {
  const TRAIL_LENGTH = 32;
  const leftTrailPositions = new Float32Array(TRAIL_LENGTH * 3);
  const rightTrailPositions = new Float32Array(TRAIL_LENGTH * 3);
  const leftTrailGeom = new THREE.BufferGeometry();
  const rightTrailGeom = new THREE.BufferGeometry();
  leftTrailGeom.setAttribute("position", new THREE.BufferAttribute(leftTrailPositions, 3));
  rightTrailGeom.setAttribute("position", new THREE.BufferAttribute(rightTrailPositions, 3));

  const trailMaterial = new THREE.LineBasicMaterial({
    color: initialTheme === "light" ? "#111111" : "#ffffff",
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });

  const leftTrailLine = new THREE.Line(leftTrailGeom, trailMaterial);
  const rightTrailLine = new THREE.Line(rightTrailGeom, trailMaterial);
  leftTrailLine.visible = false;
  rightTrailLine.visible = false;
  scene.add(leftTrailLine, rightTrailLine);

  return {
    update(model, enabled, targetSpan, delta, mode) {
      if (enabled && model && mode !== "ground") {
        leftTrailLine.visible = true;
        rightTrailLine.visible = true;

        const span = targetSpan > 0 ? targetSpan : 8;
        const leftTipLocal = new THREE.Vector3(-span * 0.44, 0.3, 0.1);
        const rightTipLocal = new THREE.Vector3(span * 0.44, 0.3, 0.1);
        const leftTipWorld = leftTipLocal.applyMatrix4(model.matrixWorld);
        const rightTipWorld = rightTipLocal.applyMatrix4(model.matrixWorld);

        const streamSpeed = (mode === "boost" ? 28 : 14) * delta;
        for (let i = TRAIL_LENGTH - 1; i > 0; i--) {
          const curr = i * 3;
          const prev = (i - 1) * 3;
          leftTrailPositions[curr] = leftTrailPositions[prev] ?? 0;
          leftTrailPositions[curr + 1] = leftTrailPositions[prev + 1] ?? 0;
          leftTrailPositions[curr + 2] = (leftTrailPositions[prev + 2] ?? 0) - streamSpeed;

          rightTrailPositions[curr] = rightTrailPositions[prev] ?? 0;
          rightTrailPositions[curr + 1] = rightTrailPositions[prev + 1] ?? 0;
          rightTrailPositions[curr + 2] = (rightTrailPositions[prev + 2] ?? 0) - streamSpeed;
        }
        leftTrailPositions[0] = leftTipWorld.x;
        leftTrailPositions[1] = leftTipWorld.y;
        leftTrailPositions[2] = leftTipWorld.z;

        rightTrailPositions[0] = rightTipWorld.x;
        rightTrailPositions[1] = rightTipWorld.y;
        rightTrailPositions[2] = rightTipWorld.z;

        (leftTrailGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (rightTrailGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      } else {
        leftTrailLine.visible = false;
        rightTrailLine.visible = false;
      }
    },
    setTheme(theme: FlightLabTheme) {
      trailMaterial.color.set(theme === "light" ? "#111111" : "#ffffff");
    },
    dispose() {
      leftTrailLine.removeFromParent();
      rightTrailLine.removeFromParent();
      leftTrailGeom.dispose();
      rightTrailGeom.dispose();
      trailMaterial.dispose();
    },
  };
}

export function applyGhostMaterial(model: THREE.Object3D | null, enabled: boolean): void {
  if (!model) return;
  const ghostMaterial = new THREE.MeshStandardMaterial({
    color: "#06b6d4",
    emissive: "#0891b2",
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.8,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });

  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (enabled) {
      if (!mesh.userData.__origMaterial) {
        mesh.userData.__origMaterial = mesh.material;
      }
      mesh.material = ghostMaterial;
    } else if (mesh.userData.__origMaterial) {
      mesh.material = mesh.userData.__origMaterial;
    }
  });
}

import { sampleHarvestedElevation } from "./rig/harvestedWingProfiles";

/**
 * Compute alignment score [0, 1] between current live wing transforms and
 * harvested V1 Drogon aerodynamic profile.
 */
export function computeWingHarvestAlignment(
  leftWingHand: THREE.Object3D | null,
  rightWingHand: THREE.Object3D | null,
  normalizedPhase: number
): number {
  if (!leftWingHand || !rightWingHand) return 1.0;
  const expectedElev = sampleHarvestedElevation(normalizedPhase, 0.45);
  const leftPitch = leftWingHand.rotation.x;
  const error = Math.abs(leftPitch - expectedElev);
  return Math.max(0, Math.min(1, 1 - error / (Math.PI * 0.5)));
}

