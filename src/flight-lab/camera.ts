import * as THREE from "three";
import type { FlightLabCameraPreset } from "./types";

interface PresetData {
  azimuth: number;
  elevation: number;
  distance: number;
  targetX: number;
  targetY: number;
  ortho: boolean;
}

const CAMERA_PRESETS_DATA: Record<FlightLabCameraPreset, PresetData> = {
  chase: { azimuth: 0.56, elevation: 0.25, distance: 22, targetX: 0, targetY: 0, ortho: false },
  takeoff: { azimuth: 1.15, elevation: 0.10, distance: 18, targetX: 0, targetY: 0, ortho: false },
  detail: { azimuth: 0.42, elevation: 0.12, distance: 3.2, targetX: 0, targetY: 0, ortho: false },
  profile: { azimuth: Math.PI / 2, elevation: 0.10, distance: 20, targetX: 0, targetY: 0, ortho: false },
  front: { azimuth: Math.PI, elevation: 0.08, distance: 20, targetX: 0, targetY: 0, ortho: false },
  top: { azimuth: 0.25, elevation: 1.35, distance: 25, targetX: 0, targetY: 0, ortho: false },
  frontOrtho: { azimuth: Math.PI, elevation: 0, distance: 20, targetX: 0, targetY: 0, ortho: true },
  sideOrtho: { azimuth: Math.PI / 2, elevation: 0, distance: 20, targetX: 0, targetY: 0, ortho: true },
  topOrtho: { azimuth: 0, elevation: Math.PI / 2, distance: 25, targetX: 0, targetY: 0, ortho: true },
  threeQuarterOrtho: { azimuth: Math.PI * 0.75, elevation: 0.35, distance: 22, targetX: 0, targetY: 0, ortho: true },
};

export interface FlightLabCameraState {
  preset: FlightLabCameraPreset | null;
  isOrtho: boolean;
  orthoSize: number;
  azimuth: number;
  elevation: number;
  distance: number;
  targetX: number;
  targetY: number;
  followMode: "smooth" | "direct" | "fixed";
}

export interface FlightLabCameraController {
  setPreset(preset: FlightLabCameraPreset): void;
  setAutoOrbit(enabled: boolean): void;
  setFollowMode(mode: "smooth" | "direct" | "fixed"): void;
  fitSpecimen(box: THREE.Box3, margin?: number): void;
  zoomBy(amount: number): void;
  focusTarget(targetX: number, targetY: number, distance?: number): void;
  getDistance(): number;
  isOrthoActive(): boolean;
  getCameraState(): FlightLabCameraState;
  getActiveCamera(): THREE.Camera;
  updateProjection(width: number, height: number): void;
  tick(delta: number, cameraFill?: THREE.DirectionalLight, anchor?: THREE.Vector3 | number): void;
  dispose(): void;
}

export function createFlightLabCamera(
  container: HTMLElement | null,
  perspectiveCamera: THREE.PerspectiveCamera,
  orthographicCamera: THREE.OrthographicCamera
): FlightLabCameraController {
  let azimuth = 0.56;
  let elevation = 0.25;
  let distance = 22;
  let targetX = 0;
  let targetY = 0;
  let autoOrbit = false;
  let orthoSize = 12;
  let isOrtho = false;
  let activePreset: FlightLabCameraPreset | null = null;
  let followMode: "smooth" | "direct" | "fixed" = "smooth";
  let currentFollowedX = 0;
  let currentFollowedY = 0;
  let currentFollowedZ = 0;
  let firstTick = true;

  let dragging = false;
  let panning = false;
  let pointerX = 0;
  let pointerY = 0;

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    panning = event.button === 2 || event.button === 1 || event.shiftKey;
    pointerX = event.clientX;
    pointerY = event.clientY;
    container?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    if (panning) {
      const factor = isOrtho ? orthoSize * 0.004 : Math.max(distance * 0.0006, 0.0035);
      targetX = THREE.MathUtils.clamp(targetX - (event.clientX - pointerX) * factor, -12, 12);
      targetY = THREE.MathUtils.clamp(targetY + (event.clientY - pointerY) * factor, -6, 10);
    } else {
      azimuth -= (event.clientX - pointerX) * 0.007;
      elevation = THREE.MathUtils.clamp(elevation + (event.clientY - pointerY) * 0.006, -0.75, 1.4);
    }
    pointerX = event.clientX;
    pointerY = event.clientY;
  };

  const endPointer = () => {
    dragging = false;
    panning = false;
  };

  const onWheel = (event: WheelEvent) => {
    if (isOrtho) {
      const step = Math.max(orthoSize * 0.0018, 0.02);
      orthoSize = THREE.MathUtils.clamp(orthoSize + event.deltaY * step, 0.6, 60);
      const aspect = perspectiveCamera.aspect || 1;
      orthographicCamera.left = -orthoSize * aspect;
      orthographicCamera.right = orthoSize * aspect;
      orthographicCamera.top = orthoSize;
      orthographicCamera.bottom = -orthoSize;
      orthographicCamera.updateProjectionMatrix();
    } else {
      const step = Math.max(distance * 0.0016, 0.015);
      distance = THREE.MathUtils.clamp(distance + event.deltaY * step, 1.2, 70);
    }
  };

  const onContextMenu = (event: MouseEvent) => event.preventDefault();

  if (container) {
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", endPointer);
    container.addEventListener("pointercancel", endPointer);
    container.addEventListener("lostpointercapture", endPointer);
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("contextmenu", onContextMenu);
  }

  const applyPreset = (preset: FlightLabCameraPreset) => {
    const data = CAMERA_PRESETS_DATA[preset];
    if (!data) return;
    activePreset = preset;
    azimuth = data.azimuth;
    elevation = data.elevation;
    distance = data.distance;
    targetX = data.targetX;
    targetY = data.targetY;
    isOrtho = data.ortho;
    followMode = isOrtho ? "fixed" : "smooth";
    firstTick = true;
    orthoSize = 12;
    if (isOrtho) {
      const aspect = perspectiveCamera.aspect || 1;
      orthographicCamera.left = -orthoSize * aspect;
      orthographicCamera.right = orthoSize * aspect;
      orthographicCamera.top = orthoSize;
      orthographicCamera.bottom = -orthoSize;
      orthographicCamera.updateProjectionMatrix();
    }
  };

  return {
    setPreset: applyPreset,
    setAutoOrbit(enabled: boolean) {
      autoOrbit = enabled;
    },
    setFollowMode(mode: "smooth" | "direct" | "fixed") {
      followMode = mode;
    },
    fitSpecimen(box: THREE.Box3, margin = 1.35) {
      if (box.isEmpty()) return;
      const size = new THREE.Vector3();
      box.getSize(size);

      targetX = 0;
      targetY = 0;

      const maxDim = Math.max(size.x, size.y, size.z, 1.0);
      const radius = maxDim / 2;

      if (isOrtho) {
        orthoSize = THREE.MathUtils.clamp(radius * margin, 0.6, 60);
        const aspect = perspectiveCamera.aspect || 1;
        orthographicCamera.left = -orthoSize * aspect;
        orthographicCamera.right = orthoSize * aspect;
        orthographicCamera.top = orthoSize;
        orthographicCamera.bottom = -orthoSize;
        orthographicCamera.updateProjectionMatrix();
      } else {
        const fov = (perspectiveCamera.fov * Math.PI) / 180;
        const aspect = perspectiveCamera.aspect || 1;
        const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
        const distY = radius / Math.sin(fov / 2);
        const distX = radius / Math.sin(hFov / 2);
        distance = THREE.MathUtils.clamp(Math.max(distX, distY) * margin, 1.2, 70);
      }
    },
    zoomBy(amount: number) {
      if (isOrtho) {
        orthoSize = THREE.MathUtils.clamp(orthoSize + amount * 0.5, 0.6, 60);
        const aspect = perspectiveCamera.aspect || 1;
        orthographicCamera.left = -orthoSize * aspect;
        orthographicCamera.right = orthoSize * aspect;
        orthographicCamera.top = orthoSize;
        orthographicCamera.bottom = -orthoSize;
        orthographicCamera.updateProjectionMatrix();
      } else {
        let effectiveAmount = amount;
        if (amount < 0) {
          if (distance <= 4) {
            effectiveAmount = amount * 0.35;
          } else if (distance <= 8) {
            effectiveAmount = amount * 0.65;
          }
        }
        distance = THREE.MathUtils.clamp(distance + effectiveAmount, 1.2, 70);
      }
    },
    focusTarget(tx: number, ty: number, dist?: number) {
      targetX = THREE.MathUtils.clamp(tx, -12, 12);
      targetY = THREE.MathUtils.clamp(ty, -6, 10);
      if (dist !== undefined) {
        if (isOrtho) {
          orthoSize = THREE.MathUtils.clamp(dist * 0.5, 0.6, 60);
          const aspect = perspectiveCamera.aspect || 1;
          orthographicCamera.left = -orthoSize * aspect;
          orthographicCamera.right = orthoSize * aspect;
          orthographicCamera.top = orthoSize;
          orthographicCamera.bottom = -orthoSize;
          orthographicCamera.updateProjectionMatrix();
        } else {
          distance = THREE.MathUtils.clamp(dist, 1.2, 70);
        }
      }
    },
    getDistance() {
      return isOrtho ? Math.round(orthoSize * 10) / 10 : Math.round(distance * 10) / 10;
    },
    isOrthoActive() {
      return isOrtho;
    },
    getCameraState(): FlightLabCameraState {
      return { preset: activePreset, isOrtho, orthoSize, azimuth, elevation, distance, targetX, targetY, followMode };
    },
    getActiveCamera() {
      return isOrtho ? orthographicCamera : perspectiveCamera;
    },
    updateProjection(width: number, height: number) {
      if (height <= 0) return;
      const aspect = width / height;
      perspectiveCamera.aspect = aspect;
      perspectiveCamera.updateProjectionMatrix();

      orthographicCamera.left = -orthoSize * aspect;
      orthographicCamera.right = orthoSize * aspect;
      orthographicCamera.top = orthoSize;
      orthographicCamera.bottom = -orthoSize;
      orthographicCamera.updateProjectionMatrix();
    },
    tick(delta: number, cameraFill?: THREE.DirectionalLight, anchor?: THREE.Vector3 | number) {
      if (autoOrbit && !dragging) {
        azimuth += delta * 0.35;
      }

      let targetAnchorX = 0;
      let targetAnchorY = 0;
      let targetAnchorZ = 0;

      if (anchor !== undefined) {
        if (typeof anchor === "number") {
          targetAnchorY = anchor;
          currentFollowedY = targetAnchorY;
        } else {
          targetAnchorX = anchor.x;
          targetAnchorY = anchor.y;
          targetAnchorZ = anchor.z;

          if (firstTick || followMode === "direct") {
            currentFollowedX = targetAnchorX;
            currentFollowedY = targetAnchorY;
            currentFollowedZ = targetAnchorZ;
            firstTick = false;
          } else if (followMode === "smooth") {
            const diffY = Math.abs(currentFollowedY - targetAnchorY);
            const dampFactor = diffY > 1.5 ? 12.0 : 8.0;
            currentFollowedX = THREE.MathUtils.damp(currentFollowedX, targetAnchorX, dampFactor, delta);
            currentFollowedY = THREE.MathUtils.damp(currentFollowedY, targetAnchorY, dampFactor, delta);
            currentFollowedZ = THREE.MathUtils.damp(currentFollowedZ, targetAnchorZ, dampFactor, delta);
          } else {
            currentFollowedX = 0;
            currentFollowedY = 0;
            currentFollowedZ = 0;
          }
        }
      } else if (followMode === "fixed") {
        currentFollowedX = 0;
        currentFollowedY = 0;
        currentFollowedZ = 0;
      }

      const followedTargetX = targetX + currentFollowedX;
      const followedTargetY = targetY + currentFollowedY;
      const followedTargetZ = currentFollowedZ;

      if (isOrtho) {
        const camX = followedTargetX + Math.sin(azimuth) * distance;
        const camY = followedTargetY + Math.sin(elevation) * distance;
        const camZ = followedTargetZ + Math.cos(azimuth) * distance;

        orthographicCamera.position.set(camX, camY, camZ);
        orthographicCamera.lookAt(followedTargetX, followedTargetY, followedTargetZ);
        orthographicCamera.updateMatrixWorld(true);
      } else {
        const horizDist = Math.cos(elevation) * distance;
        const camX = followedTargetX + Math.sin(azimuth) * horizDist;
        const camY = followedTargetY + Math.sin(elevation) * distance;
        const camZ = followedTargetZ + Math.cos(azimuth) * horizDist;

        perspectiveCamera.position.set(camX, camY, camZ);
        perspectiveCamera.lookAt(followedTargetX, followedTargetY, followedTargetZ);
      }

      if (cameraFill) {
        cameraFill.position.copy(perspectiveCamera.position).multiplyScalar(0.55);
        cameraFill.position.y += 3;
        cameraFill.target.position.set(followedTargetX, followedTargetY, followedTargetZ);
      }
    },
    dispose() {
      if (!container) return;
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", endPointer);
      container.removeEventListener("pointercancel", endPointer);
      container.removeEventListener("lostpointercapture", endPointer);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("contextmenu", onContextMenu);
    },
  };
}
