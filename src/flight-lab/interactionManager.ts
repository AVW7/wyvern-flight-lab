import * as THREE from "three";
import type { FlightLabSpecimen } from "./catalog";
import type { FlightLabPlaybackSnapshot } from "./playback";
import {
  findClosestLandmark,
  type FlightLabStrokePhase,
  type ResolvedLandmark,
} from "./anatomicalMap";
import {
  createPinRecord,
  createPingVisualManager,
  type FlightLabPin,
} from "./inspectionPins";
import type { FlightLabEvents, FlightLabHoverLandmark } from "./types";

export interface FlightLabInteractionManager {
  updateLandmarks(landmarks: ResolvedLandmark[]): void;
  updateProbesVisuals(showProbes: boolean): void;
  createPinAtPointer(clientX: number, clientY: number): FlightLabPin | null;
  createPinFromLandmark(landmarkId: string): FlightLabPin | null;
  removePin(pinId: string): void;
  clearPins(): void;
  getPins(): FlightLabPin[];
  getActivePin(): FlightLabPin | null;
  getHoverLandmark(): FlightLabHoverLandmark | null;
  triggerPing(position: THREE.Vector3, colorHex?: string): void;
  tick(delta: number): void;
  dispose(): void;
}

export interface InteractionManagerParams {
  domElement: HTMLCanvasElement;
  scene: THREE.Scene;
  getActiveCamera: () => THREE.Camera;
  getModel: () => THREE.Object3D | null;
  getActiveSpecimen: () => FlightLabSpecimen | null;
  getCurrentClip: () => string;
  getPlaybackSnapshot: () => FlightLabPlaybackSnapshot;
  getCurrentStrokePhase: () => FlightLabStrokePhase;
  events: FlightLabEvents;
  onTelemetryDirty: () => void;
}

export function createFlightLabInteractionManager(
  params: InteractionManagerParams
): FlightLabInteractionManager {
  const {
    domElement,
    scene,
    getActiveCamera,
    getModel,
    getActiveSpecimen,
    getCurrentClip,
    getPlaybackSnapshot,
    getCurrentStrokePhase,
    events,
    onTelemetryDirty,
  } = params;

  let disposed = false;
  let currentLandmarks: ResolvedLandmark[] = [];
  let hoverLandmark: FlightLabHoverLandmark | null = null;
  let activePin: FlightLabPin | null = null;
  const pins: FlightLabPin[] = [];
  let isProbesVisible = false;

  const pingManager = createPingVisualManager();
  scene.add(pingManager.group);

  const probesGroup = new THREE.Group();
  probesGroup.name = "AnatomicalProbesGroup";
  probesGroup.visible = false;
  scene.add(probesGroup);

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const updateProbesVisuals = (showProbes: boolean) => {
    isProbesVisible = showProbes;
    const model = getModel();
    if (!showProbes || !model) {
      probesGroup.visible = false;
      return;
    }
    probesGroup.visible = true;

    // Ensure children match landmarks count
    while (probesGroup.children.length < currentLandmarks.length) {
      const markerGroup = new THREE.Group();

      const coreMat = new THREE.MeshBasicMaterial({
        color: "#ffffff",
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      });
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), coreMat);
      core.renderOrder = 998;
      markerGroup.add(core);

      const ringMat = new THREE.MeshBasicMaterial({
        color: "#ffffff",
        wireframe: true,
        depthTest: false,
        transparent: true,
        opacity: 0.6,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.15, 16), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 998;
      markerGroup.add(ring);

      probesGroup.add(markerGroup);
    }

    // Hide extra children if any
    for (let i = currentLandmarks.length; i < probesGroup.children.length; i++) {
      probesGroup.children[i]!.visible = false;
    }

    // Position markers at live joint world coordinates
    for (let i = 0; i < currentLandmarks.length; i++) {
      const lm = currentLandmarks[i]!;
      const marker = probesGroup.children[i] as THREE.Group;
      marker.visible = true;
      marker.position.copy(lm.worldPosition);

      const core = marker.children[0] as THREE.Mesh;
      const ring = marker.children[1] as THREE.Mesh;
      (core.material as THREE.MeshBasicMaterial).color.set(lm.color);
      (ring.material as THREE.MeshBasicMaterial).color.set(lm.color);

      // Highlight if hovered
      const isHovered = hoverLandmark?.id === lm.id;
      const s = isHovered ? 1.5 : 1.0;
      marker.scale.set(s, s, s);
    }
  };

  const onPointerMove = (event: MouseEvent) => {
    const model = getModel();
    if (!model || disposed) return;
    const rect = domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const camera = getActiveCamera();
    raycaster.setFromCamera(mouse, camera);

    // Check proximity of ray to any landmark joint (sphere of influence)
    let closestLandmark: ResolvedLandmark | null = null;
    let minRayDist = isProbesVisible ? 0.95 : 0.65;

    for (const lm of currentLandmarks) {
      const d = raycaster.ray.distanceToPoint(lm.worldPosition);
      if (d < minRayDist) {
        minRayDist = d;
        closestLandmark = lm;
      }
    }

    // Also check mesh hits if no direct joint proximity hit
    if (!closestLandmark) {
      const hits = raycaster.intersectObject(model, true);
      if (hits.length > 0) {
        const hit = hits[0]!;
        closestLandmark = findClosestLandmark(currentLandmarks, hit.point, 3.2);
      }
    }

    if (closestLandmark) {
      hoverLandmark = {
        id: closestLandmark.id,
        label: closestLandmark.label,
        boneName: closestLandmark.boneName,
        worldPos: {
          x: Number(closestLandmark.worldPosition.x.toFixed(2)),
          y: Number(closestLandmark.worldPosition.y.toFixed(2)),
          z: Number(closestLandmark.worldPosition.z.toFixed(2)),
        },
        rotDeg: {
          x: Number(closestLandmark.rotationEulerDeg.x.toFixed(1)),
          y: Number(closestLandmark.rotationEulerDeg.y.toFixed(1)),
          z: Number(closestLandmark.rotationEulerDeg.z.toFixed(1)),
        },
        parentBoneName: closestLandmark.parentBoneName,
        color: closestLandmark.color,
      };
    } else {
      hoverLandmark = null;
    }
  };

  const onPointerClick = (event: MouseEvent) => {
    const model = getModel();
    if (!model || disposed) return;
    // Don't intercept toolbar or UI clicks
    if ((event.target as HTMLElement).closest("button, aside, nav, select, input")) return;

    const rect = domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const camera = getActiveCamera();
    raycaster.setFromCamera(mouse, camera);

    // Check proximity to landmarks first
    let matchedLandmark: ResolvedLandmark | null = null;
    const hitPos = new THREE.Vector3();
    let minRayDist = 0.95;

    for (const lm of currentLandmarks) {
      const d = raycaster.ray.distanceToPoint(lm.worldPosition);
      if (d < minRayDist) {
        minRayDist = d;
        matchedLandmark = lm;
        hitPos.copy(lm.worldPosition);
      }
    }

    if (!matchedLandmark) {
      const hits = raycaster.intersectObject(model, true);
      if (hits.length > 0) {
        const hit = hits[0]!;
        matchedLandmark = findClosestLandmark(currentLandmarks, hit.point, 3.5) || currentLandmarks[0] || null;
        hitPos.copy(hit.point);
      }
    }

    if (matchedLandmark) {
      pingManager.triggerPing(hitPos, matchedLandmark.color);

      const snapshot = getPlaybackSnapshot();
      const specimen = getActiveSpecimen() ?? { id: "unknown", name: "Wyvern", modelFile: "unknown" };
      const pin = createPinRecord(
        pins.length + 1,
        matchedLandmark,
        specimen,
        getCurrentClip(),
        snapshot.clipTime,
        snapshot.clipProgress,
        getCurrentStrokePhase()
      );

      pins.push(pin);
      pingManager.addPinMarker(pin);
      activePin = pin;

      console.info(`[FlightLab Pin #${pin.index}] ${pin.label} (${pin.boneName}) @ ${pin.clipTime.toFixed(2)}s\n` + pin.aiSnippet);

      events.animationLog?.({
        id: pin.id,
        timestamp: pin.timestamp,
        type: "pin",
        message: `📌 [Pin #${pin.index}] ${pin.label} (\`${pin.boneName}\`) @ ${pin.clipTime.toFixed(2)}s (${Math.round(pin.clipProgress * 100)}%)`,
        details: `Pos: (${pin.worldPos.x.toFixed(2)}, ${pin.worldPos.y.toFixed(2)}, ${pin.worldPos.z.toFixed(2)}) · Phase: ${pin.strokePhase.toUpperCase()}`,
        pin,
      });

      onTelemetryDirty();
    }
  };

  domElement.addEventListener("mousemove", onPointerMove);
  domElement.addEventListener("click", onPointerClick);

  return {
    updateLandmarks(landmarks: ResolvedLandmark[]) {
      currentLandmarks = landmarks;
    },
    updateProbesVisuals,
    createPinAtPointer(clientX: number, clientY: number): FlightLabPin | null {
      const model = getModel();
      if (!model) return null;
      const rect = domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      const camera = getActiveCamera();
      raycaster.setFromCamera(mouse, camera);

      const hits = raycaster.intersectObject(model, true);
      if (hits.length === 0) return null;

      const hit = hits[0]!;
      const landmark = findClosestLandmark(currentLandmarks, hit.point, 3.5) || currentLandmarks[0];
      if (!landmark) return null;

      pingManager.triggerPing(hit.point, landmark.color);
      const snapshot = getPlaybackSnapshot();
      const specimen = getActiveSpecimen() ?? { id: "unknown", name: "Wyvern", modelFile: "unknown" };
      const pin = createPinRecord(
        pins.length + 1,
        landmark,
        specimen,
        getCurrentClip(),
        snapshot.clipTime,
        snapshot.clipProgress,
        getCurrentStrokePhase()
      );

      pins.push(pin);
      pingManager.addPinMarker(pin);
      activePin = pin;
      onTelemetryDirty();
      return pin;
    },
    createPinFromLandmark(landmarkId: string): FlightLabPin | null {
      const landmark = currentLandmarks.find((lm) => lm.id === landmarkId);
      if (!landmark) return null;

      pingManager.triggerPing(landmark.worldPosition, landmark.color);
      const snapshot = getPlaybackSnapshot();
      const specimen = getActiveSpecimen() ?? { id: "unknown", name: "Wyvern", modelFile: "unknown" };
      const pin = createPinRecord(
        pins.length + 1,
        landmark,
        specimen,
        getCurrentClip(),
        snapshot.clipTime,
        snapshot.clipProgress,
        getCurrentStrokePhase()
      );

      pins.push(pin);
      pingManager.addPinMarker(pin);
      activePin = pin;
      onTelemetryDirty();
      return pin;
    },
    removePin(pinId: string) {
      const idx = pins.findIndex((p) => p.id === pinId);
      if (idx !== -1) {
        pins.splice(idx, 1);
        pingManager.removePinMarker(pinId);
        if (activePin?.id === pinId) activePin = pins[pins.length - 1] ?? null;
        onTelemetryDirty();
      }
    },
    clearPins() {
      pins.length = 0;
      pingManager.clearPins();
      activePin = null;
      onTelemetryDirty();
    },
    getPins: () => [...pins],
    getActivePin: () => activePin,
    getHoverLandmark: () => hoverLandmark,
    triggerPing(pos: THREE.Vector3, colorHex?: string) {
      pingManager.triggerPing(pos, colorHex);
    },
    tick(delta: number) {
      pingManager.tick(delta);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      domElement.removeEventListener("mousemove", onPointerMove);
      domElement.removeEventListener("click", onPointerClick);
      pingManager.dispose();
      probesGroup.clear();
      probesGroup.removeFromParent();
      pins.length = 0;
      activePin = null;
      hoverLandmark = null;
    },
  };
}
