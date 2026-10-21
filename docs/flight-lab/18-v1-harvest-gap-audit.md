# V1-to-V2 animation and design harvesting audit

> Implementation follow-up: [19-v1-harvest-implementation.md](19-v1-harvest-implementation.md) records the operational cruise pipeline, corrected coordinate assumption, candidate review, procedural fixes and remaining work. Findings below describe the pre-implementation state.

Audited 4 October 2026 against the current working tree. This audit supersedes readiness claims in sections 1 and 5 of [16](16-v2-wing-harvest-and-coordination.md), and qualifies the measurements in [17](17-v2-systematic-animation-improvements.md). Existing uncommitted model, rig and UI work was preserved.

## Source identity and current evidence

- V2 `public/models/wyvern-v2-rig.glb`: SHA-256 `b0667a7bf5b1484a216ed9851b26ccad3fa6d833a104beb9ed59b1898f725d3c`.
- Available V1 donor `/Users/ajadvanwyk/wyvern3d-v2/public/models/drogon-decompressed.glb`: SHA-256 `4a9fc552d2c45718c90b52bd7642d4021843cbb6f6c38b2c43aae930e4f17bb7`.
- `node tools/audit-all-clips.mjs public/models/wyvern-v2-rig.glb` passes its existing numeric checks across 18 clips. Cruise and both banks measure 0.500 Hz; their looping endpoint metric is below 0.0013. Walk retains alternating asymmetry. Root travel measures zero.
- This is static/runtime evaluation evidence. No rendered design comparison, complete-cycle visual acceptance, or new animation export was performed in this audit. V2 remains Flight Lab only.

## Gaps found in the implementation

| Priority | Gap and evidence | Required improvement |
|---|---|---|
| P0 | `tools/blender/harvest_v1_to_v2.py::run_harvest` finds an action and bone pairs, removes imported objects, then prints success. It never samples poses, creates target tracks, or writes `out_path`; `wing_only` is unused. | Implement an explicit bake/export transaction. Success requires a newly written candidate, canonical target action, source hash, frame window, sampling rate and mapping report. Preserve the source scene and runtime asset. |
| P0 | `solve_foot_plane_lift` is `pass`; recipe fields `mirror`, `lift`, `loop`, `beats`, `target_frames` do not drive execution. | Implement and measure each advertised operation or reject that recipe. Do not describe ground contact or loop closure as solved. |
| P0 | Pairing accepts distances below 60 rig units despite documenting below 1. It permits repeated donor assignments, omits unmatched targets from the result, and records no ambiguity or hierarchy check. | First measure transformed rest positions on these exact source hashes. Publish per-pair residuals and confidence, reject ambiguous/missing required bones, verify side and parent chains, then derive a justified tolerance. Do not blindly substitute 1 until the coordinate-space assumption is measured. |
| P0 | Source action lookup uses substring matching and falls back to pre-existing scene actions. The documented invocation opens a GLB as a Blender startup file; the script only imports GLTF although its CLI advertises blend input. | Require exact imported action identity (with explicit import rename handling), explicit V2 input and supported source formats; isolate import/export objects and actions. Reject unsupported inputs before changing a scene. |
| P1 | `harvestedWingProfiles.ts` has hard-coded tables and V1 attribution but no extraction generator, input hash, raw samples, bone identifiers, normalization record or error comparison. | Treat these as provisional V1-inspired curves. Generate reproducible tables from measured poses and compare generated values to donor samples. Current tests check mathematical properties, not extraction fidelity. |
| P1 | `wingRefinement.ts` runs the tables on its own speed-driven flutter phase. Only digit/panel samplers are consumed; elevation/sweep/twist do not control the arm chain. | Decide whether these are aerodynamic flutter or donor wingbeat timing. Keep flutter separate; phase-lock performance curves to the authored mixer cycle before claiming V1 wingbeat coordination. Test crossfade and speed-change phase continuity. |
| P1 | The ground branch returns immediately below clearance 0.5 or speed 2, zeroing fold state. Doc 16 claims a smooth taper. | Measure offset discontinuity at both boundaries with real authored baseline resets. Implement a measured fade if necessary; preserve landing/walk contact and low-speed hover requirements. |
| P1 | `validate-wyvern-clips.mjs::loopSeam` combines quaternion radians and position rig units, while the table labels the value `seam(rad)`. The current takeoff reports 1177.5128; land 35.0001 and death 519.9999 are one-shot endpoint differences, not failed loop seams. | Report rotation and translation separately, with bone and units. Mark one-shot seam as not applicable. Add transition-pose/contact tests instead of forcing one-shots to loop. |
| P1 | Bank validation compares scalar maximum asymmetry only. Equal maxima cannot prove opposite turning direction, matched phases, or corresponding trajectories. | Compare phase-matched mirrored arm/digit poses and signed body roll over the cycle. Mutate one bank to the other direction and require rejection. |
| P2 | Existing harvest tests construct their own coordinate transform and rest-delta identity; the 60-frame test uses seven objects per side. | Exercise the real transfer code, full 60-bone rig, non-rest poses, missing mappings, duplicate donors and baseline resets. Quaternion normalization alone cannot qualify membrane appearance. |

## Packaging improvement made in this audit

`package_harvested_clips.mjs` previously wrote an unchanged base when no donors were supplied and silently skipped missing requested donors. It now rejects both before reading or writing a candidate. Its CLI accepts an explicit donor-map JSON file:

```sh
node tools/blender/package_harvested_clips.mjs /tmp/wyvern-v2-harvested-candidate.glb /tmp/harvest-donors.json
```

The JSON maps canonical clip names to donor GLB paths. Each donor must still contain exactly one action and map its channels to target node names; the existing runtime contract validates the result. This is packaging safety, not proof of valid retargeting, bind-space equivalence or visual quality.

`test/harvest-packaging.test.js` reproduced the false success before the fix, then passed after it. Missing donors and empty donor maps must leave no output. A donor manifest with source hashes, recipe and mapping evidence remains required future work.

## Animation and design work sequence

1. **Cruise reference capture:** compare the exact V1 donor's `Battle_Down02` window with the V2 cruise, using matched normalized phase and subject scale. Verify the documented 40–66 frame/three-beat interpretation before retiming. Record shoulder, elbow, wrist, hand and all digit extrema; capture downstroke, bottom reversal, recovery and top reversal.
2. **Wing silhouette and membrane:** evaluate the deformed mesh, not just wingtip bones. Inspect trailing-edge scallops, wrist pinch, panel ridges, membrane inversion, torso intersections and recovery fold. Repair V2 weights/poses locally. Vertex-count similarity alone does not establish topology or skin-weight correspondence.
3. **Body performance:** harvest measured body lift/pitch, neck stabilization and tail lag relative to wingbeat. Keep gameplay root translation separate. Resolve the excluded jaw and leg-root bones explicitly instead of silently losing their performance.
4. **Ground performance:** validate alternating knuckle/foot support, stance-phase foot slip, toe splay, folded-wing clearance and the distinct relaxed silhouette of rest versus idle. Both recipes currently use `Battle_Stand`; they are not independent harvested performances.
5. **Transitions and banking:** inspect cruise-to-bank, cruise-to-glide, dive recovery, takeoff-to-cruise and land-to-idle. Preserve intentional asymmetry; compare signed turns and phase, then isolate procedural offsets to expose double articulation.
6. **Promotion:** retain candidate assets separately; validate the actual exported GLB, Blender round-trip, full-cycle 16:9 and 3:2 captures and procedural-on/off comparisons. Only then update the Flight Lab contract. Gameplay promotion remains a separate decision.

For every step, record donor/candidate hashes, frame times, camera, scale, raw metrics, tolerance provenance and corruptions that must fail. Start with one measured cruise defect rather than replacing all 18 clips at once.

## Verification of this audit change

- Focused harvesting and runtime-contract checks: 9/9 passed; packaging regression was demonstrated failing before the fix.
- Typecheck and lint passed. Mutation suite: 113/113 killed. Wildlife simulation: all 16 species passed.
- Fast-suite equivalent via `node --import tsx --test --test-concurrency=3` passed 828/829; the unrelated `battle-hud-objectives.test.js` failed on missing `applyDefenderRoles` export. The usual tsx CLI could not create its sandbox IPC socket, so the Node import entry point was used.
- `docs:check` reports stale existing README metrics. Link checker reports seven missing targets in other documents, none in this audit's links. Those unrelated files were not repaired here.
- No dev server or browser was started; no visual improvement is claimed.
