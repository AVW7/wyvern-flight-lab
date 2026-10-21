# Corrective round trip and subframe audit, 7 October 2026

The previous candidate's integer-frame checks are insufficient for runtime acceptance. Blender MCP round-trip renders retain the visible correction, but halfway-frame runtime comparison fails the same position and normal tolerances. No active asset was changed.

## Rendered evidence

Candidate SHA256: `3c63a3c648d43efacd5e6f2ad8c1e394f9312bb22d6a76dbf46458a27c8485e1`. The candidate was losslessly decoded for Blender import. An isolated scene imported 130 shape targets and all 18 animation actions. Both the armature and shape-key action slots were selected explicitly; imported NLA blending was disabled for the matched cruise review.

Artifacts under `assets/harvest-candidates/2026-10-07/runtime-corrective/`:

- `v2-runtime-morph-roundtrip.blend`: editable saved copy retaining the original authoring scenes and isolated GLB import.
- `evidence-roundtrip/comparison-3x2.jpg` and `comparison-16x9.jpg`: original, Blender correction, and GLB round trip at frames 0, 18, 36, 54, 72, 90, 108 and 126.
- `evidence-roundtrip/macro-roundtrip-36.png`: scale 4200, 900 × 600, camera target (1696.2932, 12.8656, 2122.8188), matching the preceding study.

Both contact sheets and the full macro were visually inspected. The imported correction retains the wing-tip silhouette and the softened panel surfaces. The macro closely matches the authoring correction. Folds along the inner wing remain visible; this is not a complete anatomy or membrane-design acceptance. Clay materials, lighting and camera match the prior review. Blender's imported shape geometry does not prove reproduction of glTF normal morphs in the Three.js shader; runtime normals are measured separately.

## Subframe failure

`sample_corrective_subframes_mcp.py` evaluates the actual gated Blender correction at 144 halfway-frame positions (0.5 through 143.5, 24 fps). It writes fresh position/normal references without changing mesh data or actions.

`audit_corrective_runtime.mjs ... subframes` loads the exact candidate through Three.js GLTFLoader and AnimationMixer. Both the integer and subframe modes now exit nonzero on a tolerance failure, after writing the measured evidence.

| Measurement | Observed | Existing bound | Result |
| --- | ---: | ---: | --- |
| Maximum position error | 3.836198 rig units | 2.333333, half macro pixel | Fail |
| Mean position error | 0.012500 rig units | descriptive only | — |
| Maximum normalized normal component error | 1.624435 | 1/127 source normal quantum | Fail |
| Position samples exceeding bound | 7 / 144 | zero | Fail |
| Normal samples exceeding bound | 142 / 144 | zero | Fail |
| Largest number of failing normal vertices per sample | 286 / 8249 | descriptive only | — |
| Non-cruise weight resets | 17 / 17 | all | Pass |

The worst position sample is frame 132.5. The worst normal sample is frame 62.5, with 45 failing vertices. These are measured interpolation failures, not source/rig preservation failures. A 24 fps corrective weight bake cannot yet reproduce the continuously evaluated Blender correction within the existing bounds. No tolerance was relaxed.

`runtime-subframe-audit.json` includes per-sample position maxima, normal maxima and failing-normal-vertex counts. Integer-frame evidence in `runtime-position-audit.json` remains valid at its stated sampling scope.

## Next work

Measure the nonlinear correction more densely or adaptively and qualify held-out samples again. Investigate the local normal discontinuities rather than assuming a higher target count will solve them. Then inspect transitions with folded ground poses and reduce file/GPU costs. The original goal still includes bank/ground animation and design qualification recorded in the earlier harvesting audit.
