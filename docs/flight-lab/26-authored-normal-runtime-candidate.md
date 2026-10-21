# Authored-normal runtime candidate, 7 October 2026

The retained 90% membrane correction now passes a dense, held-out runtime position check while preserving the source's authored normals. This is a cruise correction candidate, not full V2 or gameplay promotion.

## Design decision

The area-weighted 48 fps experiment still failed interpolation, despite finite Blender normals: position maximum 2.790178 rig units and normal component maximum 1.358339. Increasing sampling alone did not qualify that normal treatment.

The original imported mesh already contains authored custom normals. They remain smooth through the measured fold, unlike normals recalculated after corrective smoothing. A separate `V2_AuthoredNormal_Corrective_Membrane` study transfers those original evaluated custom normals by topology after the correction. This retains the source's lighting direction while improving the membrane surface. It is an explicit shading choice, not a claim to reproduce area-weighted geometric normals. The runtime retains the original NORMAL accessor and adds only zero normal deltas; the unstable normal morph bank is removed.

Matched Blender contact sheets in `runtime-authored-normals-090/evidence/` were inspected at 16:9 and 3:2. Wing silhouettes remain intact, broad panels are softer than the baseline, and the original lighting direction remains readable. Inner creases still exist. The scope of this review is cruise surface shape and source shading continuity.

## Runtime-pose reference and sampling

`export_runtime_pose_samples.mjs` captures the source Three.js bone world transforms, rest matrices and every baseline membrane vertex. `sample_runtime_pose_correction_mcp.py` places the Blender rig at those exact transforms through local pose conversion, evaluates the correction, and restores its action afterward. It does not modify action data. The uncorrected Blender mesh must match the runtime baseline within a float32 arithmetic bound before accepting each reference.

This removes engine rotation-interpolation differences from the reference. It did not cure the 48 fps candidate's position failure: maximum error remained about 2.654 units. The new 96 fps bake addresses the remaining interpolation error without changing the final tolerance.

- Training: 577 poses over six seconds, at 96 samples/second.
- Held out: 576 halfway samples at different times, generated separately in `runtime-authored-normals-096-heldout/`.
- Baseline full-mesh correspondence maximum: 0.004369 rig units.
- Basis fit allowance: 1.166667 units, half the final runtime allowance, leaving the remainder for interpolation.
- Final bound remains 2.333333 units, half a pixel at the inspected 4200-unit, 900-pixel macro camera.
- 52 position bases; zero normal bases. Coefficients retain exact loop closure and [-1, 1] scaling.

## Candidate and actual results

Folder: `assets/harvest-candidates/2026-10-07/runtime-authored-normals-096/`.

Source SHA256: `b0667a7bf5b1484a216ed9851b26ccad3fa6d833a104beb9ed59b1898f725d3c`.

Candidate: `wyvern-v2-authored-096-lossless-candidate.glb`, SHA256 `0f4d3115c6b8215e3c687b7cd534082762b79383cff012895e817e93f130078b`, 10,880,152 bytes. The uncompressed candidate is 11,499,296 bytes. Lossless meshopt compression decodes and byte-compares every appended accessor; original binary data and metadata remain preserved.

| Held-out measurement | Result |
| --- | ---: |
| Samples × vertices | 576 × 8,249 |
| Maximum posed position error | 1.885412 rig units, pass |
| Mean posed position error | 0.002657 rig units |
| Authored shader normal change | exactly zero |
| Non-cruise morph resets | 17 / 17, pass |

Normal preservation is checked against the unchanged source shader normal at the same bone pose. It is not a comparison to the rejected area-weighted Blender normal field. Every normal morph attribute must be zero, and original geometry normals/bone animation data must remain identical. `runtime-authored-normals-096-heldout/runtime-pose-lossless-audit.json` records the actual GLTFLoader/AnimationMixer results.

## Round trip and deliverables

The exact lossless candidate was decoded for import and loaded into the isolated Blender scene `V2 Authored Normal Runtime 096`, with 52 shape targets and all 18 action tracks. Armature and shape-key cruise slots were selected together; NLA blending was disabled for the matched review.

- `v2-authored-normal-runtime-study.blend`: saved editable copy containing both authoring and imported runtime review scenes.
- `evidence-roundtrip/comparison-3x2.jpg` and `comparison-16x9.jpg`: matched eight-phase authoring/GLB contact sheets, both visually inspected.

The exported geometry retains the authored correction and wing-tip outline in these captures. Blender importer/rendered normal handling is separate from the proven unchanged Three.js shader normal data. No actual GPU performance or blended-motion acceptance is inferred from these contact sheets.

## Remaining original scope

The candidate is still above the unchanged active asset budget. GPU costs, cruise-to-ground/bank transitions, independent bank/ground/body harvesting, anatomy/intersection review and full clip design qualification remain. Active V2 and player GLBs were not replaced. Next: optimize this qualified cruise candidate, test transitions and reconcile it with harvested bank/body performance before promotion.

## Repository verification

Typecheck and lint pass; all 853 fast tests and 129 corruption checks pass. All 16 wildlife simulation routines pass. Documentation metrics are synchronized. Five focused corrective packaging tests include geometry-only authored-normal preservation. No development server was started.
