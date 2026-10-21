/**
 * Which rider clip plays while a given wyvern clip plays.
 *
 * The rider has four clips and the wyvern has eighteen. Rather than authoring
 * eighteen rider clips -- which would multiply the asset's animation cost for
 * motion nobody can resolve at rider scale -- the rider reacts to what the
 * wyvern is *doing*:
 *
 *   turning  -> lean into the turn
 *   fighting -> brace
 *   flying   -> idle
 *
 * The map is explicit rather than pattern-matched where it matters. An earlier
 * draft used `clip.includes("attack")`, which also matched `attackAir2` by luck
 * and would have matched any future `attackSomething` -- fine, but it also
 * matched nothing for `dive` and `scout`, leaving those on a default that was
 * silently wrong. Listing them makes the gaps visible.
 */

export const RIDER_CLIPS = ["rider_idle", "rider_leanLeft", "rider_leanRight", "rider_brace"] as const;
export type RiderClip = (typeof RIDER_CLIPS)[number];

const EXPLICIT: Record<string, RiderClip> = {
  // Banking
  bankleft: "rider_leanLeft",
  bankright: "rider_leanRight",

  // Combat and impacts
  attack: "rider_brace",
  attack2: "rider_brace",
  attackair2: "rider_brace",
  death: "rider_brace",

  // Takeoff and landing loads
  takeoff: "rider_brace",
  land: "rider_brace",

  // Cruise family
  cruise: "rider_idle",
  glide: "rider_idle",
  dive: "rider_idle",
  speed: "rider_idle",
  scout: "rider_idle",
  hover: "rider_idle",

  // Ground family
  idle: "rider_idle",
  rest: "rider_idle",
  breath: "rider_idle",
  walk: "rider_idle",
};

export function riderClipFor(wyvernClip: string): RiderClip {
  const key = wyvernClip.trim().toLowerCase();
  const mapped = EXPLICIT[key];
  if (mapped) return mapped;
  // Unknown clips fall back to idle rather than throwing: a new wyvern clip
  // should look slightly wrong, not break the scene.
  return "rider_idle";
}

/** Clips the map covers, so a test can assert nothing was forgotten. */
export function mappedWyvernClips(): string[] {
  return Object.keys(EXPLICIT).sort();
}
