export type FlightLabSpecimen = {
  id: string;
  name: string;
  modelFile: string;
  className: string;
  description: string;
  targetSize: number;
  heading: number;
  kind: "wyvern" | "egg";
};

export const FLIGHT_LAB_SPECIMENS: readonly FlightLabSpecimen[] = [
  {
    id: "wyvern-v2-rig",
    name: "V2 Rig (Gothic Rebuild)",
    modelFile: "wyvern-v2-rig.glb",
    className: "v2 rebuild",
    description:
      "92 bones, 18 clips. Current Blender focus rig with six three-segment wing digits per side and membrane panel chains.",
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
      "Review candidate for revised Idle and Walk loops. The other 16 clips are preserved; not the gameplay player.",
    targetSize: 8.4,
    heading: Math.PI,
    kind: "wyvern",
  },
  {
    id: "wyvern-v2-membrane-candidate",
    name: "V2 Membrane Repair Candidate",
    modelFile: "wyvern-v2-membrane-lab-candidate.glb",
    className: "v2 membrane candidate",
    description:
      "Softer wing membranes across all 18 clips. Flight Lab applies the exported Blender surface repair during playback.",
    targetSize: 8.4,
    heading: Math.PI,
    kind: "wyvern",
  },
  {
    id: "wyvern-v1-rig",
    name: "V1 Rig (Drogon Player)",
    modelFile: "player-wyvern.glb",
    className: "v1 reference",
    description:
      "Original gameplay juvenile wyvern rig with 13 clips. Retained as baseline for motion, wing shape, and proportion comparison.",
    targetSize: 8.4,
    heading: Math.PI,
    kind: "wyvern",
  },
] as const;

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
