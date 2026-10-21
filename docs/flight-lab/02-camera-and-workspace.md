# 02. Camera and inspection workspace

Status: proposed. Priority: P1. Depends on: 01 state contract.

## Problem and evidence

`camera.ts` uses fixed preset distances and fixed zoom limits across differently sized specimens. The lab normalizes specimens using `targetSize`, so its displayed dimensions describe a presentation transform rather than necessarily calibrated game scale. Ground placement uses a fixed Y offset. The current UI already has responsive CSS and diagnostic buttons; inspect these in-browser before changing layout.

## Implementation checklist

- [ ] Fit the specimen using its transformed bounds, perspective FOV and viewport aspect ratio. Keep padding for wing extension; use sampled animation bounds or a conservative cached envelope rather than expensive per-frame full bounds scans.
- [ ] Fit on load and explicit Fit selection. Preserve user orbit/pan during playback; resize should prevent clipping without continuously overriding user input.
- [ ] Keep chase/profile/front/top presets, but derive their target and distance from the specimen. Ground inspection places the lowest bound on the reference plane.
- [ ] Add a clear normalized-size versus calibrated-scale label. Do not imply that lab presentation units establish asset calibration.
- [ ] Keep the viewport central. Make specimen selection and advanced diagnostics collapsible on small screens; keep playback and Fit immediately reachable.
- [ ] Provide keyboard alternatives for camera operations, visible focus, accessible toggle states, and touch-friendly controls. Resolve wheel/scroll behavior deliberately within the viewport.
- [ ] Respect reduced motion for automatic orbit and decorative flow. Manual animation playback remains explicit user control.
- [ ] Make loading, missing assets, static specimens and empty search states readable with a retry or recovery action where appropriate.

## Likely files

`src/flight-lab/camera.ts`, `runtime.ts`, `environment.ts`; `src/app/flight-lab/FlightLabClient.module.css`, `components/StageViewport.tsx`, `components/SpecimenSidebar.tsx`, `components/FlightControls.tsx`.

## Acceptance and verification

- At 1440×900, 1024×768 and 390×844, all four presets show the full representative specimen with readable controls and no horizontal page overflow.
- At sampled wing extremes, the body and wingtips fit after Fit; camera gestures remain stable after switching specimens and resizing.
- Ground and egg inspection sit correctly against the reference plane without obvious sinking or floating.
- Complete specimen selection, playback, diagnostics and camera reset using keyboard only. Verify touch scrolling and viewport gestures separately.
- Capture matching dark/light screenshots. Preserve existing typography and restrained palette; record observed defects before making visual changes.

Out of scope: adding post-processing effects or importing a new UI library.
