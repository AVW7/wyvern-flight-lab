# Flight animation development

This is the durable development contract for wyvern flight animation. Use it
for new clips, state-machine changes, procedural attitude, camera adjustments,
and animation review in both sanctuary and battle.

The central rule is:

> Flying is a family of locomotion modes, not one loop with steering added.

Technical validity is necessary but not sufficient. A clip can loop exactly,
bind every track, and still communicate the wrong motion, displace the body
relative to its origin, or put the gameplay camera inside a wing.

## Sources of truth

- `docs/WYVERN_V1_REAUTHORING_SOURCE_OF_TRUTH.md` — the complete 78-action v1
  catalogue, pinned source identities, repaired-rig target names, and
  re-authoring protocol. Read this first when rebuilding or expanding an action.
- `docs/WYVERN_V1_ANIMATION_SOURCES.json` — the machine-readable source hashes,
  action counts, and canonical/noncanonical asset distinction.
- `docs/WYVERN_ANIMATION_BASELINE.md` — the measured capability envelope, how the
  authored clips were built from it, and the numeric review loop. Read this
  first; it is what makes the rest of this document enforceable.
- `validation/wyvern-animations/clip-signatures.json` — the measurements
  themselves, for all 78 clips. Regenerate with `pnpm assets:analyze-clips`.
- `validation/wyvern-animations/clip-contracts.json` — the thresholds, asserted
  by `src/render/assets/animationContracts.test.ts` in `pnpm test`.
- `docs/WYVERN_ANIMATIONS.md` — measured vendor catalogue, currently wired
  clips, sidecar contents, and pipeline constraints.
- `docs/WYVERN_ANIMATION_PLAN.md` — open work-order ledger. It records staged
  features and historical decisions; it is not the animation-quality standard.
- `src/render/assets/manifest.ts` — gameplay state to clip mapping.
- `src/render/assets/GameModel.tsx` — playback, crossfades, one-shot chaining,
  phase synchronization, and per-clip offsets.
- `src/render/flightPose.ts` — pure procedural flight attitude and bank-state
  selection.
- `scripts/build-sidecar.py` — authored sidecar build pipeline.
- `validation/wyvern-animations/` — generated reports and visual contact sheet.

Read this guide and the catalogue before changing a flight state or action.

## Flight-mode pose contracts

Define the body mechanics before touching wing keys. Every mode needs an
observable silhouette contract.

**This table is enforced.** Its Legs & Feet column is gated by `foot_drop.mean`
and `toe_curl_deg.mean`, and its Neck & Head column by `head_reach.horizontal`
and `head_reach.vertical`, in the `cruise`, `scout`, `bank`, `hover`, `speed`,
`glide` and `dive` blocks of `clip-contracts.json`. It was prose for a long time
and every forward-flight clip violated it in silence — `foot_drop` held inside
0.06 units and `toe_deg` at exactly 0.00 across whole loops — because no mode had
a rule on a limb. If you change a row here, change its rule, and the reverse.

| Mode | Torso & Hips (Pelvis) | Legs & Feet | Neck & Head | Tail | Wings |
|---|---|---|---|---|---|
| Hover | Upright (~30-45° nose-up pitch); Hips dropped low under wing roots | Legs hang down, feet extended & ready for touchdown, toes spread | Alert & level; neck counter-pitches to keep eyes on horizon | Lowered for pitch stability | Frequent, forceful beats (high cadence) |
| Takeoff | Crouch opens into rising body line; Hips lift from ground posture | Push off, extend backward/downward, then lift as velocity builds | Reaches into ascent angle | Drives down and back | Large, high-amplitude power strokes |
| Cruise/Glide (Forward) | Long, near-horizontal body line (~0-12° pitch); Hips aligned with motion | Tucked back under/behind pelvis along body line to minimize drag | Reaches forward along direction of travel | Streams behind pelvis | Efficient beats with readable recovery |
| Speed / Dive (Forward) | Streamlined / nose-down body line (-7° to -30° pitch); Hips high & flat | Tucked tight against abdomen/tail | Reaches forward / stoop line | Streamlined behind hips | Fast high-frequency beats or tight fold |
| Bank (Forward Turn) | Cruise posture + inside hip/wing lowered; procedural roll applied | Remain tucked & streamlined | Looks/leans into the turn | Counterbalances to outside | Asymmetric inside/outside stroke |
| Landing | Upright braking posture (~30-50° nose-up); Hips lowered to absorb contact | Extends forward and downward toward ground, toes/claws spread wide | Acquires landing point; head lowers relative to braking torso | Lowers for aerodynamic braking & balance | High-drag braking strokes |

### Biomechanical Posture Contracts: Forward Flight vs. Hover / Takeoff / Landing

When authoring or reviewing flight animations, enforce these structural body differences between **Forward Flight** (Cruise, Speed, Glide, Dive, Scout, Bank) and **Stationary / Transition Flight** (Hover, Takeoff, Landing):

1. **Neck Flexibility & Overlapping Motion (`NECK` chain: 4 bones)**:
   - **Forward Flight**: The neck must not be rigid or stiff. It acts as a flexible fluid spring and counterbalance, undulating with overlapping secondary motion (head lags behind the power stroke phase by ~1 landmark). In fast cruise and speed, the neck extends forward while maintaining smooth sagittal Z-flexibility (`neck_bend`) and lateral Y-sway into banks (`neck_bank`).
   - **Hover / Takeoff / Landing**: In **Hover**, the neck counter-bends to keep the head level with the horizon while the torso pitches ~30-45° upright. In **Landing**, the neck flexes downward to acquire the landing point as the body brakes. In **Takeoff**, the neck extends upward into the climb vector.

2. **Body Elongation & Spine Undulation (`SPINE` chain & `body_axis_deg`)**:
   - **Forward Flight**: The body elongates along the longitudinal flight axis. During the power downstroke, the spine and ribcage extend (`torso_recoil`), increasing the head-to-pelvis horizontal span (`head_reach`) to create a streamlined aerodynamic silhouette.
   - **Hover / Takeoff / Landing**: The body contracts vertically with an upright, compressed torso (`body_axis_deg` ≥ 25° for Hover, up to 50° for Landing flare). The hips drop low, aligning the centre of mass beneath the wing roots for lift balance or braking.

3. **Hips & Pelvis Alignment (`pelvis` / `body_axis_deg`)**:
   - **Forward Flight**: Hips/pelvis sit horizontal or near-horizontal (`body_axis_deg` between -12° and +8°), trailing streamlined behind the chest.
   - **Hover / Takeoff / Landing**: Hips drop down as the flight root pitches upright, shifting the hips below the wing pivot.

4. **Legs & Feet Carriage (`foot_drop` / `toe_deg`)**:
   - **Legs Tucked (Aerodynamic Flight)**:
     - **Modes**: Forward Cruise, Speed, Glide, Dive, Scout, Banking turns.
     - **Posture**: Hind legs fold backward beneath/behind the pelvis along the tail/body line (`foot_drop` is minimized). Claws/toes are relaxed or slightly curled backward to minimize aerodynamic drag.
   - **Legs Out / Extended (Touchdown, Hover & Payload)**:
     - **Hover**: Legs hang downward beneath the shifted centre of mass, ready to make ground contact or balance pitch (`foot_drop` up to 3.5-4.5 units below pelvis).
     - **Landing**: Legs extend forward and downward (`foot_drop` reaches maximum, up to 5.6 units below pelvis), with toes/claws spreading wide (`toe_deg`) to absorb landing impact.
     - **Takeoff**: Legs push off the terrain (extending downward), then retract/tuck backward into the body line as forward air speed reaches cruise velocity.
     - **Prey Carry / Hunting**: Legs extend downward to grapple/carry targets (`Sanct_HuntCarry`), pulsing rhythmically with the heavy power stroke.

5. **Tail Mechanics & Flight Direction (`tail_pitch` / `tail_bend`)**:
   - **Tail Elevation vs. Flight Pitch (`tail_pitch`)**:
     - **Nose-Down Flight (Speed, Dive)**: The tail flexes upward along the stoop/dive line to trim the steep pitch angle and stream aerodynamically behind the body.
     - **Nose-Up Flight (Hover, Climb, Landing)**: The tail flexes downward beneath the upright torso (`TAIL` sagittal Z) to provide pitch balance, braking surface, and stability.
   - **Lateral Counterbalance in Turns (`tail_bend`)**:
     - In banking turns (`bankLeft` / `bankRight`), the flexible 6-bone tail chain sways to the outside of the turn (opposite to the dropped inside wing) by ~1.5 units, acting as an aerodynamic rudder and dynamic counterweight.

## Motion brief

Write a short motion brief before authoring or remapping a clip. Record:

1. **Intent:** hover, accelerate, cruise, turn, decelerate, or land.
2. **Body axis:** desired head-to-tail angle and acceptable variation.
3. **Pelvis/centre of mass:** what remains visually anchored.
4. **Limbs:** hanging, pushing, tucked, trailing, or reaching.
5. **Neck/head:** gaze and relation to the torso.
6. **Tail:** propulsion, stability, counterbalance, or braking.
7. **Wing cadence:** period, amplitude, and phase landmarks.
8. **Origin contract:** what may move relative to the model origin.
9. **Camera envelope:** maximum forward, trailing, vertical, and lateral extent
   at runtime scale.
10. **Transition contract:** valid predecessors, successors, and whether phase
    must be preserved.

If these cannot be stated, the animation is not ready to author.

## Layering model

Flight motion is composed in this order:

1. **Authored primary posture** — torso, pelvis, limb carriage, neck, and tail
   establish the mode.
2. **Authored propulsion cycle** — wingbeats and restrained secondary response.
3. **Authored directional variant** — bank-specific wing, neck, and tail
   deformation.
4. **Runtime attitude** — responsive pitch and whole-model roll from actual
   velocity and wrapped yaw rate.
5. **Camera response** — framing appropriate to the resulting bounds and speed.

Do not make procedural attitude compensate for the wrong base posture. Do not
author whole-body roll into bank loops when runtime already supplies it. Do not
restart a propulsion cycle when changing between compatible directional loops;
use a shared `phaseGroup`.

## State logic

Choose animation from physical intent, not one `flying` boolean.

The target architecture is:

```text
grounded -> takeoff -> hover -> accelerate -> cruise
                         ^                       |
                         |                       v
                      decelerate <- bank left/right
                         |
                         v
                       landing
```

Use hysteresis around speed and turn thresholds so noisy measurements cannot
chatter between states. Direction reversal may switch bank loops directly.
Takeoff and landing are protected one-shots and must not be replaced by cruise
selection while they are active.

The current bank selector in `src/render/flightPose.ts` is the model: it is pure,
unit-tested, uses separate enter/exit thresholds, and handles direct reversal.
An eventual hover/cruise selector should follow the same pattern.

## Authoring workflow

### 1. Inspect before editing

- Confirm which `.blend` is open and whether it is dirty.
- Never author from a stale action set.
- Reload the sidecar source `.blend` before regeneration.
- Create a fresh decompressed vendor source when source actions are required:

```bash
pnpm exec gltf-transform copy \
  public/models/drogon.glb \
  /private/tmp/wyvern-drogon-source.glb
```

- Preserve the vendor GLB. Blender may read it, measure it, and sample it, but
  must not round-trip it.

### 2. Work on a disposable copy

Test substantial body-root or origin changes in a temporary `.blend` first.
Render and measure there before promoting the recipe to the tracked source.
This separates exploration from the authoritative asset.

### 3. Author the complete posture

Inspect the hierarchy and local axes rather than guessing from bone names.
Check whether every edited bone is already among the exported animation
targets. An edit to an unkeyed helper can look correct in a manual Blender pose
and disappear from the sidecar.

Author all compatible cruise variants from one shared timing function so their
wingbeat phase remains identical. Mirror directional poses from measured rig
axes, not by assuming left and right use identical local signs.

Mirror **every** paired chain a mode expects to be symmetric, and state each one
on the key. Wings were mirrored and hind limbs were not for as long as both
existed, so the base pose `PoseKey.body` freezes carried its own 0.72-unit
left/right foot difference into all eight flight clips. Where a mirror can run
in either direction, pick it on a gated channel rather than a convention:
`mirror_legs="L"` holds the side `foot_drop` measures, so every limb-carriage
band keeps its derivation.

### 4. Validate by measurement

**The approval view is numeric.** Measure the clip and read the channels:

```bash
pnpm assets:analyze-clips
pnpm assets:analyze-clips --trace Sanct_Cruise
```

`validation/wyvern-animations/clip-signatures.json` is committed, so a change to
a clip lands as a per-channel diff. `pnpm test` then asserts it against
`clip-contracts.json`, whose thresholds each name the vendor clip they were
derived from. `docs/WYVERN_ANIMATION_BASELINE.md` explains the channels, the
capability envelope they are set from, and how to read a trace.

Read, at minimum: stroke arc, wing elevation range, left/right elevation bias,
symmetry error, body axis, pelvis path, authored roll, loop error, and beat
count. The per-frame trace covers what sampled frames used to: three clean rises
and falls in the elevation bar is a three-beat loop, `elevL` and `elevR` tracking
within a degree is a symmetric beat, and the last frame returning to the first
line's values is the cycle closing.

Renders remain available (`scripts/build-animation-contact-sheet.py`) and are useful for judging
deformation detail a human will look at. They are **not** the approval gate. Two
contact sheets cannot be diffed, an auto-framed sheet hides origin displacement,
and a near-black dragon hides pose in a lit render — which is how a cruise loop
with a 27.3° stroke, 37.7 symmetry error and no detectable wingbeat shipped past
a sheet that had been reviewed.

### 5. Export and validate

Export from the connected, regenerated Blender scene, then install the staged
file through the sidecar validator:

```bash
pnpm assets:drogon-sidecar --from-export /path/to/blender-export.glb
pnpm assets:validate-sidecar
```

Alternatively, query the **live Blender MCP socket server** (`localhost:9876`) to run real-time evaluation scripts against the open scene without exiting Blender.

The current sidecar contract is:

- 26 expected actions;
- 292 existing target nodes;
- 876 three.js tracks per action;
- exact endpoints for every looping track;
- no meshes, skins, materials, textures, or images.

If the action set intentionally changes, update the authoring script, build
validator, runtime validator, manifest, catalogue, build notes, and credits in
one change.

### 6. Validate in runtime context

Blender approval does not approve the game. Check:

- battle cruise startup;
- sanctuary takeoff -> transit/patrol -> landing;
- straight flight, maximum climb, maximum dive, and both bank directions;
- bank reversal and return to straight flight;
- widest wingbeat phases through the gameplay camera;
- model origin, name label, selection ring, shadows, and effect sockets;
- camera near-plane intersection and model clipping;
- no console or page errors.

Test at the actual runtime scale. A 44-unit creature at `scale={1.6}` has a
different camera envelope from the same armature in a normalized Blender view.

## Measurable gates

These are channel names in `clip-signatures.json`, not things to write down by
hand. `pnpm assets:analyze-clips` emits all of them for all 78 clips.

| Question | Channel |
|---|---|
| Which locomotion mode is this? | `body_axis_deg` |
| Is there propulsion in it? | `wingtip_L.stroke_arc_deg`, `wing_elev_L.range`, `cycle.beats` |
| Is it level, or banking, and which way? | `wing_elev_bias` (signed), `tail_reach.lateral` (signed) |
| Is the pose symmetric at all? | `symmetry_error` |
| Does the body stay put? | `pelvis.span`, `pelvis.path` |
| Are the legs hanging, pushing, or tucked? | `foot_drop` |
| Are *both* legs doing it? | `foot_drop_R`, `foot_asymmetry` — `foot_drop` watches the left foot only. Flight mirrors the pair with `PoseKey.mirror_legs` and holds `foot_asymmetry` inside ±0.15; grounded and load-bearing clips do not, because planted legs are meant to differ |
| Are the claws gathered or open? | `toe_curl_deg` (local Z). **Not `toe_deg`**, which reads local X: that swings ±40° for under 0.09 of change in outer-toe span, so it moves the number without moving the silhouette |
| Where is the neck reaching? | `head_reach` |
| Which way is the head looking? | `head_reach.lateral` (signed) — the bank rows' "looks/leans into the turn". +x is the rig's left, same convention as `tail_reach.lateral`, and the two must have **opposite** signs in a turn: head inside, tail outside |
| Does the body answer the beat as a chain or as one piece? | `body_axis_deg.range` — a proxy for the neck/tail lag, not the lag itself. See the baseline |
| Is roll being authored twice? | `root_roll_delta_deg.range` |
| Will it seam? | `loop.pose_mean`, `loop.basis_max` |
| Can it share a `phaseGroup`? | `duration_s` plus `cycle.beats` |
| How low does the silhouette reach? | `ground_clearance` |

`ground_clearance` is the one to check when bounds change: it is the lowest point
of the *evaluated skin* relative to the origin, so it sets `yOffset` and tells
you whether geometry will pass through terrain. It is sampled 48 frames per clip
because the minimum of a sparse sample over-estimates it — two shipped offsets
were wrong for exactly that reason.

Camera distance should be based on the trailing and vertical bounds plus a
margin, not tuned against one convenient frame. Any animation that materially
changes bounds requires camera review in the same change; `/debug/animation`
reports live bounds at every species scale.

## Definition of done

A flight-animation change is complete only when:

- [ ] The motion brief and state pose contract are satisfied.
- [ ] The mode has a rule set in `clip-contracts.json`, and each threshold names
      the measurement it was derived from.
- [ ] `pnpm assets:analyze-clips` was re-run and `clip-signatures.json` committed.
- [ ] The signature diff was read: every channel that moved was expected to move.
- [ ] Primary body mechanics read correctly without procedural pitch or bank.
- [ ] Compatible directional clips share cadence and phase, or do not share a
      `phaseGroup`.
- [ ] Loop endpoints match exactly.
- [ ] Target counts, tracks, and sidecar content validation pass.
- [ ] Transition endpoints were reviewed, not only isolated loops.
- [ ] Battle and sanctuary gameplay cameras contain the largest silhouette.
- [ ] Live takeoff, cruise, banking, recovery, and landing were observed.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`,
      `pnpm assets:validate-sidecar`, and `pnpm build` pass.
- [ ] The catalogue, baseline, build notes, reports, and credits reflect the
      shipped asset.

## Review record

Use this short record in a work order, commit message, or pull request so the
reasoning survives after screenshots and temporary Blender files are gone:

```text
Motion intent:
Previous mode/pose:
Target mode/pose:
Authored primary posture:
Authored cycle/directional layers:
Runtime procedural layers:
Origin and bounds change:
Camera impact:
Transitions reviewed:
Blender evidence:
Runtime evidence:
Automated gates:
Known limitations:
```

Write observable facts. “Looks better” is not a motion intent; “cruise keeps
the head and tail near one horizontal line while the legs trail behind the
pelvis” is.

## Development tooling roadmap

The most valuable long-term tool is a development-only Flight Animation Lab.
It should be a small isolated R3F scene, not a second gameplay implementation.

Minimum useful controls:

- requested and active state selectors;
- clip and normalized-phase scrubber;
- horizontal speed, vertical speed, and wrapped yaw-rate controls;
- procedural pitch/bank toggle;
- side, front, top, three-quarter, sanctuary, and battle camera presets;
- model origin, skeleton, head, pelvis, feet, tail-tip, and bounds overlays;
- runtime scale selector;
- current state, phase group, action time, pitch, bank, and bounds readouts;
- fixed reference screenshot capture.

Status:

1. ~~Flight Animation Lab with fixed cameras and bounds overlays.~~ Done —
   `/debug/animation`.
2. ~~Explicit `hover` loop and state.~~ Done — `Sanct_Hover`, 32.1° nose-up
   against cruise's 2.1°, four beats against three.
3. ~~Offline measurement and a numeric quality gate.~~ Done —
   `pnpm assets:analyze-clips` and `animationContracts.test.ts`.
4. `hoverToCruise` and `cruiseToHover` transitions. Not started. Hover is
   deliberately outside `phaseGroup: 'flight'` because its cadence differs, so
   the handoff is currently a plain crossfade; an authored transition is what
   would make it seamless.
5. Speed-based hover/cruise hysteresis. `flightAnimationState` already has it;
   only the sanctuary's `'hovering'` phase opts in by passing `horizontalSpeed`.
6. Automated camera-clearance checks against `ground_clearance` and evaluated
   bounds, so a widened silhouette fails the same way a broken loop does.

## Lessons that must not regress

- A valid loop can still communicate the wrong locomotion mode.
- An auto-framed contact sheet can hide origin displacement — and no two contact
  sheets can be compared, so nothing catches a slow drift between them.
- A document can describe an asset the `.blend` does not contain. `BUILD_NOTES.md`
  claimed "three symmetric 83-degree wingbeats" while the shipped clip measured
  27.3° and 37.7 symmetry error, because the recipe was rewritten and the bake
  was not. Only a measurement of the shipped file closes that gap.
- Sign conventions must be measured, not reasoned about. Two separate recipes
  authored a bank that produced no left/right asymmetry at all, each with a
  confident comment explaining why it worked.
- The minimum of a sparse sample over-estimates ground clearance, and ground
  clearance sets `yOffset`.
- A manual pose edit can target a helper that the exported action never keys.
- A pose helper named for a general operation can cover one chain. `mirror`
  symmetrised the wings and nothing else, so the hind limbs kept the frozen base
  pose's asymmetry through every flight clip until a channel existed that watched
  the second foot.
- A longer horizontal tail can invalidate a previously safe chase camera.
- A constraint that names a chain can hold on only part of it. "The wing
  clavicles are children of the neck" is true of `Neck` and `Neck1` and false
  below them, and until that was probed it capped the bank's head lean at an
  amplitude nobody could see — while the runtime, reasoning from the same
  sentence, fed the full yaw to all three neck bones anyway.
- A runtime layer can rebuild a defect the authoring layer already fixed.
  `applyTailBoneOffset` and `applyLegBoneOffset` added straight into
  `bone.rotation.x`/`.z`, which is lift on the axis this rig measures as inert
  and sway on the sagittal one — precisely what `render/boneOffsets.ts` exists to
  prevent. Runtime and authoring must drive the same measured axes.
- Wing timing should be approved only after torso, pelvis, limbs, neck, and
  tail satisfy the mode contract.
- Animation, runtime transforms, and camera framing are one visual system and
  must be reviewed together.

## Why previous documentation was wrong & How to maintain truth

### The 4 Root Causes of Documentation Drift
1. **Unchecked Prose Standards**: Rules were written in prose ("*cruise keeps a long body line*") instead of automated assertions (`pnpm test`). Prose does not fail CI builds.
2. **Contact Sheet Optical Illusions**: Renders of near-black dragons hide pose errors, wingbeat amplitude, and pitch offsets. Approval was visual rather than numeric.
3. **Inferred vs. Measured Axes**: Signs and axes were reasoned about mathematically instead of being probed directly on the rig in Blender (e.g. assuming local X pitched the body when it yawed it, or assuming opposite signs banked wings when equal signs did).
4. **Desynchronized Code & Assets**: Hand-written documentation in `BUILD_NOTES.md` claimed "three 83-degree wingbeats" while the underlying `.blend` export held 0 wingbeats because the bake script was not executed after the recipe edit.

### The Mandatory Animation Workflow
* **Rule 1**: Always execute `pnpm assets:analyze-clips` after modifying any clip to regenerate `clip-signatures.json`.
* **Rule 2**: Run `pnpm test` to validate signatures against `clip-contracts.json`.
* **Rule 3**: Probe any new bone transform via the live Blender socket (`127.0.0.1:9876`) before writing procedural runtime offsets or authoring scripts.

