import type {
  FlightLabCameraState,
  FlightLabComparisonMode,
  FlightLabMode,
  FlightLabTheme,
} from "./types";

export interface FlightLabInspectionPreset {
  version: 1;
  presetName: string;
  timestamp: string;
  specimenId: string;
  mode: FlightLabMode;
  clipName: string;
  clipTime: number;
  speedScale: number;
  inspectionFps: number;
  cameraState: FlightLabCameraState;
  theme: FlightLabTheme;
  showSkeleton: boolean;
  showWireframe: boolean;
  showSilhouette: boolean;
  showStreamlines: boolean;
  showProbes: boolean;
  comparisonMode: FlightLabComparisonMode;
}

export function serializeInspectionPreset(params: Omit<FlightLabInspectionPreset, "version" | "timestamp">): string {
  const preset: FlightLabInspectionPreset = {
    version: 1,
    timestamp: new Date().toISOString(),
    ...params,
  };
  return JSON.stringify(preset, null, 2);
}

export function parseInspectionPreset(
  jsonString: string
): { success: true; preset: FlightLabInspectionPreset } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== "object") {
      return { success: false, error: "Preset data must be a JSON object" };
    }
    if (parsed.version !== 1) {
      return { success: false, error: `Unsupported preset version: ${parsed.version}` };
    }
    if (typeof parsed.specimenId !== "string" || !parsed.specimenId) {
      return { success: false, error: "Missing or invalid specimenId" };
    }
    if (typeof parsed.mode !== "string") {
      return { success: false, error: "Missing or invalid mode" };
    }
    if (typeof parsed.clipName !== "string") {
      return { success: false, error: "Missing or invalid clipName" };
    }
    if (typeof parsed.clipTime !== "number" || !Number.isFinite(parsed.clipTime)) {
      return { success: false, error: "Invalid clipTime" };
    }
    if (!parsed.cameraState || typeof parsed.cameraState !== "object") {
      return { success: false, error: "Missing or invalid cameraState" };
    }

    const preset: FlightLabInspectionPreset = {
      version: 1,
      presetName: typeof parsed.presetName === "string" ? parsed.presetName : "Inspection Preset",
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
      specimenId: parsed.specimenId,
      mode: parsed.mode,
      clipName: parsed.clipName,
      clipTime: Math.max(0, parsed.clipTime),
      speedScale: typeof parsed.speedScale === "number" ? Math.max(0.1, Math.min(4, parsed.speedScale)) : 1.0,
      inspectionFps: typeof parsed.inspectionFps === "number" ? Math.max(1, Math.min(120, parsed.inspectionFps)) : 24,
      cameraState: parsed.cameraState,
      theme: parsed.theme === "light" ? "light" : "dark",
      showSkeleton: Boolean(parsed.showSkeleton),
      showWireframe: Boolean(parsed.showWireframe),
      showSilhouette: Boolean(parsed.showSilhouette),
      showStreamlines: Boolean(parsed.showStreamlines),
      showProbes: Boolean(parsed.showProbes),
      comparisonMode: parsed.comparisonMode || "off",
    };

    return { success: true, preset };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse preset JSON: ${msg}` };
  }
}
