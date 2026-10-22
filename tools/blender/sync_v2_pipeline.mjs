/**
 * BG-1 (safe half) — rebuild the shipped runtime GLB from a pinned snapshot, one command.
 *
 * ## Why this exists
 *
 * The shipped `public/models/wyvern-v2-rig.glb` is not an export of any `.blend`: every stage
 * that shaped it after C1 ran at GLB level, in an order spread over several sessions. That
 * history lived in commit messages and a handoff note, which is why doc 41's proposed rebuild
 * order was wrong in one placement (it lists the C5 weight rebalance *after* the D4 flight
 * group; the flight group actually ran on the post-C5 asset). This driver makes the chain
 * explicit, ordered and **self-verifying**: every stage's output hash is asserted against the
 * hash that stage historically produced, so a drifted tool fails the run at the stage that
 * drifted instead of shipping a plausible-looking asset.
 *
 * ## What it does not do
 *
 * It does not export the blend. `cli.py export` still refuses to write the shipped destination
 * from `wyvern-v2-master.blend`, because the blend cannot reproduce D2/D3/D4/C5 or the two
 * GLB-level jaw stages — that refusal is the point of the provenance gate, not an obstacle.
 *
 * ## Usage
 *
 *   node tools/blender/sync_v2_pipeline.mjs                 # build + validate, touch nothing
 *   node tools/blender/sync_v2_pipeline.mjs --json out.json # also write a machine report
 *   node tools/blender/sync_v2_pipeline.mjs --keep          # keep the scratch directory
 *   node tools/blender/sync_v2_pipeline.mjs --promote       # install the result (see below)
 *   node tools/blender/sync_v2_pipeline.mjs --promote --note "why the asset changed" --force
 *
 * Without `--promote` the run is read-only with respect to the repo: every stage writes into a
 * scratch directory and the on-disk contract is never touched — each stage validates against a
 * private contract copy re-signed to the bytes it is about to write (WYVERN_RUNTIME_CONTRACT).
 *
 * `--promote` installs the rebuilt asset as the shipped GLB, re-pins the runtime contract,
 * syncs the two candidate aliases and re-runs the rider-mount calibration. When the rebuild
 * reproduces the current pin it is a byte-for-byte no-op; when it does not, promote refuses
 * unless `--force` is given, and `--note` records why in the contract provenance.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectRuntimeRig } from "./runtime_rig_contract.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const abs = (relative) => resolve(repoRoot, relative);

/** The snapshot every rebuild starts from: the asset as of 5fb3ab1 (post A1/A2/A3/B/D1). */
export const STAGE0 = {
  path: "assets/pipeline/wyvern-v2-stage0.glb",
  sha256: "88adf57e5d769b26a382bbc94bced253473a88c87e071c4b3100cd43ce666d6d",
  bytes: 5844968,
  source: "git show 5fb3ab1:public/models/wyvern-v2-rig.glb",
};

const CONTRACT_REL = "scripts/blender/wyvern_v2_runtime_contract.json";
const RUNTIME_REL = "public/models/wyvern-v2-rig.glb";
const BASELINE_REL = "assets/rig-audits/2026-10-21-dynamics/v1-dynamics-reference.json";
/** Must stay the two aliases test/asset-provenance.test.js pins to the runtime asset. */
const CANDIDATE_ALIASES = [
  "public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb",
  "public/models/wyvern-v2-membrane-lab-candidate.glb",
];

/**
 * The GLB-level stages in the order they were actually run, each with the sha256 its output
 * historically carried. `steps` run in sequence; a step with `inPlace` rewrites the current
 * file instead of writing the stage output (the C5 compaction).
 */
export const PIPELINE_STAGES = [
  {
    id: "d2-buzz",
    stage: "D2",
    tool: "tools/blender/reshape_buzz_clips.mjs",
    expect: "064b974afefc85facb65da31ab1c0d5e6a4e89d302ff4e4f1f0d45e439969092",
    note: "takeoff/death BUZZ reshape — the D2-only staged asset",
    steps: [{ args: (current, output) => [current, output] }],
  },
  {
    id: "d1-stabilize",
    stage: "D1",
    tool: "tools/blender/stabilize_v2_body_and_feet.mjs",
    expect: "b2368b6640787698c1e461168e15dc5a936a821b8ffaa5ab6f5b96b44e51fceb",
    note: "Body/feet floor realign (death Body Y −41.1)",
    steps: [{ args: (current, output) => [current, output] }],
  },
  {
    id: "coordinate-panels",
    stage: "D1",
    tool: "tools/blender/coordinate_all_v2_clips.mjs",
    expect: "645b5f3311a420221e72741b9c3fb6e198b9fb3adf22509c60d02ed2a70c273f",
    note: "panel re-solve at 24 fps — the c968a24 install",
    steps: [{ args: (current, output) => [current, output] }],
  },
  {
    id: "d3-motion-floor",
    stage: "D3",
    tool: "tools/blender/reshape_d3_clips.mjs",
    expect: "e10f1733d43213bea54c370b87fc4eeef64e10744174dfc30a9b9a7a3a78374d",
    note: "idle/walk/attack2 continuous motion floor",
    steps: [{ args: (current, output) => [current, output] }],
  },
  {
    id: "d4-attack",
    stage: "D4",
    tool: "tools/blender/reshape_d4_clips.mjs",
    expect: "950c4321b00cd5e2a5a398b812b6dcfd135eb19965274783c4996ff7ca19e570",
    note: "attack amplification + strike accent",
    steps: [{ args: (current, output) => [current, output] }],
  },
  {
    id: "c5-weights",
    stage: "C5",
    tool: "tools/blender/rebalance_v2_skin_weights.mjs",
    expect: "bef7a09aa131dd996f4e91e66e0edd95bbd623c1d6644e6eeb1b40ae0deffdee",
    note: "skin-weight rebalance (not idempotent — refuses above 15% median panel share) + compaction",
    steps: [
      { args: (current, output) => [current, "--out", output] },
      { tool: "tools/blender/compact_v2_glb.mjs", args: (current) => [current, current], inPlace: true },
    ],
  },
  {
    id: "d4-flight",
    stage: "D4",
    tool: "tools/blender/reshape_d4_flight_clips.mjs",
    expect: "b5f1c1ef67ad9324212f8ab2075e707abd3ff02280ff77db47ffe96a96f3d08b",
    note: "cruise/bankLeft/bankRight retimed to 1.000 Hz + stroke gain — runs on the post-C5 asset",
    steps: [{ args: (current, output) => [current, output] }],
  },
  {
    id: "c6-jaw-pivot",
    stage: "C6",
    tool: "tools/blender/recenter_v2_jaw_pivot.mjs",
    expect: "04dbda5c94e50fc190d10d8a43ef13955ef5d7457b059eaa57c68af2725de8d8",
    note: "Jaw hinge to the mandible joint, promoted at GLB level",
    steps: [{ args: (current, output) => ["--in", current, "--out", output] }],
  },
  {
    id: "c6-jaw-restore",
    stage: "C6",
    tool: "tools/blender/restore_jaw_amplitude.mjs",
    expect: "f5d768a2946bb7e6e946e3acb927e9be9db9cfa7287c2d5c042940bcd636e11b",
    note: "authored mouth restored + death's non-jaw gain re-solved — the shipped pin",
    steps: [{ args: (current, output) => ["--in", current, "--out", output] }],
  },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");

function stageEnv(privateContract) {
  return { ...process.env, WYVERN_RUNTIME_CONTRACT: privateContract };
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.WYVERN_RUNTIME_CONTRACT;
  return env;
}

/** Run a tool, returning its tail. Throws with the captured output on a non-zero exit. */
function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: options.env ?? cleanEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) throw new Error(`${label}: could not run (${result.error.message})`);
  const lines = output.trim().split("\n").filter(Boolean);
  if (result.status !== 0) {
    throw new Error(`${label}: exit ${result.status}\n${lines.slice(-25).join("\n")}`);
  }
  return lines.slice(-2).join("\n");
}

/** Point a private contract copy at `assetPath`, exactly as each stage's --write path does. */
function resignPrivateContract(contractPath, assetPath) {
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const bytes = readFileSync(assetPath);
  contract.signature = inspectRuntimeRig(bytes);
  contract.asset.sha256 = sha256(bytes);
  contract.asset.bytes = bytes.length;
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
}

function build(scratch) {
  const stage0Bytes = readFileSync(abs(STAGE0.path));
  if (sha256(stage0Bytes) !== STAGE0.sha256 || stage0Bytes.length !== STAGE0.bytes) {
    throw new Error(
      `${STAGE0.path} is ${sha256(stage0Bytes).slice(0, 16)}… / ${stage0Bytes.length} B, ` +
      `expected ${STAGE0.sha256.slice(0, 16)}… / ${STAGE0.bytes} B (${STAGE0.source})`,
    );
  }

  const privateContract = join(scratch, "contract.json");
  writeFileSync(privateContract, readFileSync(abs(CONTRACT_REL)));

  const rows = [];
  let current = join(scratch, "stage0.glb");
  writeFileSync(current, stage0Bytes);

  for (const stage of PIPELINE_STAGES) {
    const output = join(scratch, `${stage.id}.glb`);
    for (const step of stage.steps) {
      const tool = step.tool ?? stage.tool;
      const label = `${stage.id}: ${tool.split("/").pop()}`;
      // The contract copy must describe the bytes the tool is about to validate.
      resignPrivateContract(privateContract, current);
      const tail = run(label, process.execPath, [abs(tool), ...step.args(current, output)], {
        env: stageEnv(privateContract),
      });
      rows.push({ stage: stage.id, tool, tail });
      process.stdout.write(`  ${stage.id.padEnd(18)} ${tail.split("\n").pop()}\n`);
      if (step.inPlace) continue;
      current = output;
    }
    const bytes = readFileSync(current);
    const hash = sha256(bytes);
    if (hash !== stage.expect) {
      throw new Error(
        `${stage.id} produced ${hash.slice(0, 16)}… (${bytes.length} B), expected ` +
        `${stage.expect.slice(0, 16)}… — the stage tool drifted from the hash this pipeline pins`,
      );
    }
    process.stdout.write(`  ${"".padEnd(18)} ${hash.slice(0, 12)}  ${String(bytes.length).padStart(8)} B  ok\n`);
  }

  return { final: current, rows };
}

/**
 * The three behavioural gates must pass on any candidate. The contract *signature* check is
 * informational here: a rebuild that legitimately re-authors structure (weights, bind
 * matrices) changes the signature, and `promote` re-signs the contract in that case behind
 * `--force`. The hash gate in `promote` is what actually protects the pin.
 */
function validate(finalPath) {
  const results = [];
  const contractCheck = (() => {
    try {
      const tail = run("runtime contract signature", process.execPath, [
        "tools/blender/runtime_rig_contract.mjs", finalPath, "--candidate",
      ]);
      return { name: "runtime contract signature", ok: true, tail };
    } catch (error) {
      return { name: "runtime contract signature", ok: false, tail: error.message };
    }
  })();
  results.push(contractCheck);
  process.stdout.write(
    `  ${contractCheck.name.padEnd(28)} ${contractCheck.ok ? "ok" : "changed (promote re-signs)"}\n`,
  );

  for (const [name, command, args] of [
    ["clip validator (strict)", process.execPath, ["scripts/validate-wyvern-clips.mjs", finalPath, "--strict"]],
    ["pose envelope", tsx, ["tools/audit-v2-pose-envelope.mjs", finalPath]],
    ["dynamics gate", process.execPath, ["tools/audit-dynamics.mjs", finalPath, "--baseline", BASELINE_REL, "--strict"]],
  ]) {
    const tail = run(name, command, args);
    results.push({ name, ok: true, tail });
    process.stdout.write(`  ${name.padEnd(28)} ok\n`);
  }
  return results;
}

function promote(finalPath, { note, force }) {
  const contract = JSON.parse(readFileSync(abs(CONTRACT_REL), "utf8"));
  const pin = contract.asset.sha256;
  const finalBytes = readFileSync(finalPath);
  const hash = sha256(finalBytes);

  if (hash !== pin && !force) {
    throw new Error(
      `rebuild produced ${hash.slice(0, 16)}… but the contract pins ${pin.slice(0, 16)}…. ` +
      `Refusing to promote a changed asset without --force (and a --note saying why it changed).`,
    );
  }

  const install = (target) => {
    const temporary = `${target}.sync.tmp`;
    writeFileSync(temporary, finalBytes);
    renameSync(temporary, target);
  };
  install(abs(RUNTIME_REL));

  contract.signature = inspectRuntimeRig(finalBytes);
  contract.asset.sha256 = hash;
  contract.asset.bytes = finalBytes.length;
  if (note) {
    const stamp = new Date().toISOString().slice(0, 10);
    contract.provenance.baseline =
      `${stamp}: ${note} (tools/blender/sync_v2_pipeline.mjs). ${contract.provenance.baseline}`;
  }
  writeFileSync(abs(CONTRACT_REL), `${JSON.stringify(contract, null, 2)}\n`);

  for (const alias of CANDIDATE_ALIASES) install(abs(alias));

  run("calibrate-rider-mount", process.execPath, ["tools/calibrate-rider-mount.mjs", "--write"]);
  run("runtime contract (pinned)", process.execPath, ["tools/blender/runtime_rig_contract.mjs"]);

  return { sha256: hash, bytes: finalBytes.length, changed: hash !== pin };
}

async function main() {
  const argv = process.argv.slice(2);
  const flagIndex = (name) => argv.indexOf(name);
  const jsonIndex = flagIndex("--json");
  const noteIndex = flagIndex("--note");

  const scratch = mkdtempSync(join(tmpdir(), "wyvern-sync-"));
  const report = { startedAt: new Date().toISOString(), stages: [], promoted: false };
  try {
    process.stdout.write(`rebuilding from ${STAGE0.path} (${STAGE0.sha256.slice(0, 12)}…)\n`);
    const { final, rows } = build(scratch);
    report.stages = rows;
    const finalBytes = readFileSync(final);
    report.final = { path: final, sha256: sha256(finalBytes), bytes: finalBytes.length };

    process.stdout.write("validating the rebuilt candidate\n");
    report.checks = validate(final);

    const contract = JSON.parse(readFileSync(abs(CONTRACT_REL), "utf8"));
    report.reproducesPin = report.final.sha256 === contract.asset.sha256;
    process.stdout.write(
      report.reproducesPin
        ? `\nrebuild reproduces the shipped pin ${report.final.sha256.slice(0, 12)}… byte-for-byte\n`
        : `\nrebuild produced ${report.final.sha256.slice(0, 12)}…, pin is ${contract.asset.sha256.slice(0, 12)}…\n`,
    );

    if (argv.includes("--promote")) {
      const promoted = promote(final, {
        note: noteIndex >= 0 ? argv[noteIndex + 1] : null,
        force: argv.includes("--force"),
      });
      report.promoted = true;
      report.promote = promoted;
      process.stdout.write(
        promoted.changed
          ? `promoted a CHANGED asset: ${promoted.sha256.slice(0, 12)}… (${promoted.bytes} B)\n`
          : `promoted; the shipped asset is unchanged (${promoted.sha256.slice(0, 12)}…)\n`,
      );
      process.stdout.write("next: npm run test:fast && npm run assets:audit-dynamics:v2 && npm run assets:check-provenance\n");
    } else {
      process.stdout.write("dry run: nothing installed. Re-run with --promote to install the rebuild.\n");
    }
    report.passed = true;
  } finally {
    if (jsonIndex >= 0) {
      writeFileSync(abs(argv[jsonIndex + 1]), `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`report written to ${argv[jsonIndex + 1]}\n`);
    }
    if (argv.includes("--keep")) {
      process.stdout.write(`scratch kept at ${scratch}\n`);
    } else {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`\nsync failed: ${error.message}`);
    process.exitCode = 1;
  });
}
