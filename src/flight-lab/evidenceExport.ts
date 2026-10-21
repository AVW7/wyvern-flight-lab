import type * as THREE from "three";
import type { FlightLabSpecimen } from "./catalog";
import type { FlightLabCameraState } from "./camera";
import type { FlightLabPlaybackSnapshot } from "./playback";
import type { BilateralSymmetryMetrics, FlightLabStrokePhase, ResolvedLandmark } from "./anatomicalMap";
import type { FlightLabPin } from "./inspectionPins";
import type { FlightLabComparisonMode, FlightLabMode } from "./types";

export interface DiagnosticsReportParams {
  specimen: FlightLabSpecimen | null;
  currentClip: string;
  snapshot: FlightLabPlaybackSnapshot;
  mode: FlightLabMode;
  strokePhase: FlightLabStrokePhase;
  symmetry: BilateralSymmetryMetrics | null;
  landmarks: ResolvedLandmark[];
  pins: FlightLabPin[];
}

export function formatDiagnosticsReport(params: {
  specimen: FlightLabSpecimen | null;
  currentClip: string;
  snapshot: FlightLabPlaybackSnapshot;
  mode: FlightLabMode;
  strokePhase: FlightLabStrokePhase;
  symmetry: BilateralSymmetryMetrics | null;
  landmarks: ResolvedLandmark[];
  pins: FlightLabPin[];
}): string {
  const { specimen, currentClip, snapshot, mode, strokePhase, symmetry, landmarks, pins } = params;
  const lines = [
    "==================================================",
    `WYVERN FLIGHT LAB DIAGNOSTIC REPORT: ${specimen?.name ?? "None"}`,
    "==================================================",
    `Generated: ${new Date().toISOString()}`,
    `Specimen: ${specimen?.id} (${specimen?.modelFile})`,
    `Clip: "${currentClip}" | Duration: ${snapshot.clipDuration}s | Time: ${snapshot.clipTime}s (${Math.round(snapshot.clipProgress * 100)}%)`,
    `Flight State: ${mode} | Stroke Phase: ${strokePhase.toUpperCase()}`,
    `Playback: ${snapshot.status} @ ${snapshot.effectiveRate.toFixed(2)}x (FPS: ${snapshot.inspectionFps})`,
    "",
    "--- BILATERAL SYMMETRY ---",
    `Height Delta: ${symmetry?.deltaHeightMm ?? 0} mm`,
    `Span Delta: ${symmetry?.deltaSpanMm ?? 0} mm`,
    `Dihedral Angle: ${symmetry?.symmetryAngleDeg ?? 0}°`,
    `Symmetry Score: ${symmetry?.symmetryScorePercent ?? 100}%`,
    "",
    "--- KEY ANATOMICAL LANDMARKS ---",
    ...landmarks.map((lm) =>
      `[${lm.category}] ${lm.label.padEnd(32)} | Bone: ${lm.boneName.padEnd(20)} | Pos: (${lm.worldPosition.x.toFixed(2)}, ${lm.worldPosition.y.toFixed(2)}, ${lm.worldPosition.z.toFixed(2)}) | Rot: (${lm.rotationEulerDeg.x.toFixed(1)}°, ${lm.rotationEulerDeg.y.toFixed(1)}°, ${lm.rotationEulerDeg.z.toFixed(1)}°)`
    ),
    "",
    `--- ACTIVE INSPECTION PINS (${pins.length}) ---`,
    ...pins.map((p) => p.aiSnippet),
    "==================================================",
  ];

  return lines.join("\n");
}

export interface EvidenceCaptureParams {
  renderer: THREE.WebGLRenderer;
  specimen: FlightLabSpecimen | null;
  currentClip: string;
  snapshot: FlightLabPlaybackSnapshot;
  mode: FlightLabMode;
  comparisonMode: FlightLabComparisonMode;
  cameraState: FlightLabCameraState;
  strokePhase: FlightLabStrokePhase;
  symmetry: BilateralSymmetryMetrics | null;
  landmarks: ResolvedLandmark[];
  pins: FlightLabPin[];
}

export function exportEvidenceCapture(params: EvidenceCaptureParams): { captureId: string } {
  const {
    renderer,
    specimen,
    currentClip,
    snapshot,
    mode,
    comparisonMode,
    cameraState,
    strokePhase,
    symmetry,
    landmarks,
    pins,
  } = params;

  const canvas = renderer.domElement;
  const dataURL = canvas.toDataURL("image/png");
  const captureId = `capture-${specimen?.id ?? "wyvern"}-${Date.now()}`;
  const payload = {
    version: "2.0",
    captureId,
    timestamp: new Date().toISOString(),
    specimen: {
      id: specimen?.id ?? null,
      name: specimen?.name ?? null,
      modelFile: specimen?.modelFile ?? null,
    },
    clip: {
      name: currentClip,
      duration: snapshot.clipDuration,
      time: snapshot.clipTime,
      progress: snapshot.clipProgress,
      looping: snapshot.isLooping,
      strokePhase,
    },
    symmetry,
    mode,
    comparisonMode,
    playback: {
      status: snapshot.status,
      speedScale: snapshot.speedScale,
      effectiveRate: snapshot.effectiveRate,
      inspectionFps: snapshot.inspectionFps,
    },
    camera: {
      ...cameraState,
      viewWidth: canvas.width,
      viewHeight: canvas.height,
      pixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    },
    landmarks: landmarks.map((lm) => ({
      id: lm.id,
      label: lm.label,
      bone: lm.boneName,
      worldPos: { x: lm.worldPosition.x, y: lm.worldPosition.y, z: lm.worldPosition.z },
      rotDeg: { x: lm.rotationEulerDeg.x, y: lm.rotationEulerDeg.y, z: lm.rotationEulerDeg.z },
    })),
    pins,
  };

  if (typeof document !== "undefined") {
    const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const jsonURL = URL.createObjectURL(jsonBlob);

    const dlPng = document.createElement("a");
    dlPng.href = dataURL;
    dlPng.download = `${captureId}.png`;
    dlPng.click();

    const dlJson = document.createElement("a");
    dlJson.href = jsonURL;
    dlJson.download = `${captureId}.json`;
    dlJson.click();

    URL.revokeObjectURL(jsonURL);
  }

  return { captureId };
}
