# Corrective compression and GPU evidence, 7 October 2026

The qualified cruise correction now has a smaller candidate that preserves its measured position tolerance and the original authored normals. Its added GPU morph storage is reduced by removing unused normal morph attributes. Active assets and their budgets remain unchanged.

## Current candidate

`assets/harvest-candidates/2026-10-07/runtime-authored-normals-096/wyvern-v2-position-only-exp14-candidate.glb`

- SHA256: `9a6f6b965f336291681e4170726903ceefd9d1575de59da0836bb8c9f2832be2`.
- Size: 6,480,212 bytes, down from the preceding 10,880,152-byte lossless candidate (40.4% reduction).
- 52 position targets, no normal morph attributes; 577 weight keys at 96 samples/second.
- Source data, skeleton, skin weights, materials, textures and original bone channels remain identical.
- All 576 held-out runtime-pose samples pass: maximum position error 2.201067 rig units against the unchanged 2.333333 bound. Mean error 0.178306 units.
- Original shader normals remain exactly unchanged; all 17 non-cruise actions reset correction weights.

The new position fields use the meshopt EXPONENTIAL filter with 14-bit mantissa precision and shared component exponents. Animation times and coefficients remain lossless. New position accessor bounds are recomputed from decoded values. A 12-bit trial failed the same held-out position test (maximum 3.134469 units); it is rejected. Precision was chosen from measured outcomes, not by relaxing the final tolerance.

`runtime-authored-normals-096-heldout/runtime-pose-exp14-audit.json` pins this candidate's evidence. The preceding lossless candidate retains its own `runtime-pose-lossless-audit.json`; its historical report was not relabelled as the optimized candidate.

## Removing unused GPU data

The current Three.js GLTFLoader requires consistent semantics across a morph bank. Mixed position/normal banks still supply explicit zero deltas for unused semantics. A uniformly position-only bank needs no normal target accessors, so packaging now omits them. The verifier enforces the same semantic set on every target and still rejects missing zero semantics in mixed banks.

The measurement/test was red before this change. A corruption test also proves that altered original geometry bytes are rejected. Six focused packaging checks pass.

At the measured maximum texture width of 16,384, Three.js `WebGLMorphtargets.js` allocates:

- Previous position-plus-zero-normal layout: width 16,384 × height 2 × 4 float components × 4 bytes × 52 targets = 27,262,976 bytes.
- Position-only layout: width 8,249 × height 1 × 4 float components × 4 bytes × 52 targets = 6,863,168 bytes.

That is a 74.8% reduction in this morph texture allocation, including the previous row padding. This is the allocation formula for the installed renderer and measured texture limit, not total application/GPU memory.

## Actual WebGL measurements

A temporary, localhost-only preview loaded the source and optimized GLBs using the installed Three.js GLTFLoader and actual source materials. It used 60 warmup and 240 measured animation frames per model, with disjoint timer queries for GPU render cost. Models were disposed between runs. No Next.js development server was started.

Hardware: ANGLE Metal Renderer, Apple M3. Pixel ratio 1. Actual drawing viewports were 1778 × 1000 (16:9) and 1333 × 889 (3:2); the app's viewport override produced these dimensions, which are recorded in the reports.

| Run | Original GPU p95 | Corrected GPU p95 | Corrected CPU render p95 |
| --- | ---: | ---: | ---: |
| 16:9, original first | 3.466 ms | 1.855 ms | 0.300 ms |
| 3:2, corrected first | 2.808 ms | 2.712 ms | 0.300 ms |
| 3:2, original first | 3.629 ms | 2.359 ms | 0.400 ms |

Both models rendered 49,872 triangles in three draw calls. Candidate GPU cost stayed below 2.8 ms at p95 in these isolated tests. The reversed-order run provides a check on warmup/order effects; these numbers are not evidence that correction makes the game faster. They do not include the full game scene, physics, other actors, high pixel ratios or blended transitions.

Reports: `gpu-performance-16x9-report.json`, `gpu-performance-3x2-reversed-report.json`, `gpu-performance-3x2-report.json`. Source/candidate hashes are recorded alongside the measurements. A preliminary narrow-panel report is retained separately and is not used for the full-size claim.

`webgl-preview-16x9.png` and `webgl-preview-3x2.png` show the actual optimized candidate with original textures. Both were inspected: wing/body silhouette and texture identity remain readable, while inner creases remain visible. The temporary browser tab was closed, viewport override reset and localhost server stopped after capture.

## Blender deliverable and remaining work

The optimized GLB was decoded and imported through Blender MCP into `V2 Optimized 14-bit Review`, with 52 shape targets and cruise action/shape-key slots selected together. The saved editable copy is `v2-optimized-position-only-study.blend` in the candidate folder. Earlier authoring scenes and candidates remain preserved.

The candidate is still 478,888 bytes above the unchanged active V2 exception of 6,001,324 bytes. No budget or active model was changed by this study. Blended transitions, bank/body/ground harvesting and complete rig/design qualification remain before promotion.

## Repository verification

Typecheck and lint pass. All 854 fast tests and 129 invariant corruption checks pass. All 16 wildlife simulation routines pass, and documentation metrics are synchronized. The active V2 source hash is unchanged.
