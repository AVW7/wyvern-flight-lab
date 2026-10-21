# Original-skin bank pose correctives

7 October 2026. Blender MCP converts the isolated weight study into discrete pose corrections on an exact copy of the original harvested membrane's skin weights. This advances authoring without replacing the rig with the unprotected weight experiment.

## Strength scan

Four fixed blends of original and smoothed weights were evaluated through Blender at all 16 bank samples. Both p95 crease angle and the tracked edge 3381/3390 must not increase against the retained original-weight corrective study.

| Weight blend | Protected samples |
| --- | ---: |
| 0.125 | 3/16 |
| 0.25 | 4/16 |
| 0.5 | 11/16 |
| 0.75 | 10/16 |

No tested fixed blend qualifies throughout the sampled cycle. `bank-root-strength-scan.json` retains all measurements. Smaller weight blends are not assumed safer.

## Discrete pose construction

`build_bank_pose_correctives_mcp.py` copies `WyvernMembrane_ExportSafe.005`, retaining its original Armature modifier, bind vertices and exact four-influence skin weights. New object `V2_OriginalSkin_BankPoseCorrectives` contains 16 relative shape keys, one per measured pose.

For each pose, the target is a blend between the retained bank surface correction and the seam-safe weight-study positions. The sampled blend values are 0, 0.125, 0.25, 0.5, 0.75 and 1; choose the largest value that does not worsen either measured crease metric. BankLeft frame 72 uses zero local weight-study contribution; bankLeft frame 90 uses 0.75; the other 14 use one. The zero fallback retains the existing corrected bank surface, not the uncorrected raw skin pose.

The chosen deformed target is converted to a pre-skin delta by solving each vertex's original weighted bone linear transform. Reconstruction through Blender's original Armature modifier differs by at most 0.000989 source rig units, below the float32 arithmetic bound `float32 epsilon * target extent * 64`. Exact original weight membership/values were verified after creation. This preserves the rig skin rather than directly promoting the altered weights.

Saved editable study: `assets/harvest-candidates/2026-10-07/bank-corrective-study/v2-original-skin-bank-pose-study.blend`. Report: `bank-pose-corrective-report.json`.

## Visual evidence and limits

Sixteen matched renders compare the retained baseline and reconstructed poses for both banks at frames 18 and 72. Both `bank-pose-corrective-contact-16x9.png` and `bank-pose-corrective-contact-3x2.png` were inspected. They retain the bank silhouette, show local surface changes at frame 18, and show the intended unchanged local-study fallback for bankLeft frame 72. Lighting and common camera follow document 29. Blender clay shading is inspection evidence, not a runtime authored-normal proof.

All shape keys are saved at zero by default. They currently require explicit activation at their corresponding pose; no automatic clip activation, interpolated playback, loop closure or crossfade qualification is claimed. The chosen metrics are protected at the discrete desired poses, not proven across interpolated frames. The reconstruction bound is position evidence, not a crease-angle error budget.

Next densify/qualify the phase-dependent targets, construct a continuous original-skin corrective basis and bank-only weight animation, then validate held-out poses, zero resets, round-trip shading, transitions and GPU/file cost. Preserve the independently qualified cruise correction and all ground motion. Active GLBs and budgets remain unchanged; body/ground harvesting remains outstanding.
