#!/usr/bin/env node
/**
 * Does one bone's GLB channel still carry the authored blend pose?
 *
 * Same instrument that localised the jaw divergence, generalised to any bone. The
 * export relation is `channel(k) = rest_glb · basis(0)⁻¹ · basis(k)` — the exporter
 * writes the **frame-0 pose** as the node TRS, so `rest_glb · basis(k)` is off by a
 * constant `basis(0)` and would report a uniform error on every clip, correct or not.
 *
 * A clip whose deviation is ~0 is a control: it proves the relation. A clip that
 * deviates has been re-posed at GLB level since the export.
 *
 * Usage:
 *   node tools/blender/dump_jaw_basis_keys.py  # → --bone Head --clips ... --out <json>
 *   node tools/blender/compare_bone_amplitude.mjs --bone Head --basis <json> [--glb <path>]
 */

import { readFileSync } from "node:fs";
import { Quaternion } from "three";

import { RUNTIME_PATH, readGlb } from "./runtime_rig_contract.mjs";
import { decodeFloats } from "./glb_clip_edit.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

const bone = arg("--bone", "Jaw");
const basisPath = arg("--basis", null);
const glbPath = arg("--glb", RUNTIME_PATH);
if (!basisPath) throw new Error("--basis <json from dump_jaw_basis_keys.py> is required");

const dump = JSON.parse(readFileSync(basisPath, "utf8"));
const { gltf, binary } = readGlb(readFileSync(glbPath));

const node = gltf.nodes.find((n) => n.name === bone);
if (!node) throw new Error(`no ${bone} node in ${glbPath}`);
const rest = new Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
const angle = (q) => (2 * Math.atan2(Math.hypot(q.x, q.y, q.z), Math.min(1, Math.abs(q.w))) * 180) / Math.PI;

console.log(`${glbPath} · ${bone} · ${Object.keys(dump.clips).length} clips from ${basisPath}\n`);
console.log("clip          keys  deviation(deg)  shipped max(deg)  authored max(deg)  kind");

let controls = 0;
let diverged = 0;

for (const [name, record] of Object.entries(dump.clips)) {
  const anim = gltf.animations.find((a) => a.name === name);
  if (!anim) {
    console.log(`${name.padEnd(12)} ${String(record.count).padStart(5)}  (clip missing from the asset)`);
    continue;
  }
  const index = gltf.nodes.indexOf(node);
  const channel = anim.channels.find((c) => c.target.node === index && c.target.path === "rotation");
  if (!channel) throw new Error(`${name}: no ${bone} rotation channel`);
  const current = decodeFloats(gltf, binary, anim.samplers[channel.sampler].output);
  if (current.length / 4 !== record.count) {
    throw new Error(`${name}: channel has ${current.length / 4} keys, dump has ${record.count}`);
  }

  const authored = record.basis.map(([w, x, y, z]) => new Quaternion(x, y, z, w));
  const b0inverse = authored[0].clone().invert();
  const target = authored.map((q) => rest.clone().multiply(b0inverse).multiply(q));

  let deviation = 0;
  let shippedMax = 0;
  let authoredMax = 0;
  for (let k = 0; k < target.length; k++) {
    const now = new Quaternion(current[k * 4], current[k * 4 + 1], current[k * 4 + 2], current[k * 4 + 3]);
    deviation = Math.max(deviation, angle(target[k].clone().invert().multiply(now)));
    shippedMax = Math.max(shippedMax, angle(rest.clone().invert().multiply(now)));
    authoredMax = Math.max(authoredMax, angle(rest.clone().invert().multiply(target[k])));
  }
  const kind = deviation <= 0.01 ? "control" : "DIVERGED";
  if (kind === "control") controls += 1;
  else diverged += 1;
  console.log(
    `${name.padEnd(12)} ${String(target.length).padStart(5)}  ${deviation.toFixed(4).padStart(14)}` +
    `  ${shippedMax.toFixed(2).padStart(16)}  ${authoredMax.toFixed(2).padStart(17)}  ${kind}`,
  );
}

console.log(`\n${controls} control(s), ${diverged} diverged.`);
if (controls === 0) console.log("No control reproduced — the composition is unverified, do not trust the rows above.");
