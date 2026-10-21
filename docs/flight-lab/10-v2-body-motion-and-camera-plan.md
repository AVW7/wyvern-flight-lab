# V2 rebuild: wings, legs, tail and vertical camera follow

Date: 13 September 2026. Status: proposed, documentation only. No model or runtime changes are delivered by this plan.

## Intended result

Improve the existing Gothic wyvern rebuild while preserving its supplied appearance: coherent wingbeats, membranes that deform without sharp accidental pinching, convincing leg support and flight tuck, and a tail that follows the body's motion without snapping. The Chase camera must follow the wyvern vertically through ground and flight changes.

Interpret the user's camera report as missing vertical following, consistent with screenshot 03 and the current source. This is a Flight Lab repair first; gameplay camera integration is a separate qualification step. Do not replace `public/models/player-wyvern.glb` as part of this work.

This plan sets the next focused order for the reported body and camera defects. [09](09-flight-lab-improvement-plan.md) remains the broader lab roadmap; use its playback and evidence work where needed without requiring the entire roadmap before repairing a visible defect. [08](08-animation-and-flight-lab-delivery-plan.md) retains animation acceptance and promotion gates. Read [NEXT_SESSION](NEXT_SESSION.md) and [07](07-v2-blender-motion-handoff.md) before Blender work, and verify historical file identities before reuse.

## Evidence and limits

The supplied screenshots are visual evidence, not executable instructions. Copies are retained here because the original attachments live in temporary folders.

| Evidence | Observation | What still needs reproduction |
| --- | --- | --- |
| [01: cruise overview](evidence/2026-09-13-rebuild/01-cruise-overview.png) | Gothic rebuild selected in Cruise; wings extend beyond the narrow inspection area, limiting silhouette review | Full wingbeat and framing at a documented canvas size |
| [02: wing folds](evidence/2026-09-13-rebuild/02-wing-folds.png) | Strong angular folds and bright patches across the membrane, especially on the image-right wing | Separate skin collapse, normals/material response and intentional folds using matched neutral and textured views |
| [03: vertical framing](evidence/2026-09-13-rebuild/03-vertical-framing.png) | Body lies well below the central reticle; visible shoulder telemetry is near world Y = -4.60 | Exact selected clip/time and the ground/flight transition that produced this state |

Still images do not establish flap timing, foot sliding or tail continuity. Legs and tail are requested improvement areas, not diagnosed defects yet. Do not infer a missing texture from a bright patch alone.

Source reviewed on this date:

- `src/flight-lab/catalog.ts` selects `wyvern-v2-rig.glb`, target size 8.4, heading PI. Its description declares 92 bones and 18 clips; inspect the actual loaded GLB before treating those as verified counts.
- `src/flight-lab/camera.ts` computes camera position around a fixed origin and calls `lookAt(targetX, targetY, 0)`. Its tick receives no animated body anchor. Manual target changes are not vertical following.
- `src/flight-lab/runtime.ts` ticks the camera before mixer/model updates and assigns model Y to -5.45 in ground mode or a small sinusoid in flight. This is a concrete source-level explanation for lost vertical framing, pending browser reproduction. Following alone would not correct the abrupt presentation offset.
- Current files already include concurrent lab changes, including projection preservation and expanded export metadata. Re-read before implementation; do not reapply older plan 09 baseline findings blindly. The player asset and asset budget are also already dirty.

## 1. Pin the failing baseline

Inspect working-tree changes and the live Blender scene's filepath/unsaved state. Use Blender MCP for authoring, on a separate study/action/mesh copy. Verify the export-safe study recorded in plan 07 rather than opening an older rejected membrane export. Hash the loaded lab GLB, source study and each candidate; preserve the original player and all unrelated work.

Record clip, exact seconds, verified authoring frame rate, transforms, camera state, viewport and hash for each reproduced defect. Inspect isolated clips with imported NLA/blends disabled, then repeat through normal runtime transitions. Keep authored movement distinct from lab presentation movement. Run the existing motion audit on the actual files; historical cruise-reset measurements are references, not proof that today's file has the same defect.

Deliver baseline full-cycle video or frame sequences from front, side and rear/three-quarter views, plus contact and landmark measurements. Include 16:9 and 3:2 browser captures. Establish a failing measurement/test before each fix. Derive numerical limits from the matched source, calibrated model scale, measured pixels or device evidence, and record their provenance before acceptance.

Pin front, side and top silhouette references in the rest pose and at maximum wing extension, recovery fold, grounded support and flight tuck. Record body length, span and limb proportions in the same coordinate system. Use these to distinguish a shape defect from a bad pose; proportion changes need a demonstrated mismatch, not a general anatomy redesign. Compare against the supplied source, whose fantasy anatomy is the visual reference rather than a claim of biological accuracy.

Record transform ownership explicitly: imported armature/root motion, authored bone motion, lab model translation/rotation, then camera motion. The current runtime adds pitch/roll with a fixed per-frame lerp and a separate flight bob. Those presentation transforms can alter the apparent performance and depend on rendering cadence. Evaluate the authored clip with presentation motion disabled before editing it; test enabled presentation separately at different frame intervals. Do not bake compensation for lab movement into the Blender action.

## 2. Restore vertical following and reliable inspection

Files: `src/flight-lab/camera.ts`, `runtime.ts`, `types.ts`, associated controls and `test/flight-lab.test.js` as needed.

1. Reproduce ground → takeoff → cruise → land → ground, plus pause, seek and stepping. Log animated body world Y, camera Y, target Y and projected body center. Also reproduce with a deterministic translated test subject so the camera test does not depend on clip quality.
2. Resolve a stable torso/pelvis anchor from verified rig bindings after mixer and presentation transforms update and world matrices are current. Avoid following wing tips, tail tips or a per-frame whole-body bounding-box center, which changes with the flap. Define a stable model-root fallback and report missing bindings.
3. Keep authored motion intact. Separate the follow anchor from user pan offsets; translate both camera position and look target with it so distance/elevation remain coherent. Chase follows by default. Keep matched orthographic inspection views fixed by default, with an explicit follow choice and serialized state for repeatable comparisons.
4. Replace the unexplained ground/flight placement jump with calibrated floor/body placement and a documented transition policy. Derive support height from validated contact geometry; do not erase authored root translation or move the floor every frame to hide sliding. Do not drive the camera from illustrative altitude labels.
5. Use frame-rate-independent smoothing only if measured playback calls for it. Snap deterministically after seek, reset or asset load; specify pause behavior. Preserve orbit, pan, zoom and orthographic projection on resize. Serialize anchor/follow mode and offsets in evidence exports.

Camera comfort check: distinguish sustained root ascent/descent from periodic torso bob. For Chase, compare direct tracking with a filtered body anchor using the same recorded motion; measure projected body excursion, camera oscillation and lag during takeoff/landing. Choose filter settings from those results, without suppressing sustained vertical travel. Keep exact unsmoothed following available for diagnosis. Hold the chosen horizon/elevation through banking unless an explicit camera mode requests roll; avoid automatic zoom or lead changes on every wingbeat. Keep headroom and space in the viewing direction using the measured motion envelope, not an assumed gameplay velocity. Flight Lab's illustrative speed does not justify velocity-based look-ahead.

Acceptance: a known vertical translation moves camera and target by the same amount in unsmoothed follow; the body stays at the intended screen anchor through vertical motion. With smoothing enabled, report tracking error and settling time against documented limits. Manual pan persists, scrubbing has no stale target, and fixed matched views remain fixed. Fit once to measured full-cycle bounds with a documented margin so wings and tail stay visible without zoom pumping. Prove a mutant that freezes target Y is rejected, and test actual runtime update order in the browser.

## 3. Repair the wingbeat, then membrane deformation

Authoring scope: verified v2 Blender candidate, shoulder → elbow → wrist → hand → six digit chains and membrane panels. Runtime scope is limited to isolating playback and faithfully evaluating the export.

1. Review cruise first at full speed and slow motion, including each internal beat boundary and the loop boundary. Plot world-space shoulder, elbow, wrist and digit-tip paths alongside local rotations. Compare the supplied source at matching body orientation and phase; do not assume mirrored bones use the same signed axis.
2. Identify whether wrong motion comes from authored tracks, rest axes/parenting, mixer blends or presentation rotations. Correct the smallest responsible layer. Preserve a readable power stroke, coordinated elbow/wrist extension and a recovering upstroke; digit and membrane lag should follow the established source performance rather than synchronized rigid paddles. Do not invent amplitude or cadence without the reference comparison.
3. Only after the skeletal stroke is sound, hold identical poses and compare skin deformation. Inspect root attachment, elbow fold, wrist fan and trailing edge. Repair local weights/panel influence or demonstrated topology defects on a duplicate mesh. Preserve deliberate folds, texture identity and silhouette; do not use lighting changes to conceal collapse.
4. Recheck weight normalization and the documented four-influence export limit. Compare the Blender authoring result with the exact re-imported GLB, including neutral-material and textured passes. A good high-influence Blender preview is insufficient.
5. Extend the accepted cruise treatment to `bankLeft` and `bankRight`, preserving intentional asymmetry, then qualify takeoff, land, hover, glide, dive and speed individually. Phase carry applies only to proven compatible loops.

Acceptance: no internal reset, reversed joint sweep, accidental membrane inversion, root tearing or hard pinches in the identified regions across complete cycles. Record angular/vertex displacement and velocity through internal and loop seams with consistent coordinate spaces. Check continuous playback, not only endpoint equality. A deliberately corrupted flap track and local skin-weight mutation must fail the relevant checks. A clean rotation scan alone never approves a wing surface.

### Whole-body coordination and head stability

Use one phase sheet for a complete cruise beat: upper reversal, mid-downstroke, lower reversal and mid-recovery, plus intermediate samples around any discontinuity. Plot chest/pelvis translation and pitch alongside wrist motion, leg tuck and tail-base rotation. Compare phase relationships with the source at its original timing before normalized-phase comparison. Repair demonstrated separation between the wings and torso; do not add a generic sine-wave body bounce or require every segment to peak together.

Inspect the head's world orientation and its motion relative to the chest in side and front views. Preserve intentional gaze changes while removing demonstrated jitter or excessive inherited roll. Check the current v2 hierarchy with a neck-only rotation probe on a duplicate pose: measure whether shoulder/wrist transforms change. The historical neck-to-wing coupling described for the original Drogon is not evidence that v2 has the same defect. Do not reparent bones or add compensating keys without reproducing coupling on this rig.

Acceptance: the full animal reads coherently in uninterrupted playback; chest response, leg tuck and tail follow-through retain the intended phase relationship after export. Head motion has no unexplained discontinuity, and any neck isolation requirement has measured before/after landmark evidence. Include a fixed-camera pass so camera smoothing cannot hide body jitter.

### Membrane shading diagnosis

At the exact failing pose, capture textured, uniform rough-material, wireframe and surface-normal views with the same camera and fixed lighting. Check front/back orientation, normals/tangents, material assignments and texture load results on the exported mesh. If the ridge persists in silhouette or wireframe, investigate geometry/weights; if it appears only in the shaded pass, inspect shading inputs before changing the rig. A missing texture must be established from the actual material/load result. Do not globally smooth normals, disable culling or increase exposure merely to conceal a local defect.

## 4. Give legs credible support and flight posture

Identify actual sole, toe and wing-knuckle contact patches against the source and a calibrated floor before correction. Plan 07 explicitly records that dominant-weight minima were insufficient to infer forelimb support; do not add arbitrary IK from that earlier measurement.

- Ground: map stance/swing phases for both legs in idle and walk. Measure planted-patch displacement, floor penetration and toe clearance in world units; account for intended root travel before calling movement sliding. Correct pelvis weight transfer, knee/ankle bends and toe release in dependency order. Preserve the wyvern's anatomy.
- Flight: verify hip/knee/ankle tuck under the body through cruise and both banks. Remove demonstrated dangling, clipping or cycling inherited from an unrelated ground pose. Keep asymmetry when supported by the source action.
- Transitions: inspect final support and push-off in takeoff, then extension, touchdown and settling in land. Do not allow an automatic mode switch or crossfade to hide a contact teleport.

Acceptance: validated planted contacts remain stable within source-derived tolerances; swing feet clear the floor; joints do not pop or intersect the body; flight posture holds through complete beats. Capture side/front contact sequences and contact trajectories. Mutate a planted-foot key to prove the slip gate detects it. Mark intentional contacts and airborne intervals explicitly.

## 5. Restore continuous tail motion

Bind and inspect the complete pelvis-to-tip chain. Measure rest lengths, local rotations and world-space trajectories at base, middle and tip before changing keys. Review cruise and walk first, then banks, takeoff and landing.

Preserve a strong tail base with progressively delayed follow-through toward the tip where supported by the source. Correct measured rigid sections, kinks, excessive oscillation or seam snaps locally. Check body/leg/wing and floor clearance throughout the swept motion. Do not overlay a procedural oscillator on an authored defect. A procedural proposal requires its own isolated evaluation before integration.

Acceptance: no visible kink, instantaneous tip reversal, unintended stretch or floor/body intersection across complete loops and transitions. Assess angular velocity as well as positional seam closure. Record base/mid/tip paths and side/top footage. Inject a distal-tail seam error to prove the continuity check fails.

## Shared clearance checks

Track wing-to-leg, wing-to-tail, wing-to-body, left-to-right folded wing and foot/tail-to-floor clearance through the affected clips and blends. Start with the visible problem regions, using sampled deformed surface patches rather than bone distances alone. Broad bounds can identify candidate collisions but cannot prove membrane clearance. Inspect intermediate and subframe poses around minimum separation, especially the wrist fold, tucked feet and landing extension.

Record the closest patches, clip time, signed separation or intersection evidence, calibrated units and screenshot. Distinguish intended attachment/contact from accidental penetration; adjacent membrane panels and planted toes must not produce false failures. Derive clearance tolerances from the source surface and export precision. Re-run these checks after changes to weights, body motion or transition fades, since individually valid endpoints can intersect during blending.

## 6. Round-trip and qualify the combined candidate

Export only the intended scene/selection; verify one intended skin, rig/clip names and counts against the pinned baseline, normalized weights, materials, bounds and scale. Re-import the exact exported file in Blender and evaluate that same hash with Three.js. Preserve all unaffected clips and flag changed ones in the plan 08 ledger as unreviewed, failed, candidate or accepted.

Run idle → walk → idle; ground → takeoff → cruise; cruise ↔ each bank; cruise → land → idle; and representative flight/ground action interruptions. Review full cycles for all affected clips, with identical baseline/candidate framing and lighting at 16:9 and 3:2. Record static, Blender, browser and gameplay evidence separately. Player promotion remains outside this repair delivery and requires plan 08's explicit qualification.

For cruise/bank transitions, trigger at the four measured stroke phases used in the phase sheet, in both directions. Record outgoing/incoming clip times, effective weights, fade duration, root transform and completion state. Compare wrist, foot and tail trajectories during the blend, not just the first and last poses. Verify takeoff hands off after the intended support release and landing settles into the intended grounded pose. Select fade duration from pose/contact evidence; do not lengthen every fade to mask mismatched performances. Test interruption and pause/seek/resume separately so blend state cannot masquerade as an authored defect.

### Rendering cost and export regression

Before increasing bones, vertices, material slots or adding membrane simulation, measure the current exact GLB in the target browser on the user's device. Record device/browser, canvas dimensions, pixel ratio, overlays, shadows and asset hash. Repeat the same full-cycle playback with the candidate after loading/shader warm-up. Compare frame-time distribution, draw calls, triangle count, texture/geometry counts and file size; include GPU timing only when actually available. Renderer resource counts are not precise GPU-memory measurements.

Use repeated comparable runs to establish measurement variation and set a justified regression budget. Keep camera and overlays identical, and record whether frame rate is display-capped. No fixed FPS claim or arbitrary larger asset budget is an acceptance substitute. If extra geometry or simulation is proposed, demonstrate the visible improvement alongside its measured cost; prefer the local track/weight repair when it achieves the same result.

For implementation, run focused regression tests and the repository gates: `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test:fast`, `pnpm sim:wildlife`, `pnpm invariants:mutate`, `pnpm docs:check`. Read installed Next.js guides before route changes. Keep runtime frame mutations outside React state, preserve core purity and the Sanctuary porting seam. Record pre-existing failures separately.

## Deliverables and next action

Deliver a preserved baseline, separate Blender candidate, exact round-tripped GLB, per-defect before/after evidence, camera regression evidence and a clip/transition acceptance ledger. Each entry must identify the artifact hash, reproduced failure, change, measured result and unresolved issues. Include the silhouette references, whole-body phase sheet, clearance results, shading diagnosis and comparable rendering-cost measurements where affected by the repair.

Begin with the vertical-camera reproduction and fix so subsequent body inspection remains visible; then repair one reproduced cruise wingbeat defect, followed by membrane deformation, legs and tail. Do not mark any phase complete from this document alone. Current completion: plan and retained user screenshots only; no fresh Blender playback, browser reproduction or asset approval has been performed.
