# Blender MCP corrective cruise rig

Updated 7 October 2026. Continues [21-local-membrane-crease-study.md](21-local-membrane-crease-study.md).

## Current authoring result

Blender MCP now controls an isolated, saved V2 study. The reviewed cruise rig softens membrane recovery creases with a post-armature Corrective Smooth modifier. Its boundary is pinned; the original mesh positions, four-influence skin weights and 92-bone skeleton are retained. The correction is keyed on only in the cruise review action. All other 17 review actions key its strength to zero.

Editable study: `assets/harvest-candidates/2026-10-07/mcp-study/v2-corrective-cruise-mcp.blend`.

This is a **Blender authoring prototype**, not a runtime GLB promotion. A standard GLB exporter cannot retain this modifier and its driver. Bake a runtime-compatible corrective morph before claiming equivalent game deformation.

The active V2 remains SHA-256 `b0667a7bf5b1484a216ed9851b26ccad3fa6d833a104beb9ed59b1898f725d3c`; V1 player remains `0e37110bca94bbe4cb064e4a075e15fce19f23cdbb71a4535f4d289b5549b329`. No source model or gameplay asset was replaced.

## Direct MCP work and source identity

The interactive Blender MCP endpoint was initially offline. Blender was started with a copy of the saved export-safe study, then its actual scene/save state was inspected through MCP. The current runtime V2 GLB was decompressed and imported into a separate scene using a real 3D-view context. The older authoring scene stays separate. All model inspection, panel baking, skin trials, modifier setup, rendering, action gating and final save were performed through `mcp__blender__execute_blender_code`.

The latest rig uses `WyvernRig`, `V2_CorrectiveSurface_Membrane`, and the `V2RigReview_*` action bank. The original imported actions remain available with `.001` suffixes. Use the review actions to animate the correction control; original imported actions do not key that new property.

## Experiments that changed the next action

1. **Panel coordination:** panel bones inherit one finger even when neighboring fingers bend differently. Their departure from averaged neighboring skin rotation reached 68.22 degrees at cruise frame 18. A separate action averages neighboring digit segment skin transforms and solves panel local translation/rotation. It bakes successfully and its surgically packaged GLB passes the 18-clip motion audit. The visual effect is small: only 44.81 of 8,249 total membrane weight units belong to panel bones, approximately 0.54%. This is not accepted as the visible crease solution.
2. **Continuous digit grid:** a rest-bone triangle grid supplies at most three barycentric influences per changed vertex. The study changes 6,860 membrane vertices while preserving the body. Its inspected frame introduces new ridges. The hidden grid copy and separate `v2-digit-grid-mcp.blend` remain rejected experiments.
3. **Pose correction:** Corrective Smooth after the armature reduces the acute wrist-to-panel ridge in the matched close view. Factor 1.0, 20 iterations and length-weighted smoothing are experiment settings, not acceptance budgets. Boundary pinning retains the perimeter. The modifier is retained in the authoring prototype only after its ground regression is isolated.

The initial panel donor accidentally included both scenes. `cruise-panel-donor-isolated.glb` supersedes it and uses `use_active_scene=True`. The packaging tool rejects multiple donor actions and copies only the 16 panels' rotation/translation channels. Its tests protect the binary prefix, root, geometry and non-panel performance.

## Measured and inspected cruise evidence

Eight samples cover the full six-second cruise action: frames 0, 18, 36, 54, 72, 90, 108 and 126 at 24 fps. Both matched contact sheets were inspected:

- [Cruise 16:9](../../../assets/harvest-candidates/2026-10-07/mcp-study/evidence-corrective/cruise-comparison-16x9.jpg)
- [Cruise 3:2](../../../assets/harvest-candidates/2026-10-07/mcp-study/evidence-corrective/cruise-comparison-3x2.jpg)
- [Original close view, frame 36](../../../assets/harvest-candidates/2026-10-07/mcp-study/evidence/macro-framed-original-36.png)
- [Corrective close view, frame 36](../../../assets/harvest-candidates/2026-10-07/mcp-study/evidence/macro-framed-corrective-36.png)

The 95th-percentile adjacent face angle falls at every sampled cruise phase, from 34.41–40.66 degrees to 26.47–33.74 degrees: a 17.0–23.4% reduction per matched phase. The close view shows a softer recovery ridge, and the full contact sheets retain the main wing silhouette and tips. Some inner folds remain. This is not a claim that all folds should be removed.

All 356 exact-position groups remain coincident after both original and corrected deformation; maximum paired separation is zero. Surface indices and vertex counts match. `corrective-crease-metrics.json` records measurements; `corrective-posed-surfaces.json` retains the evaluated geometry for reproducibility. These are sampled surface checks, not a continuous animation or gameplay qualification.

## Ground regression and protection

Applying the same smoothing to walk raises its 95th-percentile fold angles from roughly 67–76 degrees to 80–91 degrees. The ungated walk renders were inspected and retained as failed evidence:

- [Rejected ungated walk 3:2](../../../assets/harvest-candidates/2026-10-07/mcp-study/evidence-corrective/walk-comparison-3x2.jpg)
- [Rejected ungated walk 16:9](../../../assets/harvest-candidates/2026-10-07/mcp-study/evidence-corrective/walk-comparison-16x9.jpg)

The corrective object's modifier factor now reads the rig's `membrane_corrective_strength` property through a driver. Each `V2RigReview_*` action explicitly keys that property: cruise 1, every other action 0. The action bank preserves the source bone curves and supplies a blendable correction control rather than a frame handler.

`gate_v2_corrective_mcp.py` checks five phases including endpoints for all 18 review actions. Every non-cruise action has exactly zero evaluated vertex drift from the original. A live fault injection forces the modifier on during walk frame 15 and produces 118.7774 rig units of maximum drift. Restoring the expression brings the measured drift back to exactly zero. This is an additional live Blender mutation check, separate from the repository's mutation count.

## Repository checks

Fast tests pass 848/848; repository mutation checks kill 129/129. Typecheck, lint, all 16 wildlife simulations and documentation metrics pass. These checks cover repository/tool behavior and are separate from the live Blender surface and ground-protection measurements. `corrective-study-manifest.json` pins the final saved study hash and evidence.

## Tools and continuation

- `coordinate_v2_panels_mcp.py`: original panel-coordinate experiment; requires its initial isolated runtime scene.
- `package_panel_coordination.mjs`: guarded panel-only animation splice; separate experimental GLB.
- `rebind_v2_digit_grid_mcp.py`: rejected grid-weight study.
- `render_v2_corrective_mcp.py`: matched MCP render batches; choose `review_clip`, `review_label`, and `review_ratio` before executing. Corrective labels use the gated review action bank.
- `measure_v2_corrective_mcp.py`: surface collection used for the ungated experiment measurements.
- `gate_v2_corrective_mcp.py`: action protection audit, deliberate ground corruption and final save.

No dev server was needed. Blender remains open on the saved cruise review study for continued authoring. Source meshes, rejected studies and the original authoring scene remain separate from the visible corrective object.

Next: bake the cruise-only pose correction into loop-safe morph targets, retain source skin/skeleton/material identity, inspect the exact exported GLB under the same cameras, and verify non-cruise/transition behavior. An unpaused full-loop review, bank correction, runtime procedural overlays, full-body performance and ground contact qualification remain open. Keep the goal active; the broad V2 improvement is not complete.
