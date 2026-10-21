# V2 animation and Flight Lab delivery plan

9 September 2026. User requested continued rig repair, a plan for every animation and Flight Lab, and preparation for game export. This plan governs qualification and promotion, not automatic approval of the current candidates. Fantasy Biomes owns gameplay; Blender owns authored animation. Current repo has substantial concurrent staged/unstaged work. Inspect current files before implementation and preserve unrelated changes.

## Current deliverables

Complete candidate: `/Users/ajadvanwyk/.codex/visualizations/2026/09/09/01a08509-1dea-76c0-8707-83856dc9d32c/v2-rig/wyvern-v2-complete-candidate.glb`.

SHA256: `16e45508119426cf979936b45b7463246c9215960a9ce56b7b65f4c037d04c86`. Size: 24,761,676 bytes. One skin, 92 bones, all 18 canonical animation names. Walk, cruise and both banks come from the current repair exports. The other 14 animation JSON records, original node hierarchy, skins, meshes, materials, textures and image records are preserved exactly; original binary data remains intact at the beginning of the buffer. This is append-only packaging and leaves superseded animation bytes; optimize only after quality approval.

The bundle was imported back into Blender successfully. Saved review: `v2-complete-export-review.blend` in the same folder. Scene `Complete V2 Export Review`, armature `WyvernRig.002`, action `walk.002`, frames 0–59 at 24 fps. Blender action suffixes are collision suffixes; exported names are canonical. Inspect live state before opening. This is the combined-export review file; `v2-motion-repair-banks.blend` remains the authoring checkpoint.

Reproduction:

```sh
node tools/package-v2-animation-candidate.mjs public/models/wyvern-v2-rig.glb /path/to/v2-rig /path/to/wyvern-v2-complete-candidate.glb
node tools/audit-wyvern-motion.mjs /path/to/wyvern-v2-complete-candidate.glb
```

Packaging pins the inspected base hash, maps tracks by exact node names, rejects missing mappings, and checks all preserved records. Its adjacent JSON records donor hashes and output identity. The motion audit checks binding and continuity for walk/cruise/banks at approximately 96 Hz; it does not certify the other clips or textured rendering.

As of 15 September, Flight Lab's `public/models/wyvern-v2-rig.glb` is the repaired V2 cruise candidate: SHA-256 `34b2862c7c74f77952131b612dc296d4d29215f63af2ad749e3782f333ec928f`, 6,977,360 bytes, 49,872 triangles, one shared skin, 92 bones and 18 canonical clips. This is a restricted Flight Lab promotion after Blender still-frame review, a Three.js continuity audit and a live Lab seam scan. It does not replace the separate v1 `player-wyvern.glb` or approve game-player promotion; the gates below still apply.

## Ownership and order

| Work package | Owner boundary | Dependency | Deliverable / exit evidence |
|---|---|---|---|
| A. Reference and measurement | Blender study + evidence artifacts | None | Pin source/candidate identity, anatomical landmarks, pose correspondence, camera scale and per-clip semantics |
| B. Grounded gait | Blender rig/skin/actions | A | Source-matched walk on wing knuckles and hind feet; measured stance contacts, lift, sliding and folded membranes |
| C. Flight family | Blender actions | A; B for shared skin changes | Continuous cruise and mirrored bank pair; each other flight mode reviewed separately |
| D. One-shots and lifecycle | Blender actions | B/C | Takeoff, landing, attacks, breath and death with explicit event/contact timing |
| E. Lab qualification tools | `src/flight-lab/**` and `src/app/flight-lab/**` | A; can progress alongside B–D | Repeatable source/candidate comparison, full-clip scan and transition evidence |
| F. Candidate qualification | Evidence + lab | B–E | Every required animation and transition approved; exported file matches reviewed Blender result |
| G. Game promotion | Existing player loader/animation adapter | F | Controlled play → flight → interaction → landing → saved return-to-Roost loop, plus rollback |

Do not introduce a second animation owner or use React state per frame. Consult applicable ADRs before structural changes; keep core free of Three.js/browser state. Do not reparent the original v1 skeleton or silently substitute the 56-bone baseline for the 92-bone candidate.

## Complete animation ledger

Durations below were verified from the combined Blender import at 24 fps. Loop/one-shot is the intended qualification contract; verify runtime mapping before wiring. All unchanged clips are **unqualified**, even when an older validator passes.

| Priority | Clip | Seconds | Playback | Current status | Specific acceptance work |
|---|---|---:|---|---|---|
| P0 | `walk` | 2.4583 | loop | Repaired candidate | Four-limb gait: alternating forelimb/hindlimb support, anatomical knuckle/sole segmentation, believable weight transfer, no extra feet, no planted-foot sliding; source finger motion retained |
| P0 | `idle` | 6 | loop | Original retained | Stable support, breathing without contact drift; folded wing outline; transition into walk without a stance snap |
| P0 | `cruise` | 6 | loop, three beats | Repaired candidate | Whole skin and joint velocity through each internal reset; source stroke amplitude/recovery and no panel tears; steady body direction |
| P0 | `bankLeft` | 6 | loop, three beats | Repaired candidate | Left-turn intent and asymmetric wings; verify altered distal motion still looks authored; no doubled whole-body roll |
| P0 | `bankRight` | 6 | loop, three beats | Repaired candidate | Opposite counterpart under reflection; same phase/cadence and closure checks |
| P0 | `takeoff` | 3 | once | Original retained | Crouch/load → push-off → last contact → first airborne stroke; feet and wing knuckles release in believable order; completion enters flight |
| P0 | `land` | 3 | once | Original retained | Approach/flare → first contact → settling; no ground penetration or loop restart; completion returns to a grounded state |
| P1 | `hover` | 6 | loop | Original retained | Supported airborne posture, stronger beats, stable body/leg carriage; verify its different beat count and transition to cruise |
| P1 | `scout` | 6 | loop | Original retained | Distinct slower-flight read; neck/head activity without wing displacement; validate actual cadence instead of assuming cruise compatibility |
| P1 | `speed` | 5 | loop | Original retained | Forward posture and tucked limbs, distinct cadence; no neck compensation that fights travel direction |
| P1 | `glide` | 3.9583 | loop | Original retained | Load-bearing extended membrane with restrained motion, no unwanted flap/reset; control transitions into and out of propulsion |
| P1 | `dive` | 6 | loop | Original retained | Coherent body/neck/tail line, leg carriage and wing fold; preserve steering meaning, recover without a pose inversion |
| P1 | `rest` | 6 | loop | Original retained | Low supported stance, compact wings, quiet membrane; idle/rest transition without clipping |
| P1 | `attack` | 1.5 | once | Original retained | Readable anticipation/contact/recovery; source-appropriate support; authored strike event separated from gameplay damage ownership |
| P1 | `attack2` | 3.3333 | once | Original retained | Preserve intentional asymmetry; compare authored strike landmarks and recovery; do not mirror it simply to pass symmetry |
| P1 | `attackAir2` | 3.3333 | once | Original retained | Airborne strike, believable wing support/recovery and return to locomotion; no accidental grounded leg pose |
| P1 | `breath` | 2 | once | Original retained | Inhale/aim/emission/cutoff; jaw motion and mouth attachment; event times recorded; no indefinite repeating action |
| P1 | `death` | 4 | once, hold end | Original retained | Controlled collapse, final contact/grounding, terminal pose held; no accidental return to locomotion |

P0 defines the first dependable locomotion export. P1 clips must still be qualified before the full 18-clip asset is declared game-ready. Do not expose unfinished actions through gameplay just because their clips exist.

## Measurement contract

1. Use common units and anatomically registered body poses. Source and target import transforms differ. Do not independently rescale each pose to disguise amplitude changes.
2. Resolve bone names against the loaded rig. The 92-bone body landmark is `Body`, not `Pelvis`. Capture both shoulders/elbows/wrists/hands, representative digit tips, both feet/toes, body, head and tail tip.
3. For ground contact, define mesh contact patches from source anatomy. Dominant-weight group minima are only exploratory data. Establish floor, stance intervals and travel speed from source evidence before IK. Compare contact order, foot velocity during stance, clearance during swing, penetration and support shape.
4. Sample local AND world-space bone rotation with hemisphere-safe quaternions, plus vertex displacement. Record every internal beat reset, the last-to-first boundary, angular velocity and its changes. First/last pose equality alone is insufficient.
5. Compare membrane outline, local edge stretch, collapsed/inverted faces, intersections, seams and attachment sliding. Numerical closeness does not override visibly worse skin. Preserve exact coincident-seam behavior and intentional source folds.
6. Keep thresholds traceable: pixels from camera scale for silhouette/landmark displacement; source envelopes for stretch/contact drift; documented hardware measurements for performance. The lab's current 10-degree warning is a coarse diagnostic, not universal animation approval.
7. Prove gates with corrupted tracks/weights. Replaying the original broken cruise and the rejected hemisphere-flip walk must be red. A one-shot must not be failed merely for having different endpoint poses.

## Flight Lab work plan

### Existing, source-inspected functionality

The lab currently selects only the v2 rig, lists all 18 clip names, supports exact clip selection, one-shot playback, pause/scrub/frame stepping, loop control, orthographic cameras, skeleton/wireframe/silhouette views, floor visibility, seam scanning and PNG/JSON evidence export. These are implementation observations, not current browser test results.

### E1: Safe baseline/candidate selection

Keep the currently staged baseline unchanged. Add an explicit review candidate or a local-file import path; name and display baseline/candidate identity and SHA. Avoid hidden replacement of the only specimen. Existing tests currently assert exactly one specimen, so update those tests intentionally if adding a second. Keep default behavior stable. Load all 18 canonical names with exact-match checks; reject a candidate missing a required clip rather than silently choosing another motion.

### E2: Correct scanner and evidence semantics

`motionProbe.ts` currently samples `bone.quaternion` (local rotation) against a threshold justified with world-space repair measurements. Bring measurement and threshold into the same space, and report both local and world results explicitly. Include end-to-start closure separately from interior jumps, and distinguish looping versus one-shot clips.

Isolate the measured action from other active blends during a scan; restore time, play/pause, effective weights, loop mode and any model movement afterward, preferably in `finally`. Extend beyond angle spikes to contact/vertex displacement and angular-velocity discontinuities. Use actual GLB regression inputs and mutation tests; avoid tests that merely mirror the scan implementation.

Evidence JSON should add source/candidate hashes, all playback rates, coordinate space, sampling rate, loop/one-shot status, camera/view size, clip duration and acceptance status. Current evidence export records only basic specimen/clip/time/mode/landmarks. Verify PNG actually contains the rendered frame and downloads work in the target browser.

### E3: Paired visual review

Provide phase-synchronized baseline/candidate views with identical camera, scale and lighting, and distinguish normalized phase from real time when clips differ in duration. Show a neutral-material comparison and a textured pass. Keep full wing/body bounds visible across a whole clip. Capture 16:9 and 3:2. Source pose controls must not manipulate the other action accidentally.

### E4: Transition runner

Run deterministic sequences with explicit event times, start phases, playback rate and expected completion states. Current `play()` resets a new action before crossfading, so shared cadence alone does not preserve wingbeat phase. Add phase carry only for explicitly compatible loops and verify it in the actual renderer.

| Sequence | What to prove |
|---|---|
| idle → walk → idle | No foot teleport; smooth support handoff; final idle stable |
| idle/walk → takeoff → cruise | Ground contact release, one-shot completion, no instant flight reset |
| cruise ↔ bankLeft ↔ bankRight ↔ cruise | Common six-second/three-beat phase maintained; asymmetry and heading correct |
| cruise ↔ hover/scout/speed/glide/dive | Mode-specific posture and cadence transition; no assumption all share flight phase |
| flight → land → idle | Flare and touchdown; grounded completion; no looped landing |
| grounded attack/breath → previous ground loop | Action fires once, correct event point, recovery and restored locomotion |
| cruise → attackAir2/breath → cruise | Flight retained through action; no planted or hanging limb glitch |
| any supported state → death | Terminal end pose held; no stray action-finished restart |
| pause → step/scrub → scan → resume | Stable playback state, no teleport or scan-induced animation change |

Choose fade durations through measured pose/contact evidence, not a single assumed universal fade. Runtime pose correction must not conceal a malformed authored clip.

### E5: Qualification record

Record each clip/transition as unreviewed, failed, candidate, or accepted, with its hash and evidence links. No automatic green status from a scan with no warnings. A hash change invalidates prior acceptance for that clip/affected skin. Preserve failed studies and their reason without offering them as normal gameplay choices.

## Promotion checklist

- All required clip and transition rows accepted with source-matched Blender and Flight Lab evidence.
- Full exported file re-imported into Blender and evaluated in Three.js; exact names, expected durations, skin/bone counts and texture/material fidelity checked.
- Bind/rest transforms and normalized weights verified; no stray helper rig, camera, rejected mesh, armature or duplicate animation exported.
- Preserve source/game size and coordinate conventions. Measure model bounds through every clip; calibrate actual runtime scale and floor offset. Eight-unit lab framing does not prove gameplay scale.
- Recompress/prune only a separate accepted candidate; re-run geometry, animation, texture and runtime checks afterward. Record measured size change rather than raising budgets to hide it.
- Wire the 92-bone model through the existing player adapter. Audit v1 hardcoded bone/clip names and mouth/camera attachments. The v2 `land` clip exists, but the current v1 player lacks a dedicated landing clip; do not assume switching models automatically wires landing behavior.
- Run repository gates: `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test:fast`, `pnpm sim:wildlife`, `pnpm invariants:mutate`, `pnpm docs:check`. Report concurrent failures separately. Run donor-repo gates only if changing that repo.
- Validate actual controlled gameplay: spawn → walk → take off → cruise/bank → action → land → return-to-Roost → save/reload. Capture performance and console errors on the actual device; no FPS claim without measurement.
- Preserve the old player asset and adapter mapping for rollback; make promotion a focused, reviewable change after candidate approval.

## Immediate next work

The complete candidate is packaged and imported into Blender. Next implement E1/E2 against the current concurrent lab work, then qualify P0 walk/cruise/banks/takeoff/land. Do not start another broad rig rebuild. Do not promote the current candidate into the player while membrane fidelity, grounded contact and altered bank character remain unapproved.
