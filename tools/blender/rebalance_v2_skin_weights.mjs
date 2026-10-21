#!/usr/bin/env node
/**
 * C5: rebalance the V2 skin weights.
 *
 * Four passes, each measured before and after by `audit_v2_skin_weights.mjs`. Every pass works in
 * bind **world** space (see `bindMeshToWorld` in `glb_skin_io.mjs` — the meshes are authored ~2188x
 * smaller than the skeleton and the body's POSITION is normalized SHORT, so comparing raw vertex
 * coordinates against `bindWorldPos()` silently compares two different spaces).
 *
 *  1. **web** — the inter-digital membrane panels own 0.0–12% of the web between their two digits;
 *     the digits own the rest. Every web vertex hands `WEB_SHARE_NEAR..WEB_SHARE_FAR` (graded along
 *     the panel's own head->tail axis) to its panel bone, then one topological smoothing pass keeps
 *     the ownership boundary from stepping.
 *  2. **scapular** — `L_WingRoot` carries 8 vertices against `R_WingRoot`'s 24. The nearest
 *     `SCAPULAR_TARGET` pectoral/shoulder vertices per side hand `SCAPULAR_SHARE_FAR..NEAR` (falling
 *     off with distance from the `WingRoot` axis) to `WingRoot`. Both sides take the *same* count so
 *     the asymmetry cannot simply re-appear through a different candidate ranking.
 *  3. **neck** — the task list calls this the "thoracic cliff" (`Spine3` 5,971 mass vs `Spine1` 271
 *     and `Spine2` 281) and implies redistributing the chest. Measured, that is not what the mass
 *     is: 92% of `Spine3`'s mass sits above `Neck1.head` and the chest carries ~63 of it, so a
 *     chest redistribution moves almost nothing. The actual defect is that `Spine3` owns the whole
 *     `Neck1` span — 3,832 vertices whose nearest bone is `Neck1`. This pass hands `Spine3` mass to
 *     whichever of `Neck1/Neck2/Head` is geometrically nearest, graded in along the neck so the
 *     handover cannot step.
 *  4. **symmetry** — geometric mirror averaging. Both meshes are ~91%/84% exact-mirror symmetric at
 *     0.01 units; where a mirrored partner exists, each vertex averages its own weight with its
 *     partner's mirrored influence, so no paired bone keeps a one-sided mass advantage.
 *
 * Weights are handled in 0..1 and quantized back to normalized U8 on write. Nothing is written
 * unless `--write` is passed; the contract signature and pinned SHA-256 are then re-derived from
 * the bytes actually written, as `bind_missing_panel_and_tail1_weights.mjs` does.
 *
 * Usage:
 *   node tools/blender/rebalance_v2_skin_weights.mjs                 # dry run, prints the plan
 *   node tools/blender/rebalance_v2_skin_weights.mjs --write         # write the shipped asset
 *   node tools/blender/rebalance_v2_skin_weights.mjs --out /tmp/x.glb
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { Vector3 } from "three";
import { readGlb, inspectRuntimeRig, validateRuntimeRig, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { createRig, normalizationScale, readSkin, writeSkin } from "./glb_skin_io.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";
import { smoothSelectedWeights } from "./local_membrane_weights.mjs";

const ARGS = process.argv.slice(2);
const outFlag = ARGS.indexOf("--out");
const OUTPUT = outFlag === -1 ? null : ARGS[outFlag + 1];
// The input is the first positional that is not the --out value, so `--out /tmp/x.glb` cannot be
// mistaken for the source asset. Guard the flag being absent: `outFlag + 1` is 0 then, which would
// exclude the first positional instead.
const INPUT = ARGS.find((a, i) => !a.startsWith("--") && (outFlag === -1 || i !== outFlag + 1))
  ?? "public/models/wyvern-v2-rig.glb";
const WRITE = ARGS.includes("--write");
const TARGET = OUTPUT ?? INPUT;

// Panel ownership of the inter-digital web, graded along the panel's head->tail axis.
const WEB_SHARE_NEAR = 0.20;
const WEB_SHARE_FAR = 0.35;
const WEB_SMOOTH_BLEND = 0.25;
// Scapular falloff.
const SCAPULAR_TARGET = 110;
const SCAPULAR_RADIUS = 260;
const SCAPULAR_SHARE_NEAR = 0.35;
const SCAPULAR_SHARE_FAR = 0.15;
// Neck handover: fraction of Spine3's mass handed over where the neck bone is nearest, and the
// ramp length (as a fraction of the Spine3.head -> Head.head axis) over which it reaches full.
const NECK_SHARE = 0.50;
const NECK_RAMP = 0.25;
const NECK_CANDIDATES = ["Neck1", "Neck2", "Head"];
// Largest influence any pass may evict to make room for the new one. The web pass wants to own the
// web, so it may displace whatever is smallest; the neck and scapular passes are corrections and
// must only displace negligible influences.
const MAX_EVICT = 0.10;
// Mirror averaging.
const MIRROR_KEY_DECIMALS = 4;

const { gltf, binary } = readGlb(readFileSync(INPUT));
const rig = createRig(gltf);
let cursor = binary;
const jointSet = new Set(gltf.skins[0].joints);

const weightOf = (vertex, joint) => {
  let sum = 0;
  for (let slot = 0; slot < 4; slot++) if (vertex.joints[slot] === joint) sum += vertex.weights[slot];
  return sum;
};

/**
 * Move `value` onto `joint`.
 *
 * A full four-influence vertex has no free slot, so something must give way. The victim is the
 * smallest influence that is *not* protected — picking the globally smallest instead refused every
 * web vertex whose smallest slot happened to be the adjacent digit, which is exactly the vertex the
 * panel exists to own (`L_WingPanel2_0`: 111 of 136 web vertices skipped that way). Eviction is
 * capped at `maxEvict` so a pass can never quietly discard a substantial influence.
 */
function addWeight(vertex, joint, value, { protect = null, maxEvict = Infinity } = {}) {
  if (value <= 0) return false;
  let slot = vertex.joints.indexOf(joint);
  if (slot === -1) {
    slot = vertex.weights.indexOf(0);
    if (slot === -1) {
      let victim = -1;
      for (let c = 0; c < 4; c++) {
        if (protect && protect.has(vertex.joints[c])) continue;
        if (victim === -1 || vertex.weights[c] < vertex.weights[victim]) victim = c;
      }
      if (victim === -1 || vertex.weights[victim] >= Math.min(value, maxEvict)) return false;
      let lead = 0;
      for (let c = 1; c < 4; c++) if (c !== victim && vertex.weights[c] > vertex.weights[lead]) lead = c;
      vertex.weights[lead] += vertex.weights[victim];
      vertex.weights[victim] = 0;
      slot = victim;
    }
    vertex.joints[slot] = joint;
  }
  vertex.weights[slot] += value;
  return true;
}

function takeWeight(vertex, joint, value) {
  const slot = vertex.joints.indexOf(joint);
  if (slot === -1) return 0;
  const taken = Math.min(vertex.weights[slot], value);
  vertex.weights[slot] -= taken;
  return taken;
}

/** Bone axis in bind world space: head -> first joint child (a bone's tail is its child's head). */
function boneSegment(name) {
  const index = rig.nodeIndexByName.get(name);
  assert.notEqual(index, undefined, `unknown node ${name}`);
  const head = rig.bindWorldPos(name);
  const jointChild = (gltf.nodes[index].children ?? []).find(c => jointSet.has(c));
  if (jointChild !== undefined) {
    const tail = rig.bindWorldPos(gltf.nodes[jointChild].name);
    if (tail.distanceToSquared(head) > 1e-6) return { head, tail };
  }
  const parentIndex = rig.parentOf.get(index);
  if (parentIndex !== undefined) {
    const direction = head.clone().sub(rig.bindWorldPos(gltf.nodes[parentIndex].name));
    if (direction.lengthSq() > 1e-6) return { head, tail: head.clone().add(direction) };
  }
  return { head, tail: head.clone().add(new Vector3(0, 1, 0)) };
}

function pointToSegment(point, segment) {
  const p = new Vector3(...point);
  const ab = segment.tail.clone().sub(segment.head);
  const lengthSq = ab.lengthSq();
  const t = lengthSq < 1e-9 ? 0 : p.clone().sub(segment.head).dot(ab) / lengthSq;
  const clamped = Math.max(0, Math.min(1, t));
  return { distance: p.distanceTo(segment.head.clone().addScaledVector(ab, clamped)), t };
}

/** Read a mesh with weights in 0..1 and positions in bind world space. */
function readMesh(name, space = "world") {
  // `cursor`, not `binary`: every pass re-appends JOINTS_0/WEIGHTS_0, so after the first write the
  // live accessors live in the grown buffer and decoding the original would read stale offsets.
  const { vertices, indices, prim } = readSkin(gltf, cursor, name, { space });
  const weightScale = normalizationScale(gltf.accessors[prim.attributes.WEIGHTS_0]);
  for (const vertex of vertices) vertex.weights = vertex.weights.map(w => w / weightScale);
  return { vertices, indices };
}
const massOf = vertices => vertices.reduce((a, v) => a + v.weights.reduce((x, y) => x + y, 0), 0);

/** Per-joint vertex count and mass, for the before/after table. */
function coverageOf(vertices) {
  const map = new Map();
  for (const v of vertices) {
    for (let slot = 0; slot < 4; slot++) {
      if (v.weights[slot] <= 0) continue;
      const name = rig.jointName(v.joints[slot]);
      const entry = map.get(name) ?? { vertices: 0, mass: 0 };
      entry.vertices += 1;
      entry.mass += v.weights[slot];
      map.set(name, entry);
    }
  }
  return map;
}
const coverageTable = (before, after, names) => Object.fromEntries(names.map(name => {
  const b = before.get(name) ?? { vertices: 0, mass: 0 };
  const a = after.get(name) ?? { vertices: 0, mass: 0 };
  return [name, {
    before: { vertices: b.vertices, mass: Number(b.mass.toFixed(2)) },
    after: { vertices: a.vertices, mass: Number(a.mass.toFixed(2)) },
  }];
}));

const WATCHED = ["Body", "Spine1", "Spine2", "Spine3", "Neck1", "Neck2", "Head", "L_WingRoot", "R_WingRoot"];

const report = { asset: INPUT, passes: {} };

/**
 * Read-only: per panel bone, the fraction of its inter-digital web mass the panel owns.
 *
 * This is the pass's own target metric, so it is also the honest idempotency signal — absolute
 * panel mass is not, because `WingPanel0_0`/`1_0` already carried ~280 before C5 (bound in C2).
 */
function panelWebShares(vertices) {
  const shares = [];
  for (const side of ["L", "R"]) {
    for (let panel = 0; panel < 4; panel++) {
      for (let segment = 0; segment < 2; segment++) {
        const phalanx = segment + 1;
        const panelJoint = rig.jointIndexByName.get(`${side}_WingPanel${panel}_${segment}`);
        const digitA = rig.jointIndexByName.get(`${side}_WingD${panel}P${phalanx}`);
        const digitB = rig.jointIndexByName.get(`${side}_WingD${panel + 1}P${phalanx}`);
        if ([panelJoint, digitA, digitB].some(j => j === undefined)) continue;
        let webMass = 0;
        let panelMass = 0;
        for (const vertex of vertices) {
          const a = weightOf(vertex, digitA);
          const b = weightOf(vertex, digitB);
          if (a <= 0 || b <= 0) continue;
          webMass += a + b;
          panelMass += weightOf(vertex, panelJoint);
        }
        if (webMass > 0) shares.push(panelMass / webMass);
      }
    }
  }
  return shares.sort((a, b) => a - b);
}

/**
 * Pre-flight: this pass is NOT idempotent — every run hands more mass to the panels, so running it
 * on an already-rebalanced asset double-applies. The median web share separates the two states by
 * a wide margin (pre-C5 ≈ 0.02, post-C5 ≈ 0.42), so refuse rather than silently compound.
 */
{
  const shares = panelWebShares(readMesh("WyvernMembrane_ExportSafe").vertices);
  const median = shares[Math.floor(shares.length / 2)] ?? 0;
  report.preflight = { panels: shares.length, medianWebShare: Number(median.toFixed(4)), alreadyRebalanced: median > 0.15 };
  if (median > 0.15 && !ARGS.includes("--force")) {
    console.error(
      `[C5] refusing to run: the median panel web share is already ${(median * 100).toFixed(1)}% ` +
      `(pre-C5 is ~2%). This pass is not idempotent — apply it to the pre-C5 asset, or pass --force.`,
    );
    process.exit(1);
  }
}

const bodyBefore = coverageOf(readMesh("WyvernBody_Rebuild").vertices);
const membraneBefore = coverageOf(readMesh("WyvernMembrane_ExportSafe").vertices);

// ---------------------------------------------------------------- 1. membrane web
{
  const mesh = "WyvernMembrane_ExportSafe";
  const { vertices, indices } = readMesh(mesh);
  const before = massOf(vertices);
  const selected = new Set();
  let moved = 0;
  let skippedFull = 0;
  const panels = [];
  for (const side of ["L", "R"]) {
    for (let panel = 0; panel < 4; panel++) {
      for (let segment = 0; segment < 2; segment++) {
        const phalanx = segment + 1;
        const bone = `${side}_WingPanel${panel}_${segment}`;
        const panelJoint = rig.jointIndexByName.get(bone);
        const digitA = rig.jointIndexByName.get(`${side}_WingD${panel}P${phalanx}`);
        const digitB = rig.jointIndexByName.get(`${side}_WingD${panel + 1}P${phalanx}`);
        if ([panelJoint, digitA, digitB].some(j => j === undefined)) continue;
        const axis = boneSegment(bone);
        let webVertices = 0;
        let panelMass = 0;
        let skipped = 0;
        for (const [index, vertex] of vertices.entries()) {
          const a = weightOf(vertex, digitA);
          const b = weightOf(vertex, digitB);
          if (a <= 0 || b <= 0) continue;
          webVertices += 1;
          const { t } = pointToSegment(vertex.position, axis);
          const share = WEB_SHARE_NEAR + (WEB_SHARE_FAR - WEB_SHARE_NEAR) * Math.max(0, Math.min(1, t));
          const take = (a + b) * share;
          if (!addWeight(vertex, panelJoint, take, { protect: new Set([digitA, digitB]) })) { skippedFull += 1; skipped += 1; continue; }
          const gotA = takeWeight(vertex, digitA, take * (a / (a + b)));
          const gotB = takeWeight(vertex, digitB, take * (b / (a + b)));
          // Give back whatever the digits could not cover, so the vertex total never grows.
          const shortfall = take - gotA - gotB;
          if (shortfall > 1e-12) takeWeight(vertex, panelJoint, shortfall);
          const net = gotA + gotB;
          if (net <= 0) continue;
          selected.add(index);
          moved += net;
          panelMass += net;
        }
        panels.push({ bone, webVertices, skipped, addedMass: Number(panelMass.toFixed(2)) });
      }
    }
  }
  // One neighbour blend over the touched set so the web boundary does not step.
  const smoothed = smoothSelectedWeights(
    vertices.map(v => v.position),
    indices,
    vertices.map(v => v.joints),
    vertices.map(v => v.weights),
    selected,
    WEB_SMOOTH_BLEND,
  );
  for (const index of selected) vertices[index].weights = smoothed[index].slice();
  cursor = writeSkin(gltf, cursor, mesh, vertices).binary;
  report.passes.web = {
    mesh,
    webVertices: selected.size,
    skippedNoSlot: skippedFull,
    movedMass: Number(moved.toFixed(2)),
    totalMassBefore: Number(before.toFixed(2)),
    totalMassAfter: Number(massOf(vertices).toFixed(2)),
    panels,
  };
}

// ---------------------------------------------------------------- 2. scapular falloff
{
  const mesh = "WyvernBody_Rebuild";
  const { vertices } = readMesh(mesh);
  const scapular = [];
  for (const side of ["L", "R"]) {
    const rootJoint = rig.jointIndexByName.get(`${side}_WingRoot`);
    assert.notEqual(rootJoint, undefined, `missing ${side}_WingRoot joint`);
    const shoulderJoint = rig.jointIndexByName.get(`${side}_WingShoulder`);
    const spine3Joint = rig.jointIndexByName.get("Spine3");
    const axis = boneSegment(`${side}_WingRoot`);
    const candidates = [];
    for (const [index, vertex] of vertices.entries()) {
      const shoulderMass = weightOf(vertex, shoulderJoint);
      const spineMass = weightOf(vertex, spine3Joint);
      if (shoulderMass + spineMass <= 0) continue;
      const { distance } = pointToSegment(vertex.position, axis);
      if (distance > SCAPULAR_RADIUS) continue;
      candidates.push({ index, vertex, distance, shoulderMass, spineMass });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const chosen = candidates.slice(0, SCAPULAR_TARGET);
    let moved = 0;
    let placed = 0;
    for (const { vertex, distance, shoulderMass, spineMass } of chosen) {
      const falloff = 1 - Math.min(1, distance / SCAPULAR_RADIUS);
      const share = SCAPULAR_SHARE_FAR + (SCAPULAR_SHARE_NEAR - SCAPULAR_SHARE_FAR) * falloff;
      const take = (shoulderMass + spineMass) * share;
      if (!addWeight(vertex, rootJoint, take, { protect: new Set([shoulderJoint, spine3Joint]), maxEvict: MAX_EVICT })) continue;
      const gotS = takeWeight(vertex, shoulderJoint, take * (shoulderMass / (shoulderMass + spineMass)));
      const got3 = takeWeight(vertex, spine3Joint, take * (spineMass / (shoulderMass + spineMass)));
      const shortfall = take - gotS - got3;
      if (shortfall > 1e-12) takeWeight(vertex, rootJoint, shortfall);
      moved += gotS + got3;
      placed += 1;
    }
    scapular.push({
      side,
      candidates: candidates.length,
      vertices: placed,
      nearest: Number((chosen[0]?.distance ?? 0).toFixed(1)),
      farthest: Number((chosen.at(-1)?.distance ?? 0).toFixed(1)),
      addedMass: Number(moved.toFixed(2)),
    });
  }
  cursor = writeSkin(gltf, cursor, mesh, vertices).binary;
  report.passes.scapular = { mesh, target: SCAPULAR_TARGET, sides: scapular };
}

// ---------------------------------------------------------------- 3. neck handover
{
  const mesh = "WyvernBody_Rebuild";
  const { vertices } = readMesh(mesh);
  const spine3Joint = rig.jointIndexByName.get("Spine3");
  const spine3Segment = boneSegment("Spine3");
  const headSegment = boneSegment("Head");
  // Ramp axis: Spine3.head -> Head.head. t = 0 at the chest joint, t = 1 at the skull.
  const rampStart = rig.bindWorldPos("Spine3");
  const rampEnd = rig.bindWorldPos("Head");
  const ramp = rampEnd.clone().sub(rampStart);
  const rampLength = ramp.length();
  const candidates = NECK_CANDIDATES.map(name => ({ name, joint: rig.jointIndexByName.get(name), segment: boneSegment(name) }));
  for (const c of candidates) assert.notEqual(c.joint, undefined, `missing ${c.name} joint`);

  let touched = 0;
  let moved = 0;
  const toBone = {};
  for (const vertex of vertices) {
    const mass = weightOf(vertex, spine3Joint);
    if (mass <= 0) continue;
    const p = new Vector3(...vertex.position);
    // Only hand over where a neck bone is genuinely nearer than Spine3 itself.
    let nearest = null;
    let nearestDistance = pointToSegment(vertex.position, spine3Segment).distance;
    for (const c of candidates) {
      const d = pointToSegment(vertex.position, c.segment).distance;
      if (d < nearestDistance) { nearest = c; nearestDistance = d; }
    }
    if (!nearest) continue;
    const t = rampLength < 1e-6 ? 0 : p.clone().sub(rampStart).dot(ramp) / (rampLength * rampLength);
    // Ramp in over NECK_RAMP of the axis starting at Spine3.head, so nothing steps at the joint.
    const rampFactor = Math.max(0, Math.min(1, (t - 0) / NECK_RAMP));
    if (rampFactor <= 0) continue;
    const take = mass * NECK_SHARE * rampFactor;
    if (take <= 0) continue;
    if (!addWeight(vertex, nearest.joint, take, { protect: new Set([spine3Joint]), maxEvict: MAX_EVICT })) continue;
    const got = takeWeight(vertex, spine3Joint, take);
    if (got <= 0) { takeWeight(vertex, nearest.joint, take); continue; }
    moved += got;
    toBone[nearest.name] = (toBone[nearest.name] ?? 0) + got;
    touched += 1;
  }
  cursor = writeSkin(gltf, cursor, mesh, vertices).binary;
  report.passes.neck = {
    mesh,
    share: NECK_SHARE,
    ramp: NECK_RAMP,
    vertices: touched,
    movedMass: Number(moved.toFixed(2)),
    byBone: Object.fromEntries(Object.entries(toBone).map(([k, v]) => [k, Number(v.toFixed(2))])),
    totalMassAfter: Number(massOf(vertices).toFixed(2)),
  };
}

// ---------------------------------------------------------------- 4. mirror symmetry
{
  const summary = {};
  const mirroredName = name => {
    if (name.startsWith("L_")) return `R_${name.slice(2)}`;
    if (name.startsWith("R_")) return `L_${name.slice(2)}`;
    return name;
  };
  for (const mesh of ["WyvernBody_Rebuild", "WyvernMembrane_ExportSafe"]) {
    // Key in mesh-local space: the bind matrix carries a ~0.0002 rotation term, so world X is not
    // an exact mirror and a world-space key would miss most pairs. Local coordinates are exact.
    const { vertices } = readMesh(mesh, "local");
    const key = p => p.map(v => v.toFixed(MIRROR_KEY_DECIMALS)).join(",");
    const byKey = new Map();
    for (const [index, vertex] of vertices.entries()) {
      const k = key(vertex.position);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(index);
    }
    const seen = new Set();
    let pairs = 0;
    let changed = 0;
    for (const [index, vertex] of vertices.entries()) {
      if (seen.has(index) || Math.abs(vertex.position[0]) < 1e-4) continue;
      const mirrorKey = key([-vertex.position[0], vertex.position[1], vertex.position[2]]);
      const partnerIndex = (byKey.get(mirrorKey) ?? []).find(i => i !== index && !seen.has(i));
      if (partnerIndex === undefined) continue;
      const partner = vertices[partnerIndex];
      const own = vertex.weights.slice();
      const other = partner.weights.slice();
      const ownJoints = vertex.joints.slice();
      const otherJoints = partner.joints.slice();

      // Average corresponding influences without changing either palette: for each of my
      // influences, find the same (or mirrored) joint in the partner and split the difference.
      const merged = own.slice();
      let differing = false;
      for (let slot = 0; slot < 4; slot++) {
        const joint = ownJoints[slot];
        if (own[slot] === 0 && joint === 0) continue;
        const mirror = rig.jointIndexByName.get(mirroredName(rig.jointName(joint)));
        const partnerSlot = otherJoints.indexOf(mirror);
        const partnerWeight = partnerSlot === -1 ? 0 : other[partnerSlot];
        merged[slot] = (own[slot] + partnerWeight) / 2;
        if (Math.abs(merged[slot] - own[slot]) > 1e-9) differing = true;
      }
      const partnerMerged = other.slice();
      for (let slot = 0; slot < 4; slot++) {
        const joint = otherJoints[slot];
        if (other[slot] === 0 && joint === 0) continue;
        const mirror = rig.jointIndexByName.get(mirroredName(rig.jointName(joint)));
        const ownSlot = ownJoints.indexOf(mirror);
        const ownWeight = ownSlot === -1 ? 0 : own[ownSlot];
        partnerMerged[slot] = (other[slot] + ownWeight) / 2;
      }
      for (let slot = 0; slot < 4; slot++) {
        vertex.weights[slot] = merged[slot];
        partner.weights[slot] = partnerMerged[slot];
      }
      seen.add(index);
      seen.add(partnerIndex);
      pairs += 1;
      if (differing) changed += 1;
    }
    cursor = writeSkin(gltf, cursor, mesh, vertices).binary;
    summary[mesh] = { pairs, changed };
  }
  report.passes.symmetry = summary;
}

// ---------------------------------------------------------------- before / after
const bodyAfter = coverageOf(readMesh("WyvernBody_Rebuild").vertices);
const membraneAfter = coverageOf(readMesh("WyvernMembrane_ExportSafe").vertices);
report.body = coverageTable(bodyBefore, bodyAfter, WATCHED);
report.membranePanels = coverageTable(
  membraneBefore, membraneAfter,
  ["L_WingPanel0_1", "R_WingPanel0_1", "L_WingPanel2_0", "R_WingPanel2_0", "L_WingPanel3_0", "R_WingPanel3_0"],
);

// ---------------------------------------------------------------- write
gltf.buffers[0].byteLength = cursor.length;
const json = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPad = (4 - (json.length % 4)) % 4;
const paddedJson = jsonPad ? Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]) : json;
const binPad = (4 - (cursor.length % 4)) % 4;
const bin = binPad ? Buffer.concat([cursor, Buffer.alloc(binPad)]) : cursor;
const bytes = Buffer.alloc(28 + paddedJson.length + bin.length);
bytes.write("glTF", 0, 4, "ascii");
bytes.writeUInt32LE(2, 4);
bytes.writeUInt32LE(bytes.length, 8);
bytes.writeUInt32LE(paddedJson.length, 12);
bytes.writeUInt32LE(0x4e4f534a, 16);
paddedJson.copy(bytes, 20);
bytes.writeUInt32LE(bin.length, 20 + paddedJson.length);
bytes.writeUInt32LE(0x004e4942, 24 + paddedJson.length);
bin.copy(bytes, 28 + paddedJson.length);

report.output = { path: TARGET, written: WRITE || outFlag !== -1, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
console.log(JSON.stringify(report, null, 2));

if (!WRITE) {
  if (outFlag !== -1) {
    // Candidate only: no contract re-sign, no compaction. Lets `measure_membrane_extent.mjs`
    // score the weights before anything the runtime loads is touched.
    writeFileSync(TARGET, bytes);
    console.log(`\ncandidate written to ${TARGET} (contract untouched).`);
  } else {
    console.log("\ndry run: nothing written. Re-run with --write to promote, or --out <path> for a candidate.");
  }
} else {
  const contractPath = "scripts/blender/wyvern_v2_runtime_contract.json";
  const tmp = `${TARGET}.c5.tmp`;
  writeFileSync(tmp, bytes);
  try {
    // Weight fingerprints legitimately change: re-sign before compacting, because compactGlb
    // validates against the on-disk contract.
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    contract.signature = inspectRuntimeRig(bytes);
    writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
    compactGlb(tmp, tmp);
    const finalBytes = readFileSync(tmp);
    contract.signature = inspectRuntimeRig(finalBytes);
    contract.asset.sha256 = createHash("sha256").update(finalBytes).digest("hex");
    contract.asset.bytes = finalBytes.length;
    writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
    writeValidatedRuntimeRig(TARGET, finalBytes);
    console.log(`[C5] Wrote ${TARGET}: ${JSON.stringify(validateRuntimeRig(readFileSync(TARGET)))}`);
  } finally {
    rmSync(tmp, { force: true });
  }
}
