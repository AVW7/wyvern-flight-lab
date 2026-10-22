import type { FlightLabMode } from "./types";

export const MODE_CLIPS: Record<FlightLabMode, readonly string[]> = {
  ground: ["idle", "groundwalk", "walk", "rest"],
  takeoff: ["takeoff", "flightcruise", "cruise", "hover"],
  cruise: ["cruise", "flightcruise", "speed", "scout", "hover"],
  "bank-left": ["bankLeft", "bankleft", "cruise", "speed"],
  "bank-right": ["bankRight", "bankright", "cruise", "speed"],
  boost: ["speed", "flightcruise", "cruise", "scout"],
  land: ["land", "idle", "rest"],
};

export const ONESHOT_ALIASES: Record<string, readonly string[]> = {
  attack: ["attack", "attackbite", "bite", "attack1"],
  attack2: ["attack2", "attackclaw", "claw"],
  attackAir2: ["attackair2", "attackair", "attackbite", "attackclaw", "attack"],
  breath: ["breath", "roar", "firebreath"],
  death: ["death", "fall", "dragon_death_01"],
};

export type ClipResolutionStatus = "exact" | "alias" | "fallback" | "unavailable";

/**
 * Name-level aliases: "the caller asked for `walk`, the asset calls it
 * `GroundWalk`".
 *
 * This table used to live inside `runtime.ts:resolveAction`, duplicating
 * knowledge that belongs here next to `MODE_CLIPS` / `ONESHOT_ALIASES` — three
 * tables in two files that had to be kept in step by hand. It is now the single
 * source for name lookup, and `resolveClipAlias` preserves the lookup the
 * runtime already relied on (candidate order, exact-or-substring, case-blind).
 */
export const CLIP_ALIASES: Record<string, readonly string[]> = {
  walk: ["groundwalk", "walk", "trot", "run"],
  groundwalk: ["walk", "groundwalk"],
  idle: ["idle", "groundidle", "stand"],
  rest: ["rest", "idle", "groundwalk"],
  cruise: ["flightcruise", "cruise", "glide", "fly"],
  flightcruise: ["cruise", "flightcruise"],
  hover: ["hover", "flightcruise", "cruise"],
  scout: ["scout", "glide", "flightcruise", "cruise"],
  glide: ["glide", "flightcruise", "cruise"],
  dive: ["dive", "speed", "flightcruise", "cruise"],
  speed: ["speed", "flightcruise", "cruise"],
  takeoff: ["takeoff", "flightcruise", "cruise"],
  land: ["land", "idle", "groundwalk"],
  attack: ["attackbite", "attack", "bite"],
  attack2: ["attackclaw", "attack2", "claw"],
  breath: ["roar", "breath", "firebreath"],
  death: ["death", "fall"],
};

/**
 * Resolve a requested clip name against the names the loaded asset actually has.
 * Returns the asset's spelling, or null. Substring matching is deliberate: the V1
 * asset ships `GroundWalk`, `AttackBite`, `FlightCruise` and friends.
 */
export function resolveClipAlias(name: string, available: readonly string[]): string | null {
  const candidates = CLIP_ALIASES[name.toLowerCase()];
  if (!candidates) return null;
  for (const candidate of candidates) {
    for (const availableName of available) {
      const lower = availableName.toLowerCase();
      if (lower === candidate || lower.includes(candidate)) return availableName;
    }
  }
  return null;
}

export interface ClipResolutionResult {
  clipName: string | null;
  status: ClipResolutionStatus;
  requestedModeOrAction: string;
  reason: string;
}

export function resolveModeCapability(
  mode: FlightLabMode,
  available: readonly string[],
  strict = false
): ClipResolutionResult {
  const normalized = new Map(available.map((name) => [name.toLowerCase(), name]));
  const candidates = MODE_CLIPS[mode];
  if (!candidates || candidates.length === 0) {
    return {
      clipName: null,
      status: "unavailable",
      requestedModeOrAction: mode,
      reason: `Unknown mode: ${mode}`,
    };
  }

  // Primary candidate is exact match
  const primary = candidates[0];
  if (primary) {
    const exactMatch = normalized.get(primary.toLowerCase());
    if (exactMatch) {
      return {
        clipName: exactMatch,
        status: "exact",
        requestedModeOrAction: mode,
        reason: `Exact match: "${exactMatch}"`,
      };
    }
  }

  // Secondary candidates are explicit aliases
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;
    const alias = normalized.get(candidate.toLowerCase());
    if (alias) {
      if (strict) {
        return {
          clipName: null,
          status: "unavailable",
          requestedModeOrAction: mode,
          reason: `Strict inspection rejected alias "${alias}" for mode "${mode}"`,
        };
      }
      return {
        clipName: alias,
        status: "alias",
        requestedModeOrAction: mode,
        reason: `Explicit alias "${alias}" resolved for mode "${mode}"`,
      };
    }
  }

  if (strict) {
    return {
      clipName: null,
      status: "unavailable",
      requestedModeOrAction: mode,
      reason: `Strict inspection rejected fallback for mode "${mode}"`,
    };
  }

  if (mode !== "ground") {
    const fuzzy = available.find((name) => /fly|flight|wing|air|glide|hover|dive|soar/i.test(name));
    if (fuzzy) {
      return {
        clipName: fuzzy,
        status: "fallback",
        requestedModeOrAction: mode,
        reason: `Fuzzy flight fallback "${fuzzy}" used for mode "${mode}"`,
      };
    }
  }

  const fallback = available[0] ?? null;
  return {
    clipName: fallback,
    status: fallback ? "fallback" : "unavailable",
    requestedModeOrAction: mode,
    reason: fallback ? `Default clip fallback "${fallback}"` : "No clips available",
  };
}

export function resolveOneShotCapability(
  actionName: string,
  available: readonly string[]
): ClipResolutionResult {
  const normalized = new Map(available.map((name) => [name.toLowerCase(), name]));
  const candidates = ONESHOT_ALIASES[actionName] ?? [actionName];

  for (const candidate of candidates) {
    const exact = normalized.get(candidate.toLowerCase());
    if (exact) {
      return {
        clipName: exact,
        status: "exact",
        requestedModeOrAction: actionName,
        reason: `Exact one-shot match "${exact}"`,
      };
    }
  }

  // Fuzzy substring match
  for (const candidate of candidates) {
    const found = available.find((a) => a.toLowerCase().includes(candidate.toLowerCase()));
    if (found) {
      return {
        clipName: found,
        status: "alias",
        requestedModeOrAction: actionName,
        reason: `Fuzzy one-shot resolved: "${found}" for action "${actionName}"`,
      };
    }
  }

  return {
    clipName: null,
    status: "unavailable",
    requestedModeOrAction: actionName,
    reason: `Action "${actionName}" is not available in loaded asset`,
  };
}

export function resolveFlightLabClip(mode: FlightLabMode, available: readonly string[]): string | null {
  return resolveModeCapability(mode, available, false).clipName;
}

/**
 * Every mode's capability in one pass, for the mode buttons.
 *
 * The UI needs this *before* the user clicks: a V1 asset has no `cruise`,
 * `bankLeft`, `bankRight` or `land`, so those buttons silently played whatever
 * the fallback chain produced. The badge is what turns that into a fact on screen.
 */
export function resolveAllModeCapabilities(
  available: readonly string[]
): Record<FlightLabMode, ClipResolutionResult> {
  const result = {} as Record<FlightLabMode, ClipResolutionResult>;
  for (const mode of Object.keys(MODE_CLIPS) as FlightLabMode[]) {
    result[mode] = resolveModeCapability(mode, available, false);
  }
  return result;
}
