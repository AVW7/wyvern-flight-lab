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

/**
 * The working set: the main runtime rig and the V1 reference it is compared
 * against. Nothing else belongs in this picker.
 *
 * **Retired 2026-10-22** — `wyvern-v2-locomotion-candidate` and
 * `wyvern-v2-membrane-candidate` were promoted aliases: byte-identical copies of
 * `wyvern-v2-rig.glb` kept "for harness compatibility". Four picker entries that
 * rendered three identical wyverns made it unclear which asset was being worked
 * on, so they are no longer listed here. The GLB files stay on disk because
 * `test/asset-provenance.test.js` pins them to the contract hash and
 * `tools/blender/upgrade_v2_rig_ground_and_membrane.mjs` writes them — retiring
 * the *picker entry* is the point, not deleting the bytes. `promotedAliasOf`
 * remains on the type for any future promoted alias.
 */
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
