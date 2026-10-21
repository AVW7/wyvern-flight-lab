# Flight Lab improvement plan

Date: 13 September 2026. Status: proposed; documentation only.

## Outcome and scope

Make `/flight-lab` a dependable workspace for identifying, reproducing and recording v2 animation defects. A reviewer should be able to select an exact clip, inspect a problem pose, compare it with Blender evidence, and export enough information to reproduce the result.

This is the current implementation order for the lab. Plans 01–05 remain supporting design references; their original multi-specimen baseline is historical. [08](08-animation-and-flight-lab-delivery-plan.md) continues to govern animation qualification and game promotion. [NEXT_SESSION](NEXT_SESSION.md) and [07](07-v2-blender-motion-handoff.md) retain Blender continuation context.

Keep the monochrome black, white, grey and transparent interface, with the wyvern as the main visual focus. Preserve the single v2 catalogue entry. Asset authoring, replacing the player GLB, restoring the old creature catalogue and interactive flight gameplay are outside this plan.

## Verified source baseline

Reviewed `src/flight-lab/`, the route client and components, `test/flight-lab.test.js`, and existing handoffs. These are source observations, not browser or asset-quality approval.

| Existing behavior | Improvement needed |
| --- | --- |
| Catalogue has one v2 specimen and declares 18 canonical clip names | Display loaded asset identity and actual clip availability; declarations alone cannot establish export contents |
| Playback, scrubbing, stepping, looping and one-shots already exist | Reconcile runtime state with control state; frame stepping pauses the runtime while the React paused flag is independently maintained |
| Mode keys include `2` and `3`; one-shot metadata also assigns those keys | Remove shortcut collisions; the current handler checks modes first |
| `motionProbe.ts` samples local bone rotations at quarter-frame intervals, defaulting to 24 fps | Explicitly test the last-to-first seam, isolate sampling from live blends, and make scan assumptions visible |
| Frame stepping uses a 1/60-second inspection interval | Distinguish inspection sample rate from Blender's authored frame rate |
| Camera controller stores orthographic zoom; runtime resize resets the frustum to ±12 | Preserve zoom on resize and provide reproducible camera state |
| Export creates PNG and JSON with specimen, clip, time, mode and landmarks | Add asset fingerprint, camera, transforms, playback and capture settings; use one capture identity |
| Telemetry speed and altitude are constants chosen by mode | Label these as illustrative or remove them from inspection; reserve measured labels for real observations |
| Tests include synthetic mixer playback and injected jump coverage | Extend these to real runtime integration, scan restoration and browser controls |

## Delivery order

### 1. Trustworthy playback and controls (P0)

Primary files: `src/flight-lab/runtime.ts`, `playback.ts`, `types.ts`, `src/app/flight-lab/FlightLabClient.tsx`, and `components/FlightControls.tsx`.

- Reproduce step → resume, scrub while playing, one-shot interruption, death completion and non-loop endpoint behavior before fixes. Add failing regression coverage for observed defects.
- Publish a discrete runtime playback snapshot covering active clip, playing/paused/completed state, loop policy, mode and effective rate. Let controls reflect acknowledged runtime state instead of optimistic independent flags. Keep sampled telemetry outside the animation callback.
- Choose one shortcut mapping shared by labels and keyboard dispatch. Ignore editing targets and do not steal native control keys when a control has focus.
- Resolve capabilities from loaded clips. Distinguish exact mode mappings, fallback clips and unavailable actions; disable controls during loading, failure and scans when they cannot execute safely.
- Add an explicit inspection frame-rate setting with seconds always visible. Default from verified authoring metadata where available; otherwise label the rate as an inspection setting. GLB duration does not establish an authored fps.

Exit evidence: button labels and runtime agree after stepping and completion; one resume command restarts playback; exact endpoints remain seekable; each shortcut performs one advertised action; missing clips and load retry produce clear states.

### 2. Reliable motion diagnostics (P0, after 1)

Primary files: `src/flight-lab/motionProbe.ts`, `runtime.ts`, `types.ts`, and the stage/log components.

- Separate internal discontinuities from the explicit end-to-start loop comparison. Mark loop tests not applicable for one-shots unless requested.
- Sample an isolated evaluation instance or fully preserve and restore mixer/action state, including active blends, weights, rates and paused state. Prove that scanning cannot alter the inspected pose or trigger completion side effects.
- Return structured results with bone, time, frame convention, metric, measured value, threshold and threshold source. Provide a results list with jump-to-time and bone highlighting rather than only the eight largest log messages.
- Retain the existing 10° rotation threshold only with its documented cruise-repair provenance. Do not interpret it as universal animation quality. Add translation, root drift and contact-slip measures only after pinning model units, reference contacts and measured tolerances.
- Cache landmark bindings per loaded rig, report missing landmarks explicitly, and document whether coordinates are model-local or world-space.
- Measure scan duration on the actual device before choosing cancellation/chunking budgets. Provide progress and prevent results from a previous asset or clip being applied to the current selection.

Exit evidence: clean motion stays clear; injected internal jump and loop-boundary jump are independently detected; interrupted scans restore state; intentional one-shot movement is not labelled a failed loop. A passing scan never automatically approves membrane deformation or artistic quality.

### 3. Repeatable cameras and a focused workspace (P1, after 1)

Primary files: `src/flight-lab/camera.ts`, `environment.ts`, `runtime.ts`, route CSS and stage/control components.

- Give the camera controller ownership of resize projection updates so orthographic zoom survives viewport changes. Expose serializable position, target, projection and scale.
- Verify front, side and top directions against model axes and Blender reference views. Fit to measured bounds with a documented margin; allow manual framing and restore it accurately.
- Separate an unmodified authored-pose inspection view from the lab's presentation movement. Record root normalization, heading, scale and floor transform so comparisons do not hide motion defects.
- Put clip selection, timeline, pause and stepping next to the viewport. Collapse secondary diagnostics and the single-specimen metadata panel; avoid allocating a permanent search sidebar to one result.
- Add selectable landmark groups and compact scan results. Keep essential controls visible at 16:9 and 3:2, with keyboard focus, accessible names, and narrow-screen stacking.

Exit evidence: matched Blender and browser poses use documented cameras; resize preserves framing; reset updates both camera and displayed preset; screenshots at both aspect ratios show the entire inspected region and usable controls.

### 4. Reproducible evidence and candidate comparison (P1, after 2–3)

Primary files: `src/flight-lab/runtime.ts`, `types.ts`, camera/probe helpers and route components. Introduce a lab-local evidence module only if it owns capture/serialization as a complete responsibility.

- Export a versioned record with one capture ID shared by image and metadata: loaded asset filename and SHA-256, clip identity and duration, exact time, inspection fps, playback state, mode, camera, model/floor transforms, viewport pixels, pixel ratio, overlays, landmarks and full scan results with provenance.
- Freeze a coherent pose and explicitly render it before capture. Handle failed capture/download visibly and restore playback afterward. Do not claim that the DOM overlays are present in a canvas-only PNG.
- Support restoring the record after validating its schema and asset fingerprint. Reject or visibly flag a mismatched asset rather than silently replaying against different geometry.
- Add a lab-only reference/candidate slot for explicitly selected exports. Start with sequential A/B using locked camera, lighting, transforms and clip phase. Keep independent mixers and clear resource ownership; simultaneous rendering is optional after memory measurement.
- Produce full-cycle pose sheets and transition evidence for the animation ledger in plan 08. Preserve each asset's raw timing and identify normalized-phase comparison explicitly.

Exit evidence: a captured pose can be restored from its record; PNG and JSON identify the same state; mismatched files are flagged; switching candidates releases owned resources and leaves the player asset untouched.

## Implementation constraints

Read the relevant installed Next.js guides before route changes, plus `CONTEXT.md`, applicable ADRs and `docs/LESSONS_LEARNED.md`. Keep animation/rendering/disposal in the lab runtime and controls in React. Preserve the Sanctuary Studio seam and ported wyvern modules. Keep `src/core/**` browser-independent. Do not create another gameplay controller inside the lab.

Before each change, inspect the working tree and reproduce the issue with a measurement or failing test. At plan creation, `public/models/player-wyvern.glb` and `tools/asset-budget.json` are modified and a Sanctuary animation handoff is untracked; preserve those changes. Existing candidate paths and hashes in older documents must be rechecked before use.

## Verification and completion

Deliver each numbered phase separately, starting with phase 1. Test the actual runtime/control boundary where applicable; helper-only tests cannot prove that the controls are wired correctly.

- Focused checks: `node --import tsx --test test/flight-lab.test.js` plus new lab regression files. Add mutants for new enforced invariants and verify they fail.
- Repository gates for implementation: `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test:fast`, `pnpm sim:wildlife`, `pnpm invariants:mutate`, and `pnpm docs:check`. Record pre-existing failures separately. Refresh generated documentation with `pnpm docs` only when needed.
- Browser matrix: idle, walk, cruise, both banks, takeoff, land, an attack and death; all 18 loaded clips for availability and smoke playback. Exercise loading failure/retry, pause/seek/step/resume, rate changes, interruptions, resize, scan and export.
- Capture and inspect 16:9 and 3:2 evidence on a persistent server. Record browser/device, exact asset hash, viewport and console errors. Measure frame timing and scan duration against the same baseline/device before setting budgets.
- Store a phase completion record beside this plan with failing baseline, final measurements, screenshots, test outcomes and unresolved limitations. Plans and static checks remain separate from visual qualification and game-promotion approval.

First implementation slice: reproduce the step → resume state mismatch and keyboard collisions, establish the shared playback/control contract, and verify that slice in the browser before adding diagnostic features.
