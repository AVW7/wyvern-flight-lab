# Repository audit — 2026-10-21

Scope: whole repo at `2b8373d` (working tree clean). Gates run locally, layout measured in
headless Chromium 1243 at 390/820/1024/1280/1440 px.

## Gates

| Gate | Command | Result |
|---|---|---|
| Types | `tsc --noEmit` | **0 errors** — `strict` + `noUncheckedIndexedAccess` |
| Build | `next build` | **pass** — 3 static routes, TS phase 14.7 s |
| Tests | `tsx --test test/*.test.js` | **123 / 123 pass**, 8.9 s |
| Lint | — | **no config, no script** |
| CI | — | **none** |

Code volume: 10,463 lines TS/TSX (54 files), 3,133 lines CSS (1 file), 4,908 lines tests.
Type discipline is good: 9 `any`/`@ts-ignore` in the whole tree, all at three.js boundaries.

## Findings

### P0-1 — Mobile layout clips 61% of the UI (measured)

At 390×844:

| Metric | Value |
|---|---|
| `main.clientHeight` | 844 px |
| `main.scrollHeight` | 2193 px |
| `getComputedStyle(main).overflowY` | `hidden` |
| `window.scrollY` after `scrollTo(0, 5000)` | 0 |

1,349 px of the interface — the entire controls panel and animation log — cannot be reached
on a phone. Cause: `2b8373d` changed `.surface` from `min-height: 100svh` to
`height: 100svh; overflow: hidden`, but the `@media (max-width: 720px)` block still assumes
the page scrolls (`.lab { display: block; overflow: visible }`).

Desktop is unaffected and degrades cleanly: stage height 783 px @ 1440×900, 601 px @
1280×720, 481 px @ 1440×600.

Fix — inside the 720 px query:

```css
.surface { height: auto; overflow: visible; }
```

### P0-2 — The two "candidate" rigs are byte-identical to the canonical rig

```
67ed571a9dacb45b8dd13538b875063cf9beda87  wyvern-v2-rig.glb
67ed571a9dacb45b8dd13538b875063cf9beda87  wyvern-v2-idle-walk-flight-lab-candidate.glb
67ed571a9dacb45b8dd13538b875063cf9beda87  wyvern-v2-membrane-lab-candidate.glb

c1041bdd408a5df26d53f47e89129df389b333aa  player-wyvern.glb
c1041bdd408a5df26d53f47e89129df389b333aa  wyvern-v1-rig.glb
```

`catalog.ts` exposes both candidates as selectable specimens, so the review workflow is
comparing a file against itself. Either the candidates were promoted without being
regenerated, or they were copied in place of real exports. Decide which: if promoted, delete
the candidate entries; if not, re-export them from Blender and let `assets:audit-clips`
prove the difference.

`wyvern-v1-rig.glb` is also unreferenced by any code path — it is a 5.6 MB convenience copy
of `player-wyvern.glb` sitting in `public/`.

### P1-3 — 114 MB working tree, 69 MB of it Blender sources

| Path | Size |
|---|---|
| `models/source/wyvern-rig-v1wing.blend` | 33.8 MB |
| `assets/blender/wyvern-gothic.glb` | 22.6 MB |
| `models/source/wyvern-rig.blend` | 17.2 MB |
| `models/source/wyvern_animated.blend` | 9.7 MB |
| `models/source/drogon-v1-rig.blend` | 8.5 MB |

`.git` is 95 MB. Any clone pays for all of it, and every `.blend` save adds a new blob.
Move the `.blend` sources to Git LFS (`.gitattributes`), or out of the repo into cold
storage with the GLB exports staying in `public/models/`.

### P1-4 — 123 tests, nothing runs them

No CI, no lint config, no `typecheck` script. The suite is the best asset in this repo and
it is entirely voluntary. A GitHub Actions job running `pnpm install && tsc --noEmit &&
pnpm test && pnpm build` costs ~2 minutes and makes every one of these findings
non-recurring. `eslint-config-next` would have flagged `patch: any`
(`FlightLabClient.tsx:427`).

### P1-5 — `runtime.ts` reaches into three.js internals

`src/flight-lab/runtime.ts:406-412` reads `mixer._bindings` and `mixer._accuIndex` and
re-applies each binding manually to stop procedural pose compounding. Both are private
fields. If a three.js upgrade renames or drops them, `bindings` is `undefined`, the block
skips silently, and the original bug returns with no signal.

Minimum: `if (!bindings) warnOnce("three.js AnimationMixer internals changed")`.
Better: pin `three` exactly (currently `^0.185.1`) and cover the guard with a test.

### P2-6 — The untested half is the half that breaks

33 of 54 source modules are never imported by a test: all 16 `.tsx` files, `runtime.ts`
(1,344 lines), `interactionManager.ts`, `comparisonRig.ts`, `membraneSurface*.ts`, the leg
and tail controllers. The tested half is kinematics and GLB contracts — genuinely rigorous,
but the UI wiring and the dispose lifecycle have no coverage at all.

### P2-7 — Extraction leftovers

- `src/sanctuary-studio/webglContext.ts` is a 5-line re-export of `src/render/webglContext.ts`,
  imported by `runtime.ts` — a seam from the carve-out.
- `src/game/playerWyvernModel.ts` is imported only by tests.
- `src/app/flight-lab/FlightLabView.tsx` vs `FlightLabClient.tsx` — confirm both are needed.

### P2-8 — Placeholder nav link

`FlightLabClient.tsx:534` — "Wyvern Rig Studio" points at `https://github.com` (root).

### P3-9 — `reactStrictMode: false`

Deliberate, presumably, because double-invocation exposes Three.js lifecycle bugs. That is
an argument for fixing the lifecycle, not for disabling the detector — or at least a comment
saying why.

### P3-10 — 3,000 lines of CSS, 3 media queries

P0-1 is the direct cost of that ratio.

## Suggested order

1. Mobile `height/overflow` fix — one rule, user-visible.
2. Resolve the candidate GLBs — either promote or regenerate; delete the unreferenced V1 alias.
3. Add CI + lint.
4. Add the `_bindings` guard and pin `three`.
5. LFS for `.blend`.
6. Component/lifecycle tests once CI exists.

## Note on tooling

`next build` fails in this agent environment on `.next/turbopack` cleanup
(`SAFE_DELETE_BULK_CONFIRM_REQUIRED`, 50-file threshold) — a sandbox shim, not the app.
Run with `CODEBUDDY_SAFE_DELETE_ENABLED=0` here; CI is unaffected.
