# Harvested bank motion and corrective surface reconciliation

7 October 2026. Blender MCP imports the exact derived opposed-bank candidate from document 20 into a separate scene, then evaluates the bank correction from document 29. Active assets remain unchanged.

## Source and editable result

Harvested GLB SHA256: `34ca702f5812b821b138a8047cbc8a6bf6ac4da74b45d8bdf289c812a29ccc4d`. Its original V2 parent is `b0667a7bf5b1484a216ed9851b26ccad3fa6d833a104beb9ed59b1898f725d3c`. The right-bank donor remains a reflected/swapped derivation of the left bank, not an independent native V1 performance.

The candidate is decoded for Blender import as `harvested-bank-import.glb`. Scene `V2 Harvested Bank Correction`, rig `WyvernRig.005`, and independent surface copy `V2_HarvestedBank_Corrective` preserve the imported rig/actions. The corrective copy retains armature weights and adds the same 0.9-factor, 20-iteration, boundary-pinned length-weighted Corrective Smooth followed by source custom-normal transfer. Clay material overrides are review-only.

Latest editable copy: `assets/harvest-candidates/2026-10-07/bank-corrective-study/v2-harvested-bank-gated-study.blend`. Earlier ungated import/correction study is preserved separately.

## Three-way measurement

Original V2, harvested digit motion and harvested motion plus surface correction are compared at eight phases for each bank. Raw surfaces and reports are saved as `harvested-bank-corrective-surfaces.json` and `harvested-bank-crease-report.json`.

Harvesting alone increases p95 crease angles at nine of 16 samples: eight increases of 1.322–1.700 degrees and one small 0.000706-degree increase at bankLeft frame 0. It reduces the metric at other samples. Therefore digit transfer alone does not solve membrane folds.

Adding correction lowers p95 by 17.773–23.196 percent against the harvested pose and 14.286–24.684 percent against original V2. All 16 corrected samples improve and contain no degenerate triangles. This is a relative surface measurement rather than broad animation/design acceptance.

Matched contact sheets `harvested-bank-contact-16x9.png` and `harvested-bank-contact-3x2.png` compare original, harvest and corrected harvest at frames 18 and 54. Both were inspected. Harvest changes trailing articulation while opposed turns remain readable. Correction subtly softens surfaces; pronounced inner folds remain. Lighting uses the existing inspection scene and a common camera inherited from document 29. No claim of resolved self-intersections or ground clearance is made.

## Animation gate

The latest authoring copy has 18 separate `V2HarvestBankReview_*` actions. Each contains a constant `bank_corrective_strength` property track: one in banks, zero in the other 16 clips. The modifier driver is `strength*0.9`. Imported actions remain intact.

The gate samples five positions per clip, including endpoints: 90 evaluated poses. Every non-bank action has exactly zero membrane position drift. Bank poses retain nonzero correction. Forcing the driver to 0.9 during walk frame 15 produces 116.045 rig units of unwanted displacement; restoring the gate returns exactly zero. This mutation establishes protection sensitivity. `harvested-bank-gating-report.json` records results.

The modifier and Blender property driver are authoring-only and must be baked into runtime-compatible morphs. No new GLB export, subframe/normal check, transition qualification, budget change or promotion is claimed. Next refine local folds and bake the retained bank study while preserving cruise corrections and zero ground deformation.
