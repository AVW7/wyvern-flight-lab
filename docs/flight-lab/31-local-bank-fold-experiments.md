# Local bank fold experiments

7 October 2026. Blender MCP experiments on the exact harvested bank study. No active asset change or qualified replacement results from this work.

## Measured defect

At bankLeft frame 18, the retained bank correction still has a high-area crease on edge vertices 3381/3390: 171.519 degrees and area-weighted score 277270.379. Neighboring root-region edges are also among the largest area-weighted creases. Vertex 3381 mixes trailing digit D4P0, elbow, wrist and shoulder; vertex 3390 mixes elbow, wrist, shoulder and spine. The different blends motivate an isolated weight experiment.

## Rejected additional surface smoothing

`V2_LocalBankRoot_Corrective` adds a second 0.9/20-iteration smoothing modifier restricted to a 429-vertex graph patch around measured root edges and approximate mirrored neighbors. Four graph rings with linear falloff were an exploratory spatial mask, not a quality tolerance. Mirrored nearest-vertex residuals range up to 14.733 rig units; these are approximate patch locations, not a topology correspondence claim.

The experiment leaves seams closed but fails the existing relative p95 improvement gate at 12 of 16 poses and increases the prominent fold angle. It is rejected. Raw measurements and the failed report are `local-bank-fold-surfaces.json` and `local-bank-crease-report.json`; saved scene copy is `v2-local-bank-fold-study.blend`.

## Weight blending experiment and boundary repair

An independent copy blends each patch vertex's bone weights with its edge neighbors for five iterations, using half-strength times the patch mask. Weights are reduced to four influences and normalized each iteration. Duplicate-position neighborhoods are combined. The first 429-vertex version leaves a 0.462244-unit seam at the patch boundary, so it is rejected.

The revised version extends the mask to every member of each affected duplicate-position group, using the same maximum mask value. `V2_BankRoot_WeightBlend_SeamSafe` changes 432 patch vertices and retains a maximum of four influences. All 356 measured duplicate-position groups remain closed in the 16 bank samples, with maximum gap zero.

Saved editable copy: `assets/harvest-candidates/2026-10-07/bank-corrective-study/v2-bank-root-weight-seamsafe-study.blend`. Original rig, actions, weights and earlier gated study remain intact.

## Evidence and remaining failures

The revised study improves p95 crease angles at 15 of 16 samples, but bankLeft frame 90 worsens by 0.003068 degrees. The unchanged strict relative-improvement gate therefore fails. Do not relabel that as a full pass.

Tracking the original target edge, rather than following the largest area-weighted entry as rankings change, shows angle improvement at 15 samples but regression from 171.975 to 178.053 degrees at bankLeft frame 72. At bankLeft frame 18 the angle remains 169.886 degrees. Preliminary 73–76-degree observations referred to newly ranked high-area edges, not the same tracked edge; `bank-root-target-edge-report.json` is the precise per-edge evidence.

Both matched contact sheets, `bank-root-weights-seamsafe-contact-16x9.png` and `bank-root-weights-seamsafe-contact-3x2.png`, were inspected. They show local shape changes around the inner folds while maintaining the broader bank silhouette. Sharp folds remain at some phases. These still images do not qualify temporal behavior or self-intersections.

The changed bind weights are not protected by the bank-only surface modifier driver. Walk frame 15 differs from the retained original-weight study by 86.925 rig units. This experiment must never be used directly as a full-action rig replacement. Any retained pose correction must be solved and baked against the original skin, gated to qualified bank clips, with ground actions returning to exact original geometry.

Raw surfaces, failed p95 report and seam/ground summary are `bank-root-weight-seamsafe-surfaces.json`, `bank-root-weight-seamsafe-crease-report.json` and `bank-root-weight-seamsafe-summary.json`. Next refine the remaining phase-dependent fold and preserve the original-weight bank-gated study as the qualified authoring baseline. Runtime export and broader body/ground work remain outstanding.
