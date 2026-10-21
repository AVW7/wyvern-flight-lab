# Bank membrane correction study

7 October 2026. Blender MCP study against the preserved original V2 skeleton and bank actions. Active GLBs remain unchanged.

## Editable experiment

`V2_Bank_Corrective_Study` is a separate mesh/data copy of the authored-normal corrective membrane in `V2 Corrective Cruise Review`. Its original armature modifier and skin weights remain intact. A post-skin Corrective Smooth modifier uses factor 0.9, 20 iterations, length-weighted smoothing and pinned boundaries, followed by topology-based transfer of the source authored custom normals. These settings reuse the retained cruise study rather than introducing a new guessed quality threshold.

The copy has its factor driver removed so bank correction can be measured independently. It is hidden from render by default and is not yet animation-gated. Do not export it as an all-action replacement. Original review actions, original membrane and earlier cruise studies remain intact.

Saved editable artifact: `assets/harvest-candidates/2026-10-07/bank-corrective-study/v2-bank-corrective-study.blend`. Source SHA256: `b0667a7bf5b1484a216ed9851b26ccad3fa6d833a104beb9ed59b1898f725d3c`.

## Measurements and sensitive gate

Both bank actions are sampled at frames 0, 18, 36, 54, 72, 90, 108 and 126. `bank-corrective-surfaces.json` retains the exact baseline and candidate deformed vertex positions and triangle indices. `audit_bank_corrective_surfaces.mjs` measures triangle-normal crease angles through the existing `measureCreases` implementation.

All 16 samples reduce the p95 crease angle by 15.640–22.144 percent against their exact original pose. The worst baseline p95 is 39.062 degrees; its correction is 32.159 degrees. No sampled candidate has a degenerate triangle. All 356 duplicated-position membrane groups remain coincident, with maximum gap zero. Maximum displacement from original is 144.956 source rig units, recorded as magnitude rather than a quality bound.

The gate requires a strictly lower p95 than each measured original pose and no additional degenerate triangles. It imposes no arbitrary angle target. Substituting the uncorrected baseline through the `uncorrected` argument rejects all 16 samples; the actual corrected surfaces pass. This proves sensitivity to a correction that does nothing, but does not prove broad visual quality.

Reports: `bank-crease-report.json` and `bank-corrective-summary.json` in the study folder.

## Visible evidence and limits

Blender MCP captured matched baseline/corrective renders for both banks at frames 18 and 54 in 16:9 and 3:2. Both contact sheets were inspected: `bank-corrective-contact-16x9.png` and `bank-corrective-contact-3x2.png`. The smoothing is subtle at whole-body scale, preserves the turning silhouette, and does not resolve the pronounced inner folds. The common front camera uses ortho scale 10000, location `(0,-4200,2300)`, aimed at `(0,100,1000)`. Sixteen Cycles samples and the existing clay lighting/materials are used.

This is an authoring experiment on the original bank actions, not the separately harvested bank candidate. It has no runtime morph bake, held-out/interpolation verification, transition checks or promotion. Ground actions have not been corrected by this study. Next refine the local inner folds, compare the harvested bank motion, then gate any retained correction to the qualified clips before export. Keep bone motion, bank direction and ground contact separate from this surface metric.
