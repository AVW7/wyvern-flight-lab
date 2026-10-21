# V1 wing harvesting implementation and candidate review

4 October 2026. Implements the first measured cruise work package from [18-v1-harvest-gap-audit.md](18-v1-harvest-gap-audit.md). This is a working harvesting pipeline and a separate review candidate, not a replacement of all 18 animations.

## Implemented

- Explicit V1/V2 GLB inputs, a dedicated headless Blender process, exact imported action identity, real per-frame baking and GLB export. Unsupported ground/full-body recipes fail explicitly instead of reporting success.
- A Meshopt import-copy decoder retains geometry, skin and animation data without modifying either original. Blender 5.1.1 cannot import the compressed runtime asset directly.
- Measured importer-space pairing: 38 arm and D0–D4 joints, unique donors, anatomical side and parent-chain checks. Arm/digit residuals measure at most about 0.419 rig units, inside the documented 1-unit bound. Blender already normalizes the scale/orientation: applying the previously documented extra 100× transform is incorrect for these imported inputs.
- V2 membrane battens have no direct V1 matches. The right D5 thumb also differs materially (up to about 19.91 units). Panels, both thumbs, the arm chain and leading D0 remain authored V2. The final package replaces only the 24 D1–D4 rotation channels.
- Source/target cycle correlation, explicit mirrored cruise motion, quaternion sign continuity, measured endpoint correction and phase-zero V2 pose calibration. The existing 24–82° distal recovery repair and its joint weights are reused from `author_v2_bank_clips.py`; donor static fold bias is removed before that repair.
- Packaging verifies donor and base hashes, clip identity, unique/nearby mappings and the selected bone subset. It preserves the original binary prefix, geometry, materials, skeleton, other animations and every unselected track. Missing donors, stale inputs, corrupted provenance and protected-root substitutions reject before writing.
- Runtime wing offsets fade continuously from the existing clearance/speed cutoffs. The fade band is one cutoff width: 0.5–1.0 clearance and 2–4 horizontal speed. This preserves zero offsets at authored contact while removing the measured discontinuity. Airborne hover bypasses the horizontal-speed suppression. These are procedural fixes, verified by regression tests; no browser visual claim is made for them.
- Endpoint audits now separate radians from rig-unit translation and show loop seam as not applicable for one-shots. Existing position and rotation limits remain unchanged.
- The hard-coded runtime aerodynamic envelopes are correctly labelled provisional V1-inspired curves. They are not promoted as measured extracts or donor wingbeat timing.

## Candidate and visual evidence

Final review asset: `assets/harvest-candidates/2026-10-04/wyvern-v2-cruise-final-candidate.glb`.

SHA-256: `0c79fddd51ce19ccb23188f33930891eb7589276817ef2fce94371b01238b9a5`.

Its donor is the existing `public/models/player-wyvern.glb`, exact `FlightCruise` action. This contains the dedicated V1 cruise performance with its actual skin; `drogon-sanctuary.glb` is an animation-only sidecar and is rejected as a standalone rig input. The source files are unchanged. Detailed hashes, mappings, reference quaternions, samples and recipe are in `cruise-final-donor.harvest.json` beside the candidate.

| Measurement | Final candidate |
|---|---:|
| Canonical clips / joints / shared skins | 18 / 92 / 1 |
| Cruise duration / cadence | 6 s / 0.500 Hz |
| Cruise wingtip symmetry residual | 0.0010 m |
| Cruise rotation / translation loop seam | 0.0007 rad / 0.0004 rig units |
| Root travel | 0 |
| Worst sampled cruise angular step at 96 Hz | 5.117°, R_WingD1P1 |

The baseline sampled cruise step is 3.834°. The candidate therefore adds faster trailing-digit motion; this is recorded, not described as an across-the-board smoothness improvement. Its world-space loop endpoint is 0.05877°, matching the baseline because the arm/leading-edge framework is preserved.

Matched front inspection captures cover eight phases of one complete wingbeat, using 16:9 and 3:2 frames. Both contact sheets were inspected:

- [16:9 baseline/candidate comparison](../../../assets/harvest-candidates/2026-10-04/evidence-final/comparison-16x9.jpg)
- [3:2 baseline/candidate comparison](../../../assets/harvest-candidates/2026-10-04/evidence-final/comparison-3x2.jpg)

Earlier wider transfers failed either symmetry or visual suitability: full arm/leading-edge transfer introduced excessive folding and pinched membrane silhouettes. The final narrower transfer preserves the V2 wing framework and changes trailing-edge articulation. Sharp panel curvature is still visible in some poses. These Blender clay captures expose pose and geometry; they do not qualify runtime materials, procedural overlays, transitions or gameplay. No runtime asset or promotion contract was replaced.

## Reproduce

Use a new output path on each run. `--performance player-cruise` selects the dedicated cruise; `landing-window` remains an explicit experimental recipe.

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 \
  --python tools/blender/harvest_v1_to_v2.py -- \
  --v1-source public/models/player-wyvern.glb \
  --v2-source public/models/wyvern-v2-rig.glb \
  --clip cruise --performance player-cruise --wing-only \
  --out /tmp/cruise-review-donor.glb
```

Write a donor-map JSON such as `{"cruise":"/tmp/cruise-review-donor.glb"}`, then:

```sh
node tools/blender/package_harvested_clips.mjs /tmp/wyvern-cruise-review.glb /tmp/donors.json
node tools/audit-all-clips.mjs /tmp/wyvern-cruise-review.glb
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 \
  --python tools/blender/render_harvest_review.py -- \
  --candidate /tmp/wyvern-cruise-review.glb --out /tmp/wyvern-cruise-evidence
```

## Checks and remaining work

Regression measurements were red before their implementation. Fast tests: 840/840 passed, plus final focused provenance/preservation checks. Typecheck and lint passed. Mutation checks: 123/123 killed, including eight new harvest/metric corruptions plus protected-root and unverified-subset cases. Wildlife: all 16 species passed.

Remaining audit work is explicit: ground contact baking/clearance, bank trajectory validation, full-body performance, generated aerodynamic profile provenance, local membrane weight repair and runtime procedural-on/off plus transition review. Unsupported recipes are deliberately rejected. Keep this candidate separate until those relevant visual/runtime gates pass; gameplay promotion remains separate.

Bank trajectory validation and candidate work subsequently continued in [20-v1-bank-harvest-and-direction-gates.md](20-v1-bank-harvest-and-direction-gates.md). The remaining-work statement above records this cruise implementation stage.
