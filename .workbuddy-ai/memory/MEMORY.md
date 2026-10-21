# Project Memory — wyvern-flight-lab

## Start here

- **Doc-41 task list state:** A1–A3, B1–B3, C1–C3, D1, D2, D3, D5 done and committed.
  **D4 is partial:** attack is done; cruise + both banks are blocked by product invariants
  (see below). HEAD `541b3e8`. Suite 165/165, tsc clean, contract validates 92 joints.
- **Runtime GLB + contract pinned at** sha256 `950c4321…`, 6,368,564 B.
- **GLB rebuild order** (each stage is NOT idempotent — rebuild from the previous stage's
  asset via `git show <commit>:public/models/wyvern-v2-rig.glb`, never from its own output):
  `reshape_buzz_clips` (D2) → `stabilize_v2_body_and_feet` → `coordinate_all_v2_clips` →
  `reshape_d3_clips` → `reshape_d4_clips` → pin contract → sync candidates → `npm test`.
- **Never `git checkout -- <asset>` mid-session.** HEAD is stale while you work.

## D4 remainder — why cruise/banks are not shipped

Both clear the dynamics gate under amplification, and both break a product invariant when
they do. Measured, not assumed:

- **cruise**: membrane span is sampled at a single frame (t = 1.0 s) requiring
  `maxMembraneX > 2500`. Authored 2780.9; at the 1.68× gain the gate needs it reads 2256.4.
  Amplifying every wing joint compounds at the tip, so no gain satisfies both. Worth
  re-examining as a *measurement* problem — the pose-independent invariant
  (`maxMembraneX >= wingTipPos.x`) still holds at that gain.
- **banks**: the flight phase group requires one wingbeat cadence across
  cruise/bankLeft/bankRight (8%). All three are 0.500 Hz authored; a 6.7× gain + smoothing
  moves the banks to 1.500 Hz, and under the accel cap they cannot reach their mean floor
  without that gain.
- The fix for both is **authored motion**, not a scale factor — the "49 static channels"
  work doc 41 describes.

## Rig geometry facts that constrain every edit

- **V1 and V2 are 100× apart in world scale** (V1 bbox 62.7 units / longest bone 29.8;
  V2 6266.8 / 938.4). Normalise before comparing any displacement between them.
- **Leg chain is `Body > Spine1 > L_LegRoot`** — Spine1 is a leg ancestor, so gaining it
  lifts grounded feet off the canonical −184 plane. Body/Spine1/legs are PROTECTED.
- **Panels are children of digits** but the panel test compares each panel against the
  slerp of two *adjacent* digits — scaling one digit desyncs its neighbour's panel.
  Rotate WingHand or above, never a `WingD*` digit independently.
- **V1's clips carry a continuous motion floor** (Idle ≥47 deg/s, GroundWalk 194,
  AttackClaw 197) because V1 keys all 640 tracks. V2's deficit was that floor, not
  amplitude — that is the whole D3 insight.
- Shared GLB/quaternion/ripple primitives now live in `tools/blender/glb_clip_edit.mjs`.

## V2 GLB / Blender pipeline (measured 2026-10-21)

- **Shipped GLB is not an export of any committed blend.** Clips were spliced at GLB level
  (`tools/blender/splice_improved_clips.mjs`).
- **Headless export:** `python3 scripts/blender/cli.py --headless --blend <b> export --out <glb>`
  (Blender 5.1 at `~/.local/bin/blender`). Exporter sets `export_def_bones=True`. `cli.py`
  bug: headless double-forwards positional args; run audit scripts via `blender -b --python …`.
- Shipped GLB is meshopt-compressed; fresh exports are ~3× larger — pass through
  `tools/blender/compact_v2_glb.mjs`.
- **Neck/head history:** the −65° baked ground-mode idle raise was fixed by
  `splice_neck_head_channels.mjs`; `walk`/`rest` necks were fine — do NOT re-splice walk.
- `upgrade_v2_rig_ground_and_membrane.mjs` cannot run (donor GLB gone).
  `coordinate_all_v2_clips.mjs` falls back to re-solving panels from base at 24 fps.

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
