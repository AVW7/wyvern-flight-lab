#!/usr/bin/env node
/**
 * Which bones has a GLB-level pass re-posed since the export?
 *
 * The export relation is `channel(k) = rest_glb · basis(0)⁻¹ · basis(k)` — the
 * exporter writes the **frame-0 pose** as the node TRS, so `rest_glb · basis(k)` is
 * off by a constant `basis(0)` and reports a uniform error on every clip, correct or
 * not. `compare_bone_amplitude.mjs` applies this to one bone; this applies it to the
 * whole rig at once, which is what tells you whether a divergence is a single bone
 * or a whole chain.
 *
 * Read the output as: `deviation` is how far the shipped channel has moved from the
 * authored pose, and `shipped/authored max` is the amplitude ratio — the number that
 * says *how much* the pose was scaled. A control clip must come back at `0.0000`.
 *
 * The ratio is only reported where the authored motion is at least
 * `MIN_RATIO_AUTHORED_DEG`. Below that it is meaningless: the D-series legitimately
 * animates bones the blend leaves static (membrane panels especially), and dividing
 * 60deg by a 0.2deg authored value produces a "300x" that says nothing.
 *
 * Usage:
 *   blender --background models/source/wyvern-v2-master.blend \
 *           --python tools/blender/dump_pose_basis_all.py -- --clips attack --out <json>
 *   node tools/blender/compare_rig_amplitude.mjs --basis <json> [--clip attack] [--glb <path>]
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

const basisPath = arg("--basis", null);
const onlyClip = arg("--clip", null);
const glbPath = arg("--glb", RUNTIME_PATH);
const tolerance = Number(arg("--tolerance", "0.01"));
const summary = argv.includes("--summary");
if (!basisPath) throw new Error("--basis <json from dump_pose_basis_all.py> is required");

const dump = JSON.parse(readFileSync(basisPath, "utf8"));
const { gltf, binary } = readGlb(readFileSync(glbPath));
const FPS = 24;
const MIN_RATIO_AUTHORED_DEG = 1;
const angle = (q) => (2 * Math.atan2(Math.hypot(q.x, q.y, q.z), Math.min(1, Math.abs(q.w))) * 180) / Math.PI;

const clips = Object.entries(dump.clips).filter(([name]) => !onlyClip || name === onlyClip);
if (clips.length === 0) throw new Error(`no clip ${onlyClip} in ${basisPath}`);

let anyControl = false;

for (const [clipName, record] of clips) {
  const anim = gltf.animations.find((a) => a.name === clipName);
  if (!anim) throw new Error(`${clipName}: clip missing from ${glbPath}`);

  const rows = [];
  for (const [boneName, samples] of Object.entries(record.bones)) {
    const nodeIndex = gltf.nodes.findIndex((n) => n.name === boneName);
    if (nodeIndex < 0) continue;
    const channel = anim.channels.find((c) => c.target.node === nodeIndex && c.target.path === "rotation");
    if (!channel) continue;
    const sampler = anim.samplers[channel.sampler];
    const current = decodeFloats(gltf, binary, sampler.output);
    const times = decodeFloats(gltf, binary, sampler.input);

    const node = gltf.nodes[nodeIndex];
    const rest = new Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
    const authored = samples.map(([w, x, y, z]) => new Quaternion(x, y, z, w));
    const b0inverse = authored[0].clone().invert();
    const target = authored.map((q) => rest.clone().multiply(b0inverse).multiply(q));

    // The exporter collapses a static channel to two keys, so key counts need not
    // match. Compare at the GLB's own key times, slerping the authored samples
    // (one per 24 fps frame) to meet them.
    const authoredAt = (t) => {
      const x = Math.min(Math.max(t * FPS, 0), target.length - 1);
      const i = Math.min(Math.floor(x), target.length - 2);
      return target[i].clone().slerp(target[i + 1], x - i);
    };

    let deviation = 0;
    let shippedMax = 0;
    let authoredMax = 0;
    for (let k = 0; k < times.length; k++) {
      const now = new Quaternion(current[k * 4], current[k * 4 + 1], current[k * 4 + 2], current[k * 4 + 3]);
      const want = authoredAt(times[k]);
      deviation = Math.max(deviation, angle(want.clone().invert().multiply(now)));
      shippedMax = Math.max(shippedMax, angle(rest.clone().invert().multiply(now)));
      authoredMax = Math.max(authoredMax, angle(rest.clone().invert().multiply(want)));
    }
    rows.push({ bone: boneName, deviation, shippedMax, authoredMax, keys: times.length });
  }

  rows.sort((a, b) => b.deviation - a.deviation);
  if (summary) {
    const over = rows.filter((r) => r.deviation > tolerance);
    const measurable = over.filter((r) => r.authoredMax >= MIN_RATIO_AUTHORED_DEG);
    const worstRatio = measurable.reduce((a, b) => (
      b.shippedMax / b.authoredMax > a.shippedMax / a.authoredMax ? b : a
    ), { shippedMax: 0, authoredMax: 1, bone: "-" });
    console.log(
      `${clipName.padEnd(12)} ${String(rows.length).padStart(3)} bones  ` +
      `${String(over.length).padStart(3)} diverged  worst ` +
      `${worstRatio.bone.padEnd(16)} ${(worstRatio.shippedMax / Math.max(worstRatio.authoredMax, 0.01)).toFixed(2)}x` +
      (measurable.length === 0 ? "  (no bone with >=1deg authored motion)" : ""),
    );
    if (over.length > 0) anyControl = true;
    continue;
  }
  const diverged = rows.filter((r) => r.deviation > tolerance);
  const controls = rows.length - diverged.length;
  if (controls > 0) anyControl = true;

  console.log(`\n${clipName} — ${rows.length} bones, ${controls} at authored pose, ${diverged.length} diverged (>${tolerance}deg)`);
  if (diverged.length === 0) {
    console.log("  (control: the whole clip matches the blend)");
    continue;
  }
  console.log("  bone                deviation   shipped max   authored max      delta   ratio");
  for (const r of diverged.slice(0, 24)) {
    const ratio = r.authoredMax >= MIN_RATIO_AUTHORED_DEG
      ? `${(r.shippedMax / r.authoredMax).toFixed(2)}x`
      : "-";
    console.log(
      `  ${r.bone.padEnd(18)} ${r.deviation.toFixed(2).padStart(9)}   ` +
      `${r.shippedMax.toFixed(2).padStart(11)}   ${r.authoredMax.toFixed(2).padStart(12)}   ` +
      `${(r.shippedMax - r.authoredMax).toFixed(2).padStart(10)}   ${ratio.padStart(7)}`,
    );
  }
  if (diverged.length > 24) console.log(`  … ${diverged.length - 24} more`);
}

if (!anyControl) {
  console.log("\nNo clip reproduced the authored pose — the composition is unverified, do not trust the rows above.");
}
