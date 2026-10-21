# Project Memory — wyvern-flight-lab

## Start here

- **Active handoff:** `.workbuddy-ai/memory/HANDOFF-v2-rig-2026-10-21.md` — doc-41 task list
  state. Read before touching `public/models/*.glb` or the runtime contract.
- **GLB rebuild order** (deterministic, reproduces byte-identical output):
  `reshape_buzz_clips` → `stabilize_v2_body_and_feet` → `coordinate_all_v2_clips` →
  pin contract → sync candidates → `npm test`.
- **Never `git checkout -- <asset>` mid-session.** HEAD is stale while you work, and a
  concurrent session has reset tracked assets to HEAD twice. Recover from candidate copies.

## V2 GLB / Blender pipeline (measured 2026-10-21)

- **Shipped GLB is not an export of any committed blend.** Clips were spliced at GLB level
  (`tools/blender/splice_improved_clips.mjs`, default donor `assets/blender/wyvern-gothic.glb`).
- **Headless export:** `python3 scripts/blender/cli.py --headless --blend <b> export --out <glb>`
  (Blender 5.1 at `~/.local/bin/blender`). Exporter sets `export_def_bones=True` → only weighted
  bones ship. `cli.py` bug: headless double-forwards positional args (`audit-glb` → `--glb`
  unrecognized); run audit scripts via `blender -b --python …` instead.
- Shipped GLB is meshopt-compressed (~5.7 MB); fresh exports are uncompressed (~17.8 MB) — pass
  through `tools/blender/compact_v2_glb.mjs`.
- **Neck/head history:** the −65° baked ground-mode idle raise was fixed by
  `splice_neck_head_channels.mjs`; `walk`/`rest` necks were fine as shipped — do NOT re-splice
  walk. `land` from the blend is a stub; don't splice it.
- `upgrade_v2_rig_ground_and_membrane.mjs` cannot run (its 2026-10-07 donor GLB is gone).
  `coordinate_all_v2_clips.mjs` falls back to re-solving panels from base and solves at 24 fps
  (sparse grids break `land`). `tools/asset-budget.json` doesn't exist; tools tolerate that.

## Architecture facts that change how you work

Full analysis: `docs/flight-lab/40-architecture-audit-and-prioritized-path.md`.

- `src/` 14.6k LOC vs `tools/`+`scripts/` 28.9k LOC — **tooling is 1.98× the runtime.**
- **`mixerBindings.ts` is load-bearing — DO NOT delete.** `runtime.ts:420` calls
  `flushMixerBindings(mixer)` every frame; without it, `mixer.update(0)` leaves static-track
  bones holding procedural values → pose drifts and never returns. Debt: the feature-detect has
  0 callers and the module has no test.
- **No game runtime exists in this repo.** `src/app/` = 2 routes, both render the Flight Lab.
  `src/game/playerWyvernModel.ts` is imported by a test only.
- **The contract is a publishing gate, not a runtime gate** — zero `src/` references to it.
- **`ClipResolutionStatus` is built, tested, then dropped** — `resolveModeCapability`'s only
  caller is the test file; runtime uses `resolveFlightLabClip` and loses the status (~40 lines
  to wire, and it's what M1 wants).
- **Three competing clip-alias tables**; the inline one at `runtime.ts:271` (17 entries) is
  consulted first.
- **18 of 44 src modules have no test** — exactly the stateful half (`membraneSurfaceRuntime`,
  `interactionManager`, `riderRuntime`, `rig/*`, `environment`, `neckSpring`, `modelLoader`…).
- 60-file `bankright` tool ladder (9.6k LOC) is one program written ~40× — real variation is a
  5-tuple. `any` census: 7 sites. `Math.random`: 7 sites.

## Mobile reachability — P0 CLOSED

- 107 controls, **0 unreachable** in chromium + webkit at 390×844 and 360×800 (drawers scroll
  internally). Document itself does not scroll — legitimate design, not a bug.
- Regression probes: `scripts/probe-mobile-reachability.mjs`, `scripts/probe-mobile-drawers.mjs`.
  **Prove any new probe against the known-bad CSS** (`git show 2b8373d:…FlightLabClient.module.css`)
  before trusting a green run.
- Playwright trap: harness `bin/render.mjs` bundles playwright 1.63.0 (builds 1243/2359); this
  machine has 1247/2368. Probes import from
  `/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/`.

## Docs map

- `39-v2-development-roadmap.md` — master plan, M1–M11.
- `40-architecture-audit-and-prioritized-path.md` — the audit.
- `41-v2-and-blender-rig-audit-task-list.md` — Workstreams A–E task list (A, B, C, D1, D5 done).

## Header responsive contract

- Header styles sit at the TOP of `FlightLabClient.module.css`; a **second responsive system at
  the BOTTOM** (≤1050px drawers, ≤720px phone chrome) wins the cascade. Check both regions.
- Harness spec: `~/.workbuddy-ai/harness/specs/wyvern-flight-lab-header.mjs`. One `next dev` per
  project dir (`.next/dev/lock`); on this 8 GB box run browsers sequentially, never alongside
  tsc/tests.

## Repo conventions

- **`.workbuddy-ai/` is tracked in git** (re-added 2026-10-21 at Aj's request) so other agents
  work from committed memory. Keep the daily log and this file current, commit with the work.
