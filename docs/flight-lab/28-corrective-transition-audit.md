# Corrective cruise transition audit

7 October 2026. Candidate remains isolated; no active model or budget changed.

## Measured runtime blends

`tools/blender/audit_corrective_transitions.mjs` loads the original and optimized candidate through the installed Three.js GLTFLoader and AnimationMixer. Source SHA256 is `b0667a7bf5b1484a216ed9851b26ccad3fa6d833a104beb9ed59b1898f725d3c`; candidate SHA256 is `9a6f6b965f336291681e4170726903ceefd9d1575de59da0836bb8c9f2832be2`.

The audit covers all 17 non-cruise clips:

- 680 static blends: eight cruise phases and five normalized weights into each target's start pose.
- 272 timed crossfades: both directions, four starting phases and the existing 0.24-second regular and 0.16-second one-shot fade durations from `src/flight-lab/runtime.ts`. Playback uses 60 Hz steps and Three.js duration warping.
- All 356 duplicated-position membrane groups remain coincident, with maximum seam gap zero.
- Bone world matrices match the original exactly throughout both audit sets.
- Every outgoing fade completes with zero corrective weights and zero membrane position drift from the original target animation.

The maximum static correction displacement is 157.042 source rig units. This describes correction magnitude, not an acceptance threshold or temporal smoothness claim. Static seam comparison permits only the floating-point arithmetic bound `Number.EPSILON * coordinate extent * 64`; all observed gaps are exactly zero. Timed samples enforce exact zero.

The report is `assets/harvest-candidates/2026-10-07/runtime-authored-normals-096/static-transition-audit.json`, including per-case measurements. Despite its historical filename, it now includes timed measurements.

## Gate sensitivity

Running the audit with the optional `open-seam` argument corrupts one duplicated vertex in the first position morph. The audit fails with `Correction opens a skin seam`. This is an in-memory mutant and does not modify either GLB.

## Limits and next work

These are numeric blend checks. They do not establish visual quality, perceptual continuity, ground clearance or absence of surface self-intersection. Timed actions use repeated playback for a controlled blend test rather than the complete Flight Lab state machine. Capture and inspect actual blended poses in both review formats before qualifying transitions visually. Bank/body/ground harvesting and the unchanged file-size budget remain outstanding.

## Blender MCP pose evidence

A subsequent Blender MCP review renders exact runtime vertex positions for cruise-to-bankLeft, cruise-to-walk, cruise-to-land and takeoff-to-cruise. Each uses a 0.24-second warped fade, an initial source phase of 0.25 and snapshots at elapsed 0, 0.12 and 0.28 seconds. This snapshot exporter advances directly between those three times; the separate numeric audit above samples at 60 Hz.

`export_corrective_transition_snapshots.mjs` exports posed body and membrane topology/coordinates, converted from Three.js world `(x,y,z)` to Blender `(x,-z,y)`. `render_corrective_transition_snapshots_mcp.py` creates an isolated snapshot scene, leaving the editable rig scenes intact. These are posed mesh snapshots, not replacement authored actions. Clay normals are recomputed by Blender, so these renders inspect geometry and silhouette rather than proving runtime shader shading.

Twenty-four renders and two contact sheets are saved in the candidate folder: `transition-contact-16x9.png` and `transition-contact-3x2.png`. Both were inspected. All sampled poses fit a common camera derived from the union of projected vertex bounds, with 5 percent framing padding at the narrower 16:9 height. The manifest records camera location, rotation and orthographic scale. The final imported snapshot differs from exported positions by at most 0.000125 rig units due to Blender float storage.

The bank and ground-fold poses still show tight ridges around the inner membrane/wing roots. No broad visual-quality pass is claimed. These observations make local bank/ground fold repair the next design task; checking only closed seams would miss this defect. Still-image samples cannot establish temporal smoothness, foot support or self-intersection clearance.

The saved `v2-runtime-transition-snapshot-study.blend` preserves authoring and optimized rig scenes alongside the new review. `transition-render-manifest.json` records the exact candidate hash, snapshot times, camera and scope. Active GLBs and their budgets remain unchanged.
