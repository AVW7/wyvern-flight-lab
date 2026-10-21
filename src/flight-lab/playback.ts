import type { FlightLabMode } from "./types";

export const DEFAULT_INSPECTION_FPS = 24;
export const FRAME_STEP_INTERVAL = 1 / DEFAULT_INSPECTION_FPS;
export const MIN_SPEED_SCALE = 0.25;
export const MAX_SPEED_SCALE = 2.0;

export type FlightLabPlaybackStatus = "playing" | "paused" | "completed";

export interface FlightLabPlaybackSnapshot {
  status: FlightLabPlaybackStatus;
  activeClip: string;
  isLooping: boolean;
  isOneShot: boolean;
  isDeath: boolean;
  clipTime: number;
  clipDuration: number;
  clipProgress: number;
  speedScale: number;
  effectiveRate: number;
  inspectionFps: number;
}

export interface FlightLabShortcutMapping {
  key: string;
  name: string;
  label: string;
  type: "mode" | "oneshot" | "playback";
}

export const FLIGHT_LAB_SHORTCUTS: FlightLabShortcutMapping[] = [
  { key: "1", name: "ground", label: "Ground", type: "mode" },
  { key: "2", name: "takeoff", label: "Takeoff", type: "mode" },
  { key: "3", name: "cruise", label: "Cruise", type: "mode" },
  { key: "4", name: "bank-left", label: "Bank L", type: "mode" },
  { key: "5", name: "bank-right", label: "Bank R", type: "mode" },
  { key: "6", name: "boost", label: "Boost", type: "mode" },
  { key: "7", name: "land", label: "Land", type: "mode" },
  { key: "A", name: "attack", label: "Attack", type: "oneshot" },
  { key: "Q", name: "attack2", label: "Attack 2", type: "oneshot" },
  { key: "E", name: "attackAir2", label: "Air Atk", type: "oneshot" },
  { key: "F", name: "breath", label: "Breath", type: "oneshot" },
  { key: "K", name: "death", label: "Fall", type: "oneshot" },
  { key: "Space", name: "togglePause", label: "Pause/Resume", type: "playback" },
  { key: "[", name: "stepBack", label: "-1 Frame", type: "playback" },
  { key: "]", name: "stepForward", label: "+1 Frame", type: "playback" },
];

export const BOOST_RATE_MULTIPLIER = 1.45;

/**
 * Canonical flight phaseGroup members across V2 and V1 rigs.
 * Clips in this group beat at matched wingbeat cadence (validated within <=8% spread
 * by scripts/validate-wyvern-clips.mjs) so crossfades preserve normalized cycle time.
 */
export const FLIGHT_PHASE_GROUP_CLIPS = new Set([
  "cruise",
  "bankleft",
  "bankright",
  "flightcruise",
  "speed",
  "glide",
  "dive",
  "hover",
  "scout",
]);

export interface ClipFlightContext {
  mode: FlightLabMode;
  airborne: boolean;
  airspeed: number;
}

/**
 * Resolves the canonical FlightLabMode, airborne altitude class, and airspeed
 * when a clip is selected directly in the Flight Lab clip browser.
 */
export function resolveClipFlightContext(clipName: string): ClipFlightContext {
  const lower = clipName.toLowerCase();
  if (lower.includes("bankleft")) {
    return { mode: "bank-left", airborne: true, airspeed: 18 };
  }
  if (lower.includes("bankright")) {
    return { mode: "bank-right", airborne: true, airspeed: 18 };
  }
  if (lower === "speed" || lower.includes("boost")) {
    return { mode: "boost", airborne: true, airspeed: 36 };
  }
  if (lower.includes("takeoff")) {
    return { mode: "takeoff", airborne: false, airspeed: 0 };
  }
  if (lower === "land" || lower.includes("landing")) {
    return { mode: "land", airborne: true, airspeed: 18 };
  }
  if (lower.includes("attackair")) {
    return { mode: "cruise", airborne: true, airspeed: 18 };
  }
  if (
    lower.includes("walk") ||
    lower.includes("groundturn") ||
    lower.includes("idle") ||
    lower.includes("rest") ||
    lower.includes("death") ||
    lower.includes("fall") ||
    lower === "hit" ||
    lower === "attack" ||
    lower === "attack2" ||
    lower.includes("attackbite") ||
    lower.includes("attackclaw") ||
    lower.includes("breath") ||
    lower.includes("roar")
  ) {
    return {
      mode: "ground",
      airborne: false,
      airspeed: lower.includes("walk") || lower.includes("groundturn") ? 4 : 0,
    };
  }
  const airspeed = lower.includes("hover")
    ? 2
    : lower.includes("scout")
    ? 8
    : lower.includes("dive")
    ? 28
    : lower.includes("glide")
    ? 14
    : 18;
  return { mode: "cruise", airborne: true, airspeed };
}

/**
 * Computes the phase-preserving start time t_new = ((t_old mod D_old) / D_old) * D_new
 * when transitioning between two clips in the flight phaseGroup.
 * Returns 0 when either clip is outside the group or durations are non-positive.
 */
export function resolvePhasePreservingCrossfadeTime(
  fromClip: string | null | undefined,
  toClip: string | null | undefined,
  fromTime: number,
  fromDuration: number,
  toDuration: number
): number {
  if (!fromClip || !toClip || fromDuration <= 0 || toDuration <= 0) return 0;
  const fromNorm = fromClip.toLowerCase();
  const toNorm = toClip.toLowerCase();
  if (!FLIGHT_PHASE_GROUP_CLIPS.has(fromNorm) || !FLIGHT_PHASE_GROUP_CLIPS.has(toNorm)) {
    return 0;
  }
  const wrappedFrom = ((fromTime % fromDuration) + fromDuration) % fromDuration;
  const normalizedPhase = wrappedFrom / fromDuration;
  return Number((normalizedPhase * toDuration).toFixed(4));
}

/**
 * Calculates effective playback rate without compounding.
 * Boost mode applies a dedicated 1.45x multiplier on top of base speed.
 */
export function calculateEffectiveRate(baseSpeed: number, mode: FlightLabMode): number {
  const clamped = Math.max(MIN_SPEED_SCALE, Math.min(MAX_SPEED_SCALE, baseSpeed));
  const multiplier = mode === "boost" ? BOOST_RATE_MULTIPLIER : 1.0;
  return Number((clamped * multiplier).toFixed(4));
}

/**
 * Advances or rewinds clip time by a discrete number of inspection frames,
 * independent of playback speed scale.
 */
export function calculateFrameStepTime(
  currentTime: number,
  frames: number,
  duration: number,
  isLooping: boolean,
  fps = DEFAULT_INSPECTION_FPS
): number {
  if (duration <= 0) return 0;
  const interval = 1 / fps;
  const stepDelta = frames * interval;
  const targetTime = currentTime + stepDelta;

  if (isLooping) {
    const wrapped = ((targetTime % duration) + duration) % duration;
    return Number(wrapped.toFixed(4));
  }

  const clamped = Math.max(0, Math.min(duration, targetTime));
  return Number(clamped.toFixed(4));
}

/**
 * Derives clip time and progress. Non-looping completed clips preserve the end time
 * at 100% (duration, 1.0) instead of wrapping to 0% via modulo.
 */
export function calculateClipTelemetry(
  time: number,
  duration: number,
  isLooping: boolean
): { clipTime: number; clipProgress: number } {
  if (duration <= 0) {
    return { clipTime: 0, clipProgress: 0 };
  }

  if (isLooping) {
    const wrapped = ((time % duration) + duration) % duration;
    return {
      clipTime: Number(wrapped.toFixed(2)),
      clipProgress: Number((wrapped / duration).toFixed(3)),
    };
  }

  const clamped = Math.max(0, Math.min(duration, time));
  return {
    clipTime: Number(clamped.toFixed(2)),
    clipProgress: Number((clamped / duration).toFixed(3)),
  };
}

/**
 * Determines whether an action is a Death clip that should hold its final pose indefinitely.
 */
export function isDeathAction(actionName: string): boolean {
  return /death|fall/i.test(actionName);
}

/**
 * Evaluates whether a specimen is capable of executing flight modes.
 * Eggs are incubation specimens and reject all flight modes.
 */
export function canSpecimenExecuteMode(kind: string, _mode: FlightLabMode): boolean {
  return kind !== "egg";
}

/**
 * Evaluates whether a specimen can trigger one-shot combat or reaction actions.
 */
export function canSpecimenExecuteOneShot(kind: string): boolean {
  return kind !== "egg";
}

/**
 * Evaluates whether a specimen supports animation scrubbing and stepping.
 */
export function canSpecimenScrub(kind: string, clipsCount: number): boolean {
  return kind !== "egg" && clipsCount > 0;
}

/**
 * Verifies if the target of a keyboard event is an editable input or focused editable area,
 * to avoid intercepting keyboard shortcuts during text input.
 */
export function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return Boolean(el.isContentEditable);
}
