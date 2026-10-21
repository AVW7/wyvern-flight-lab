# Wyvern animation + sanctuary life — staged work orders

**Status: CLOSED — 2026-08-14.** All staged animation, sanctuary travel/ambient scheduling, aerodynamic flight state machine, battle readability/LOD, Thornwing species set, and discrete world event stream work orders are complete and validated. This document remains as the permanent decision and measurement record; runtime development continues in `docs/SANCTUARY_GAMEPLAY_PLAN.md`.

---

## HANDOFF PROTOCOL

1. Read **§Onboarding** and **§Reference data** below. Both are short and contain measured numbers
   you cannot re-derive cheaply.
2. Read `CLAUDE.md` (project invariants),
   `docs/FLIGHT_ANIMATION_DEVELOPMENT.md` (durable animation workflow), and
   `docs/WYVERN_ANIMATIONS.md` (the measured asset catalogue).
3. Find the first stage in **§Progress ledger** not marked DONE. Do only that stage.
4. When finished: run the stage's *Verify*, then **edit this file** — set the ledger row and the
   stage's own `Status:` line to DONE, with a one-line note of anything that surprised you. Commit
   that edit alongside the code.
5. If you discover a stage is wrong, obsolete or blocked, say so in the ledger row rather than
   silently skipping it.

### Closing this document

When every stage reads DONE:

1. Fold the durable facts — anything a future contributor needs but that is not obvious from the
   code — into `CLAUDE.md` and `docs/WYVERN_ANIMATIONS.md`. Those are the permanent homes; this file
   is scaffolding.
2. Replace the status line at the top with `**Status: CLOSED — <date>.**` and a one-paragraph summary
   of what shipped and what was deliberately dropped.
3. Do not delete it. The rejected-options table and the measured reference data are the record of why
   the design is the shape it is, and re-deriving them costs hours.

---

## ONBOARDING (cold start)

**Project.** Wyvern3D — Next.js + react-three-fiber browser game. Raise wyverns
at a sanctuary, train them, fight with them on a world map.

**Commands.**
```bash
pnpm typecheck && pnpm lint && pnpm test   # run after every stage; all must pass
pnpm sim:battle                            # balance harness; only needed for Stage 5
```
Do **not** run `pnpm dev` in a raw shell — use the preview/browser tooling. A dev-only handle
`__wyvern.actors` is exposed during battles.

**Invariants that will bite you** (full list in `CLAUDE.md`):

- `src/core/**` is **pure**: no `three`, `react`, `zustand`, `Math.random()`, `Date`. Lint-enforced
  at `eslint.config.mjs:13-43`. It genuinely fires; never add an eslint-disable.
- **`state.rngState` is serialized** (`core/types.ts:217`). Adding any random draw to the tick path
  shifts every subsequent draw and rewrites all future outcomes. The encounter sim has its own
  independent RNG (`core/combat/encounter.ts:42`) and is safe for new rolls.
- Never reorder phases in `executeNextTick` (`core/state/tick.ts:17-35`).
- **Never `setState` in `useFrame`** — mutate `object3D` transforms directly. The two sanctioned
  exceptions are change-guarded (`BattleScene.tsx:238-244`, `GameModel.tsx:163-164`).
- drei's `<Text>` kills the WebGL context in WebKit. Use `render/labels/WorldLabel.tsx`.
- Clone skinned models with `SkeletonUtils`, never `scene.clone()`. Clone materials before
  overriding them or all five species repaint at once (they share one GLB).
- `three-stdlib` is not importable under pnpm — use `three/examples/jsm/...`. three is 0.185.1.
- `GLTFLoader` sanitizes `Object3D.name`. `props.tsx:64-67` reads `userData.name` for this reason.

**Where the animation system lives.** `src/render/assets/GameModel.tsx` (playback) and
`manifest.ts` (the clip map — the single seam between gameplay and art). Current shape:
`ClipSpec { clip, loop?, next?, yOffset?, fadeIn?, timeScale?, phaseGroup? }`,
`StateClips = ClipSpec | ClipSpec[]` (array picked by a `seed` prop), two-level
state (`state` requested → `active` playing), one-shot chaining through `next`,
per-clip offsets/fades/rates, and normalized phase preservation between
compatible loops.

**Why this plan exists.** It began when the wyvern only played idle loops or a
takeoff→swoop chain. Runtime crossfades, sanctuary placement/travel, the
22-action sidecar, ambient idle scheduling, working banks, and a seven-mode
flight selector (cruise/scout/speed/glide/dive/bank/hover) have since landed.
The sidecar has since grown to 26 actions.
The remaining staged gaps are the aerial attack action, battle VFX and mutable
battle flight state, and the world event stream.

**Before authoring any clip or touching a rig axis, read
`docs/WYVERN_ANIMATION_BASELINE.md` §Measured rig axes.** Every entry in that
table contradicted a plausible guess that had already shipped — a neck argument
driving the one inert axis, three bank recipes driving the sign with no effect,
and a contract channel named `root_roll` that measures pitch. Guessing there has
cost this project more than any other single mistake.
Durable authoring and review rules now live in
`docs/FLIGHT_ANIMATION_DEVELOPMENT.md`; do not add process requirements only to
this temporary work ledger.

**Decisions already taken by the user** — do not relitigate:
- Missing clips → **Blender-authored sidecar GLB** (not Unreal export, not retargeting).
- **Sanctuary first**, battle after.
- **Balance changes allowed**, with a `pnpm sim:battle` re-baseline.

---

## PROGRESS LEDGER

Update this table when you finish a stage. `NOT STARTED` → `DONE` (or `BLOCKED` with a reason).

| Stage | Title | Status | Depends on | Notes on completion |
|---|---|---|---|---|
| 0 | Runtime foundations + 2 bugs | DONE | — | Clip filtering, real crossfades, per-clip fade/rate, correct attack/death offsets, and shadows; gates pass. |
| 1 | Sanctuary placement | DONE | 0 | Stable perches, assignment-specific posts/states, injury rest, and overflow placement are implemented in `SanctuaryWyverns`. |
| 2 | Sanctuary travel (fly + land) | DONE | 1 | One director owns takeoff, transit/patrol, returning, landing, safe attack landings, and explicit return-to-assignment. |
| 3 | Sidecar clip pipeline | DONE | 0 | 26 short-name clips; 15.8 MB meshless GLB; 292 targets and 876 tracks/action validated through three.js. |
| 4 | Ambient behaviour & Head Gaze | DONE | 2, 3 | Head gaze, the ambient idle scheduler (sleep/sit/groom/eat/drink/perch, weighted by hunger/injury/bond), and the `/debug/animation` Flight Lab are all in. |
| 4.5 | Aerodynamic Flight State Machine | DONE | 2, 3 | Bank-hysteresis cruise and hover mode (optional `horizontalSpeed` param on `flightAnimationState`, gated to the `'hovering'` phase) are both implemented. |
| 4.6 | Measured animation baseline & quality gate | DONE | 3, 4.5 | `pnpm assets:analyze-clips` measures all 78 clips into a committed signature; `animationContracts.test.ts` gates it. Its first run found the shipped cruise loop at a 27.3° stroke and 37.7 symmetry error against a documented 83°, and both bank clips with 0.04° of left/right difference. Rebuilding fixed all three and added `Sanct_Hover`. Numbers replaced contact sheets as the approval view. |
| 4.7 | Wingbeat fidelity & working banks | DONE | 4.6 | Rebuilt the cruise/bank/hover beat from nine measured landmarks of `Battle_Down02` f40–f66 instead of four, cutting reconstruction error from 5.6° to 1.0° and restoring the stroke plane (40.5°→52.1° azimuth) and wrist fold (5.15→6.37). Two things only a rig probe could find: the source's beat drags a 37° landing flare, so the body now comes from one frame while the wings cycle (`root_roll_delta_deg` 11.4→0.0); and `bank_wings` drove the wing chains with opposite signs, which measures *zero* bias with the mirror applied — the banks had been shipping flat, failing four contract rules, against numbers the docs quoted but the `.blend` never held. Equal signs give 23.6° of bias at 0.12 rad. Banks now measure ∓24/+30 attitude and ∓29/+27 asymmetry. Also found `neck_bend(down=…)` to be a no-op on the wrong axis. |
| 4.8 | Flight variants: speed, glide, dive | DONE | 4.7 | Renamed the powered loop `glide`→`cruise` and freed the name for a real unpowered glide. `flightAnimationState` now takes a `FlightMotion` struct and picks dive→glide→hover→bank→speed→cruise, each on its own hysteresis band; omitting a channel makes the modes it gates unreachable, so `motion = {}` is byte-identical to the old behaviour. Three authored clips: `Sanct_Speed` (0.8 Hz, nose-down throughout), `Sanct_Soar` and `Sanct_Dive` (both held-wing, `cycle: null`, ±30° either side of cruise from the same 1:1 root trim). Two pre-existing battle bugs fixed on the way: the selector's output was laundered through a bank-only ternary every frame, which had already made hover unreachable there, and `horizontalSpeed` was computed and never passed. `Actor.ai` is finally consumed, latched 0.5 s because `updateAi` has no hysteresis at its range boundary. `Sanct_Cruise` measured byte-identical to the retired `Sanct_Glide`. |
| 4.9 | Scout flight mode | DONE | 4.8 | `Sanct_Scout` measures 0.333 Hz over two exact-looping beats on a +8.08° body line; it selects after banks and before speed for sanctuary circle/patrol and battle AI idle. |
| 4.95 | Aerial attack action | DONE | 4.8 | 2026-08-01: `attackAir` uses measured 3.333s `Battle_Attack04`; battle and manual sanctuary strikes now use the action channel. |
| 4.96 | Limb and neck carriage in flight | DONE | 4.9 | 2026-08-02: legs, feet, claws and neck now differ per flight mode, and the runtime layer composes onto the clip instead of erasing it. Three defects, all found by probing rather than reading: (1) every flight clip held one frozen `Battle_Down02` f40 leg pose — quaternion spread `[0,0,0,0]` for thigh and toe in all six, byte-identical across modes; (2) `hind_leg_pulse` drove each limb's own long axis with *mirrored* signs, the same failure as `bank_wings` one chain over — the calf's contribution to foot position measured exactly 0.000 and the whole helper bought 0.04 units on a 44-unit creature, against local Z's 1.32; (3) `toe_curl` drove local X, which swings `toe_deg` ±40° for under 0.09 of outer-toe span, so the one channel watching the claws was blind to both spread and curl. `foot_drop` now spans 2.20 (dive) to 4.15 (hover) against a former 4.0–4.3 everywhere, `toe_curl_deg` splits by sign at hover, and nine flight modes gained `foot_drop`/`toe_curl_deg`/`head_reach` rules. Also: the `.blend` was stale against its own script, so this baked `neck_down`, `torso_recoil`, `tail_pitch`, a `body_pitch` 12→11 drift, and BEZIER interpolation (every sampler is now CUBICSPLINE; parses in 1.24 s) for the first time — which is why `wing_elev_L.range` moved +5–7° across the family with no wing edit in the change. Runtime landed in `/debug/animation` only; see stage 4.97. **Follow-up landed 2026-08-02:** the new `foot_drop_R`/`foot_asymmetry` channels immediately exposed the other half of the same defect — the carriage was one leg, not a pair. `PoseKey.body` freezes every non-wing bone at `Battle_Down02` f40, and that frame measures `foot_drop` 4.263 left against 3.544 right, so all eight flight clips carried 0.63–1.05 of asymmetry that no recipe authored. `PoseKey.mirror_legs` applies the wings' component-wise local mirror to `Bip002-{L,R}-Thigh/Calf/Foot`; L onto R, because `foot_drop` watches the left foot and every carriage band above is derived from it — R onto L symmetrises equally well but shifts the family down 0.72 and puts cruise, scout, glide and hover outside their own bands. Residual 0.04–0.06, contract tightened from `max 1.4` to a signed ±0.15, and the regenerated signatures differ in nothing but `foot_drop_R`, `foot_asymmetry` and `skin_side_balance`. |
| 4.97 | Additive limb/neck layer in gameplay | DONE | 4.96 | 2026-08-05: Sanctuary, battle and Highlands compose local-Z/Y/X neck/head offsets over mixer pose via `render/boneOffsets.ts`; verified live camera framing and bounds clearance. |
| 4.98 | Per-manoeuvre body, head and neck in forward flight | DONE | 4.97 | 2026-08-03: forward flight (cruise/scout/bank/speed/glide/dive) only. **Authored:** the neck now answers the wingbeat one measured landmark behind the chest and the tail two, which the pose contract had specified from the start while only the tail did it — `body_axis_deg.range` 8.63→7.87 on cruise as the three stop swinging in lockstep, `cycle`/`duration_s`/`pelvis`/limbs unchanged, loops still bit-exact. And the bank's neck lean was **on the wrong side**: `bank` is +1 for left while a positive `side` turns the head right, so `Sanct_BankL` measured `head_reach.lateral` −0.04 and `BankR` +0.22 against level flight's +0.09 — the head following the tail's counterbalance to the outside. Flipped and moved onto `Neck2`+`Head`, which a probe puts at **zero** wingtip cost against the four-bone version's 0.39 units and +0.6 symmetry error: now +0.47 / −0.29, and `symmetry_error` improved slightly on both banks. **Measured:** new signed `head_reach.lateral` channel, without which none of that was visible; rules added to `cruise`, `bank`, `bank_left`, `bank_right`, `scout`, `speed`. **Runtime:** `headNeckTargets` applied hover's horizon-hold counter-rotation at *every* airspeed, so a stooping wyvern craned its head up — now blended to flight-path-following above `HOVER_EXIT_SPEED`; `turnLeadYaw` carried the same sign inversion as the clips; and the full neck yaw went to all three neck bones each frame, rebuilding the wing-swing trap the recipes avoid (`NECK_YAW_WEIGHTS` puts it below the clavicles). **Wiring:** `tailController`/`legPhysics` were mode-aware, unit-tested and reachable only from the dev lab — `flightAnimationCoordinator` had zero call sites — so tail, legs and feet did not respond to the manoeuvre in any scene; both are now wired into sanctuary, battle and Highlands, after fixing `applyTailBoneOffset`/`applyLegBoneOffset`, which added into raw Euler x/z (lift on the inert axis, sway on the sagittal one) instead of the measured local Z/Y. **Not done:** two candidates died on the probe bench and are recorded in the baseline — a speed wing-sweep (cadence and fold already separate the modes) and a bank common-mode trim (the offset holds mean elevation to ~1°; the apparent asymmetry was `wing_elev_L.mean` watching one wing that is inside on one bank and outside on the other). No phase channel yet, so the lag is gated by a documented proxy. The wing controller is deliberately still lab-only: the wing chains are the one contract-gated symmetry surface and a runtime layer there needs its own probe and rules. |
| 4.99 | Ground Gait & Toe/Claw Articulation Parity | DONE | 4.98 | 2026-08-05: Re-aligned `walk` cadence to 2.50s (60f @ 24fps, matching v1's 2.46s). Authored stance-splay (`-10°`) vs swing-curl (`+25°`) toe articulation across `walk`, `attack` (grip → lunge → release), `breath` (braced stance), and `death` (spasm → relax). Saved to blend and validated with 0.0007m mirror & 0.0006rad loop seam. All test suites pass. |
| 4.991 | V1 Biomechanical Stance & Grounded Wing Arch Alignment | DONE | 4.99 | 2026-08-05: Measured canonical v1 `drogon.glb` pose. Set `L/R_WingShoulder` local X-rotation to `+35.0°` (high Gothic arch peak at $Z = 8.68\text{ m}$), `L/R_WingElbow` to `+45.0°` (elbow drop to $Z = 6.72\text{ m}$), `L/R_WingWrist` to `-25.0° / +25.0°` (inner claw touchdown at $Z = 1.94\text{ m}$), and `L/R_WingFinger1/2/3` to `-48° / -36° / -24°` (outer wing spars drape backward along torso). Re-authored `walk` to 59f (2.458s) with measured v1 pelvis sway ($X = +1.08 \to -0.56 \to +1.31$) and `attack` to 80f (3.333s). Added UI fallback specs in `manifest.ts` for all 35 `ModelState` values so presets never snap to GLTF T-pose. Validated `wyvern.glb` with 0.0007m mirror & 0.0009rad seam. All 370 tests pass. |
| 5 | Battle readability & Mixer LOD | DONE | 0 | 2026-08-05: All items 1-12 complete: damage flash, reachable death, attack/breath tells, fire breath VFX, distance/frustum mixer LOD, death dissolve, actor.flying stamina/flight mutation for grounded combat, trauma² camera shake, hit-stop, and GroundDustVFX. |
| 5.5 | Playable Thornwing species and animation set | DONE | 0, 5 | 2026-08-12: User-requested Forest Wyvern Display derivative ships as the separately rigged Thornwing with seven 24 fps actions, full manifest-state coverage through explicit reuse, Thornmarch acquisition/save compatibility, and dedicated numeric, GLB, and contact-sheet gates. The source records Meshy provenance but no licence grant, so external-release verification remains explicit. |
| 6 | World event stream & Flourishes | DONE | 4 | 2026-08-14: GameEvent stream in core, SAVE_VERSION 9 migration, monotonic sequence-cursor draining with offline catch-up protection, in-world hatch bursts and expanding spectral aura flourishes, and __wyvern.advance dev handle. |

Stages 3 and 5 are independent of 1–2 and can be done in parallel by a second agent.

---

## KEY IDENTIFICATION CRITERIA WHEN CREATING AN ANIMATION

When authoring or inspecting any wyvern action, evaluate these 8 mandatory channels before committing the clip:

1. **Wing Posture (Ground vs. Flight Folding)**
   - **Ground clips (`idle`, `walk`, `rest`, `attack`, `breath`):** Wings must fold tightly along the flank (`up: -15°..-20°`, `sweep: 25°..30°`, `elbow: 30°..35°`, `wrist Z: -18°`). Never leave wings in the default spread bind pose.
   - **Flight clips (`cruise`, `scout`, `hover`, `speed`):** Full stroke elevation ranges (50°–110°+).
2. **Ground Clearance & `yOffset` Alignment**
   - Measure lowest skinned vertex (`ground_clearance.min`). `ClipSpec.yOffset` must equal the negation so lowest stance contacts land exactly on $y=0$.
3. **Gait Mechanics & Asymmetry**
   - Quadrupedal walks must preserve wing-knuckle stance contact (`foot_asymmetry > 0.1 m`). Do not force symmetric mirroring on `walk`.
4. **Limb & Toe/Claw Articulation**
   - **Stance/Contact Phase:** Splay/extend toes and brace claws (`toe_curl_deg` low/negative).
   - **Swing/Lift Phase:** Curl toes upward (`toe_curl_deg` positive) to prevent ground clipping. Target measured v1 ranges (`attack`: 60.74°, `walk`: 57.70°, `death`: 46.70°).
5. **Body Line & Attitude Pitch (`body_axis_deg`)**
   - Maintain mode-appropriate body pitch: forward streamlined (~0°–12°), nose-down walk (~7°), hover/land upright (25°–36°).
6. **Wing Surface Secondary Response**
   - Wrist, finger, and membrane joints must flex lagging the shoulder carrier (`matrix_basis` flex >= 0.005 rad).
7. **Loop Closure vs. One-Shot Chaining**
   - Looping clips must close frame 0 to frame $N$ seamlessly (`seam_rot < 0.01`, `seam_pelvis < 0.01`).
   - One-shot actions must specify `loop: false` and set `next` successor state (`fly` → `airborne`, `land` → `idle`).
8. **Quaternion Reflection & Sign Validation**
   - Probe rotations on the live `WyvernRig`. Reflect wing quaternions via `(w, x, -y, -z)`. Do not reconstruct quaternions via Euler angles.

---

## REFERENCE DATA

Measured, not guessed. Sources: `docs/WYVERN_ANIMATIONS.md` and direct GLB inspection.

**Ground-Y minima** — lowest point of the posed skin relative to the rig origin. `yOffset` should be
the negation, so the lowest point lands on y=0. This measures *how far the silhouette reaches below
the origin*, *not* altitude — no clip has root motion; the body never translates.

| Clip | Ground-Y min…max | Correct `yOffset` |
|---|---|---|
| `AA_..._Battle_Stand` | +1.57 … +1.89 | −1.55 ✅ set |
| `..._Neutural_Watch` | +0.86 … +2.20 | −0.86 ✅ set |
| `..._Neutural_Roar` | −0.35 … +1.77 | +0.35 ✅ set |
| `..._Battle_Walk` | −0.24 … +0.46 | +0.24 ✅ set |
| `..._Battle_Attack06` | −0.45 … +1.75 | **+0.45 ❌ MISSING** |
| `..._Death` | −2.15 … +1.83 | **+2.15 ❌ MISSING** |
| `..._Battle_Skill03` | +0.67 … +3.20 | −0.67 (needed Stage 1) |
| `..._Battle_Skill07` | −12.03 … +1.75 | −1.75 (leap; plant the rest pose) |
| `..._Damage_GroggyLoop` | −2.04 … −1.97 | +2.04 (needed Stage 1) |
| `..._Battle_Down02` | −20.28 … −0.17 | leave default (played airborne) |

**Rig.** 292 joints, 2 skins, 39,234 tris, 52 clips, all authored at **24 fps** (so catalogue frame
numbers are exact and usable with `AnimationUtils.subclip`). Two 3ds-Max-Biped generations coexist:
`Bip002-*` (body axis) and `Bip001-*` (limbs), plus 112 `Dummy*`/`Bone0NN` helpers with no meaningful
weight. **There are no bones named "wing"** — the wings are the arm chain, membrane spread by
`Bip001-*-Finger*`.

**Sockets** (verify against the cloned scene before relying on them — names get sanitized):
`B_Face_Jaw_00_0160` (breath origin), `Bip002-Head_015` (look-at), `Bip002-Tail6_01` (tail tip),
`Bip001-L-Foot_0178` / `Bip001-R-Foot_0182` (footsteps).

**Node-name safety, verified for the sidecar route:** 300 nodes, max name length **36 chars**
(Blender's bone limit is 63), **all unique** (so Blender's exporter will not append `.001` suffixes,
which would break track binding), only one dotted name — `12b586e5d5464164b349c723ae4527a9.fbx`, the
scene root, not an animation target. Animation channels target 218 distinct named nodes.

**Two clip names exceed Blender's 63-char action limit** — `..._Damage_Add_BattleStand_RightFoot` (66)
and `..._LeftFoot` (65). This is *why* `docs/WYVERN_ANIMATIONS.md:305-321` declares the asset
read-only in Blender. It forbids round-tripping; it does not forbid adding a sidecar.

**Correction to an earlier note in the repo docs:** landing is recorded as blocked. That is
**battle-specific** — it depends on `Actor.flying` being immutable (`encounter.ts:274,321`). The
sanctuary has no `Actor`, so **landing is unblocked there today**.

---

# STAGE 0 — Runtime foundations + two bugs

**Status:** DONE — 2026-07-30. All six runtime items landed; typecheck, lint, and 36 tests pass.

**Goal.** Fix two shipped bugs and add the `GameModel` capabilities every later stage needs. No
visible change except shadows.

**Files.** `src/render/assets/GameModel.tsx`, `src/render/assets/manifest.ts`

**Do.**

1. **Fix the two `yOffset` bugs.** `manifest.ts:173` (`attack`) and `:175` (`death`) have no
   `yOffset`, so they inherit the asset default `−1.55`. Per the table above, `attack` sinks
   **≈2.0 units** into the ground and `death` **≈3.7**. Add `yOffset: 0.45` and `yOffset: 2.15`.
   Invisible today only because neither state is ever requested — Stage 1 and Stage 5 both expose them.
2. **Filter clips before `useAnimations`.** `GameModel.tsx:122` passes all 52 clips to drei. On
   unmount drei enumerates lazy getters and instantiates *every* action to uncache it — 8 wyverns =
   ~416 `clipAction` constructions in one frame on every sanctuary exit. Memoize a filtered array
   (52 → ~7) using the manifest map already in scope at `GameModel.tsx:96`. **Memoize by stable
   identity** — a fresh array each render rebuilds every action.
3. **Real crossfade.** `GameModel.tsx:141-166` never calls `crossFadeFrom`; the overlap is incidental
   (the cleanup closure's `fadeOut` racing the next effect's `fadeIn`), so weights can sum above 1
   mid-blend and overshoot the pose — visible as a wing snapping past full spread. Hold a ref to the
   outgoing action and use `crossFadeFrom(prev, dur, true)` (warping on).
4. **Add `ClipSpec.fadeIn?: number`.** The fixed `FADE = 0.25` (`GameModel.tsx:22`) is too slow for a
   death (~0.12) and too fast for a landing (~0.4).
5. **Add `ClipSpec.timeScale?: number`**, applied as `action.timeScale`. Needed by Stages 2 and 4.
6. **`castShadow` on wyverns.** Set it in the traverse `repaint()` already walks
   (`GameModel.tsx:29-33`). Real wyverns cast no shadow today while every prop does, so they read as
   pasted onto the scene. Measure after — a 39k-tri skinned shadow pass per creature is real cost;
   if it hurts, gate it to the sanctuary.

**Verify.** Sanctuary looks identical; wyverns now cast shadows; switching sanctuary→worldmap no
longer hitches. `pnpm typecheck && pnpm lint && pnpm test`.

**Done when.** All six items land, gates pass, and a scene switch is visibly smoother.

---

# STAGE 1 — Sanctuary placement

**Status:** DONE — 2026-07-30. Stable placement, assignment visuals, injury
rest, and overflow handling are implemented and covered by command-logic tests.

**Goal.** Wyverns stand at the station they are assigned to, playing an appropriate clip. No motion
yet — they may teleport on assignment change.

**Why.** `SanctuaryScene.tsx:81-122` currently maps every wyvern to `PERCHES[i]` and passes **no
`state` prop**, so `GameModel` defaults to `idle` forever and `assignment.kind` is ignored entirely.
`assignment` is already authoritative in core and already reaches the renderer via `useGameState()`.
**No core change is needed for this stage.**

**Files.** `src/scenes/Sanctuary/SanctuaryScene.tsx`, `src/scenes/Sanctuary/layout.ts`,
`src/scenes/Sanctuary/dressing.ts`, `src/render/assets/manifest.ts`

**Do.**

1. **Widen `ModelState`** (`manifest.ts:41`) to add `hop | breathe | rest | land`. Only four consumer
   sites exist; the only one outside the asset layer is `BattleScene.tsx:243`.
2. **Add `POSTS` to `layout.ts`**, hand-placed beside the existing `PERCHES` (`layout.ts:86-95`).
   Hand-place rather than computing an offset — that is what `PERCHES` already does and it looks
   better. Station interaction rings are 3.5–4.5 units (`layout.ts:33-83`) and the creature is ~44
   units nose-to-tail, so a post must sit well outside the ring or it swallows the props.
3. **Register each post in the scatter exclusion set** at `dressing.ts:139` (perches already reserve a
   22-unit radius each) or wyverns will stand inside trees.
4. **Fix perch-index instability** — pre-existing bug. `SanctuaryScene.tsx:81-83` does
   `Object.values(state.wyverns).slice(...)` and indexes `PERCHES[i]`, so deleting any wyvern (death,
   `executions/index.ts:270`; release) shifts every later one and **teleports them across the map**.
   Replace with a stable hash of `w.id` + linear probing, memoized on the id set. Stage 2 would
   otherwise upgrade this from a jump into a jump plus a spurious flight.
5. **Add a pure `postFor(w, state)` derivation** and pass both position and `state` to `<GameModel>`:

| Condition | Post | State → clip | `yOffset` |
|---|---|---|---|
| `training/flightRing` | flight ring `[-4,14]` | `hop` → `Battle_Skill07` | −1.75 |
| `training/burnRange` | burn range `[14,18]` | `breathe` → `Battle_Skill03` | −0.67 |
| `training/huntingPen` | hunting pen `[-18,2]` | `attack` → `Battle_Attack06` | +0.45 |
| `training/enduranceRun` | patrol near `[-24,16]` | `walk` → `Battle_Walk` | +0.24 |
| `training/scaleForge` | forge `[26,-14]` | `idle` → `Battle_Stand` | −1.55 |
| `breeding` | plateaus `[24,4]` ± lateral | `idle` variants | per-clip |
| `injury > 30` | infirmary | `rest` → `Sanct_Rest` | +2.21 |
| `idle` | `PERCHES[hash(id)]` | seeded idle | per-clip |

`Battle_Skill07` is a self-contained leap (grounded → brief air → land → rest) that loops — verified
by render, not inferred. For breeding pair sides reuse core's own tiebreak `w.id < partner.id`
(`systems/sanctuary.ts:56`) so both halves agree without communicating.

**Gotchas.** `assignment` variants are `{kind:'idle'} | {kind:'training',stationId,ticksLeft} |
{kind:'breeding',partnerId,ticksLeft} | {kind:'garrison',regionId}` (`core/types.ts:112-116`).
**`garrison` is dead code** — never constructed anywhere. Progress fraction is not stored; only
`ticksLeft`, so derive it as `1 - ticksLeft / STATIONS[stationId].duration` (`data/stations.ts:8-54`).

**Verify.** Open the sanctuary, assign a wyvern to training in the panel, confirm it appears at that
station playing the mapped clip. Repeat for a second station. Gates pass.

**Done when.** Every assignment kind puts the wyvern in the right place with the right clip, and
deleting a wyvern no longer shuffles the others.

---

# STAGE 2 — Sanctuary travel: they fly there and land

**Status:** DONE — 2026-07-30. Sanctuary agents take off, transit or patrol,
return, select safe landing points, land, and resume assignment state.

**Goal.** Wyverns take off, fly to their post, and land — instead of teleporting.

**Why fly rather than walk.** Three reasons, the third decisive: (1) no clip has root motion, so a
walk's ground speed is an unmeasured free parameter on a 44-unit creature and sliding is unmissable;
(2) there is no navmesh and the 10 AABB colliders (`layout.ts:106-137`) were authored for a
0.45-radius player capsule; (3) the takeoff→airborne→land chain already exists and is verified —
`Battle_Down02`'s final pose *is* `Battle_Up`'s opening pose, so `land → idle` cannot pop.

**Files.** `src/scenes/Sanctuary/SanctuaryScene.tsx`, `src/render/assets/manifest.ts`

**Do.**

1. **Add `land` to the manifest** — the whole unlock is one entry:
   `land: { clip: 'SKM_DaenerysDragon|DaenerysDragon_Battle_Down02', loop: false, next: 'idle' }`
2. **One director `useFrame`** in `SanctuaryScene`, holding an ephemeral `Map<wyvernId, Agent>` with
   `{ pos, yaw, target, phase: 'settled'|'takeoff'|'transit'|'landing', base, seed, group }`. Write
   directly to `group.position` / `group.rotation.y` — the pattern at `BattleScene.tsx:262-270`.
   **Do not add a `useFrame` per wyvern**; `GameModel` already installs one each via drei's
   `useAnimations`, and doubling the callback count buys nothing.
3. **Steering is ~15 lines.** Reuse `damp` and `clamp` from `core/math/vec.ts:55-63` — pure and
   already importable. Do **not** import `core/combat/ai.ts`: its `steer` takes `Actor`, `actors[]`,
   `arenaRadius` and folds in target selection and boid separation, all battle-shaped. No separation
   (posts are unique; give two wyverns at one station a deterministic lateral slot), no pathfinding,
   no collision — it is flying.
4. **Add `ClipSpec.groundSpeed?: number`** — a hand-dialled constant in world units/sec at
   `timeScale 1`, used **only** for the endurance-run patrol (the one case that stays on the ground).
   Then `action.timeScale = clamp(measured / groundSpeed, 0.6, 1.6)` where `measured` is
   `Math.hypot(vel.x, vel.z)`. **Never derive rate from `stats.speed`** — that yields `14 + speed*0.4`
   u/s, which is a *cap*; damping (`ai.ts:160`) and the `approach=0` engage gate (`ai.ts:149`) keep
   real velocity well below it.

**Verify.** Assign a wyvern to a distant station and watch the full takeoff → transit → landing.
Gates pass. **Timing quality needs human eyes** — a screenshot cannot show whether a blend pops, so
report what you observed rather than asserting it looks right.

**Done when.** A wyvern reassigned across the map flies there and lands without popping or sliding.

---

# STAGE 3 — Sidecar clip pipeline

**Status:** DONE — 2026-07-30. 26 actions authored, contact-sheet
reviewed, and both export and three.js runtime-binding gates pass.

**Goal.** A repeatable way to add hand-authored clips to the wyvern without touching `drogon.glb`.

**Why this does not violate the read-only contract.** `docs/WYVERN_ANIMATIONS.md:305-321` declares
Blender read-only for this asset. Its stated reason is that Blender truncates action names at 63
chars and two existing clips are 65–66, so a *round-trip* silently breaks gameplay's clip lookup.
A sidecar never round-trips `drogon.glb`: it is a separate `.blend` exporting an animation-only GLB.
All 52 existing names survive byte-for-byte and the base model's 52-clip integrity stays valid.
**Update the contract wording to "forbids round-tripping, permits adding" as part of this stage.**

**Pre-verified as safe** (see §Reference data): node names max 36 chars, all unique, no dots on any
animation target. The risk is Blender's exporter renaming something — hence the assertion gate below.

**Files.** new `scripts/build-sidecar.py`, new `public/models/drogon-sanctuary.glb`,
`src/render/assets/GameModel.tsx`, `src/render/assets/manifest.ts`, `package.json`,
`docs/WYVERN_ANIMATIONS.md`, `CREDITS.md`

**Do.**

1. **Try `AnimationUtils.subclip` first for every gap.** All 52 clips are 24 fps so catalogue frame
   numbers are exact. `Battle_Up` alone contains a folded crouch, a wing-unfurl and a downstroke as
   independently usable sub-clips. Anything subclip covers convincingly does not need authoring.
2. **Author the remainder in a new `.blend`** importing only `drogon.glb`'s armature. Name actions
   short — `Sanct_Eat`, `Sanct_Sleep` (10–12 chars, cannot truncate). Priority order: `sleep`
   (curled, breathing), `sit`/`sit_loop`/`rise`, `eat` (head to ground, chew), `drink`, `groom`,
   `perch_grip`.
3. **Export a mesh-less, skin-less GLB** — armature nodes + animations only.
4. **`scripts/build-sidecar.py`**, mirroring the asset build conventions documented in
   `manifest.ts` and its
   assertion habit. **The load-bearing gate:** parse the sidecar's animation channels and assert every
   target node name exists in `drogon.glb`'s node set. That check is what catches a silent rename —
   without it a renamed bone fails silently as a frozen model.
5. **Load and concatenate** in `GameModel`, before Stage 0's clip filter.
6. **Fix build fragility while here:** `@gltf-transform/cli` is **not** in `package.json` and not in
   `node_modules` — it resolves only from an evictable npx cache. One `npm cache clean` breaks the asset build. Add it as a devDependency.
7. **Record the new clips in `CREDITS.md`** — the base asset is CC-BY-4.0 and derivative work must be
   listed.

**Also worth fixing (unrelated, found in passing):** `scripts/asset-sources.json`'s `sourceRoot`
points at `~/Documents/3Dassets`, which does not exist. The real library is
`/Volumes/Untitled/A4/3Dassets`, so `scripts/extract-assets.py` is broken as checked in.

**Verify.** `python3 scripts/build-sidecar.py` passes its assertions; the new clips play in-browser;
the base model's 52 clips still load and skin correctly.

**Done when.** A new clip can be added by editing the `.blend` and rerunning one script.

---

# STAGE 4 — Ambient behaviour & Head Gaze

**Status:** DONE — 2026-07-30 · **Depends on:** Stages 2 and 3

**Re-verified 2026-07-30 against the live tree.** Head gaze (item 4 below) has already shipped:
`src/scenes/Sanctuary/director/spatialAwareness.ts` exports `resolveGazeTarget`,
`calculateHeadTargetAngles`, and `dampHeadPose` (covered by `spatialAwareness.test.ts`), and it is
already wired into the per-frame loop at `SanctuaryWyverns.tsx:294-320`, gated on
`agent.phase === 'settled' && agent.headBone`. The measured limits actually landed as **asymmetric
pitch `[-0.61, 0.44]` rad (≈ −35°…+25°) and yaw `±0.96` rad (≈ ±55°)** — not the ±25°/±45° this
stage originally specified. Keep the measured values; do not "fix" them back to the spec.

**Landed 2026-07-30: item 2 (ambient idle scheduler).** `Agent` gained `ambientDwell`/`ambientRoll`/
`ambientAction` fields (`wyvernDirector.ts`); `SanctuaryWyverns.tsx`'s `'settled'` branch now rolls a
weighted `{sleep, sit, groom, eat, drink, perch}` pick — gated to `agent.baseState === 'idle'` so it
never overrides a training/breeding/rest assignment loop — using a per-agent RNG derived from
`createRng(deriveSeed(seed, ...))`, never `state.rngState`. `sit` exits via `rise` (not straight to
`idle`), matching the manifest's own chain. `SanctuaryWyverns` now takes a `seed` prop, threaded from
`SanctuaryScene.tsx`'s `state.seed`. **Item 3 (timeScale jitter) and item 5 (`/debug/animation` dev
tool) remain unstarted** — jitter was deliberately skipped: it would need a new per-instance
`GameModel` prop for a "nice to have" only, while the scheduler's own per-agent randomized dwell
already staggers ambient picks across agents, which is the actual lockstep risk this item existed to
address.

**Goal.** Idle wyverns do something other than loop. The sanctuary feels inhabited and responsive.

**Files.** `src/scenes/Sanctuary/SanctuaryWyverns.tsx`, `src/scenes/Sanctuary/director/wyvernDirector.ts`,
`src/render/assets/manifest.ts`, `src/core/math/rng.ts`

**Why the remaining gap is exactly here.** The `'settled'` branch of `updateAgent`
(`SanctuaryWyverns.tsx:522-531`) only ever calls `runQueued(agent)` when idle — it never picks an
ambient action. The manifest already has everything the scheduler needs: `sit → seated`
(`loop:false, next:'seated'`) and `rise → idle` (`loop:false, next:'idle'`) one-shot chains, plus
standalone loops `sleep`, `groom`, `eat`, `drink`, `perch`, and `GameModel`'s mixer `'finished'`
listener (around `GameModel.tsx:269-282`) already advances `active` through `spec.next`
generically — the same mechanism `fly → airborne` already uses. **This is a scheduling gap, not a
missing-capability gap.**

**Do.**

1. **Per-wyvern variation without touching `state.rngState`.** Use
   `createRng(deriveSeed(state.seed, w.id))` — both are pure and importable from the render layer
   (`core/math/rng.ts`), stable across reloads and identical on every machine. Add `ambientDwell:
   number` and `ambientRoll: number` fields to the `Agent` interface (`wyvernDirector.ts`, next to
   `flightAnimation`/`flightPose`) to hold the per-agent countdown and draw counter. **Never
   `Math.random()`; never `withRng` on the tick path** — `state.rngState` is serialized, and a new
   draw there shifts every subsequent draw and rewrites all future outcomes.
2. ~~Idle scheduler~~ — **done, see "Landed 2026-07-30" above.**
3. **Per-wyvern `timeScale` jitter** (`0.92 + (seed % 7) * 0.03`) to kill the last of the lockstep
   that seeded clip choice does not reach. **Deliberately skipped for now** — see note above.
4. ~~Procedural Head Look-At (`Bip002-Head_015`)~~ — **already implemented, see Status above.** No
   further work.
5. **Flight Animation Lab (Devtool infrastructure).** Still not started. Create an isolated dev route
   `/debug/animation` (or R3F overlay) featuring clip/phase scrubbers, speed/yaw-rate sliders, camera
   envelope bounds visualization, joint socket visualizers (`Bip002-Head_015`, `B_Face_Jaw_00_0160`),
   and fixed-origin reference camera presets.

**Verify.** Watch a perch for two minutes — two neighbouring wyverns should now visibly diverge via
the ambient scheduler. Head gaze is already verifiable today: stand near a settled wyvern and confirm
its head tracks the camera smoothly. Test the `/debug/animation` scrubber and controls once built.

**Done when.** Two wyverns on neighbouring perches visibly differ over a minute via the ambient
scheduler (head gaze already satisfies its own "done" condition).

---

# STAGE 4.5 — Aerodynamic flight state machine & phase preservation

**Status:** DONE — 2026-07-30 · **Depends on:** Stages 2 and 3

**Re-verified 2026-07-30 against the live tree.** The cruise half of this stage has already shipped:
`flightPose.ts:7-8` defines `BANK_ANIMATION_ENTER = 0.14` / `BANK_ANIMATION_EXIT = 0.07`,
`FlightLoopState = 'glide' | 'bankLeft' | 'bankRight'` (line 10), and `flightAnimationState`
(lines 70-85) already implement hysteresis-gated bank switching, with `phaseGroup: 'flight'`
wingbeat continuity already set on the manifest's `glide`/`bankLeft`/`bankRight` entries. **What's
missing is hover.** A `'hovering'` *phase* already exists — `wyvernDirector.ts`'s `isFlightPhase`
includes it, `isCruisePhase` does not — used today for the direct sanctuary hover command, but it is
position-only: `SanctuaryWyverns.tsx:623-627` sets `agent.position.y = 18 + sin(agent.phaseTime *
2.5) * 0.5` and returns, never touching `agent.flightAnimation` or calling `setVisual`. A hovering
wyvern therefore keeps playing whatever cruise clip (`glide`/`bankLeft`/`bankRight`) was already
active when it entered the phase, frozen for the whole hover. Confirmed by reading the phase-switch
block directly — not inferred.

**Goal.** Add the missing hover mode to the flight state machine that otherwise already exists.

**Files.** `src/render/flightPose.ts`, `src/render/assets/manifest.ts`,
`src/scenes/Sanctuary/SanctuaryWyverns.tsx`, `src/scenes/Sanctuary/director/wyvernDirector.ts`

**Do — all landed 2026-07-30.**

1. ~~Add a `horizontalSpeed`-gated `'hover'` entry to `flightAnimationState`, as an optional third
   parameter.~~ **Done exactly as specified** — `horizontalSpeed?: number`, so the two pre-existing
   call sites (`SanctuaryWyverns.tsx`'s shared cruise block, `BattleScene.tsx:276`) are unchanged.
2. ~~Widen `FlightLoopState` to include `'hover'`, with hysteresis constants.~~ **Done** —
   `HOVER_ENTER_SPEED = 2.0`, `HOVER_EXIT_SPEED = 4.0` in `flightPose.ts`.
3. ~~Add a `hover` `ClipSpec` to the manifest.~~ **Done** — reuses `Sanct_Glide` at `timeScale: 0.55`,
   `phaseGroup: 'flight'`, no `GameModel` changes needed.
4. **Wired differently than originally specified — reused the existing shared block instead of
   duplicating logic in the phase-switch.** Rather than editing the `'hovering'` phase block directly,
   `'hovering'` was added to `wyvernDirector.ts`'s `isCruisePhase()`, so the *already-existing* shared
   cruise block (`SanctuaryWyverns.tsx`, the `if (isCruisePhase(agent.phase))` check) now runs for
   hovering agents too — it already computes `horizontalSpeed` every frame from position deltas, which
   naturally comes out near-zero during a hover (only `position.y` changes). That block now passes
   `horizontalSpeed` to `flightAnimationState` only when `agent.phase === 'hovering'`, so the two other
   cruise phases (`transit`/`patrol`/etc.) are unaffected. This avoided a second, near-duplicate call
   to `flightAnimationState`/`setVisual` inside the phase-switch block.

**Verify.** Send a sanctuary wyvern a hover command and watch it settle into a dedicated hover loop
instead of freezing on whatever cruise clip it entered with. Confirm bank/cruise transitions still
work unchanged. `pnpm typecheck && pnpm lint && pnpm test` all pass (`flightPose.test.ts`'s 8 tests
included). Wingbeats should maintain continuous phase without snapping across every transition — not
re-verified live in-browser this session; do so before considering this fully closed out.

**Done when.** A hovering wyvern plays a dedicated hover loop instead of a frozen cruise clip, and
transitioning between hover, cruise, and banking maintains smooth wingbeat continuity throughout.

---

# STAGE 5 — Battle readability & Mixer LOD

**Status:** DONE — 2026-08-05 · **Depends on:** Stage 0 · **Independent of 1–4**

**Items 1-7 landed** (damage flash, death reachable, attack/breath tells, mixer LOD, bone sockets,
hit flash on 2026-07-30; fire-breath VFX after — see the ledger row for stage 5 and each item below).
**Items 8-12 remain**: death dissolve, `actor.flying` mutation, the game-feel juice layer, the
broader shadow/count-based LOD strategy, and ground-dust VFX.

The attack/breath tells of item 3 needed one follow-up: both `attack` and `breathe` were left
looping in the manifest, and `GameModel` reports only `loop: false` specs finished, so neither tell
could ever be cleared — the breath one also pinned `BreathVFX` on permanently. Both are one-shots
now, guarded by `src/render/assets/manifest.action-channel.test.ts`. See
`docs/WYVERN_CLIP_AUDIT.md`. `pnpm typecheck && pnpm lint && pnpm test && pnpm sim:battle` all pass
against what landed — the balance harness's curve is unchanged (still the same near-binary pattern
recorded elsewhere in this repo's docs), confirming the new `Actor.hitThisTick` field is genuinely
presentation-only.

One capability this stage originally called out as something to build **already existed before this
session**: the `GameModel` `action` channel (item 3) was already `ModelActionRequest`
(`GameModel.tsx:28-33`, `{ state: ModelState, token: number }`), already wired into the Sanctuary side
— `wyvernDirector.ts`'s `Agent` interface already carried `action`/`actionToken` fields, and
`SanctuaryWyvernActor.tsx` already passed them through. Battle's `WyvernActorView` only needed to
start using the channel that was already there.

**Goal.** Fights read visually and scale smoothly under heavy unit counts. Ordered by value-per-effort.

**Files.** `src/scenes/Battle/BattleScene.tsx`, `src/render/assets/GameModel.tsx`,
`src/render/assets/manifest.ts`, `src/core/combat/types.ts`, `src/core/combat/encounter.ts`

**Do.**

1. ~~Damage flash.~~ **Done 2026-07-30, exactly as specified** — `hitThisTick: boolean` on `Actor`,
   reset in `step()`'s per-actor loop, set in `dealDamage()`; `WyvernActorView` captures materials via
   `GameModel`'s `onReady` into a `useRef` (wrapped in `useCallback` so the effect that fires it
   doesn't re-run every render) and pulses `emissiveIntensity` 2.5→1 over 120ms.
2. ~~Make `death` reachable.~~ **Done 2026-07-30, exactly as specified** — a `wasAlive` ref, one
   `setAnim('death')` call on the falling edge, `g.visible = actor.alive || anim === 'death'`. The
   corpse now holds its clamped death pose indefinitely (no auto-hide timer — that's item 8's job).
3. ~~Attack/breath one-shot tells via the `action` channel.~~ **Done 2026-07-30, exactly as
   specified** — frame-diffs `actor.cooldown`/`actor.breathCooldown` resets, bumps a local
   `actionToken` ref, passes `action={{state, token}}` to `<GameModel>`.
4. ~~Mixer LOD via a `frozen` prop.~~ **Done 2026-07-30 — distance-only, not distance+count.** Added
   `frozen?: boolean` to `GameModel`, gating `mixer.timeScale` via `useEffect`. `WyvernActorView`
   computes `camera.position.distanceTo(g.position) > 150` inside the existing `useFrame` and only
   calls `setFrozen()` on a flip, exactly avoiding the inline-JSX-expression trap this item warned
   about. **Deliberately did not add the alive-actor-count gate** this item's prose also mentioned —
   that's folded into item 11 (Shadow/Mixer LOD strategy, still open), which is the more natural home
   for a count-based threshold; distance alone is the meaningful win for now.
5. **The flame: build one cone, not a VFX system.** There is currently **zero** VFX infrastructure —
   no particles, decals, sound or postprocessing — and `tryBreath` (`encounter.ts:384-411`) already
   does the cone geometry test and calls `dealDamage` but renders nothing. Add a one-tick `breathing:
   boolean` event flag to `Actor` (same shape as the existing unconsumed `ai` field), reset it in
   `step()`, set it right after `tryBreath`'s early-return guard so it fires on every exhale attempt,
   not only a connecting hit. Export the module-private `BREATH_CONE = 0.62` (line 13) as
   `BREATH_CONE_HALF_ANGLE` so the render layer can size its cone to exactly match the real hit-test
   cone; `breathRange` is already a public per-actor field. New `src/render/vfx/BreathVFX.tsx`,
   mounted alongside `<GameModel>` inside the already yaw/pitch/bank-rotated actor group: a
   `<coneGeometry>` (or a noise-turbulence `ShaderMaterial`) scaled by `actor.breathRange` /
   `BREATH_CONE_HALF_ANGLE`, additive blending, ~0.4-0.5s scale/opacity envelope. It is literally the
   sim's hit test made visible, which is the right design — the player learns the mechanic by
   watching it.
6. ~~Bone sockets: add `onReady?: (root: Group) => void` to `GameModel`.~~ **Already existed before
   this session**, and item 1 now consumes it. The caller does `getObjectByName` on the received root
   if it needs a specific socket. **Verify socket names against the cloned scene first** — `GLTFLoader`
   sanitizes `Object3D.name`.
7. ~~Hit flash is free~~ — **done, see item 1.** Materials are cloned per instance in `repaint()`
   (`GameModel.tsx:43-60`), so flashing one touches no other creature.
8. **Death dissolve — polish pass, once items 1-3 land.** Noise-discard + edge-glow shader, injected
   via `onBeforeCompile` onto the material `repaint()` already clones per instance, reached through
   `onReady` — **not** through `manifest.ts`'s `MaterialOverride`, which is static/always-on wiring
   applied unconditionally to every DROGON instance and would force every battle actor to compile a
   dissolve-capable shader permanently, dying or not. `onReady` is the existing, intended seam for
   reaching one instance's already-cloned materials after the fact. Extend item 2's death hold to
   keep the corpse visible through the dissolve before finally hiding it.
9. **`actor.flying` mutation** (user-approved). Unlocks battle landing, walk and grounded combat. It
   changes `canHit` (`ai.ts:22-26`) and therefore balance. A stamina floor is the natural trigger —
   `stamina` already exists and already drains. **Run `pnpm sim:battle` and check the win-rate curve
   is still monotonic.** Cannot break saves or replays: encounter RNG is independent of
   `state.rngState`.
10. **Game-feel juice layer, scoped strictly to presentation.** Diff `actor.hp`/`actor.alive` at the
    render boundary into a scene-local `feedback` ref — never `battleStore`, never `GameState` (core
    never emits discrete hit/death events, so this has to live in `BattleScene`). Feed it into:
    - **Camera shake:** a trauma² decay model applied as an additive offset *after* `BattleCamera`'s
      existing chase-lerp (`lines 222-223`) — `desired.current`/`look.current` themselves stay
      untouched, so the underlying framing and the piloted wyvern's real transform are unaffected.
    - **Hit-stop:** scope it to `AnimationMixer.timeScale` via a new `onMixerReady` prop mirroring
      `GameModel`'s existing `onReady` pattern. **Never** the battle-step fixed-`dt` accumulator or
      `state/GameClock.tsx`'s own independent rAF accumulator — the world clock must keep simulating
      regardless of scene, and scaling either accumulator would desync `(seed, intentLog)` replay
      reproduction and the background economy tick simultaneously.
    - **Explicit scope note:** none of this touches `dealDamage()`'s math (the `rng.range(0.9, 1.1)`
      jitter at `encounter.ts:364`) — it makes a decisive fight *feel* more eventful but will not move
      `pnpm sim:battle`'s win-rate curve. That is a separate, numbers-only fix in
      `core/data/config.ts`. Don't conflate the two, and don't report this item as progress on the
      near-binary balance gap.
11. **Animation Mixer & Shadow LOD Strategy.** Frustum-cull or distance-cull `mixer.update(dt)` for
    wyverns beyond 150 units or outside the camera view (item 4 gives you the mechanism). Disable
    `castShadow` for background wyverns in encounters with >6 active units.
12. **Impact & Ground Dust VFX.** Spawn radial ground-dust scaling rings at ground-Y during `fly`
    (takeoff) and `land` transitions. Spawn claw slash spark billboards at target `Bip002-Chest`
    sockets when physical melee attacks land.

**Verify.** Fly an assault from the world map. `__wyvern.actors` gives live actor state. For item 9,
`pnpm sim:battle` before and after, and report both curves.

**Done when.** A fight shows visible breath, hit reactions, ground dust on takeoff/landing, corpses
that fall and dissolve rather than vanish, camera/hit feedback that reads as impactful without
touching sim outcomes, and stable 60 FPS in multi-unit battles.

---

# STAGE 5.5 — Playable Thornwing species and animation set

**Status:** DONE — 2026-08-12. User-requested work order. The static Forest
Wyvern Display remains intact; a script-built, separately rigged Thornwing ships
with seven clips and explicit coverage for every runtime state. The input records
Meshy provenance but no licence grant, so external-release verification remains
an explicit caveat. · **Depends on:** Stages 0 and 5

**Goal.** Turn the Model Library's static forest wyvern into a reproducible,
playable Tier 2 species without changing gameplay dimensions based on its mesh,
round-tripping the original display GLB, or exposing the bind pose in an
unrepresented sanctuary or battle state.

**Read first.** `docs/THORNWING_ANIMATION.md`,
`docs/WYVERN_ANIMATION_BASELINE.md` §Measured rig axes, and
`docs/FLIGHT_ANIMATION_DEVELOPMENT.md`. Thornwing has a custom armature: reuse
the canonical runtime bone names, but measure its own axes rather than copying
values from the Drogon or clean-v1 rigs.

**Authoritative input and outputs.**

- Read only `public/models/library/forest-wyvern-display.glb`, the committed
  optimized Meshy-derived display asset (35,947 evaluated triangles against an
  approximately 38,400-triangle import target). Preserve it unchanged.
- Build `public/models/thornwing.glb` through `scripts/build-thornwing.py` and
  its headless Blender implementation. There is no authoritative `.blend`; the
  script is the recipe.
- Commit the numeric approval artifact at
  `validation/thornwing-animations/clip-signatures.json` and the visual sheet at
  `docs/images/thornwing-animation-contact-sheet.png`. Actual measured values
  come from the signature, not from prose in this work order.

**Do.**

1. Re-pose the asymmetric static mesh into a balanced neutral stance, retain
   its UVs/materials and triangle budget, bind it to a custom six-limbed rig,
   and limit every vertex to four finite, normalized weights. Use the canonical
   `Root`/`RootMotion`/`Body`, head/jaw, neck, spine, tail, hind-leg and wing
   names from `rigBones.ts`; add `L_FrontLegRoot -> L_FrontUpper ->
   L_FrontLower -> L_FrontFoot` and the mirrored `R_*` chain for its separate
   front legs.
2. Author exactly seven actions at 24 fps: `idle` (6 s loop), `walk` (2 s
   loop), `takeoff` (2 s one-shot), `cruise` (3 s/two-beat loop), `land` (2 s
   one-shot), `attack` (1.5 s one-shot), and `death` (3 s one-shot). Close every
   loop below `0.01` radians/units; keep grounded loops above -0.02 m; require
   cruise to have a >=50-degree stroke, <=5-degree left/right stroke-range
   difference, -5 to +15-degree body line, and negligible root drift.
3. Register `wyvern.thornwing` at `/models/thornwing.glb`, fitted at scale 6.
   `fly` chains `takeoff -> cruise`, `land` chains to `idle`, compatible flight
   states reuse `cruise` in `phaseGroup: "thornwing-flight"`, locomotion reuses
   `walk`, action states reuse the one-shot `attack`, and remaining social/rest
   states reuse `idle`. Map every `ModelState` explicitly.
4. Add Tier 2 `thornwing` with base power/speed/stamina/firepower/armor
   `29/34/25/22/17`, growth `2.7/3.1/1.9/2.1/1.4`, traits `skittish`,
   `venomous`, `loyal`, and UI colour `#688c4a`. Make it Thornmarch's native
   egg while preserving existing serialized Mirefang eggs and wyverns.
5. Bump the save to version 4. Migrate an owned-Thornmarch save only when it has
   no Thornwing egg or wyvern: allocate a normal unique egg id and derive the
   grant from a migration-specific deterministic seed without advancing the
   serialized `state.rngState`. The migration must be idempotent.
6. Use the canonical chains in sanctuary bone discovery so both the current
   wyvern rig and Thornwing receive the supported gaze, spine, hind-leg, and
   tail layers. Do not add a second creature-rendering API or read mesh-derived
   measurements in `src/core/**`.
7. Document source provenance, rebuild commands, rig axes, state reuse, and
   limitations in `docs/THORNWING_ANIMATION.md`. Keep the original Model Library
   entry beside the playable species so contributors can compare source and
   derivative.

**Verify.**

```bash
pnpm assets:thornwing
pnpm assets:analyze-thornwing
pnpm assets:validate-thornwing
pnpm assets:contact-sheet-thornwing
pnpm typecheck && pnpm lint && pnpm test
pnpm sim:battle
```

Read the signature diff before the contact sheet. Then check idle, walk,
takeoff/cruise/landing, attack, death, hatchling scale, and camera bounds in
`/models?model=wyvern.thornwing`, sanctuary, and battle. Tests must cover species
data, manifest-state coverage, one-shot action safety, Thornmarch acquisition,
and migration eligibility, idempotence, and unchanged serialized RNG state.

**Done when.** The preserved display asset rebuilds deterministically into a
validated, ground-aligned, playable Thornwing; every state remains posed;
eligible old saves receive exactly one deterministic egg without consuming the
game RNG; and the numeric signature, contact sheet, runtime views, standard
gates, and battle harness all approve the change.

---

# STAGE 6 — World event stream & Flourishes

**Status:** DONE — 2026-08-14. GameEvent stream in core, SAVE_VERSION 9 migration, monotonic sequence-cursor drain hook with offline catch-up protection, in-world hatch burst particles and expanding spectral aura flourishes, and __wyvern.advance dev handle. · **Depends on:** Stage 4

**Goal.** Discrete sim moments (hatch, level-up, coming of age) trigger explicit visual and animation flourishes.

**Why not `state.log`.** It is a 60-entry ring of formatted English prose with no entity ids
(`core/types.ts:173-177`), and the ring splice invalidates any remembered index — it cannot be
drained reliably.

**Files.** `src/core/types.ts`, `src/core/state/game.ts`, `src/core/state/save.ts`,
`src/core/data/config.ts`, `src/core/systems/sanctuary.ts`, `src/core/executions/index.ts`

**Do.**

1. Add `events: GameEvent[]` and `nextEventSeq: number` to `GameState`, where `GameEvent` is
   `{ seq, tick, kind, subjectId, objectId? }`. Bounded ring, cap 64, mirroring `log`'s treatment at
   `core/state/game.ts:31-34`.
2. Add an `emit()` helper beside `log()`. Place one `emit` **adjacent to each existing `log`** — no
   reordering, no new branches, and critically **zero new RNG draws**, so replays and the balance
   harness are untouched. Sites: training done (`sanctuary.ts:40`), egg laid (`:73`), hatched (`:96`),
   stage up (`:106`, `:119`), died (`executions/index.ts:272`), level up (`:278`).
3. Bump `SAVE_VERSION` to 2 and add `MIGRATIONS[1]`. The mechanism already exists at
   `core/state/save.ts:49-68` and documents "add a new entry whenever SAVE_VERSION is bumped".
4. Drain render-side by **seq cursor, not index**, and **jump the cursor to `nextEventSeq`** on drain —
   offline catch-up runs up to 24 ticks (`config.ts`), and you do not want 24 hatch flourishes on load.
5. **Event Flourish Specifications:**
   * **Hatch Flourish:** Roost camera smooth pan $\to$ egg shell burst particle effect $\to$ newborn wyvern rearing roar animation (`Neutural_Roar` / `rise`).
   * **Level-Up / Evolution Flourish:** Ground-Y spectral aura ring expanding upward $\to$ roar/breathe action trigger (`breathe` / `hop`) $\to$ floating stat delta label via `WorldLabel`.

**Gotcha that will bite.** **Do not route event ids through `nextId`.**
`nameFor(egg.speciesId, state.nextId)` (`systems/sanctuary.ts:88`) derives wyvern names from that
counter, so consuming it renames every subsequent wyvern.

**Verify.** `pnpm test` and `pnpm sim:replay` must still pass — this stage must not change a single
RNG draw. **Not verifiable in-browser with current tooling**: incubation is 50 ticks at 1 tick/sec.
Add a dev-only `advance(n)` handle wrapping `advanceTicks` (`core/state/tick.ts:38`).

**Done when.** A hatch fires a visible flourish, level-ups emit an aura roar, and an old save still loads.

---

# STAGE 4.9 — Scout flight mode

**Status:** DONE — 2026-08-01. `Sanct_Scout` measured 0.333 Hz over two exact-looping beats, with a +8.08° body axis, 107.0° stroke, zero pelvis path, and no phase group; circle/patrol and idle AI select it after banking and before speed. · **Depends on:** Stage 4.8

**Goal.** A slow, loitering search loop, so a wyvern circling with nothing to do
does not read as a wyvern travelling somewhere.

**Read first.** `docs/WYVERN_ANIMATION_BASELINE.md` §Measured rig axes and
§How the authored clips were created, then `docs/FLIGHT_ANIMATION_DEVELOPMENT.md`.
Stage 4.8 built three modes this way; copy its shape rather than inventing one.

**Files.** `scripts/build-sidecar.py`, `src/render/flightPose.ts`,
`src/render/assets/manifest.ts`, `validation/wyvern-animations/clip-contracts.json`,
`src/scenes/Sanctuary/SanctuaryWyverns.tsx`, `src/scenes/Battle/BattleScene.tsx`,
`src/app/debug/animation/page.tsx`, plus the five clip lists in §Cross-cutting.

**Do.**

1. **Clip.** `ActionRecipe("Sanct_Scout", ..., True, flight_keys(beats=2, beat_frames=72, body_pitch=-6.0))`.
   Two beats in 144 frames is **0.333 Hz** against cruise's 0.5, speed's 0.8 and
   hover's 0.667 — cadence is the mode, exactly as it is for speed. The nine
   landmark fractions × 72 round to 0, 8, 14, 22, 33, 42, 53, 58, 64: all
   distinct, no key collisions. `body_pitch=-6.0` is a slight nose-**up** trim
   (positive is nose-down), landing the body line near +8° — inside cruise's
   contracted ±15°, because scout is a cadence variant, not a new attitude.
2. **Selector.** Add `searching?: boolean` to `FlightMotion` and a rung
   **after the bank block, before the speed check**: scout is a cruise variant,
   so a scouting wyvern that turns should still bank, and a caller must not
   assert `searching` while `boosting`. Being an intent it needs no hysteresis
   band, like `powered`.
3. **Contract.** New `scout` mode: `cycle.cadence_hz` **max 0.42** (below
   cruise's 0.5 — this is the rule that makes it a mode), `cycle.beats` min 2,
   plus cruise's amplitude, symmetry, origin, loop and lateral rules unchanged.
   Set every threshold from the first measured bake, not from this document.
4. **Wire it.** Sanctuary: `searching: agent.phase === 'circle' || agent.phase === 'patrol'`.
   Battle: `searching: actor.ai === 'idle'` — no latch needed, unlike `boosting`,
   because `idle` has no boundary to chatter across.
5. Add `'scout'` to `ModelState`, `FlightLoopState`, and the debug page's
   `GROUPS`; update the five clip lists.

**Traps.**

- **Do not author a head scan into it.** `director/spatialAwareness.ts` writes
  the head bone every frame in the sanctuary, so an authored head turn is
  overwritten and you will be debugging a clip that measures correctly and does
  nothing. Differentiate scout by body and wings only.
- `flight_keys` has no amplitude parameter, so scout cannot have *deeper* beats
  today, only slower ones. If deeper is wanted, that is a real extension —
  scale each sampled wing pose toward or away from the beat's mean via slerp —
  and it should be its own change with its own measurement.
- It **must not** join `phaseGroup: 'flight'`: 2 beats against cruise's 3 fails
  `animationContracts.test.ts`'s duration-and-cadence check by construction.

**Verify.** `pnpm assets:analyze-clips`, then read the signature diff: cadence
0.333, 2 beats, body axis inside ±15, `pelvis.path` 0, `root_roll_delta_deg` 0,
`loop.pose_mean` 0. Then `/debug/animation`: tick `searching`, confirm the
readout reaches `scout`, and confirm a turn still selects `bankLeft/Right`. Then
gates.

**Done when.** A sanctuary wyvern on a `circle` or `patrol` command visibly beats
slower than one in `transit`, and the contract gate fails if that stops being true.

---

# STAGE 4.95 — Aerial attack action

**Status:** DONE — 2026-08-01. `attackAir` promotes the measured 3.333s airborne `Battle_Attack04` as a one-shot action; both battle and manual sanctuary strikes select it when airborne. · **Depends on:** Stage 4.8

**Goal.** A flying wyvern that strikes should not play the planted ground bite.

**The one rule that matters.** This is a **one-shot, and it must not go through
`flightAnimationState`.** That selector runs every frame and returns a looping
mode; routing a strike through it means cruise selection stomps the swing
mid-animation. One-shots already have their own channel — `ModelActionRequest`
in `GameModel.tsx:29`, `{ state, token }`, where a changed token retriggers and
the base state resumes underneath. `attack` and `breathe` already use it.

**Files.** `src/render/assets/manifest.ts`, `src/scenes/Battle/BattleScene.tsx`,
`validation/wyvern-animations/clip-contracts.json`, and the clip lists only if
you author rather than promote a clip.

**Do.**

1. **Pick the clip by measurement, not by name.** The vendor file already has
   airborne strikes: `Battle_Skill11_L/R` (162.2° elevation range) and
   `Battle_SkyMoveL/R` (179.4° arc, the widest in the corpus). Their high
   `symmetry_error` — 22.4 and 14.0 — is a *feature* here, not the defect it
   would be in a cruise loop: a strike is asymmetric. Read the catalogue in
   `docs/WYVERN_ANIMATIONS.md` for durations first; anything over ~3 s will not
   read as a single blow, which is why `attack` uses `Battle_Attack06` (3.3 s)
   rather than `Battle_Attack01` (8.1 s).
2. **Manifest.** Add `attackAir` to `ModelState` with `loop: false` and **no**
   `next` — the action channel restores the base state on its own. Follow the
   flight-clip convention of `yOffset: 0`: it plays at altitude, where the
   ground fit is meaningless.
3. **Fire it.** In `BattleScene.tsx`, the attack tell is already a frame-diff of
   `actor.cooldown`. One line:
   `setAction({ state: actor.flying ? 'attackAir' : 'attack', token: actionToken.current })`.
   Do not add an event to the sim — battle presentation frame-diffs the sim and
   never writes to it, and an event queue would have to be replay-stable.
4. **Contract.** Add an `air_gesture` mode, or extend `grounded_gesture`'s
   sibling set: assert the clip is a one-shot the manifest plays as one, and
   that its `ground_clearance.min` is *not* held to the planted `≥ -2.5` floor —
   an airborne strike legitimately reaches far below the origin.

**Optional follow-on, not required here.** `Actor.ai === 'engage'` is consumed
by Stage 4.8 only as a `boosting` hint. A dedicated *attack-run* loop — a held
approach posture distinct from cruise — would be a fourth flight mode and
belongs in its own stage, after scout.

**Verify.** Start a battle, let a flying wyvern strike, confirm it plays the
airborne clip and that the cruise loop resumes underneath without a snap. Confirm
a grounded unit still plays `attack`. Then gates.

**Done when.** Airborne and grounded strikes are visibly different actions, and
neither is interrupted by loop selection.

---

## CROSS-CUTTING

**After every stage:** `pnpm typecheck && pnpm lint && pnpm test`.

**No FPS instrumentation exists anywhere in the repo.** Add a dev-flagged drei `<Stats>` before
Stage 5, which adds mixers, shadows and a transparent cone.

**Performance ceiling.** 8 sanctuary wyverns ≈ 314k skinned tris and ~2,336 bone matrices/frame —
the practical 60fps ceiling on mid hardware, and `PERCHES.length` already enforces it. **Battle is the
hazard: attacker count is uncapped** (`executions/index.ts:230-233`), so 10 wyverns ≈ 392k tris and 20
mixers while the sim runs up to 8 fixed steps per frame. Mitigation order: clip filtering (Stage 0) →
pause off-screen mixers → distance cull → cap wyverns per side (a gameplay change).

## EXPLICITLY REJECTED — do not implement

| Rejected | Why |
|---|---|
| Additive blend layer | Exists to unlock 4 `Damage_Add_*` clips that have complete planted substitutes already identified |
| General keyframe-event system | One `[start, end]` window covers the only real case (flame during `Skill03`'s held f127–f190 thrust) |
| Boids for sanctuary agents | 8 agents at unique hand-placed posts; a per-station slot offset is the whole problem |
| Navmesh / pathfinding | Fly over the obstacles; the chain already exists |
| Behaviour tree / GOAP | `assignment.kind` **is** the behaviour selector; the sim already did this work |
| Positions in `core/**` | 1Hz tick rate, replay surface, save bloat, and it inverts a boundary that is currently correct |
| Retargeting Wyvern 2 or Dragon | Weeks before one pixel changes, and neither source carries the sanctuary behaviours |
| Unreal export of Wyvern Rex | Only source with real eat/drink/sleep clips, but a ~30GB prerequisite that may simply fail, then still a joint-by-joint retarget onto a 292-bone dual-Biped |
