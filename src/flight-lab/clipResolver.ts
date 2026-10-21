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
