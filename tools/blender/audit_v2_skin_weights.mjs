#!/usr/bin/env node
/**
 * C5 skinning audit: where the V2 weight mass actually sits.
 *
 * Three questions, per bone and per side, straight from the GLB:
 *  1. **Coverage** — how many vertices a bone owns and how much mass it carries.
 *  2. **Symmetry** — `|L − R| / (L + R)` for every paired wing/panel bone. The gate is 0.05.
 *  3. **Web coverage** — for each inter-digital panel, how much of the membrane web between
 *     digits K and K+1 the panel bone actually owns. The web is the set of vertices weighted to
 *     *both* adjacent digits; if the panel owns ~none of it, the panel is decorative and the
 *     membrane tears along the digit seam.
 *
 * Usage: node tools/blender/audit_v2_skin_weights.mjs [glb] [--json-out <path>]
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Vector3 } from "three";
import { readGlb } from "./runtime_rig_contract.mjs";
import { createRig, readSkin } from "./glb_skin_io.mjs";

const ARGS = process.argv.slice(2);
const jsonFlag = ARGS.indexOf("--json-out");
const TARGET = ARGS.find((a, i) => !a.startsWith("--") && (jsonFlag === -1 || i !== jsonFlag + 1))
  ?? "public/models/wyvern-v2-rig.glb";
const JSON_OUT = jsonFlag === -1 ? null : ARGS[jsonFlag + 1];

const SYMMETRY_LIMIT = 0.05;
const MESHES = ["WyvernBody_Rebuild", "WyvernMembrane_ExportSafe"];

const { gltf, binary } = readGlb(readFileSync(TARGET));
const rig = createRig(gltf);

/** Per-joint coverage over both meshes. */
const coverage = new Map();
function addCoverage(name, weight) {
  const entry = coverage.get(name) ?? { vertices: 0, mass: 0, maxWeight: 0 };
  entry.vertices += 1;
  entry.mass += weight / 255;
  entry.maxWeight = Math.max(entry.maxWeight, weight / 255);
  coverage.set(name, entry);
}

const skins = {};
for (const meshName of MESHES) {
  const { vertices } = readSkin(gltf, binary, meshName);
  for (const v of vertices) {
    for (let slot = 0; slot < 4; slot++) {
      const w = v.weights[slot];
      if (w > 0) addCoverage(rig.jointName(v.joints[slot]), w);
    }
  }
  skins[meshName] = vertices.length;
}

const bones = [...coverage.entries()]
  .map(([name, e]) => ({
    bone: name,
    vertices: e.vertices,
    mass: Number(e.mass.toFixed(2)),
    maxWeight: Number(e.maxWeight.toFixed(3)),
  }))
  .sort((a, b) => b.mass - a.mass);

/** Paired L/R symmetry on mass and vertex count. */
const symmetry = [];
for (const entry of bones) {
  if (!entry.bone.startsWith("L_")) continue;
  const right = coverage.get(`R_${entry.bone.slice(2)}`);
  if (!right) continue;
  const left = coverage.get(entry.bone);
  const massRatio = Math.abs(left.mass - right.mass) / Math.max(1e-9, left.mass + right.mass);
  const countRatio = Math.abs(left.vertices - right.vertices) / Math.max(1e-9, left.vertices + right.vertices);
  symmetry.push({
    bone: entry.bone.slice(2),
    left: { vertices: left.vertices, mass: Number(left.mass.toFixed(2)) },
    right: { vertices: right.vertices, mass: Number(right.mass.toFixed(2)) },
    massRatio: Number(massRatio.toFixed(4)),
    countRatio: Number(countRatio.toFixed(4)),
    passes: massRatio < SYMMETRY_LIMIT,
  });
}
symmetry.sort((a, b) => b.massRatio - a.massRatio);

/**
 * Inter-digital web coverage. The web between digit K and K+1 at phalanx P is the vertex set
 * carrying weight on both `WingD{K}P{P}` and `WingD{K+1}P{P}`; the panel bone owes that web.
 */
const membrane = readSkin(gltf, binary, "WyvernMembrane_ExportSafe");
const web = [];
for (const side of ["L", "R"]) {
  for (let panel = 0; panel < 4; panel++) {
    for (let segment = 0; segment < 2; segment++) {
      const phalanx = segment + 1;
      const digitA = rig.jointIndexByName.get(`${side}_WingD${panel}P${phalanx}`);
      const digitB = rig.jointIndexByName.get(`${side}_WingD${panel + 1}P${phalanx}`);
      const panelJoint = rig.jointIndexByName.get(`${side}_WingPanel${panel}_${segment}`);
      let webVertices = 0;
      let webMass = 0;
      let panelOwned = 0;
      for (const v of membrane.vertices) {
        const weightOf = j => {
          let sum = 0;
          for (let slot = 0; slot < 4; slot++) if (v.joints[slot] === j) sum += v.weights[slot];
          return sum;
        };
        const a = weightOf(digitA);
        const b = weightOf(digitB);
        if (a > 0 && b > 0) {
          webVertices += 1;
          webMass += (a + b) / 255;
          panelOwned += weightOf(panelJoint);
        }
      }
      web.push({
        bone: `${side}_WingPanel${panel}_${segment}`,
        digits: [`WingD${panel}P${phalanx}`, `WingD${panel + 1}P${phalanx}`],
        webVertices,
        webMass: Number(webMass.toFixed(2)),
        panelMass: Number((panelOwned / 255).toFixed(2)),
        share: webMass > 0 ? Number((panelOwned / 255 / webMass).toFixed(4)) : 0,
      });
    }
  }
}

/**
 * Geometric consistency: does each vertex's dominant bone match the bone segment that is actually
 * nearest to it? This is the only pose-independent test of "is this vertex weighted to the bone
 * that will move it", and it is what showed the task list's "thoracic cliff" was really `Spine3`
 * owning the whole `Neck1` span (20.1% neck-slab agreement before C5, 59.9% after).
 *
 * Reported as a diagnostic, not a gate: a vertex on the surface of a tube is often marginally
 * nearer an unrelated bone through the body, so the absolute number is low even on a healthy rig.
 */
function geometricAgreement(gltf, binary, rig, meshName) {
  const jointSet = new Set(gltf.skins[0].joints);
  const segments = [];
  for (const name of rig.jointIndexByName.keys()) {
    const index = rig.nodeIndexByName.get(name);
    const head = rig.bindWorldPos(name);
    const child = (gltf.nodes[index].children ?? []).find(c => jointSet.has(c));
    let tail;
    if (child !== undefined) {
      tail = rig.bindWorldPos(gltf.nodes[child].name);
    } else {
      const parent = rig.parentOf.get(index);
      tail = parent === undefined
        ? head.clone().add(new Vector3(0, 1, 0))
        : head.clone().add(head.clone().sub(rig.bindWorldPos(gltf.nodes[parent].name)));
    }
    if (tail.distanceToSquared(head) < 1e-6) continue;
    segments.push({ name, head, tail });
  }
  const distanceTo = (p, s) => {
    const ab = s.tail.clone().sub(s.head);
    const lengthSq = ab.lengthSq();
    const t = lengthSq < 1e-12 ? 0 : Math.max(0, Math.min(1, p.clone().sub(s.head).dot(ab) / lengthSq));
    return p.distanceTo(s.head.clone().addScaledVector(ab, t));
  };
  const NECK = ["Spine2", "Spine3", "Neck1", "Neck2", "Head"];
  const { vertices } = readSkin(gltf, binary, meshName);
  let agree = 0;
  let neckSlab = 0;
  let neckAgree = 0;
  const neckDominant = new Map();
  for (const vertex of vertices) {
    const p = new Vector3(...vertex.position);
    let lead = 0;
    for (let slot = 1; slot < 4; slot++) if (vertex.weights[slot] > vertex.weights[lead]) lead = slot;
    const dominant = rig.jointName(vertex.joints[lead]);
    let nearest = null;
    let nearestDistance = Infinity;
    for (const s of segments) {
      const d = distanceTo(p, s);
      if (d < nearestDistance) { nearestDistance = d; nearest = s.name; }
    }
    if (nearest === dominant) agree += 1;
    if (NECK.includes(nearest)) {
      neckSlab += 1;
      neckDominant.set(dominant, (neckDominant.get(dominant) ?? 0) + 1);
      if (dominant === nearest) neckAgree += 1;
    }
  }
  return {
    mesh: meshName,
    dominantEqualsNearestPct: Number((100 * agree / vertices.length).toFixed(1)),
    neckSlabVertices: neckSlab,
    neckAgreementPct: Number((100 * neckAgree / neckSlab).toFixed(1)),
    neckSlabDominant: Object.fromEntries([...neckDominant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)),
  };
}

const report = {
  asset: path.basename(TARGET),
  meshes: skins,
  symmetryLimit: SYMMETRY_LIMIT,
  bones,
  symmetry,
  web,
  geometry: geometricAgreement(gltf, binary, rig, "WyvernBody_Rebuild"),
  failingSymmetry: symmetry.filter(s => !s.passes).map(s => s.bone),
};
report.passed = report.failingSymmetry.length === 0;

const payload = JSON.stringify(report, null, 2);
if (JSON_OUT) {
  mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, payload + "\n");
}

const thoracic = ["Body", "Spine1", "Spine2", "Spine3", "L_WingRoot", "R_WingRoot"];
console.log(`asset ${report.asset}  meshes ${JSON.stringify(skins)}`);
console.log("\nthoracic / scapular:");
for (const name of thoracic) {
  const e = coverage.get(name);
  assert.ok(e, `missing ${name}`);
  console.log(`  ${name.padEnd(12)} verts ${String(e.vertices).padStart(6)}  mass ${e.mass.toFixed(1).padStart(8)}`);
}
console.log("\ndistal membrane panels:");
for (const name of ["L_WingPanel0_1", "R_WingPanel0_1", "L_WingPanel2_0", "R_WingPanel2_0", "L_WingPanel3_0", "R_WingPanel3_0"]) {
  const e = coverage.get(name);
  console.log(`  ${name.padEnd(16)} verts ${String(e?.vertices ?? 0).padStart(4)}  mass ${(e?.mass ?? 0).toFixed(2)}`);
}
console.log("\nweb coverage (panel share of the inter-digital web):");
for (const w of web) {
  console.log(`  ${w.bone.padEnd(16)} web ${String(w.webVertices).padStart(4)} verts  share ${(w.share * 100).toFixed(1).padStart(5)}%`);
}
console.log("\nL/R symmetry (limit 0.05):");
for (const s of symmetry.slice(0, 8)) {
  console.log(`  ${s.bone.padEnd(16)} mass ${s.left.mass} vs ${s.right.mass}  ratio ${s.massRatio}  ${s.passes ? "ok" : "FAIL"}`);
}
console.log(`\nfailing symmetry: ${report.failingSymmetry.length ? report.failingSymmetry.join(", ") : "none"}`);
console.log(`passed: ${report.passed}`);
process.exitCode = report.passed ? 0 : 1;
