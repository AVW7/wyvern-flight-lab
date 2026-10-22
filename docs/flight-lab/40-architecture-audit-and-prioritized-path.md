# Flight Lab — Architecture, Technical Debt & Prioritized Path

**Date:** 2026-10-21
**Scope:** `wyvern-flight-lab` @ `3db1b15` (main, 5 commits ahead of origin/main)
**Method:** Every claim below was measured against the repo or a live browser render. Where the
roadmap (`39-v2-development-roadmap.md`) states something that the code contradicts, the
contradiction is called out explicitly with the measurement that settles it.

---

## 1. Shape of the codebase

| Layer | Measured | Notes |
|---|---|---|
| Runtime + UI (`src/`) | **14,612 LOC** | 56 files. `runtime.ts` alone is 1,385 LOC. |
| Tests (`test/`) | **5,676 LOC** | 18 files, **161 tests**, 12.8 s wall clock. |
| Tooling (`tools/` + `scripts/`) | **28,943 LOC** | **183 files** — 126 `.py`, 54 `.mjs`, 1 `.ts`. |
| Docs (`docs/`) | **9,506 LOC** | 62 markdown files. |
| Runtime asset | `wyvern-v2-rig.glb` | 5.9 MB meshopt, sha256 `d916b748…`, 18 clips. |

**The headline ratio: tooling is 1.98× the runtime.** For a project whose user-facing
deliverable is one page, that is the defining structural fact. The Flight Lab app is a
*measuring instrument* for wyvern animation — but the instrument itself (28.9k lines of
one-off scripts) is now the larger body of code and the harder thing to maintain.

### Runtime dependency shape

```
app/flight-lab/FlightLabClient.tsx (800 LOC, 34 useState, 7 useEffect)
  └── flight-lab/runtime.ts (1,385 LOC — the god object)
        ├── rig/          (13 files — procedural flight rig, V2-keyed)
        ├── kinematics/   (flightPose)
        ├── rider/        (mountData, riderClip, riderMount, riderRuntime)
        ├── comparisonRig · interactionManager · camera · playback · diagnostics
        └── scene/ + render/  (modelLoader, modelProcessor, gltfLoader, webglContext)
```

`runtime.ts` is a single closure holding ~40 mutable `let` bindings, owning the scene graph,
the mixer, the animation state machine, the mode/altitude/pitch state machine, telemetry
publishing, and the entire public API surface. It is coherent — the comments explain *why* —
but it is the file every future change will touch, and it is where the M1 error-model work
will land.

---

## 2. Verification results — roadmap claims vs. reality

The roadmap is well-researched. Nine of its baseline claims survive contact with the code.
Two are wrong in a way that matters, and three are already done but still listed as work.

### 2.1 ✅ Confirmed

| Roadmap claim | Measurement |
|---|---|
| 161 fast tests | `node scripts/test-fast.mjs` → **161/161 pass**, 12.8 s. Ran 3× — no flake reproduced. |
| No CI | No `.github/` directory. Confirmed. |
| No lint config | No `eslint.config.*` / `.eslintrc*`. Confirmed. |
| `cli.py` headless arg-forwarding bug | Reproduced: `cli.py: error: unrecognized arguments: --glb`, **exit code 2**. Fails loudly. |
| Candidates byte-identical to runtime | sha256: all three V2 files = `d916b748d987…`. Confirmed. |
| V1 scale trap (100×) | V1 62.7 vs V2 6,266.8 raw units. Confirmed in roadmap. |
| Dynamics gate is meaningful | `npm run assets:audit-dynamics:v2` → **FAIL, 27 checks** across 9 clips. The gate is red, not decorative. |
| `range` metric saturates at 180° | `tools/diagnose-clip-dynamics.mjs:81` documents the saturation in-code and provides `travel` (unbounded) as the channel to trust. **Already handled.** |
| `tools/asset-budget.json` absent | Confirmed absent. |

### 2.2 ❌ Wrong — the mixer-internals poke was *relocated*, not removed

> Roadmap M4: *"Verify the `mixer._bindings` / `_accuIndex` internal poke is gone … current
> `runtime.ts` no longer contains it — keep it that way."*

**It is still there, and it is load-bearing.** The poke moved to
`src/flight-lab/rig/mixerBindings.ts` (55 LOC), and `runtime.ts:420` calls
`flushMixerBindings(mixer)` **every frame** in `updateMixer`. The rider mixer calls it too
(`riderRuntime.ts:109`).

It cannot simply be deleted: the module's own header explains that `AnimationMixer` only
applies an animated property when the binding's accumulator index moves, so under
`mixer.update(0)` — which is exactly what scrubbing and pausing do — a bone with a static
keyframe track keeps whatever value procedural code last wrote, and the pose **drifts and
never returns**. Deleting the call re-introduces a slow pose-drift bug that is invisible in
a still frame and obvious in continuous playback.

The real debt here is narrower and more precise than the roadmap's framing:

- `mixerBindingsAreSupported()` is the documented feature-detect — and it is **called from
  nowhere**. It is dead code, so a three.js rename would silently restore the drift bug
  instead of surfacing it. That is precisely the failure mode the function was written to
  prevent.
- `mixerBindings.ts` has **no test file**. It is the only module in `src/flight-lab/rig/`
  that pokes at three.js internals, and it is the one with zero coverage.

**Correct framing for M4:** the poke is *necessary and version-fragile by design*. What it
needs is a live feature-detect call, a test that fails when three.js renames the fields, and
a documented fallback. Not removal.

### 2.3 ❌ Wrong — M9's "flip the default" target does not exist

> Roadmap M9: *"`src/game/playerWyvernModel.ts` already resolves V1/V2 clips and attaches the
> flight rig for V2 specimens, but `DEFAULT_PLAYER_WYVERN_MODEL` remains `player-wyvern.glb`."*

`DEFAULT_PLAYER_WYVERN_MODEL` **does not exist anywhere in the repo.** Nor does any model path
in `src/game/`. The file is 46 lines and exports exactly one function,
`resolvePlayerWyvernAnimation(state, availableClips) -> string` — a pure clip-name resolver.
It contains no `AnimationMixer`, no `GLTFLoader`, no `createWyvernFlightRig`, no `modelFile`.

It is also imported by **no production code** — only by `test/player-wyvern-animation.test.js`.
There is no game runtime in this repo. `src/app/` has two routes, and both render the
Flight Lab.

So M9 is not "flip a constant" — it is "build the game-side integration that the constant
would have belonged to, and only then promote V2." That is a materially larger piece of work
than a one-line default change, and it should be scoped as such.

---

## 3. Architectural gaps

### Gap A — No contract enforcement at application load *(M1, P0)*

The runtime contract (`wyvern_v2_runtime_contract.json` + `tools/blender/runtime_rig_contract.mjs`)
is a genuinely good piece of governance: `writeValidatedRuntimeRig` refuses to write
unpinned bytes, and 11 packaging tools route through it. It has correctly prevented a
corrupted asset from shipping.

But it is enforced **only in the toolchain**. `src/` contains zero references to the contract,
the validator, or a hash check. The Flight Lab will load a contract-violating GLB and play it
without complaint.

The consequence: the contract is a *publishing* gate, not a *runtime* gate. A user who drops a
re-exported or hand-edited GLB into `public/models/` gets a broken rig with no diagnostic and
no remediation command. The roadmap's M1 table lists "contract drift → diagnostic + exact
re-pin command" as a failure mode to surface; today the app cannot detect it at all.

**Fix:** a `validateRuntimeRig`-equivalent check at specimen load — the GLB is already fetched
as bytes by `loadModelFile`, so the check is a parse plus a comparison, not a refetch.
Ship the failing hash, the expected hash, and the re-pin command in the error.

### Gap B — `ClipResolutionStatus` is computed and then thrown away *(M1/M4)*

`clipResolver.ts` implements exactly the model the roadmap wants: `resolveModeCapability`
returns `{ clipName, status: "exact" | "alias" | "fallback" | "unavailable", reason }`.
It is well-tested (`test/flight-lab.test.js:111`).

**The runtime never calls it.** `runtime.ts:373` calls `resolveFlightLabClip`, which is a
one-line wrapper that drops `status` and returns `clipName` only. So the "unavailable on this
rig" case the roadmap wants surfaced degrades to a **silent fallback clip** — exactly the
failure mode M1 says it wants to kill. `resolveModeCapability` has **one caller in the
entire repo: the test file.**

The infrastructure is 90% built and 10% wired. This is the cheapest high-value fix in the
roadmap: thread the status through `playMode()` → `events.clipResolution?.()` → a badge in
`FlightControls`.

### Gap C — Two independent, divergent clip-alias tables

`clipResolver.ts` has `MODE_CLIPS` (7 modes) and `ONESHOT_ALIASES` (5 actions).
`runtime.ts:271` has a **separate inline `aliases` table with 17 entries** covering a
different set (`glide`, `dive`, `scout`, `trot`, `run`, `stand`, `groundidle`).

`runtime.ts` consults its own table *first* (line 291), then falls through to
`resolveFlightLabClip`, then to `resolveOneShotCapability`. So clip resolution actually runs
**three different algorithms in priority order**, and only the last two expose a status.
The `aliases` table is also reallocated on every `resolveAction` call, which happens per
clip-play.

Both tables are correct in isolation. The problem is that they can disagree — e.g. `dive` and
`glide` are in the runtime table but not in `MODE_CLIPS` — and there is no single place that
knows the full answer. M4 ("explicit rig capability reporting") needs exactly one table.

### Gap D — 18 of 44 source modules have no test file

Untested modules, by directory:

```
flight-lab/  comparisonRig, environment, interactionManager, membraneSurface,
             membraneSurfaceRuntime, neckSpring, rig/boneOffsets, rig/flightMouth,
             rig/legPhysics, rig/mixerBindings, rig/tailController
rider/       riderRuntime
render/      gltfLoader, webglContext
scene/       modelLoader, modelProcessor
```

The 161 tests concentrate on *pure functions* — clip resolution, kinematics, rig math,
contract validation. That is the right instinct, and it is why the suite is fast and stable.
But the untested set is precisely the **stateful, side-effecting** half: the membrane
surface runtime (355 LOC, mutates skinned mesh geometry every frame), the interaction manager
(370 LOC, raycasting and pin lifecycle), the rider runtime, and the mixer-binding flush.

`rig/mixerBindings.ts` is the sharpest case: it is the only module that depends on
three.js *private* fields, it runs on every frame of every clip, and it has no test. A
three.js upgrade breaks pose stability silently.

### Gap E — `src/game/` and `src/sanctuary-studio/` are porting scars

- `src/sanctuary-studio/webglContext.ts` is a **4-line pure re-export** of
  `src/render/webglContext.ts`, and `runtime.ts` imports through the scar. The canonical
  implementation lives in `render/`; the import path is backwards.
- `src/game/playerWyvernModel.ts` is orphaned (test-only), as covered in §2.3.
- `src/render/gltfLoader.ts` and `src/scene/modelLoader.ts` overlap: both construct a
  `GLTFLoader` with a `MeshoptDecoder`, from two different modules. `gltfLoader.ts` caches a
  shared loader; `modelLoader.ts` does not.

These are small, but they are the residue of porting this lab out of the Sanctuary codebase.
`docs/flight-lab/README.md` still says *"Do not edit ported Sanctuary wyvern modules as a
shortcut"* — an instruction aimed at a codebase that no longer exists here.

### Gap F — The 60-file `bankright` tool ladder

60 files / 9,633 LOC / one third of all tooling, all following the same shape:
`fit_bankright_v39_*`, `fit_bankright_v40_*`, … `render_bankright_v31..v44_*`,
`audit_bankright_v39..v44_*`.

They are **not** meaningfully different. `diff` of v39 vs v40 is **6 changed lines** — the
`SOURCE`/`DEST`/`REPORT` path constants, a `t0, t1` frame window, a `shape_a, shape_b` pair,
and a schema string. 268 lines each, byte-identical otherwise.

This is a parameterised program written as 40 copies. Every future iteration adds a file.
The actual variation is a **5-tuple**: (source, dest, t0, t1, shape pair). One script taking
those five as arguments would replace all 60.

### Gap G — 62 docs, one remaining numbering collision

`docs/flight-lab/` has 62 markdown files numbered `01`–`41`. The `39-*` collision between
`39-v2-development-roadmap.md` and the parallel rig audit has now been resolved by moving the
rig & Blender audit task list to [`41-v2-and-blender-rig-audit-task-list.md`](41-v2-and-blender-rig-audit-task-list.md)
and refreshing [`docs/flight-lab/README.md`](README.md). One earlier prefix collision remains:
**`37-stage3-clip-defect-taxonomy.md` / `37-v2-idle-neck-audit-note.md`**.

---

## 4. Technical debt register

| # | Debt | Size | Severity | Evidence |
|---|---|---|---|---|
| D1 | No CI, no lint | — | **High** | No `.github/`, no eslint config. Every gate is manual. |
| D2 | Contract not enforced at load | — | **High** | Zero `src/` references to contract/validator. |
| D3 | `ClipResolutionStatus` discarded | 1 wrapper | **High** | `runtime.ts:373` → `resolveFlightLabClip` drops status. |
| D4 | Mixer-internals poke: dead detect, no test | 55 LOC | **High** | `mixerBindingsAreSupported()` has 0 callers; module untested. |
| D5 | Duplicate alias tables (3 algorithms) | 17 + 12 entries | Medium | `runtime.ts:271` vs `clipResolver.ts:3,13`. |
| D6 | 18/44 modules untested | ~3,300 LOC | Medium | Listed in §3 Gap D. |
| D7 | 60-file tool ladder | 9,633 LOC | Medium | 6-line diffs between "different" tools. |
| D8 | Candidates byte-identical to runtime | 2 files | Medium | sha256 all `d916b748…`. A/B review of identical files is a no-op. |
| D9 | `cli.py` headless forwarding | 1 function | Medium | `--glb` unrecognized, exit 2. |
| D10 | Porting scars (`sanctuary-studio/`, `game/`) | ~50 LOC | Low | §3 Gap E. |
| D11 | Stale docs + numbering collisions | 62 files | Low | §3 Gap G. |
| D12 | 102 MB `.git`, 23 MB gothic GLB tracked | — | Low | `assets/blender/wyvern-gothic.glb` is a 23 MB donor, now retired per M8. |
| D13 | `any` usage | 7 sites | Low | `runtime.ts` ×4, `modelProcessor` ×2, `interactionManager` ×2. Small — an ESLint budget of 0-new is realistic. |
| D14 | `Math.random` in animation log IDs | 7 sites | Low | `runtime.ts` ×4, `environment.ts` ×3. Harmless but makes log IDs non-deterministic. |
| D15 | **4 procedural-rig runtime bugs** | 4 sites | **High** | `jaw` not restored; gaze ungated in ground mode; `dive` head hard-copied; `bankRightHotspotFrame` dead. All verified in source — see §9. |
| D16 | Doc numbering: 2× `37-`, now **2× `39-`** | 4 files | Medium | Two concurrent agents wrote into the same numbering space in one evening. |

**Note on the reported flake:** 161/161 passed on three consecutive runs (12.8 s, 10.0 s,
9.8 s). The 1/161 flake did not reproduce. It may have been an OOM-adjacent artefact of
concurrent load on the 8 GB box rather than a logic race. M3's flake-quarantine policy is
still worth having, but the priority should be **naming the test**, not hunting the bug.

---

## 5. The P0 that turned out not to be a P0

The roadmap's M2 asks for a re-measurement of mobile reachability after the panel rework,
because the morning audit found 1,349 px of unreachable interface at 390×844
(`.surface { height:100svh; overflow:hidden }` against a ≤720 px query that assumed the page
scrolled). The roadmap correctly declines to claim it's fixed.

**I measured it. It is fixed.** Two probes, chromium + webkit, 390×844 and 360×800:

- `scripts/probe-mobile-reachability.mjs` — 107 controls, **0 unreachable** in all four
  engine×viewport combinations. The panel rework converted the side panels into overlay
  drawers carrying their own `overflow-y: auto`, so the controls panel scrolls internally
  (max scroll 1,302–1,406 px of 2,019–2,061 px content) instead of relying on document scroll.
- `scripts/probe-mobile-drawers.mjs` — the harder question. With each drawer opened
  individually, every in-viewport control passes a `document.elementFromPoint` hit-test.
  **0 covered, 0 unreachable.** The controls drawer is 84 controls / 26 in view / 0 covered.

**The instrument was proven against the known-bad state.** Swapping the pre-rework CSS
(`2b8373d`) back in and re-running the same probe produced **FAIL: 4 unreachable controls**
in both engines — the camera zoom buttons and both panel toggles stranded at y≈2,103 px.
Green on HEAD, red on the old CSS, same probe. The measurement is real.

Two caveats worth recording:

1. **Opening both drawers at once stacks them.** Both are `min(340px, 88vw)` wide and
   overlap; the right drawer covers the left one's 5 specimen controls (0 of 5 hit-testable).
   Realistic phone flow opens one at a time, in which case both are fully usable — but the
   overlap is a latent UX papercut, not a blocker.
2. The document itself still does not scroll (`scroll=false`); everything reachable is
   reachable via the drawers' internal scroll. That is a legitimate design, not a bug.

**Recommendation:** close M2 as *verified fixed*, and land both probes as the regression
harness M2 asked for — they are the "measurement scripted" exit criterion, already written.
Retire the 1,349 px figure from the carried-debts list.

---

## 6. Prioritized path

Reordered from the roadmap's own sequencing, with the corrections from §2 applied. The
roadmap's instincts were sound; three priorities move.

### P0 — Foundations (blocks everything else)

**1. CI + lint** *(roadmap M3, unchanged priority — it is the keystone)*
ESLint with a strict TS baseline, a **zero-new-`any`** budget (7 existing sites), and
`no-floating-promises`. GitHub Actions on PR: `tsc --noEmit` → `test:fast` →
`assets:validate-wyvern` → clip validator. The GitHub connector is already bound.
*Rationale:* every other item below is a regression risk until a gate exists. This is the
single highest-leverage hour in the roadmap.

**2. Contract enforcement at load** *(roadmap M1, new — promoted to P0)*
Validate the fetched GLB against the pinned contract inside `loadSpecimen`, and surface
drift with the exact re-pin command. *Rationale:* D2 is the only debt that lets a *known-bad*
asset reach a user silently. The validator already exists and is proven — it needs one call
site.

**3. Surface `ClipResolutionStatus`** *(roadmap M1/M4, new — promoted to P0, cheapest win)*
Thread the status through `playMode()` → `events` → a badge in `FlightControls`.
*Rationale:* the model is built and tested; only the wiring is missing. This is the "no
silent fallback" requirement, and it is ~40 lines.

**4. Mobile reachability: close as verified** *(roadmap M2, downgraded P0 → done)*
Land both probes as CI-regression scripts. *Rationale:* measured green in two engines at two
widths, with the instrument proven red on the old CSS.

### P1 — Correctness of the asset pipeline

**5. Blend↔GLB sync check in CI** *(roadmap M8, unchanged — keep)*
Export the blend headless, compare clip inventory and per-clip target sets against the
runtime asset, fail on unexplained drift. *Rationale:* this is the direct prevention for
the neck bug fixed today. Highest value per line in the whole roadmap.

**6. Retire donor splices + candidate policy** *(roadmap M8)*
`wyvern-gothic.glb` (23 MB, tracked) is the default donor for `splice_improved_clips.mjs`
and produced the shipped `walk`. Either make every donor a recorded, reviewed artifact or
drop the donor path. The two candidates are byte-identical to the runtime — differentiate
or delete. *Rationale:* D8 + D12. An A/B review of two identical files is theatre.

**7. `cli.py` headless forwarding** *(roadmap M8)*
`command_arguments` forwards `glb` as `--glb`; the subparser takes it positionally. One-line
fix. *Rationale:* D9. It currently blocks the headless audit path the CI sync check needs.

**8. Harden the mixer-binding flush** *(roadmap M4, reframed)*
Call `mixerBindingsAreSupported()` at load and surface a diagnostic when it returns false;
add a test that fails when three.js renames the fields. **Do not remove the flush.**
*Rationale:* §2.2. The current state is the worst of both worlds — the version-fragile poke
runs, but the guard that would catch a rename is never invoked.

**8b. Fix the four verified procedural-rig runtime bugs** *(from the parallel rig audit, §9)*
Add `jaw` to `allControlledBones`; gate `intelligentHeadNeckController` on `isGroundedMode`;
compose the `dive` head pose as an offset instead of a hard `copy`; either populate
`bankRightHotspotFrame` at runtime or delete the dead read; include `roar`/`death` in
`isMouthActionActive`. *Rationale:* confirmed behaviour bugs, every one in code with zero
test coverage, and they corrupt authored motion — which undermines every dynamics
measurement taken against the rig. Cheap to fix, and it unblocks trusting M5/M6.

**9. Consolidate the clip-alias tables** *(roadmap M4, new)*
One table, one resolution path, one status. *Rationale:* D5. M4's "explicit rig capability
reporting" is not implementable while three algorithms compete.

### P2 — Animation quality (the long pole)

**10. Dynamics measurement trust** *(roadmap M5 — already substantially done)*
The V1 baseline is frozen and pinned; the gate runs and is red on 27 checks; `range`'s
saturation is documented in-code with `travel` as the unbounded channel. *Remaining work is
small* — the seam-policy distinction (one-shots vs loops) and the `accents` non-gating
rationale, both already argued in `NEXT_SESSION.md`. **Reduce M5 to a short closure note
and move on.**

**11. Stage 3 re-authoring** *(roadmap M6 — the real work)*
Order stands: CUBICSPLINE on dominant channels → `takeoff`/`death` (BUZZ) →
`idle`/`walk`/`attack2` (CONCENTRATED) → `attack` coverage (49 constant channels) →
`bank` mean. *Rationale:* this is the only P2 item that changes the deliverable's quality,
and its dependency — trustworthy measurement — is already in place.

**12. Animation polish** *(roadmap M7)*
`idle` posture (graded 6/10), `walk` (4/10), membrane residuals, porting `attack2`/`attackAir2`
into the blend. *Rationale:* correct as P2; depends on M6.

### P3 — Housekeeping

**13. Tool-ladder consolidation** *(new)* — collapse the 60 `bankright` files into one
parameterised script. *Rationale:* D7, 9,633 LOC and growing per iteration.

**14. Docs: index, de-collide, re-track** *(new)* — resolve the `37`/`39` collisions, write
a real index, refresh `docs/flight-lab/README.md` (it says 16 specimens; there are 4), and
**commit `39-v2-development-roadmap.md`** — it is currently untracked, and it is the
document every other agent will work from.

**15. Fix the porting scars** *(new)* — point `runtime.ts` at `render/webglContext`, fold
`src/sanctuary-studio/` away, merge the two `GLTFLoader` constructions, and decide whether
`src/game/` is a live integration or an archive.

**16. Game-side V2 promotion** *(roadmap M9 — rescope)*
There is no `DEFAULT_PLAYER_WYVERN_MODEL` and no game runtime in this repo. Either scope
M9 as *build the game integration* (a real project) or park it explicitly as
out-of-repository. *Rationale:* §2.3. Leaving it as written will produce a milestone
nobody can complete.

**17. Performance & packaging** *(roadmap M10)* — asset budget in CI, dev-server HMR
stability, LOD decision. Correctly P2; 5.9 MB meshopt is already good.

---

## 7. Dependencies & prerequisites

```
P0:  [1] CI + lint ──────────────┬─→ [5] blend↔GLB sync ──→ [7] cli.py fix
                                  ├─→ [2] contract at load
                                  └─→ [3] ClipResolutionStatus
      [4] mobile reachability (verified — land as regression)

P1:  [2] ──→ [8] mixer guard ──→ [9] alias consolidation
      [8b] 4 procedural-rig runtime bugs  ← fixes authored-motion corruption
      [5] ──→ [6] donor/candidate policy

P2:  [5] + [8b] ──→ [10] measurement closure ──→ [11] Stage 3 ──→ [12] polish ──→ [16] game

P3:  [13] tools · [14] docs · [15] scars · [17] perf
```

**Prerequisites that must be resolved before starting:**

| Prerequisite | Why | State |
|---|---|---|
| **GitHub Actions + `gh` auth** | M3's CI is the gate for everything else | Connector bound; repo has no `.github/` yet |
| **Blender 5.1 on PATH** | M8's blend↔GLB sync check needs a headless export | Present at `~/.local/bin/blender`; `cli.py` defaults to `/Applications/Blender.app` — **path mismatch** |
| **A recorded donor inventory** | M8's "no unrecorded donor" exit criterion | `wyvern-gothic.glb` is present but its use as `walk`'s source is undocumented in-repo |
| **8 GB RAM discipline** | Full-suite runs are 10–13 s but next dev + WebGL + browser is tight | Sequenced; `test-fast.mjs` already pins concurrency to 3 |
| **Blender 5.1 meshopt encoder** | The sync check must reproduce the meshopt pipeline | `compact_v2_glb.mjs` exists; verify encoder parity before trusting the check |

**Sequencing note for the 8 GB box:** `next dev` + a headless browser + `tsc` do not fit
together comfortably. Run the browser probes *after* typecheck, never concurrently, and kill
the dev server as soon as the capture is taken. Both probe scripts in §5 were run with the
dev server up and no other heavy process — that is the ceiling.

---

## 8. Two documents, one number

The roadmap says: *"Suggested next three actions: (1) M1 error-path tests … (2) M2's
390×844 re-measurement — it's a 30-minute check … (3) M8's blend↔GLB CI sync check."*

That ordering is right, and the re-measurement has now been done: **M2 is closed**. The
revised top three, with everything else held:

1. **CI + lint** — the gate that makes every subsequent change safe. Nothing else in this
   document is worth doing first.
2. **Contract enforcement at load** — the only path by which a known-bad asset reaches a user
   without a diagnostic. ~1 call site, validator already proven.
3. **Blend↔GLB sync check in CI** — the direct prevention for the bug class that cost
   today, and the prerequisite for trusting every future clip promotion.

`ClipResolutionStatus` wiring is a close fourth and the smallest diff in the set.

---

## 9. Cross-reference — a parallel rig audit landed mid-session

While this audit was running, another agent produced
[`docs/flight-lab/41-v2-and-blender-rig-audit-task-list.md`](41-v2-and-blender-rig-audit-task-list.md) (46 KB, originally numbered `39-*` before renumbering to `41`) — an independent audit of
the **rig, Blender pipeline, and Flight Lab AI-feedback loop**, organised as Workstreams A–E. It covers ground this document
does not: GLB sampler leaks, blend-vs-runtime mismatch matrices, membrane weight
distribution, per-clip animation authoring, and Flight Lab pose-anomaly detection (`Workstream E`).

**The two documents are complementary, not competing.** This one covers architecture, code
structure, and process. That one covers rig data and Blender assets. Both land on the same
two priorities: pipeline hygiene and Stage 3 dynamics.

**I independently re-verified that document's four `src/flight-lab/` runtime-code claims
against the source. All four hold:**

| Claim | Verification |
|---|---|
| `jaw` omitted from `allControlledBones` (`wyvernFlightRig.ts:71-80`), so `sealFlightJaw`'s per-frame `jaw.quaternion.copy(closedPose.quaternion)` (`flightMouth.ts:21`) overwrites authored jaw motion and `reset()` never restores it | **Confirmed.** `allControlledBones` lists head/neck/spine/tail/legs/wings — no `jaw`. `sealFlightJaw` returns early only when `isMouthActionActive` is true, so the jaw is pinned to the captured bind pose on every other frame. |
| Gaze controller runs in ground mode (`wyvernFlightRig.ts:203` → `223`) | **Confirmed.** `isGroundedMode` gates the spine wave and tail controller (lines 162–185) but `intelligentHeadNeckController` at line 223 is **outside** that block. |
| `dive` hard-codes `STREAMLINED_HEAD_ROTATION` (`gazeController.ts:79-85`) | **Confirmed.** `holdStreamlinedHeadPose` does `headBone.quaternion.copy(STREAMLINED_HEAD_ROTATION)` — a hard `copy`, not an offset composition, so it discards the authored `dive` head track. |
| `bankRightHotspotFrame` is never populated at runtime | **Confirmed.** The only reference in the entire repo is the *read* at `membraneSurfaceRuntime.ts:169`. Nothing writes it. The hotspot envelope is dead at runtime. |
| `isMouthActionActive` omits `roar` and `death` | **Confirmed** — `runtime.ts:453` and `:701` both test only `clipLower.includes("breath") \|\| clipLower.includes("attack")`. |

**This changes one of my recommendations.** These four are *runtime behaviour* bugs in the
procedural flight rig — exactly the surface I identified as untested (§3 Gap D). Three of the
four live in `rig/`, and `rig/flightMouth.ts` and `rig/gazeController.ts` are in my
no-test-coverage list. The pattern is consistent: **the procedural rig is the least-tested
and most bug-prone part of the codebase**, and it layers on top of authored clips, so its
bugs corrupt the very motion the rest of the project is trying to measure.

**Recommendation added — new P1 item, slotted between #8 and #9:**

> **8b. Fix the four verified procedural-rig runtime bugs** *(from the parallel rig audit,
> independently re-verified here)*. Add `jaw` to `allControlledBones`; gate
> `intelligentHeadNeckController` on `isGroundedMode`; compose the `dive` head pose as an
> offset rather than a hard `copy`; either populate `bankRightHotspotFrame` at runtime or
> delete the dead read; and include `roar`/`death` in `isMouthActionActive`.
> *Rationale:* these are confirmed behaviour bugs, each in code with zero test coverage.
> They are cheap to fix, and until they are fixed the rig cannot be trusted to preserve
> authored motion — which undercuts every dynamics measurement taken against it.

**Coordination note (updated):** the `39-*` prefix collision has been resolved by renaming the
rig & Blender task list to [`41-v2-and-blender-rig-audit-task-list.md`](41-v2-and-blender-rig-audit-task-list.md)
and integrating its `Workstreams A–E` into [`39-v2-development-roadmap.md`](39-v2-development-roadmap.md).
`Workstream A` (`Tasks A1–A3`: 114-sampler leak compaction, `-32°` neck-lift bomb removal + `+0.4°` horizon leveling, `walk` `+8.6°` jaw fix, and `land → idle` `<1.0°` handoff) has also landed (`sha256: b25db7a1…`, `5,744,660 B`).

---

## Appendix — measurement commands

```sh
# Test suite (3 consecutive runs, all 161/161, no flake)
node scripts/test-fast.mjs

# Dynamics gate (FAIL, 27 checks — meaningful, not decorative)
npm run assets:audit-dynamics:v2

# Contract validator
npm run assets:validate-wyvern

# Mobile reachability (chromium + webkit, 390x844 and 360x800)
node scripts/probe-mobile-reachability.mjs --base http://localhost:3010
node scripts/probe-mobile-drawers.mjs      --base http://localhost:3010

# cli.py headless forwarding bug (exit 2)
python3 scripts/blender/cli.py --headless --blend models/source/wyvern-rig.blend \
  audit-glb public/models/wyvern-v2-rig.glb
```

**Playwright note:** the harness bundles playwright 1.63.0, which expects browser builds
1243/2359; this machine has 1247/2368, which the managed workspace's 1.64.0-alpha matches.
Both probe scripts import from
`/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/`.
The harness's own `bin/render.mjs` will fail to launch until that mismatch is resolved —
worth fixing before M3 schedules the harness as a CI job.
