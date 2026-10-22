export type FlightLabSpecimen = {
  id: string;
  name: string;
  modelFile: string;
  className: string;
  description: string;
  targetSize: number;
  heading: number;
  kind: "wyvern" | "egg";
  /** Set when this specimen is byte-identical to another (promoted baseline copy). */
  promotedAliasOf?: string;
};

export const FLIGHT_LAB_SPECIMENS: readonly FlightLabSpecimen[] = [
  {
    id: "wyvern-v2-rig",
    name: "V2 Rig (Gothic Rebuild / Rig 2)",
    modelFile: "wyvern-v2-rig.glb",
    className: "v2 rebuild (Rig 2)",
    description:
      "Rig 2 focus rig: 92 bones, 18 clips. Current Blender focus rig with six three-segment wing digits per side and membrane panel chains.",
    targetSize: 8.4,
    heading: Math.PI,
    kind: "wyvern",
  },
  {
    id: "wyvern-v2-locomotion-candidate",
    name: "V2 Locomotion Candidate (Idle + Walk)",
    modelFile: "wyvern-v2-idle-walk-flight-lab-candidate.glb",
    className: "v2 motion candidate",
    description:
      "Promoted alias: the idle/walk review candidate was promoted to the V2 baseline on 2026-10-21 (idle neck re-splice, horizon leveling, jaw and land-handoff fixes) and refreshed to the Stage 3 dynamics baseline on 2026-10-22 (flight group retimed to 1.000 Hz). Retained for harness compatibility; byte-identical to wyvern-v2-rig.glb.",
    targetSize: 8.4,
    heading: Math.PI,
    kind: "wyvern",
    promotedAliasOf: "wyvern-v2-rig",
  },
  {
    id: "wyvern-v2-membrane-candidate",
    name: "V2 Membrane Repair Candidate",
    modelFile: "wyvern-v2-membrane-lab-candidate.glb",
    className: "v2 membrane candidate",
    description:
      "Promoted alias: the membrane repair candidate was promoted to the V2 baseline on 2026-10-21 (panel/Tail1 weight binding, sampler compaction) and refreshed to the Stage 3 dynamics baseline on 2026-10-22 (flight group retimed to 1.000 Hz). Retained for harness compatibility; byte-identical to wyvern-v2-rig.glb.",
    targetSize: 8.4,
    heading: Math.PI,
    kind: "wyvern",
    promotedAliasOf: "wyvern-v2-rig",
  },
  {
    id: "wyvern-v1-rig",
    name: "V1 Rig (Drogon Player / Rig 1)",
    modelFile: "player-wyvern.glb",
    className: "v1 reference (Rig 1)",
    description:
      "Rig 1 baseline: Original gameplay juvenile wyvern rig with 13 clips (V1 Drogon). Retained as baseline for motion, wing shape, and proportion comparison.",
    targetSize: 8.4,
    heading: Math.PI,
    kind: "wyvern",
  },
] as const;

/**
 * Joints in the pinned V2 runtime skin. Duplicated from
 * `scripts/blender/wyvern_v2_runtime_contract.json` because that file is 215 KB
 * of node signature and the browser only needs the count; `test/flight-lab.test.js`
 * asserts this number and `V2_RIG_CLIPS` against the contract, so the copy cannot
 * drift silently.
 */
export const V2_RIG_JOINT_COUNT = 92;

/**
 * The only file the contract pins. The V2 *candidates* (`…-candidate.glb`) are
 * deliberately partial — a few clips, sometimes fewer bones — so holding them to
 * the full contract would raise a banner on every switch to them.
 */
export const PINNED_RUNTIME_MODEL = "wyvern-v2-rig.glb";

export const V2_RIG_CLIPS = [
  "idle",
  "walk",
  "takeoff",
  "cruise",
  "bankLeft",
  "bankRight",
  "attack",
  "attack2",
  "attackAir2",
  "breath",
  "death",
  "dive",
  "glide",
  "hover",
  "land",
  "rest",
  "scout",
  "speed",
] as const;

export const V1_RIG_CLIPS = [
  "AttackBite",
  "AttackClaw",
  "BankLeft",
  "BankRight",
  "Death",
  "FlightCruise",
  "GroundTurnLeft",
  "GroundTurnRight",
  "GroundWalk",
  "Hit",
  "Idle",
  "Roar",
  "Takeoff",
] as const;

export function findFlightLabSpecimen(id: string): FlightLabSpecimen {
  return FLIGHT_LAB_SPECIMENS.find((specimen) => specimen.id === id) ?? FLIGHT_LAB_SPECIMENS[0]!;
}

export function isV2RigSpecimen(
  specimenOrId: FlightLabSpecimen | { id: string } | string | null | undefined
): boolean {
  if (!specimenOrId) return false;
  const id = typeof specimenOrId === "string" ? specimenOrId : specimenOrId.id;
  return id.startsWith("wyvern-v2-");
}
