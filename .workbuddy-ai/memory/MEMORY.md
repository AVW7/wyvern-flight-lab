# Project Memory — wyvern-flight-lab

## V2 GLB / Blender pipeline facts (measured 2026-10-21)

- **The shipped `public/models/wyvern-v2-rig.glb` is NOT an export of any committed blend.**
  Its clips were assembled at GLB level by splicing donor GLBs (`tools/blender/splice_improved_clips.mjs`,
  default donor `assets/blender/wyvern-gothic.glb`). Shipped `walk` is byte-identical to the gothic
  donor's walk; shipped `idle` (Neck1 −21.1° / Neck2 −24.2° / Head −19.3° ≈ −65° baked neck raise)
  came from a donor (`idle-v2-fold-candidate.glb`) that lived outside the repo and is gone.
- **Both Blender sources carry a healthy `idle`**: Neck1 ±1°, Neck2 ±1.3°, Head ±3.4° (quat.x),
  mean ≈0° — a breathing bob, no baked raise. Verified in `models/source/wyvern-rig.blend` (56 bones,
  39 weighted) and `wyvern-rig-v1wing.blend` (106 bones, 106 weighted) — identical fcurve values.
- **Headless export path**: `python3 scripts/blender/cli.py --headless --blend <blend> export --out <glb>`
  (Blender 5.1 at `~/.local/bin/blender`). The exporter uses `export_def_bones=True`, so only weighted
  bones ship: wyvern-rig.blend → 39 joints (shipped rig needs 92 — full re-export from it is not viable),
  wyvern-rig-v1wing.blend → 106. Exporter also bakes + strips the control rig on export.
- **Bug in `cli.py`**: headless mode double-forwards positional subcommand args as options
  (`audit-glb` → `--glb` unrecognized). Workaround: run audit scripts inside Blender directly
  (`blender -b --python …`) or via the MCP session.
- **Ground-mode head lift — FIXED 2026-10-21 (idle only).** New tool
  `tools/blender/splice_neck_head_channels.mjs` re-spliced idle's Neck1/Neck2/Head
  rotation channels from a fresh `wyvern-rig.blend` export into the shipped GLB:
  −65° raise → ≈0° + ±7° head bob. Runtime now sha256 `d916b748…`, 5,977,592 bytes;
  contract `scripts/blender/wyvern_v2_runtime_contract.json` updated per doc 14.
  `land` verified healthy (do not splice the blend's stub land). **Aj confirmed
  2026-10-21: `walk` and `rest` necks are fine as shipped — only `idle` had the issue;
  do NOT re-splice walk.** Same fix applied to the two review candidates
  (`wyvern-v2-membrane-lab-candidate.glb`, `wyvern-v2-idle-walk-flight-lab-candidate.glb`) —
  all three assets share sha256 `d916b748…`.
  Evidence: docs/flight-lab/evidence/2026-10-21-idle-{before,after,after-candidate}.png.
- Shipped GLB is meshopt-compressed (5.7 MB); fresh exports are uncompressed (17.8 MB) — run through
  `tools/blender/compact_v2_glb.mjs` if a full re-export is ever needed.

## Flight Lab header — responsive contract (set 2026-10-21)

- Header styles live near the TOP of `src/app/flight-lab/FlightLabClient.module.css` (`.header`,
  `.brand`, `.nav`, `.menuToggle`…); breakpoints: inline nav above 768px, collapsible dropdown
  menu at ≤768px, icon-only toggle at ≤400px, 44px touch floor under `pointer: coarse`.
- **The CSS module has a second, pre-existing responsive system at the BOTTOM of the file**
  (`@media (max-width: 1050px)` → lab side panels become overlay drawers; `@media (max-width: 720px)`
  → phone chrome: safe-area surface padding, telemetry, camera dock, stage toolbar). Those later
  blocks win the cascade over header rules near the top — the old ≤720 block's
  `.header { flex-direction: column }` silently stacked the brand and menu toggle. When touching
  the header, check both regions.
- Regression harness spec: `~/.workbuddy-ai/harness/specs/wyvern-flight-lab-header.mjs`
  (chromium + webkit, dark + light, 5 viewports; theme key `flight-lab-theme`).
  Run against a dev server: `node bin/render.mjs --spec wyvern-flight-lab-header --base http://localhost:<port>`.
  Gotcha: only ONE `next dev` per project dir (`.next/dev/lock`); a stale lock after an OOM-killed
  server must be deleted by hand. Next dev + WebGL page + browser on this 8GB box is tight —
  run browsers sequentially, never concurrently with tsc/tests.

## Repo conventions

- **`.workbuddy-ai/` (project memory + agent workspace data) is tracked in git** — re-added
  2026-10-21 at Aj's request ("add work buddy back for other agents to work from"), reversing the
  same-day exclusion. Other agents/sessions clone the repo and work from the committed memory, so
  keep `memory/YYYY-MM-DD.md` (append-only daily log) and `MEMORY.md` current and commit them
  alongside the work they describe.

## Tooling

- **playwright-cli** (browser automation skill): installed 2026-10-21 at
  `/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/.bin/playwright-cli`
  (`@playwright/cli` 0.1.22). Browsers in `~/Library/Caches/ms-playwright/` (chromium-1247,
  headless shell, firefox-1553, webkit-2368, ffmpeg-1011). NOT on PATH — use the absolute
  path or `export PATH=…/node_modules/.bin:$PATH`. The skill's bootstrap line
  (`command -v playwright-cli || npm bin -g …`) is broken on npm ≥9 (`npm bin` removed);
  global npm installs are prohibited in this sandbox — the managed workspace is the way.
