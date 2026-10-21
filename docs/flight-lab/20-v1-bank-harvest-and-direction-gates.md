# V1 bank harvest and direction gates

Updated 4 October 2026. Continuation of [19-v1-harvest-implementation.md](19-v1-harvest-implementation.md).

## Implemented result

The harvester now accepts explicit `--performance player-bank` recipes for the exact V1 `BankLeft` and `BankRight` actions. Each transfer changes only the 24 D1–D4 wing rotation channels. Existing V2 shoulders, arms, leading edge, panels, thumbs, body, root, legs, geometry and other animation channels remain intact.

Independent native donor transfers failed the opposed-bank trajectory gate: 4.7561 m residual. That rejected experiment remains `assets/harvest-candidates/2026-10-04/banks/wyvern-v2-bank-candidate.glb`. It must not be promoted.

The review candidate derives its right trailing-digit performance by reflecting and swapping the harvested left donor's selected rotation channels. It is explicitly a derived opposed bank, not an independently harvested native V1 BankRight. The donor manifest records its parent hash and reflection policy.

Candidate: `assets/harvest-candidates/2026-10-04/banks/wyvern-v2-bank-mirrored-candidate.glb`.

SHA-256: `34ca702f5812b821b138a8047cbc8a6bf6ac4da74b45d8bdf289c812a29ccc4d`.

The active V2 remains `b0667a7bf5b1484a216ed9851b26ccad3fa6d833a104beb9ed59b1898f725d3c`; V1 player remains `0e37110bca94bbe4cb064e4a075e15fce19f23cdbb71a4535f4d289b5549b329`.

## Measured gates

Before implementation, the audit accepted a right-bank clip copied from left-bank. The regression reproduced that failure. The audit now samples all paired wing bones at 49 normalized phases in Body-local coordinates and compares reflected, swapped trajectories. Baseline and corrected candidate both measure 0.0011 m. The limit reuses the existing 0.25 m mirror budget in `scripts/validate-wyvern-clips.mjs`, including its existing 0.0072 m per rig-unit conversion.

A second regression injects a 0.2-radian root rotation into right-bank only. Local wing coordinates hide this corruption, so the audit also compares reflected Body world-rotation deltas relative to its bind orientation. The corrected candidate measures 0.0000 radians; its limit reuses the existing 0.05-radian rotation seam budget. This checks consistency without claiming the authored clips contain nonzero body roll.

Both regressions pass. The mutation suite kills both gate-disabling mutations, with 125/125 overall. Typecheck and lint pass. Fast tests pass 842/842; all 16 wildlife routines pass. Documentation metrics are synchronized. Full clip audit passes all 18 clips.

## Visual evidence and limits

Matched Blender clay renders were inspected at eight phases in both 16:9 and 3:2:

- [Left bank 16:9](../../../assets/harvest-candidates/2026-10-04/banks/evidence-left/comparison-16x9.jpg)
- [Left bank 3:2](../../../assets/harvest-candidates/2026-10-04/banks/evidence-left/comparison-3x2.jpg)
- [Right bank 16:9](../../../assets/harvest-candidates/2026-10-04/banks/evidence-right/comparison-16x9.jpg)
- [Right bank 3:2](../../../assets/harvest-candidates/2026-10-04/banks/evidence-right/comparison-3x2.jpg)

The opposite bank silhouettes remain visible. Trailing articulation changes, but sharp creases and pinched panels remain at some phases. These captures do not qualify runtime materials, procedural overlays or transitions. Local membrane weight repair and runtime review remain necessary before promotion. No dev server was needed for these asset measurements and direct Blender renders.

## Reproduce

Use fresh output paths. Bake the left donor:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 \
  --python tools/blender/harvest_v1_to_v2.py -- \
  --v1-source public/models/player-wyvern.glb \
  --v2-source public/models/wyvern-v2-rig.glb \
  --clip bankLeft --performance player-bank --wing-only \
  --out /tmp/bank-left-donor.glb
node tools/blender/mirror_bank_donor.mjs /tmp/bank-left-donor.glb /tmp/bank-right-donor.glb
```

Write a donor-map JSON with `bankLeft` and `bankRight` pointing to those paths, then:

```sh
node tools/blender/package_harvested_clips.mjs /tmp/bank-review.glb /tmp/bank-donors.json
node tools/audit-all-clips.mjs /tmp/bank-review.glb
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 \
  --python tools/blender/render_harvest_review.py -- \
  --candidate /tmp/bank-review.glb --clip bankLeft --out /tmp/bank-left-evidence
```

Repeat rendering with `--clip bankRight` and a separate evidence directory. Ground/contact and full-body harvest recipes remain unsupported.
