# Area-weighted membrane normal study, 7 October 2026

Blender MCP traced the largest halfway-frame normal mismatch to vertex 2942. Two tiny incident triangles reverse direction during the folded pose, dominating the angle-based smooth normal. Face-area weighting stabilizes the lighting direction there without changing geometry, skeleton or skin weights.

In the full-strength study, the maximum normal jump between quarter-frame samples 62 through 63 fell from 113.358 degrees to 0.646 degrees. `normal-diagnosis.json` records the exact vectors. This local result does not qualify the entire membrane.

A separate copy, `V2_AreaWeighted_Corrective_Membrane`, carries a Weighted Normal modifier after the armature and corrective smoothing. It has its own mesh data; the earlier study remains available. A 48 fps, 289-frame experimental bake was packaged as `wyvern-v2-area-weighted-48fps-candidate.glb` (SHA256 `f2a5f5116ce59c5385880f296579ed17d3a82df946e0efa84d1b5562d32d1ce6`, 21,379,112 bytes). All sampled positions and normals pass, but held-out evaluation reveals an undefined Blender corner normal at vertex 4601, frame 46.75, repeated at 94.75 and 142.75. That full-strength package remains rejected for playback.

## Retained Blender study

`assets/harvest-candidates/2026-10-07/runtime-area-weighted/v2-area-weighted-090-study.blend` retains a 90% correction with face-area normals. It is the largest tested setting with no undefined corner normals at all 288 held-out samples. At full strength there are three failures; 90% and 80% both have none. `strength-qualification.json` records these measurements. This establishes sampled finite normals, not interpolation parity or complete absence of geometric folds.

`prepare_area_weighted_mcp.py` derives the setting from that measurement, retains the rig property gate, and disables the normal modifier whenever the correction property is zero. The strength is not a new arbitrary acceptance threshold. `measure_area_normal_strength_mcp.py` repeats the scan and asserts that the full-strength corruption turns red.

`ground-gate-090.json` checks a midpoint in all 17 non-cruise review actions: vertex drift is exactly zero and the normal modifier is disabled in every case. These checks do not cover crossfade motion.

Matched clay contact sheets in `evidence-090/comparison-3x2.jpg` and `comparison-16x9.jpg` compare the prior correction with the 90% face-area study across eight cruise phases. Both were inspected: the outer wing silhouette is retained and the broad panel surfaces remain readable. Inner folded creases persist. These screenshots are Blender authoring evidence; they are not runtime acceptance.

## Tool changes and remaining work

The bake and fit tools now accept an isolated bake directory and sampling frequency instead of requiring 145 samples at 24 fps. The baker can read evaluated corner normals, requires consistent normals for each retained vertex, and rejects undefined normals before normalization. The subframe sampler applies the same checks. Defaults retain the original workflow; every MCP call must pass its configuration explicitly because execution namespaces are fresh.

The retained 90% study still needs a new bake, held-out runtime comparisons, exact GLB renders, folded transitions and file/GPU optimization. The experimental 48 fps full-strength package is too large for the active budget, which was not changed. Active player and V2 GLBs remain untouched.
