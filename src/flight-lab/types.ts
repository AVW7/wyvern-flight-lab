import type { FlightLabSpecimen } from "./catalog";
import type { FlightLabCameraState } from "./camera";
import type { FlightLabPlaybackSnapshot } from "./playback";
import type { FlightLabStrokePhase } from "./anatomicalMap";
import type { FlightLabPin } from "./inspectionPins";

export type FlightLabMode = "ground" | "takeoff" | "cruise" | "bank-left" | "bank-right" | "boost" | "land";
export type FlightLabTheme = "dark" | "light";
export type FlightLabCameraPreset =
  | "chase"
  | "takeoff"
  | "detail"
  | "profile"
  | "front"
  | "top"
  | "frontOrtho"
  | "sideOrtho"
  | "topOrtho"
  | "threeQuarterOrtho";
export type FlightLabComparisonMode = "off" | "ghost" | "formation";

export type { FlightLabStrokePhase, FlightLabPin };

export interface FlightLabAnimationClipInfo {
  name: string;
  duration: number;
  tracksCount: number;
}

export interface FlightLabAnimationEvent {
  id: string;
  timestamp: string;
  type: "load" | "clip" | "mode" | "speed" | "state" | "scan" | "export" | "pin" | "rig" | "compare";
  message: string;
  details?: string;
  pin?: FlightLabPin;
}

export interface FlightLabMeshMetrics {
  triangles: number;
  vertices: number;
  dimensions: { width: number; height: number; depth: number };
}

export interface FlightLabLandmark {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface FlightLabHoverLandmark {
  id: string;
  label: string;
  boneName: string;
  worldPos: { x: number; y: number; z: number };
  rotDeg: { x: number; y: number; z: number };
  parentBoneName?: string;
  color: string;
}

export interface FlightLabComparisonMetrics {
  primarySpecimen: {
    id: string;
    name: string;
    triangles: number;
    bonesCount: number;
    clipsCount: number;
    modelFile: string;
  };
  comparisonSpecimen: {
    id: string;
    name: string;
    triangles: number;
    bonesCount: number;
    clipsCount: number;
    modelFile: string;
  };
}

export interface FlightLabTelemetry {
  speed: number;
  altitude: number;
  bank: number;
  clip: string;
  clipDuration: number;
  clipTime: number;
  clipProgress: number;
  cameraDistance: number;
  isPlaying: boolean;
  speedScale: number;
  effectiveRate: number;
  inspectionFps: number;
  isOrtho: boolean;
  landmarks?: FlightLabLandmark[];
  strokePhase?: FlightLabStrokePhase;
  symmetryDeltaMm?: number;
  symmetryAngleDeg?: number;
  symmetryScorePercent?: number;
  hoverLandmark?: FlightLabHoverLandmark | null;
  activePin?: FlightLabPin | null;
  comparisonMode?: FlightLabComparisonMode;
  pinCount?: number;
  interactiveFlight?: {
    active: boolean;
    airspeedMps: number;
    verticalSpeedMps: number;
    altitudeM: number;
    bankDeg: number;
    pitchDeg: number;
    headingDeg: number;
    gForce: number;
    courseRingCount: number;
    ringsCleared: number;
  };
}

export interface FlightInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  climb: boolean;
  dive: boolean;
  boost: boolean;
}

export interface FlightLabEvents {
  loading?(loading: boolean): void;
  clips?(clips: string[]): void;
  clipDetails?(clips: FlightLabAnimationClipInfo[]): void;
  activeClip?(clip: string): void;
  playbackState?(state: FlightLabPlaybackSnapshot): void;
  telemetry?(telemetry: FlightLabTelemetry): void;
  animationLog?(event: FlightLabAnimationEvent): void;
  metrics?(metrics: FlightLabMeshMetrics | null): void;
  comparisonMetrics?(metrics: FlightLabComparisonMetrics | null): void;
  error?(error: Error | null): void;
  mode?(mode: FlightLabMode): void;
}

export interface FlightLabRuntime {
  loadSpecimen(specimen: FlightLabSpecimen): Promise<void>;
  setMode(mode: FlightLabMode): void;
  playClip(name: string): void;
  playOneShot(name: string): void;
  seek(timeSeconds: number): void;
  stepFrames(frames: number): void;
  setInspectionFps(fps: number): void;
  getPlaybackSnapshot(): FlightLabPlaybackSnapshot;
  setLoop(loop: boolean): void;
  setPaused(paused: boolean): void;
  setSpeed(speed: number): void;
  setTheme(theme: FlightLabTheme): void;
  setCameraPreset(preset: FlightLabCameraPreset): void;
  setSkeleton(enabled: boolean): void;
  setWireframe(enabled: boolean): void;
  setSilhouette(enabled: boolean): void;
  setStreamlines(enabled: boolean): void;
  setAutoOrbit(enabled: boolean): void;
  setFloorVisible(enabled: boolean): void;
  setProbesVisible(enabled: boolean): void;
  setComparisonMode(mode: FlightLabComparisonMode): Promise<void>;
  setInteractiveFlightActive(active: boolean): void;
  isInteractiveFlightActive(): boolean;
  setInteractiveFlightInput(input: Partial<FlightInputState>): void;
  resetInteractiveFlight(): void;
  createPinAtPointer(clientX: number, clientY: number): FlightLabPin | null;
  createPinFromLandmark(landmarkId: string): FlightLabPin | null;
  removePin(pinId: string): void;
  clearPins(): void;
  getPins(): FlightLabPin[];
  dumpDiagnostics(): string;
  scanSeam(): void;
  exportEvidence(): void;
  zoomBy(amount: number): void;
  focusTarget(targetX: number, targetY: number, distance?: number): void;
  resetCamera(): void;
  fitCamera(): void;
  getCameraState(): FlightLabCameraState;
  dispose(): void;
}

export type { FlightLabCameraState };
