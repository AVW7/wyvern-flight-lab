import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const slowFiles = new Set(["model-integration.test.js", "scene-audit.test.js"]);
const files = readdirSync("test")
  .filter((f) => f.endsWith(".test.js") && !slowFiles.has(f))
  .map((f) => `test/${f}`);

// AGENTS.md pins this machine at 8 GB. `tsx --test` defaults to concurrency ≈ ncpu, which
// puts eight workers — each holding a Three.js module graph — into that budget, so the gate
// thrashes rather than finishes and reads as a hang at a fixed test number. 3 is the value
// measured green here (798/798, exit 0). It takes ~8 min on an idle box and longer when
// anything else is competing for the same RAM — 11m38s with other node processes running.
// TEST_CONCURRENCY raises it on a larger box.
const concurrency = process.env.TEST_CONCURRENCY ?? "3";

// Prefer the workspace-local tsx so the gate still runs where pnpm is absent.
const localTsx = "node_modules/.bin/tsx";
const [command, args] = existsSync(localTsx)
  ? [localTsx, ["--test", `--test-concurrency=${concurrency}`, ...files]]
  : ["pnpm", ["exec", "tsx", "--test", `--test-concurrency=${concurrency}`, ...files]];

const result = spawnSync(command, args, { stdio: "inherit" });
// A gate that did not run must not report success: spawnSync leaves status null
// on ENOENT, which `?? 0` would turn into a passing exit code.
if (result.error || result.status === null) {
  console.error(`test:fast could not run ${command}: ${result.error?.message ?? "unknown error"}`);
  process.exit(1);
}
process.exit(result.status);
