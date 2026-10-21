# V2 shared skin repair

2026-09-30. Scope: `public/models/wyvern-v2-rig.glb` only; V1/player model remains untouched.

The incoming Flight Lab asset had two skins referencing the same ordered 92 joints. The body and membrane inverse bind matrices differed by a uniform scale of 1.4321229833 and a small translation. The older one-skin handoff therefore did not describe this incoming package. Deleting the second skin without normalizing its geometry would deform the membrane incorrectly.

`tools/blender/deduplicate_v2_skins.mjs` verifies that the matrix relationship holds across all 92 joints, bakes the membrane positions into the body bind space, and points both mesh nodes at skin 0. It refuses nonuniform corrections, different joint lists, sparse data, and morph targets. Matrix equivalence is bounded by 32 float32 epsilons relative to measured matrix magnitude, reflecting the exported float32 data. Positive uniform scale leaves normal and tangent directions unchanged. The compactor then removes unused accessors/views. Exported bone names, hierarchy, weights, clips, materials, and textures are preserved.

| Evidence | Result |
| --- | --- |
| Incoming skin regression check | Failed: 2 skins instead of 1 |
| Repaired skin | 1 skin, 92 joints; body and membrane both reference skin 0 |
| Three.js deformation comparison | All 18 clips, 9 times per clip, both meshes; 5,309,874 vertex comparisons |
| Maximum world-space position change | 0.0003049673 rig units, about 0.0022 mm at the documented 0.0072 fit |
| Comparison float32 bound | 0.014892535 rig units: 32 float32 epsilons times maximum sampled position magnitude |
| Geometry budget | 49,872 triangles unchanged; 5,922,048 bytes after compaction |
| Duplicate-skin mutant | Rejected by the same validator used by the regression test and mutation suite |

The byte ceiling records the measured 60,768-byte increase over the previous ledger ceiling. Float32 membrane positions preserve the normalization without another lossy quantization pass. Ground-fold and takeoff packagers now require one skin.

This is structural and headless deformation evidence. No browser playback, visual idle approval, or gameplay promotion is claimed.
