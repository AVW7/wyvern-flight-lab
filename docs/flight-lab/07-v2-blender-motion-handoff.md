> Current runtime authority (2026-10-01): [runtime contract cleanup](14-v2-runtime-contract-cleanup.md) and `scripts/blender/wyvern_v2_runtime_contract.json`. Hashes, skin counts, and qualification statements below are historical snapshots, not a description of the current runtime package.

# V2 Blender motion repair: current handoff

Updated 9 September 2026. User explicitly switched focus to the v2 rebuild and requested continued fixes plus documentation for future sessions/agents. Fantasy Biomes remains the main game. Do not replace its repaired player GLB as a side effect of Blender work.

## Open this first

Current saved study:

`/Users/ajadvanwyk/.codex/visualizations/2026/09/09/01a08509-1dea-76c0-8707-83856dc9d32c/v2-rig/v2-motion-repair.blend`

Inspect the live Blender filepath and dirty state before opening anything. Current scene is `V2 Gothic Rebuild Inspection`, armature `WyvernRig.001`, mesh `WyvernMesh.001`. Selected action is `Walk_Authored_Fingers_Continuous`, frames 0–59 at 24 fps. Cruise candidate is `Cruise_Reset_Repair_Candidate`, frames 0–144. Mute imported NLA tracks to isolate actions. Candidate actions have fake users.

This file supersedes the earlier study in `Documents/art direction/v2-rig-inspection/`; that directory contains earlier raw probes and renders. Current writes belong in the task output folder above. Other scenes preserve the downloaded reference, original v2 baseline, and source pose comparison. Do not save over source model files.

## Asset identities

- Downloaded reference inspection copy: `/Users/ajadvanwyk/wyvern3d-v2/public/models/drogon-decompressed.glb`, SHA256 `4a9fc552d2c45718c90b52bd7642d4021843cbb6f6c38b2c43aae930e4f17bb7`. Provenance back to the original download has not been re-established this session.
- Original simplified rebuild: `wyvern3d-v2/public/models/wyvern.glb`, 56 bones. Three simplified wing fingers and elbow-parented membranes; not the latest wing.
- Current rebuilt source: `wyvern3d-v2/public/models/wyvern-gothic.glb`, SHA256 `f334e78569c701bbfefe43ef9816147e200c56bdcb3a8a58889a9f13c6d2956e`, 92 bones, 18 actions, 27,164 vertices. Six three-segment digits per wing plus membrane panels.
- Fantasy Biomes `public/models/player-wyvern.glb` remains the separate repaired v1 player. It was not modified during this work.

## What actually failed

### Internal flap resets

The exported gothic cruise passes the old endpoint/symmetry validator but rotates each elbow 48.74 degrees between frames 47 and 48, repeating every 48 frames. Matching frame 144 to frame zero conceals the reset inside the cycle. Quarter-frame sampling in Blender measured a 16.17-degree world/armature-space step on a distal finger; Three.js measured 16.31 degrees.

`Cruise_Reset_Repair_Candidate` bridges the six frames either side of each reset with normalized quaternion-component Hermite interpolation, preserving the rest of the stroke. Tangents come from adjacent original samples. Radius provenance: ceil(48.74 / 10.14 adjacent elbow degrees per frame) plus tangent support = six frames. This is a local smoothing candidate, not an exact reconstruction of source motion.

### Walking wing fold

The prior walk bakes a fixed hand/digit fold rather than retaining moving authored finger poses. Source `Battle_Walk` and rebuilt `walk` both span frames 0–59. Source body alignment uses pelvis pose/rest rotations to remove coordinate-system differences before comparing deformed skin.

`Walk_Authored_Fingers_Candidate` restores the source's moving hand/digit rotations using nearest rest-position bone pairs, rest-delta rotations, and parent-space reconstruction. Four initial pose samples reduced average wing-surface distance from approximately 359 to 64 raw rig units, about 82%. This is rest-nearest vertex correspondence on dominant wing groups, not topology equivalence or whole-animation approval.

**Do not use that first candidate:** it contains a quaternion hemisphere flip causing a 179.94-degree quarter-frame step at frame 45.75. Still frames concealed the fault.

`Walk_Authored_Fingers_Continuous` fixes quaternion signs consistently across keys and blends the last three frame intervals to the first hand/digit pose. Its largest quarter-frame step returns to the unchanged original toe movement, 5.75 degrees; Blender loop seam measures zero. The three-interval closure window is provisional: the 3.89-degree residual is spread locally without exceeding the measured original walk peak. Inspect velocity continuity before promotion.

### Corrected ground-support interpretation

Earlier notes said the forelimbs did not support the animal because dominant-weight claw minima sat above hind-foot minima. That inference was too strong. A source-relative comparison shows a similar height separation on the downloaded reference using the same mapped patches:

| Raw Z minima over walk | Source aligned to target | Continuous candidate |
|---|---:|---:|
| Left front patch | -75.05 | -58.26 |
| Right front patch | -73.12 | -58.66 |
| Left hind patch | -153.50 | -183.46 |
| Right hind patch | -141.96 | -151.80 |

These are dominant-weight hand/claw and foot/toe groups, not an anatomically approved sole/knuckle contact segmentation. A calibrated ground plane and source contact schedule remain missing. **Do not add arbitrary IK based on those minima alone.** Validate the actual contact patches first.

## Export evidence

Separate single-action `walk-candidate.glb` and `cruise-candidate.glb` are in the current output folder. They each contain one skin and 92 bones. Blender exports their sole clip as `Animation`; they are inspection artifacts, not drop-in runtime replacements.

| Three.js measurement | Shipped gothic | Exported candidate |
|---|---:|---:|
| Cruise peak ~1/96-second step | 16.3100 degrees | 4.1488 degrees |
| Walk peak ~1/96-second step | 5.7459 degrees | 5.7459 degrees |
| Cruise loop seam | 0.0805 degrees | 0.1005 degrees |
| Walk loop seam | 0.0454 degrees | 0.0624 degrees |

Sampling is approximately 96 Hz, 577 samples for cruise and 237 for walk. The small export seam residuals are reported, not rounded to zero. This audit strips materials for headless loading, so it does not establish material fidelity. It is a diagnostic measurement tool, not a complete quality gate.

Reproduce from the Fantasy Biomes checkout:

```sh
node tools/audit-wyvern-motion.mjs /path/to/wyvern-gothic.glb /path/to/walk-candidate.glb /path/to/cruise-candidate.glb
```

The tool fails if no matching motion exists, avoiding an empty-result success. `export-motion-audit.jsonl` in the output folder contains pretty-printed JSON objects, not strict one-object-per-line JSONL.

## Rejected or superseded approaches

- `Walk_Source_Forelimbs_Candidate`: transferring the full source arm chain does not change the support-height result; no benefit over the finger candidate established.
- `Walk_Neutral_Panels_Study`: neutralizing panel channels produced little numerical improvement. Unkeyed transforms can carry over when switching actions, so reset them explicitly before repeating that experiment. Do not promote it.
- Hemisphere-sensitive quaternion angles report approximately 350 degrees for equivalent representations. Use `abs(dot(q1,q2))` or Three.js `angleTo` for measurements; separately maintain sign continuity when writing quaternion keys.
- Selected-object export initially included other scenes. Re-exporting with **both** `use_selection=True` and `use_active_scene=True` fixed it. Check skin/bone/clip counts after export.
- Rest mesh proximity (0.0114% of span) and weight coverage do not prove good posed membranes.

## Next bounded work

1. Review continuous walk and cruise, including subframes and every internal beat reset, against the source from identical cameras. Current sampled 3:2 and 16:9 renders are evidence, not full playback approval.
2. Define source knuckle/sole contact patches and contact phases; compare candidate surface locations, support order and sliding. Derive ground height and forward speed before applying contact correction.
3. Isolate remaining membrane differences: compare source/candidate skin under matched poses, then change weights or panel offsets on a duplicate mesh. Do not smooth away authored folds blindly.
4. Add assertions and a deliberately corrupted track/weight to prove future acceptance gates detect the fault. Current audit is measurements only; no new mutation gate is claimed.
5. Round-trip full candidate assets with correct runtime clip names and preserved other actions/materials. Then inspect actual Flight Lab. Do not replace the game asset before those checks.

## Validation and scope

The motion audit executed successfully on shipped and candidate GLBs; targeted ESLint passed. Model source, materials, mesh weights and game files were not edited in this pass. No full gameplay, complete ground contact, visual parity, FPS, or release certification. The saved Blender actions and separate exports are working candidates.

## Continuation: membrane experiments and banking, 9 September

**Latest saved file:** same output folder, `v2-motion-repair-next.blend`. Active action remains the corrected walk. The earlier `v2-motion-repair.blend` remains the prior checkpoint. `before-membrane-study.blend` preserved the live dirty state before experiments.

### Membrane fitting: rejected

`fit-membrane-study.py` is saved in the output folder. It fits existing vertex influences to source poses 0/15/30/45 with a unit-sum solve and nonnegative projection, then measures held-out poses 8/22/38/52. Only 2,885 dominant-wing vertices are included; do not describe this as the whole mesh. Held-out mean error fell from 60–64 to 42–50 raw units. **The render became worse, with new pinches/tears. Reject this fit.**

A second duplicate smooths weight deltas over four adjacency passes, also connecting exactly coincident rest vertices. It still shows visible artifacts. Neither experiment changes the working mesh. `Membrane_Weight_Fit_Study` and `Membrane_Continuous_Weights_Study` are hidden and retained for diagnosis, not export. No acceptance threshold should be inferred from the experimental four-pass regularization setting.

Lesson: lower mean positional error is not sufficient. The next fitter must constrain spatial continuity, preserve seam equivalence and attachments, and compare local face distortion/normal changes. A few fitted walk poses cannot approve cruise deformation.

### Banking diagnostics and studies

Dense sampling reveals an approximately 29.47-degree quarter-frame panel rotation step in both original Blender bank actions (Three.js approximately 29.35). Unlike cruise, resetting the loop is not the only problem.

| Blender study | Largest quarter-frame step | Interpretation |
|---|---:|---|
| Original banks | 29.47 degrees | Panel fault at frame 1.5 |
| `BankLeft/Right_Continuous_Candidate` | 27.71 degrees | Reset smoothing alone insufficient; fault moves to frame 124.25 |
| `BankLeft/Right_Panel_Repair` | 13.10 degrees | Cruise panel motion on original asymmetric bank arm/digits |
| `BankLeft/Right_Distal_Continuity_Study` | 8.20 degrees | Cruise hand/digit/panel motion, retaining asymmetric bank shoulder/elbow/wrist |

`repair-bank-resets.py`, `bank-reset-measurement.json`, `bank-panel-repair.json`, and `bank-distal-study.json` preserve the experiments. The panel candidates were exported separately as `bank-left-candidate.glb` and `bank-right-candidate.glb` and evaluated in Three.js: 13.096 degrees peak, 2.873-degree whole-skeleton seam at **Tail10**. The original shipped banks have the same tail seam, so that residual was not introduced by this repair. Local-bone and whole-chain world-space seam measures differ; always name which is reported.

The distal study further reduces the jumps but replaces authored bank-specific finger behavior. It is an explicit tradeoff experiment, not an approved repair. Its remaining peak is frame 25.25, propagated through the wing chain; inspect upstream shoulder/elbow/wrist channels before further smoothing. Distal studies have not been exported or visually approved. Bank before/after panel-candidate stills at frame 28 were inspected, with both aspect ratios captured; these are not continuous playback approval.

**Next priority:** inspect the upstream bank motion around frame 25.25 and retain anatomical motion rather than flattening it simply to improve a metric. For walking, segment source contact surfaces properly before IK. Keep the rejected meshes hidden and use the original `WyvernMesh.001` for exports. Runtime player assets remain unchanged.

## Continuation: shoulder continuity and closed bank loops

**Latest saved file:** `v2-motion-repair-banks.blend` in the same task output folder. Active action `BankLeft_Closed_Loop`, frames 0–144 at 24 fps. Current companion actions: `BankRight_Closed_Loop`, `Cruise_Reset_Repair_Candidate`, `Walk_Authored_Fingers_Continuous`. Keep the original mesh; rejected weight studies remain hidden. Older files are checkpoints, not current state.

The residual bank peak was traced to the outer shoulder near frame 25.25. In local space the shoulder step abruptly rises to about 4.29 degrees per quarter-frame. `BankLeft/Right_Shoulder_Continuity` applies a single symmetric one-frame binomial quaternion filter (0.25 previous / 0.5 current / 0.25 next) to the two shoulders, periodically sampled at quarter frames. It builds on the distal study, so the earlier tradeoff of replacing bank-specific distal motion still applies. It does not change weights, the skeleton or non-shoulder arm channels.

Measured shoulder peak falls from 4.358 to 3.924 degrees per quarter-frame; largest change in angular-step vector falls from 3.582 to 2.496 degrees (about 30%). Maximum hand span remains 2516.13 raw units, but minimum rises from 1631.19 to 1698.77 (about 4.1%). This is recorded in `shoulder-continuity.json`: do not claim every pose was preserved exactly.

`BankLeft/Right_Closed_Loop` additionally blends tail rotations over the final six frame intervals toward their initial values with smoothstep and quaternion sign consistency. This is a local authoring choice, not a formal tolerance. It repairs the inherited tail seam while leaving the measured peak wing motion unchanged. The exported single-action artifacts `BankLeft_Closed_Loop.glb` and `BankRight_Closed_Loop.glb` both have one skin and 92 bones.

| Three.js quarter-frame audit | Original banks | Current closed-loop exports |
|---|---:|---:|
| Maximum world-space bone rotation step | 29.35 degrees | 7.386 degrees |
| Left full-skeleton seam | 2.873 degrees | 0.069 degrees |
| Right full-skeleton seam | 2.873 degrees | 0.104 degrees |

Normal-speed rendered previews now exist: `bank-preview.mp4` (144 frames, six seconds, current left closed-loop action) and `walk-preview.mp4` (59 frames, 2.458 seconds, corrected walk). These are neutral Workbench renders, not gameplay videos. Current left-bank stills at frame 25 were inspected at both 3:2 and 16:9. Continuous source-versus-candidate visual approval remains outstanding; recording a preview is not approval.

Next: compare those previews to the artist source and inspect whether the changed distal bank motion preserves the desired banking character. Then define proper source sole/knuckle contact patches for walking. Do not interpret 7.386 degrees as an acceptance threshold, or resume rejected weight fitting simply because its numerical fit was better. Rig and membrane fidelity, full-set export, and game integration remain separate open gates.

## Continuation: isolated membrane surface rebuild

**Latest membrane study:** `/Users/ajadvanwyk/.codex/visualizations/2026/09/09/01a087ee-d2be-7910-a7c0-6ce514bf1577/v2-membrane-rebuild.blend`. It is based on the clean complete-export review and leaves the source GLBs and Fantasy Biomes runtime assets unchanged.

The visible walk faceting was reproduced at frames 0, 15, 30 and 45. The four membrane shells are separate connected components (683, 635, 683 and 635 vertices) inside the combined mesh. They were separated from the 24,528-vertex body, subdivided once, and decimated only on the membrane. Body geometry and the 92-bone armature were not rebuilt. The resulting Blender study measures 49,872 triangles: 34,614 body triangles plus 15,258 membrane triangles, compared with the previous 39,238-triangle combined mesh. The frame-15 comparison is in the same output folder as `membrane-before-walk-f15.png` and `membrane-rebuild-walk-f15.png`.

The Blender candidate visibly softens the broad triangular folds without smoothing the body. It is **not an export candidate yet**. Subdivision interpolates more than four joint influences onto 2,827 membrane vertices. Blender's GLB exporter truncates these to four, and the explicit reproduction measured up to 17.96% of a vertex's influence mass being discarded. The resulting render reintroduced sharp discontinuities, so `rejected-four-influence-membrane-export.glb` is retained only as a failed study. Do not promote it or raise the asset budget around it.

Next bounded step: rebuild the subdivided membrane's skin field with an export-safe four-bone palette per continuous panel, preserving shared-edge weights across the inner and outer shells. Prove the palette with an intentionally corrupted seam, then re-render walk and cruise before exporting. Ground-contact segmentation and transition qualification remain separate subsequent gates.

## Continuation: export-safe paired membrane skin

**Latest clean authoring/export files:** `v2-membrane-export-safe-clean.blend` and `wyvern-v2-export-safe-clean-candidate.glb` in `/Users/ajadvanwyk/.codex/visualizations/2026/09/09/01a087ee-d2be-7910-a7c0-6ce514bf1577/`. The earlier `v2-membrane-rebuild.blend`, rejected GLB and full study scene remain separate checkpoints. Runtime assets were not replaced.

The subdivided membrane has 8,249 vertices. Before compression, 2,813 vertices exceeded four influences: 2,389 had five, 409 had six and 15 had seven. The export-safe copy groups coincident rest-space vertices and assigns every vertex in a group the same top-four bone palette and normalized weights. All 8,249 vertices now have at most four influences. There are 115 paired-position groups; the seam-equivalence check reports zero mismatches. A deliberate single-weight mutation makes the check report one mismatch, and restoring the weight returns it to zero.

This narrow compression preserves most of the high-influence field: mean discarded influence mass is 1.67%, the 95th percentile is 8.80%, and the worst vertex remains 17.96%. Across walk frames 0, 15, 30 and 45, mean deformation drift from the high-influence Blender reference is 1.34-1.41 raw units against a 6,772-unit membrane bounding-box diagonal (about 0.02%); the 95th percentile is 7.47-8.05 units (about 0.12%). These measurements describe proximity, not visual approval.

The clean GLB is 20,726,944 bytes and exports without Blender's influence-truncation warning. It contains one skin, 92 bones and exactly the 18 canonical clip names. `tools/audit-wyvern-motion.mjs` completes without missing-target warnings: bank-left peak/seam 7.386/0.112 degrees, bank-right 7.386/0.132, cruise 4.149/0.110 and walk 5.746/0.076. These reproduce the current reviewed motion package; they do not qualify membrane appearance, ground contact or transitions.

The exact clean GLB was subsequently re-imported through Blender's native File > Import path. This bypassed the MCP timer-context failure in `armature_display` and confirms the file itself is importable. The imported result is saved as `v2-membrane-export-safe-import-review.blend`. Post-export 3:2 evidence exists for walk frames 0, 15, 30 and 45 and cruise frames 0, 36, 72 and 108 as `export-roundtrip-<clip>-f<frame>-3x2.png`.

The round-trip renders do **not** approve the candidate. Walk still shows pronounced longitudinal ridges and acute membrane creases, particularly through the forearm-to-digit panels. Cruise remains continuous in the skeletal audit, but frames 36 and 108 show pinched folds and uneven panel curvature. The four-influence export blocker is resolved structurally; the visible deformation defect is not. Next, compare these exact exported poses against the authored model and rebuild the local panel weight distribution where the remaining creases occur. Then capture a complete unpaused cycle and the 16:9 evidence set. Ground contact and transition qualification remain separate gates. Do not promote this GLB into the game player.

## Flight Lab-only cruise repair, 15 September

The direct Flight Lab asset now supersedes the prior no-promotion status only for the isolated V2 cruise specimen. `public/models/wyvern-v2-rig.glb` is SHA-256 `34b2862c7c74f77952131b612dc296d4d29215f63af2ad749e3782f333ec928f` and retains the clean export's one shared skin, 92 bones, 18 clips, 49,872 triangles and 6,977,360-byte runtime package. `Cruise_WingShapeRepair_v1Reference` reduces the maximum measured distal recovery fold from 141.01 degrees to 67.68 degrees without altering shoulders. Its restored-animation runtime export audits at a 3.8337-degree cruise peak per 1/96 second and a 0.0588-degree seam; Flight Lab loaded all 18 clips / 4,968 tracks and reported no cruise loop jump above 10 degrees.

This is not visual approval of every action, ground contact, player-controller compatibility, gameplay or release performance. `public/models/player-wyvern.glb` remains the separate Drogon player and the game-promotion gates continue to apply.
