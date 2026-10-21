# 04. Reproducible comparison and reports

Status: proposed. Priority: P2. Depends on: 02 and 03.

## Outcome

Save an inspection, reproduce its pose and camera, compare two specimens fairly, and export the evidence needed to work on a defect.

## Implementation checklist

- [ ] Define a versioned inspection preset containing specimen ID, available asset revision, mode, resolved clip, clip time, rate, loop setting, camera pose, theme, scale mode and diagnostic toggles.
- [ ] Validate imported presets and handle missing specimens/clips explicitly. Permit known catalogue IDs only; do not load arbitrary remote model URLs from a shared preset.
- [ ] Add local save/load, JSON download and a recoverable copy failure state. Keep storage bounded and tolerate unavailable browser storage.
- [ ] Start with sequential A/B comparison using saved views and matched normalized clip phase. Provide normalized-size and calibrated-scale comparison only when calibration exists, with clear labels.
- [ ] Add optional side-by-side rendering only after profiling. Prefer one renderer with split viewports and independent specimen ownership; avoid doubling canvas contexts casually.
- [ ] Export a report with preset, asset identity, capability resolution, mesh metrics, diagnostics, browser/viewport metadata and the bounded event log.
- [ ] Capture PNG evidence at the selected pose through an explicit render/capture operation. Do not enable permanent drawing-buffer preservation merely for screenshots.
- [ ] Seed decorative environment randomness for reproducible captures. Record observations and thresholds separately from pass/fail judgments.

## Likely files

New lab-local preset/report helpers in `src/flight-lab/`; `types.ts`, `runtime.ts`, `camera.ts`, `environment.ts`; `FlightLabClient.tsx`, `components/AnimationLogConsole.tsx`.

## Acceptance and verification

- Export/import restores the same specimen, clip time, view and overlays within documented numeric tolerances.
- Invalid versions, removed clips and unavailable storage produce a recovery message without corrupting the active inspection.
- A/B views use the same chosen scale policy, camera framing policy and animation phase; differing clip durations are handled explicitly.
- Downloaded PNG and JSON open correctly and identify the inspected asset. Capture success does not automatically mark an asset approved.
- Compare performance with the single-specimen baseline before enabling split view by default.

Out of scope: cloud accounts, collaboration backend, video encoding and automatic publication.
