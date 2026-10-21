# 01. Playback and state reliability

Status: complete. Priority: P0. Dependencies: none.

## Problem and evidence

`runtime.ts` applies `speedScale` both to animation actions and to `mixer.update(delta * speedScale)`, making the selected rate compound. `play()` returns early for an already-active action, so changing cruise to boost can skip its new action rate. One-shot completion uses a time threshold, and timeline display uses modulo even at a non-looping endpoint. Frame stepping currently scales the step by playback speed.

`FlightLabClient.tsx` maintains selected clip state separately from runtime telemetry. Numeric keyboard shortcuts bypass the egg restriction applied to mode buttons. Loading clears clip lists but does not immediately clear metrics and all playback readouts. These source paths need behavioral regression coverage.

## Implementation checklist

- [x] Define a small authoritative playback state: load status, specimen, mode, resolved clip, playback status, loop policy, clip time and effective rate. Runtime events reconcile the controls after every accepted command.
- [x] Apply playback rate once. Define boost's multiplier separately and update it even when the clip is unchanged.
- [x] Use mixer completion events with active-action identity checks. Specify interrupt behavior: a new mode or manual clip cancels a pending one-shot return; reactions return to the current mode; Death holds its final pose until reset or another explicit selection.
- [x] Define pause as freezing clip and specimen motion, including procedural bank/pitch settling and trails. Camera inspection remains available.
- [x] Define one frame step as 1/60 second of clip time, independent of playback rate; label this inspection sampling interval, not the source animation FPS. Stepping pauses playback. Clamp non-looping endpoints and use consistent wrapping for loops.
- [x] Preserve the end time at 100% for completed non-looping clips. Seeking must evaluate the requested pose while paused, including after a completed action.
- [x] Route buttons and shortcuts through the same capability checks. Ignore shortcuts in editable content and avoid overriding focused control behavior.
- [x] Clear stale metrics, clip selection, errors and telemetry on specimen changes. Keep existing cancellation protection and test rapid changes, failed loads, retries and disposal during loading.
- [x] Sample telemetry outside the render callback. Keep immediate discrete events for loading, clip changes, completion and errors.

## Likely files

`src/flight-lab/runtime.ts`, `types.ts`, `clipResolver.ts`; `src/app/flight-lab/FlightLabClient.tsx`, `components/FlightControls.tsx`; `test/flight-lab.test.js`. Introduce a local playback helper only where it creates a testable ownership boundary.

## Acceptance and verification

- At 0.5x, 1x and 2x, a synthetic clip advances by the expected amount for a known simulated elapsed time. Cruise-to-boost updates the rate without changing clips.
- One-shots complete once, rapid interruptions cannot resurrect old actions, and Death remains held.
- Paused forward/back stepping and endpoint seeking produce the expected time and visible pose; React selection matches the actual active clip after modes and one-shots.
- Eggs reject unsupported commands through both keyboard and pointer. Rapid A/B/A loads show only A's final data; a failed load offers a working retry.
- Browser evidence covers seek, pause, restart, non-looping completion, specimen switching, and route exit/re-entry without duplicate canvases or listeners.

Out of scope: new flight physics, new assets, workspace redesign.
