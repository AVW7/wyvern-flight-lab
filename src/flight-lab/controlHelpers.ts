export type ClipCategory = "all" | "flight" | "locomotion" | "combat" | "reaction";

export interface ClipCategoryOption {
  id: ClipCategory;
  label: string;
}

export const CLIP_CATEGORIES: readonly ClipCategoryOption[] = [
  { id: "all", label: "All" },
  { id: "flight", label: "Flight" },
  { id: "locomotion", label: "Locomotion" },
  { id: "combat", label: "Combat" },
  { id: "reaction", label: "Reactions" },
];

export interface QuickLocomotionAction {
  key: string;
  name: string;
  clipName: string;
  label: string;
  category: "ground" | "flight";
  icon: string;
  description: string;
}

export const QUICK_LOCOMOTION_ACTIONS: readonly QuickLocomotionAction[] = [
  { key: "W", name: "walk", clipName: "walk", label: "Walk", category: "ground", icon: "🐾", description: "Quadrupedal ground locomotion cycle" },
  { key: "I", name: "idle", clipName: "idle", label: "Idle", category: "ground", icon: "🛡️", description: "Quadrupedal alert ground stance" },
  { key: "R", name: "rest", clipName: "rest", label: "Rest", category: "ground", icon: "🛌", description: "Low quadrupedal ground rest posture" },
  { key: "H", name: "hover", clipName: "hover", label: "Hover", category: "flight", icon: "✦", description: "Vertical stationary flight elevation" },
  { key: "S", name: "scout", clipName: "scout", label: "Scout", category: "flight", icon: "🔭", description: "Panoramic horizon scanning patrol" },
  // Glide moved off `G` when `G` became the procedural-rig bypass (Task E3);
  // `L` is the free mnemonic ("level flight").
  { key: "L", name: "glide", clipName: "glide", label: "Glide", category: "flight", icon: "〰", description: "Aerodynamic soaring dihedral" },
  { key: "D", name: "dive", clipName: "dive", label: "Dive", category: "flight", icon: "⇣", description: "Streamlined nose-down stoop plunge" },
];

/**
 * Categorizes an animation clip name into an aerodynamic/anatomical group.
 */
export function categorizeClip(clipName: string): Exclude<ClipCategory, "all"> {
  const lower = clipName.toLowerCase();

  if (
    lower.includes("attack") ||
    lower.includes("breath") ||
    lower.includes("bite") ||
    lower.includes("claw") ||
    lower.includes("fire")
  ) {
    return "combat";
  }

  if (
    lower.includes("death") ||
    lower.includes("hit") ||
    lower.includes("hurt") ||
    lower.includes("fall") ||
    lower.includes("stun")
  ) {
    return "reaction";
  }

  if (
    lower.includes("walk") ||
    lower.includes("run") ||
    lower.includes("idle") ||
    lower.includes("rest") ||
    lower.includes("ground") ||
    lower.includes("stand")
  ) {
    return "locomotion";
  }

  // Default flight: cruise, glide, bank, takeoff, land, soar, dive, hover
  return "flight";
}

/**
 * Filter clips by category and text search query.
 */
export function filterClips<T extends { name: string }>(
  clips: T[],
  category: ClipCategory,
  searchQuery = ""
): T[] {
  const q = searchQuery.toLowerCase().trim();

  return clips.filter((clip) => {
    if (q && !clip.name.toLowerCase().includes(q)) {
      return false;
    }
    if (category === "all") {
      return true;
    }
    return categorizeClip(clip.name) === category;
  });
}

/**
 * Formats time in seconds and frame number into a high-precision inspection readout.
 */
export function formatTimecode(seconds: number, duration: number, fps = 24): string {
  const safeSeconds = Math.max(0, seconds);
  const safeDuration = Math.max(0, duration);
  const currentFrame = Math.round(safeSeconds * fps);
  const totalFrames = Math.round(safeDuration * fps);

  return `${safeSeconds.toFixed(2)}s / ${safeDuration.toFixed(2)}s (f${currentFrame}/${totalFrames} @ ${fps}fps)`;
}

/**
 * Compact time format for hover bubbles: "0.85s · f20"
 */
export function formatBubbleTime(seconds: number, fps = 24): string {
  const safeSeconds = Math.max(0, seconds);
  const frame = Math.round(safeSeconds * fps);
  return `${safeSeconds.toFixed(2)}s · f${frame}`;
}
