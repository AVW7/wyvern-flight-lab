#!/usr/bin/env node
/**
 * Measure a rig's motion dynamics and optionally gate it against a reference.
 *
 *   node tools/audit-dynamics.mjs <glb>                        print the table
 *   node tools/audit-dynamics.mjs <glb> --write-reference out  emit a reference JSON
 *   node tools/audit-dynamics.mjs <glb> --baseline ref.json    gate, print pass/fail
 *   node tools/audit-dynamics.mjs <glb> --baseline ref.json --strict   exit 1 on failure
 *
 * The reference is generated, never typed. `--write-reference` records the
 * source SHA-256 so a reference measured from a different file is detectable.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildReference,
  compareToReference,
  loadRig,
  measureDynamics,
  REFERENCE_CLIP_MAP,
  DYNAMICS_HZ,
} from "../scripts/wyvern-dynamics.mjs";

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const has = (name) => argv.includes(`--${name}`);

if (!target) {
  console.error("usage: node tools/audit-dynamics.mjs <glb> [--baseline ref.json] [--write-reference out.json] [--json out.json] [--strict]");
  process.exit(2);
}

const rig = await loadRig(target);
const measured = measureDynamics(rig);

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

console.log(`\n${target}  ${rig.sha256.slice(0, 12)}  ${rig.bytes} B`);
console.log(`${rig.bones.length} bones · ${rig.gltf.animations.length} clips · sampled at ${DYNAMICS_HZ} Hz\n`);
console.log(pad("clip", 13) + pad("peak", 8) + pad("joint", 18) + pad("p95", 8) + pad("mean", 8) + pad("accents", 9) + pad("accelMax", 10) + "sustained");
for (const [name, m] of Object.entries(measured)) {
  console.log(
    pad(name, 13) +
      pad(num(m.peak), 8) +
      pad((m.peakJoint ?? "—").slice(0, 16), 18) +
      pad(num(m.p95), 8) +
      pad(num(m.mean), 8) +
      pad(m.accents, 9) +
      pad(num(m.accelMax, 0), 10) +
      (m.sustained ? "yes" : "NO")
  );
}

const writeReference = flag("write-reference");
if (writeReference) {
  const reference = buildReference(rig, target);
  mkdirSync(dirname(writeReference), { recursive: true });
  writeFileSync(writeReference, `${JSON.stringify(reference, null, 2)}\n`);
  console.log(`\nwrote reference ${writeReference}`);
}

const jsonOut = flag("json");
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify({ target, sha256: rig.sha256, sampleHz: DYNAMICS_HZ, clips: measured }, null, 2)}\n`);
  console.log(`wrote ${jsonOut}`);
}

const baselinePath = flag("baseline");
if (baselinePath) {
  const reference = JSON.parse(readFileSync(baselinePath, "utf8"));
  const result = compareToReference(measured, reference);
  console.log(`\nreference ${baselinePath} (${reference.source?.sha256?.slice(0, 12) ?? "unknown"})`);
  console.log("candidate/reference, deg/s.  * accents is reported, not gated.\n");
  console.log(pad("clip", 13) + pad("peak", 16) + pad("p95", 16) + pad("mean", 16) + pad("accelMax", 18) + "accents*");
  for (const row of result.rows) {
    const cell = (got, want) => `${num(got, 1)}/${num(want, 1)}`;
    console.log(
      pad(row.clip, 13) +
        pad(cell(row.got.peak, row.want.peak), 16) +
        pad(cell(row.got.p95, row.want.p95), 16) +
        pad(cell(row.got.mean, row.want.mean), 16) +
        pad(cell(row.got.accelMax, row.want.accelMax), 18) +
        `${row.got.accents}/${row.want.accents}`
    );
  }
  if (result.passed) {
    console.log("\ndynamics: PASS");
  } else {
    console.log("\ndynamics: FAIL");
    for (const failure of result.failures) {
      console.log(`  ${failure.clip}.${failure.channel} = ${num(failure.value, 2)} (reference ${num(failure.reference, 2)}, expected ${failure.expected})`);
    }
    if (has("strict")) process.exit(1);
  }
}

if (!baselinePath) {
  const known = new Set([...Object.keys(REFERENCE_CLIP_MAP), ...Object.values(REFERENCE_CLIP_MAP)]);
  const unmapped = Object.keys(measured).filter((n) => !known.has(n));
  if (unmapped.length) console.log(`\nno reference cousin (left authored): ${unmapped.join(", ")}`);
}
