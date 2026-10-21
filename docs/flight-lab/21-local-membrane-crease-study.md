# Local membrane crease study

Updated 7 October 2026. Continues [20-v1-bank-harvest-and-direction-gates.md](20-v1-bank-harvest-and-direction-gates.md).

## Outcome

Added repeatable posed-surface measurements and an isolated local skin-weight experiment. The experiment is not a qualified visual repair: matched renders still show the pinched wing folds. The active V2 and V1 player assets remain unchanged.

The exact exported membrane has 8,249 vertices and 356 groups sharing identical positions. Every group has matching skin influences and weights. This rules out mismatched coincident skin weights as the measured defect; it does not rule out other shading, topology or deformation problems. The older authoring study's 115 groups are not assumed to describe the quantized runtime export.

## Measurements

`tools/audit-membrane-creases.mjs` measures the documented `WyvernMembrane_ExportSafe` mesh directly through Three.js skinning, at eight normalized phases for cruise and both banks. It records adjacent face angles, boundary/non-manifold edges, degenerate faces, and the eight largest area-weighted crease edges at each phase. The local ranking multiplies the face angle by the smaller adjacent face area so tiny triangles do not dominate selection. It is a diagnostic score, not an acceptance threshold or a screen-space quality grade. Maximum angles near 180 degrees alone are not a meaningful approval test for these thin folded shells.

Reports are stored under `assets/harvest-candidates/2026-10-07/`:

- `crease-baseline.json`: current runtime V2.
- `crease-bank.json`: the derived bank candidate from 4 October.
- `crease-local.json`: the local weight experiment.

Before this study, the bank candidate's 95th-percentile face angles both improved and worsened relative to runtime depending on phase. Passing the bone-motion gate therefore did not establish improved membrane shape.

## Local experiment

`tools/blender/local_membrane_weights.mjs` selects vertices from the reported largest bank crease edges and changes their existing weights using one experimental 0.25 neighbor blend. It extends selection to exact-position peers, keeps existing positive joint palettes, and renormalizes weights. It does not add influences, smooth the entire wing, change geometry or change animation. The 0.25 blend and eight-edge selection are explicit experiment parameters, not qualification thresholds.

The run selected 33 vertices and changed 34 including coincident peers. All 356 exact-position groups still match. Binary-prefix and metadata checks verify unchanged geometry, joint palettes, skeleton, materials and animations. Only a new membrane weight accessor is appended to the decompressed GLB; this large inspection file is not runtime optimized.

Experiment: `assets/harvest-candidates/2026-10-07/local-membrane-candidate.glb`.

SHA-256: `cb154c1392e953eb290b1a38dd1097acf490e708d042ae8b995ad23e9cf22691`.

The eight strongest area-weighted crease scores decrease by 0.42–3.55% across left-bank phases and 0.40–3.41% across right-bank phases. Some 95th-percentile angles increase slightly. These are a mixed numerical result, not proof of better appearance.

Matched left-bank renders compare the experiment against its exact bank parent with identical animation and camera:

- [16:9 comparison](../../../assets/harvest-candidates/2026-10-07/weight-evidence-left/comparison-16x9.jpg)
- [3:2 comparison](../../../assets/harvest-candidates/2026-10-07/weight-evidence-left/comparison-3x2.jpg)

Both complete eight-phase contact sheets were inspected. The differences are subtle; acute panel folds remain. Reject this experiment as a complete solution to the visible defect. Right-bank and runtime overlay/transition visual qualification are still open. The earlier `evidence-left` folder compares against runtime with a different bank performance and must not be used to attribute changes to this weight adjustment.

## Reproduce

Use fresh output paths:

```sh
node tools/audit-membrane-creases.mjs assets/harvest-candidates/2026-10-04/banks/wyvern-v2-bank-mirrored-candidate.glb > /tmp/bank-creases.json
node tools/blender/local_membrane_weights.mjs assets/harvest-candidates/2026-10-04/banks/wyvern-v2-bank-mirrored-candidate.glb /tmp/bank-creases.json /tmp/local-membrane.glb
node tools/audit-membrane-creases.mjs /tmp/local-membrane.glb
node tools/audit-all-clips.mjs /tmp/local-membrane.glb
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 \
  --python tools/blender/render_harvest_review.py -- \
  --baseline assets/harvest-candidates/2026-10-04/banks/wyvern-v2-bank-mirrored-candidate.glb \
  --candidate /tmp/local-membrane.glb --clip bankLeft --out /tmp/local-membrane-evidence
```

No dev server was needed: direct asset measurements and Blender renders provide the evidence for this isolated study. The renderer now accepts an explicit baseline to keep comparisons attributable.

## Validation and next work

The analytical fixture measures a flat shared edge as zero degrees and its folded counterpart as 90 degrees. A collapsed triangle is reported explicitly. Protection tests cover selected-only edits, coincident skin equivalence, normalization and palette preservation. The mutation suite kills deliberate suppression of crease angles and editing of protected vertices: 127/127 overall. Fast tests pass 846/846. Typecheck, lint, all 18 clip audits and all 16 wildlife simulations pass. Documentation metrics are synchronized.

Next, inspect the recorded high-area crease edges in close views with the authored source under the same pose. Test a source-backed panel/weight correction or reduce the problematic digit motion locally. Do not resume broad weight fitting or promote this experiment based only on a lower scalar score. Ground contact, full-body harvesting, procedural overlays and transitions remain separate work.
