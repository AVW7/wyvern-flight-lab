import type * as THREE from "three";
import type { FlightLabSpecimen } from "./catalog";
import type { FlightLabCameraState } from "./camera";
import type { FlightLabPlaybackSnapshot } from "./playback";
import type { BilateralSymmetryMetrics, FlightLabStrokePhase, ResolvedLandmark } from "./anatomicalMap";
import type { FlightLabPin } from "./inspectionPins";
import type { PoseAnomaly } from "./poseEnvelope";
import type { FlightLabComparisonMode, FlightLabMode } from "./types";

/**
 * The dev inbox. Fixed filenames on purpose — the route accepts content, never a
 * path. Kept here rather than in `evidenceInbox.ts` so the browser bundle can
 * print the same strings the route writes to.
 */
export const INBOX_DIR = "docs/flight-lab/inbox";
export const ISSUE_PATH = `${INBOX_DIR}/latest-issue.md`;
export const CAPTURE_PATH = `${INBOX_DIR}/latest-capture.png`;
export const TELEMETRY_PATH = `${INBOX_DIR}/latest-capture.json`;

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
  /** Pose-envelope findings for the active clip, collected at export time. */
  anomalies: PoseAnomaly[];
  proceduralRigEnabled: boolean;
}

/** 24 fps is the Blender scene's frame rate — the frame number must match it. */
const CLIP_FPS = 24;

export function clipFrameNumber(clipTime: number): number {
  return Math.round(clipTime * CLIP_FPS);
}

/**
 * `catalog.ts` stores the bare filename; an agent needs the path it can open.
 * Absolute-looking values pass through so this cannot double-prefix.
 */
function modelPath(specimen: FlightLabSpecimen | null): string {
  const file = specimen?.modelFile;
  if (!file) return "—";
  return file.includes("/") ? file : `public/models/${file}`;
}

/**
 * The JSON sidecar. Pure so the download fallback and the inbox route write the
 * *same* document — a sidecar that disagrees with the markdown is worse than no
 * sidecar.
 */
export function buildEvidenceTelemetry(
  params: Omit<EvidenceCaptureParams, "renderer"> & { captureId: string; generatedAt?: string },
) {
  const {
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
    anomalies,
    proceduralRigEnabled,
    captureId,
    generatedAt,
  } = params;

  return {
    version: "3.0",
    captureId,
    timestamp: generatedAt ?? new Date().toISOString(),
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
      frame: clipFrameNumber(snapshot.clipTime),
      fps: CLIP_FPS,
      looping: snapshot.isLooping,
      strokePhase,
    },
    proceduralRigEnabled,
    symmetry,
    mode,
    comparisonMode,
    playback: {
      status: snapshot.status,
      speedScale: snapshot.speedScale,
      effectiveRate: snapshot.effectiveRate,
      inspectionFps: snapshot.inspectionFps,
    },
    camera: cameraState,
    anomalies,
    landmarks: landmarks.map((lm) => ({
      id: lm.id,
      label: lm.label,
      bone: lm.boneName,
      worldPos: { x: lm.worldPosition.x, y: lm.worldPosition.y, z: lm.worldPosition.z },
      rotDeg: { x: lm.rotationEulerDeg.x, y: lm.rotationEulerDeg.y, z: lm.rotationEulerDeg.z },
    })),
    pins,
  };
}

const magnitude = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
const fmtDeg = (value: number) => `${value.toFixed(1)}°`;

function anomalyRows(anomalies: PoseAnomaly[]): string[] {
  if (anomalies.length === 0) return ["No findings. The clip holds inside the pose envelope at export time."];
  const rows = [
    "| kind | clip | bone | measured | limit | frame | time |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const anomaly of anomalies) {
    const measured = anomaly.unit === "rig" ? anomaly.value.toFixed(2) : fmtDeg(anomaly.value);
    const limit = anomaly.unit === "rig" ? anomaly.threshold.toFixed(2) : fmtDeg(anomaly.threshold);
    rows.push(
      `| ${anomaly.kind} | ${anomaly.clip} | \`${anomaly.boneName}\` | ${measured} | ${limit} | #${anomaly.frame} | ${anomaly.time.toFixed(2)}s |`,
    );
  }
  return rows;
}

/**
 * The issue document. Written for a *coding agent* that has the repo but none of
 * this conversation: it has to say what is wrong, on which bone and frame, what
 * the rig was doing, and where the picture is.
 */
export function buildEvidenceMarkdown(
  params: Omit<EvidenceCaptureParams, "renderer"> & {
    captureId: string;
    generatedAt?: string;
    /** True when the user asked for this from a single pin's `Save for AI`. */
    pinOnly?: boolean;
  },
): string {
  const {
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
    anomalies,
    proceduralRigEnabled,
    captureId,
    generatedAt,
    pinOnly,
  } = params;

  const generated = generatedAt ?? new Date().toISOString();
  const frame = clipFrameNumber(snapshot.clipTime);
  const notes = pins.map((pin) => pin.note?.trim()).filter((note): note is string => Boolean(note));

  // With no note the doc still has to say something actionable, so fall back to
  // the joints that deviate most from bind — the ones a human would have pinned.
  const worstLandmarks = [...landmarks]
    .filter((lm) => lm.layers)
    .sort(
      (a, b) =>
        magnitude(b.layers!.clipDeltaEulerDeg) + magnitude(b.layers!.proceduralDeltaEulerDeg) -
        (magnitude(a.layers!.clipDeltaEulerDeg) + magnitude(a.layers!.proceduralDeltaEulerDeg)),
    )
    .slice(0, 5);

  const lines: string[] = [
    `# Flight Lab issue — ${specimen?.name ?? "no specimen"} / ${currentClip} / frame #${frame}`,
    "",
    `> Written by **${pinOnly ? "Save for AI" : "Export"}** in Flight Lab at ${generated}. Re-exporting overwrites this file.`,
    `> Screenshot: \`${CAPTURE_PATH}\` · telemetry: \`${TELEMETRY_PATH}\` · capture id: \`${captureId}\``,
    "",
    "## What looks wrong",
    "",
  ];

  if (notes.length > 0) {
    for (const note of notes) lines.push(`- ${note}`);
  } else if (pins.length > 0) {
    lines.push("- (No note was typed. The pinned joints below are what was clicked.)");
  } else {
    lines.push("- (No pin and no note. The joints that deviate most from bind are listed below.)");
  }

  lines.push(
    "",
    "## Where",
    "",
    "| field | value |",
    "| --- | --- |",
    `| Specimen | ${specimen?.name ?? "—"} (\`${specimen?.id ?? "—"}\`) |`,
    `| Model file | \`${modelPath(specimen)}\` |`,
    `| Clip | \`${currentClip}\` — ${snapshot.clipTime.toFixed(2)} s of ${snapshot.clipDuration} s (${Math.round(snapshot.clipProgress * 100)}%) |`,
    `| Frame | #${frame} @ ${CLIP_FPS} fps |`,
    `| Flight state | ${mode} · stroke ${strokePhase.toUpperCase()} |`,
    `| Procedural rig | ${proceduralRigEnabled ? "ON (clip + flightRig)" : "OFF (raw .glb tracks)"} |`,
    `| Comparison | ${comparisonMode} |`,
    `| Camera | preset \`${cameraState.preset}\`, distance ${cameraState.distance.toFixed(2)} |`,
    `| Symmetry | ${symmetry ? `${symmetry.symmetryScorePercent}% (height Δ${symmetry.deltaHeightMm} mm, span Δ${symmetry.deltaSpanMm} mm)` : "not measured"} |`,
    "",
  );

  lines.push(`## Pinned joints (${pins.length})`, "");
  if (pins.length > 0) {
    // A pin keeps the frame it was taken at, which is usually *not* the current
    // frame — saying so once here stops the two numbers reading as a contradiction.
    if (pins.some((pin) => pin.frame !== frame)) {
      lines.push(
        `The canvas is at frame #${frame}; each pin below names the frame it was taken at.`,
        "",
      );
    }
    pins.forEach((pin, index) => {
      lines.push(pin.aiSnippet);
      if (index < pins.length - 1) lines.push("");
    });
  } else {
    lines.push("No inspection pins. The five joints furthest from bind at this frame:");
    lines.push("");
    lines.push("| bone | clip delta | procedural delta | horizon pitch |");
    lines.push("| --- | --- | --- | --- |");
    for (const lm of worstLandmarks) {
      lines.push(
        `| \`${lm.boneName}\` | ${fmtDeg(magnitude(lm.layers!.clipDeltaEulerDeg))} | ${fmtDeg(magnitude(lm.layers!.proceduralDeltaEulerDeg))} | ${fmtDeg(lm.layers!.worldHorizonEulerDeg.x)} |`,
      );
    }
  }

  lines.push("", `## Pose envelope scan — \`${currentClip}\``, "");
  lines.push(...anomalyRows(anomalies));

  lines.push(
    "",
    "## How to reproduce",
    "",
    `1. Open \`/flight-lab\` and select specimen \`${specimen?.id ?? "—"}\` (${modelPath(specimen)}).`,
    `2. Play clip \`${currentClip}\`, pause at ${snapshot.clipTime.toFixed(2)} s (frame #${frame}).`,
    `3. ${proceduralRigEnabled ? "Leave **Proc** on" : "Turn **Proc** off"}${comparisonMode === "raw" ? ", and engage **Raw** to compare against the ghost" : ""}.`,
    `4. Compare against \`${CAPTURE_PATH}\`.`,
    "",
    "## Notes for the agent",
    "",
    "- This file and its screenshot are overwritten by the next export; copy them if you need history.",
    `- Telemetry sidecar \`${TELEMETRY_PATH}\` carries the full landmark list and the raw anomaly records.`,
    "- `Bind Delta` is the baked clip vs the bind pose; `Procedural Delta` is what `src/flight-lab/rig/` added on top. A defect with a large bind delta and a small procedural delta lives in the `.glb` track, not in the runtime rig.",
    "",
  );

  return lines.join("\n");
}

export interface EvidenceSubmitResult {
  ok: boolean;
  issuePath: string;
  capturePath: string;
  telemetryPath: string;
  message: string;
}

/**
 * POST the capture to the dev inbox route. Returns a result instead of throwing:
 * the caller falls back to a browser download when the route is not there
 * (production build, static export, `next start` without the dev flag).
 */
export async function submitEvidenceReport(payload: {
  captureId: string;
  png: string;
  markdown: string;
  telemetry: unknown;
}): Promise<EvidenceSubmitResult> {
  const base = { ok: false, issuePath: ISSUE_PATH, capturePath: CAPTURE_PATH, telemetryPath: TELEMETRY_PATH };
  try {
    const response = await fetch("/api/flight-lab/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ...base, message: `inbox route returned ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}` };
    }
    return { ...base, ok: true, message: `wrote ${ISSUE_PATH} + ${CAPTURE_PATH}` };
  } catch (error) {
    return { ...base, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Browser-download fallback, kept for builds where the dev route does not exist.
 * Same telemetry builder as the inbox path.
 */
export function exportEvidenceCapture(params: EvidenceCaptureParams): { captureId: string } {
  const canvas = params.renderer.domElement;
  const dataURL = canvas.toDataURL("image/png");
  const captureId = `capture-${params.specimen?.id ?? "wyvern"}-${Date.now()}`;
  const { renderer: _renderer, ...rest } = params;
  const payload = buildEvidenceTelemetry({ ...rest, captureId });

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
