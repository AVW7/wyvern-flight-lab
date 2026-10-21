#!/usr/bin/env node
/**
 * Derive the rider mount from geometry. Never transcribe these numbers.
 *
 * A previous attempt carried the mount offset as a literal in a plan document,
 * and it did not reproduce: the plan said Spine3 was at (0, 783.4, 25.2) in one
 * place and roughly (0, 734, 136) in another, because one figure was read from
 * the contract's *local* node TRS and the other from the world chain. Deriving
 * it here means the runtime reads a generated file and the argument is over.
 *
 * What is derived
 * ---------------
 *   seatPoint      world position on the wyvern's back directly above Spine3
 *   spine3         Spine3's bind world position and quaternion
 *   riderOrigin    where the rider's own origin must sit so its pelvis lands on
 *                  the seat: seatPoint - (RDR_Pelvis local offset)
 *   mountOffset    riderOrigin - spine3.position, expressed in Spine3's local
 *                  frame so the runtime can apply it as a child transform
 *
 *   node tools/calibrate-rider-mount.mjs            print the derivation
 *   node tools/calibrate-rider-mount.mjs --write    write the JSON
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Vector3, Quaternion } from "three";
import { loadRig } from "../scripts/wyvern-dynamics.mjs";
import { skinnedMeshes, quantile } from "../scripts/wyvern-skin-sample.mjs";

const WYVERN = "public/models/wyvern-v2-rig.glb";
const RIDER = "public/models/wyvern-rider.glb";
const OUT = "scripts/blender/wyvern_rider_mount.json";
/** Runtime-facing copy. The browser bundle cannot import from scripts/. */
const OUT_TS = "src/flight-lab/rider/mountData.ts";

/**
 * Radius around Spine3's (x, z) used to find the back surface.
 *
 * The rider's hips are ~120 units across (0.30 m), so 80 is the smallest radius
 * that fully contains the seat footprint. The choice barely matters: p98 across
 * radii 60..260 moves 992 -> 1031 units, which is 1 cm at 400 u/m. The disc
 * passes through the whole body cross-section, so p50 lands on the belly
 * (~440) -- p98 is what reads as "the back".
 */
const SEAT_RADIUS = 80;
const SENSITIVITY_RADII = [60, 80, 120, 200];

const wyvern = await loadRig(WYVERN);
wyvern.scene.updateMatrixWorld(true);

const spine3 = wyvern.bones.find((bone) => bone.name === "Spine3");
if (!spine3) throw new Error("Spine3 not found; the mount point changed and this tool is stale");

const spine3World = new Vector3();
const spine3Quat = new Quaternion();
spine3.getWorldPosition(spine3World);
spine3.getWorldQuaternion(spine3Quat);

// --- seat surface: the top of the body directly above Spine3 -----------------
const meshes = skinnedMeshes(wyvern.scene);
const body = meshes.find((entry) => /DaenerysDragon001$/.test(entry.mesh.name)) ?? meshes[0];

/** p98 of body heights inside a disc of `radius` around Spine3, in the x/z plane. */
function seatHeightAt(radius) {
  const heights = [];
  for (let v = 0; v < body.count; v++) {
    const dx = body.points[v * 3] - spine3World.x;
    const dz = body.points[v * 3 + 2] - spine3World.z;
    if (dx * dx + dz * dz <= radius * radius) heights.push(body.points[v * 3 + 1]);
  }
  return { height: heights.length ? quantile(heights, 0.98) : Number.NaN, samples: heights.length };
}

const seat = seatHeightAt(SEAT_RADIUS);
if (!Number.isFinite(seat.height)) throw new Error("no body vertices near Spine3; SEAT_RADIUS is wrong");

const seatY = seat.height;
const seatPoint = new Vector3(spine3World.x, seatY, spine3World.z);

// Recorded so a reader can see the seat height is a plateau, not a knife edge.
const sensitivity = SENSITIVITY_RADII.map((radius) => {
  const { height, samples } = seatHeightAt(radius);
  return { radius, p98: Number(height.toFixed(2)), samples };
});

// --- rider: where its pelvis sits relative to its own origin -----------------
const rider = await loadRig(RIDER);
rider.scene.updateMatrixWorld(true);
const pelvis = rider.bones.find((bone) => bone.name === "RDR_Pelvis");
if (!pelvis) throw new Error("RDR_Pelvis not found; rider contract and this tool disagree");
const pelvisLocal = new Vector3();
pelvis.getWorldPosition(pelvisLocal); // rider root is at the origin, so this is the local offset

// Rider origin so that pelvis lands on the seat.
const riderOrigin = new Vector3(
  seatPoint.x - pelvisLocal.x,
  seatPoint.y - pelvisLocal.y,
  seatPoint.z - pelvisLocal.z
);

// --- express the offset in Spine3's local frame ------------------------------
const mountOffset = riderOrigin.clone().sub(spine3World);
const inverseQuat = spine3Quat.clone().invert();
const mountOffsetLocal = mountOffset.clone().applyQuaternion(inverseQuat);

const fmt = (v) => v.toArray().map((n) => Number(n.toFixed(3)));

const report = {
  contractVersion: 1,
  generatedBy: "tools/calibrate-rider-mount.mjs",
  note: "Generated from geometry. Do not hand-edit; re-run the tool instead.",
  wyvern: {
    path: WYVERN,
    sha256: wyvern.sha256,
    joint: "Spine3",
    spine3World: fmt(spine3World),
    spine3Quaternion: Number(spine3Quat.x.toFixed(6)) + "," + Number(spine3Quat.y.toFixed(6)) + "," + Number(spine3Quat.z.toFixed(6)) + "," + Number(spine3Quat.w.toFixed(6)),
  },
  seat: {
    point: fmt(seatPoint),
    surfaceY: Number(seatY.toFixed(3)),
    sampleRadius: SEAT_RADIUS,
    samples: seat.samples,
    quantile: 0.98,
    derivation: "p98 of body-mesh vertex heights within SEAT_RADIUS of Spine3's x/z, in bind pose",
    sensitivity,
  },
  rider: {
    path: RIDER,
    sha256: rider.sha256,
    pelvisLocal: fmt(pelvisLocal),
    origin: fmt(riderOrigin),
  },
  mount: {
    offsetLocal: fmt(mountOffsetLocal),
    offsetWorld: fmt(mountOffset),
    unitsPerMetre: 400,
    seatHeightMetres: Number((seatY / 400).toFixed(3)),
  },
};

console.log(`Spine3 world        ${fmt(spine3World).join(", ")}`);
console.log(`seat surface y      ${seatY.toFixed(2)}  (${(seatY / 400).toFixed(3)} m above the ground plane, ${seat.samples} samples)`);
console.log(`  sensitivity       ${sensitivity.map((s) => `R${s.radius}:${s.p98}`).join("  ")}`);
console.log(`rider pelvis local  ${fmt(pelvisLocal).join(", ")}`);
console.log(`rider origin        ${fmt(riderOrigin).join(", ")}`);
console.log(`mount offset local  ${fmt(mountOffsetLocal).join(", ")}`);
console.log(`mount offset world  ${fmt(mountOffset).join(", ")}`);

if (process.argv.includes("--write")) {
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${OUT}`);

  const [ox, oy, oz] = report.mount.offsetLocal;
  const ts = `/**
 * GENERATED by tools/calibrate-rider-mount.mjs -- do not edit.
 *
 * The rider mounts at Spine3. The offset is expressed in Spine3's local frame,
 * so the runtime only has to place a group at Spine3's world pose and offset
 * its child by this vector. Re-run the tool if the wyvern or rider asset changes.
 *
 * Derived from ${WYVERN} (${report.wyvern.sha256.slice(0, 12)}) and
 * ${RIDER} (${report.rider.sha256.slice(0, 12)}).
 */

export const RIDER_MOUNT = {
  joint: ${JSON.stringify(report.wyvern.joint)},
  /** Offset from Spine3 to the rider's origin, in Spine3's local frame, wyvern units. */
  offsetLocal: [${ox}, ${oy}, ${oz}] as const,
  /** Same offset in world axes, for diagnostics. */
  offsetWorld: [${report.mount.offsetWorld.join(", ")}] as const,
  unitsPerMetre: ${report.mount.unitsPerMetre},
  seatHeightMetres: ${report.mount.seatHeightMetres},
  /** Wyvern units per rider unit; both are authored in wyvern units, so 1. */
  riderScale: 1,
} as const;
`;
  writeFileSync(OUT_TS, ts);
  console.log(`wrote ${OUT_TS}`);
}
