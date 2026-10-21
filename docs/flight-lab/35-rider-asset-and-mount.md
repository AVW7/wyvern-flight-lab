# Rider Asset and Mount

**Date**: 2026-10-21
**Status**: Asset built, mounted, verified. Not yet visually polished.

---

## 1. Why a separate GLB

`tools/blender/runtime_rig_contract.mjs` asserts four things about
`wyvern-v2-rig.glb`: skin count, joint count, mesh count, and a full node TRS
signature. `test/wyvern-v2-kinetics.test.js` asserts clip wiring on top of that.

Merging a rider into the wyvern would break all five. A separate
`public/models/wyvern-rider.glb` breaks nothing, at the cost of one extra load
and one matrix multiply per frame.

The rider is **not** parented to the wyvern. It is a sibling in `world`, driven
each frame from Spine3's world matrix. Being a bone child would place it inside
the model, where it would be picked up by `measureBounds` (changing
`largestExtent` and therefore the entire scene scale), by `scanSeam` (sampled as
wyvern geometry), and by the landmark cache (keyed on node names under the model
root).

---

## 2. The asset

Built by `tools/blender/build_rider.py`, headless, deterministic — a rebuild is
byte-identical (verified: same SHA-256 across two runs).

| Property | Value |
|---|---|
| Bones | 24, all `RDR_`-prefixed |
| Triangles | 2,860 across 2 primitives (armour, cloak) |
| Vertices | 1,494 |
| Clips | 4 — `rider_idle`, `rider_leanLeft`, `rider_leanRight`, `rider_brace` |
| Skins | 1 |
| Orientation | +Y up, +Z forward, matching the wyvern |
| Scale | authored in wyvern units; object scale 1 |

Contract: `scripts/blender/wyvern_rider_runtime_contract.json`, validated by
`tools/blender/rider_runtime_contract.mjs` and
`test/rider-runtime-contract.test.js`.

Bone hierarchy is a conventional humanoid: `Root → Pelvis → Spine1..3 → Chest →
Neck1..2 → Head`, with `Cloak` off the chest, arms off the chest, legs off the
pelvis. `RDR_Root` carries no geometry by design — it exists so the asset has a
single origin to mount.

Weights are rigid: each armour primitive is 100% weighted to one bone. That is
deliberate for plate armour and means the skin is correct by construction rather
than by weight painting. Joints are covered by overlapping icosphere "guards" so
no gaps open.

---

## 3. Scale derivation

This number is load-bearing and easy to get wrong silently, so it is derived
rather than chosen.

`tools/measure-wyvern-saddle.mjs` measures the wyvern body mesh at
**2822.4 × 1067.3 × 4162.2** world units. Reading that build as a ~10.4 m
nose-to-tail animal gives 4162.2 / 10.4 = **400.2 units per metre**, rounded to
**400**:

| Quantity | Units | Metres |
|---|---:|---:|
| Body length | 4162 | 10.4 |
| Shoulder height | 1067 | 2.67 |
| Wingspan (membrane) | 6267 | 15.7 |
| Head mesh | 345 | 0.86 |
| Saddle back height | 999 | 2.50 |

A 1.8 m rider is therefore 720 units standing, and the seated model is 530 units
tall — **50% of the wyvern's body height**, which is the proportion of a person
on a large horse. It is 17% of the body length.

**Decision point.** At this scale the rider is small against a 15.7 m wingspan and
reads as a detail rather than a character. If Aj wants a more prominent rider,
the honest lever is `RIDER_HEIGHT_M`, not a fudge to the mount — raising it to
2.4 m would make the rider 66% of body height. Everything downstream
(`build_rider.py` → contract → calibration) regenerates from that one constant.

---

## 4. Mount calibration

`tools/calibrate-rider-mount.mjs` derives the seat from geometry and writes both
`scripts/blender/wyvern_rider_mount.json` (audit) and
`src/flight-lab/rider/mountData.ts` (runtime). Nothing is transcribed.

An earlier attempt carried the mount as a literal in a plan document and it did
not reproduce — one figure was Spine3's world position, another its *local* node
TRS from the runtime contract. Deriving it removes the ambiguity.

Derivation:

1. Spine3's bind world position — **(0, 783.439, 25.186)**.
2. Seat surface — p98 of body-mesh vertex heights within 80 units of Spine3's
   x/z: **y = 999.21** (2.498 m). The disc cuts the whole body cross-section, so
   p50 lands on the belly (~440); p98 is what reads as "the back".
3. Rider pelvis sits 48 units above the rider's own origin, so the rider origin
   must be at **y = 951.21**.
4. Offset from Spine3, expressed in Spine3's local frame:
   **(-0.001, 27.033, -165.579)**.

The seat height is a plateau, not a knife edge — recorded in the JSON so nobody
has to re-derive it:

| Sample radius | p98 seat height |
|---:|---:|
| 60 | 992.27 |
| 80 | 999.21 |
| 120 | 992.27 |
| 200 | 1037.4 |

Across radii 60–260 that is 992 → 1031, i.e. about 1 cm at 400 units/metre.

---

## 5. Three bugs found and fixed

**Double scaling — the rider was invisible.** `spine3.matrixWorld` already
carries the wyvern's `normalizedClone` factor, because Spine3 is a child of the
normalised model. Multiplying by `S(scale)` on top applied it twice: the rider's
world scale came out at 1.8e-6 against an intended 1.34e-3, roughly 1/670 of its
size. It loaded, animated, was correctly positioned, and rendered nothing
visible. `riderMatrix` now decomposes Spine3's world matrix, discards the parent
scale, and composes with exactly one factor.

The first version of the test for this *passed while the bug shipped* — it
asserted the offset scaled linearly, which both formulas satisfy, and never
checked the rider's own scale. It now asserts the world scale directly, and was
confirmed live by re-applying the old formula (fails with
`1.799e-6 should equal 1.341e-3`).

**Limbs were vertical.** Arm and leg cylinders were built along +Z and never
rotated to follow their bones, so every limb stood as a vertical post. Parts of
kind `limb` now take two endpoints and orient via
`rotation_difference`.

**Legs were buried in the torso.** The wyvern's back is 374 units (0.94 m) wide
at the saddle and still 250 units wide at shin height. The rider's legs hung at
x = ±52 units — about 18 cm inside the body. Measured profile:

| Height | Body half-width |
|---:|---:|
| y 800 | 179 units |
| y 850 | 124 units |
| y 900 | 126 units |
| y 950 | 158 units |

The stance was widened so knees sit at 0.30 m and ankles at 0.47 m (188 units),
clearing the flanks. The rider's X extent is now 420 units against a 374-unit
back — a wide but physically necessary seated stance.

---

## 6. Runtime integration

| File | Role |
|---|---|
| `src/flight-lab/rider/mountData.ts` | generated mount constants |
| `src/flight-lab/rider/riderMount.ts` | `riderMatrix`, `uniformScaleOf` |
| `src/flight-lab/rider/riderClip.ts` | wyvern clip → rider clip |
| `src/flight-lab/rider/riderRuntime.ts` | load, skinned clone, own mixer, per-frame follow |
| `src/flight-lab/rig/mixerBindings.ts` | mixer flush, extracted from `runtime.ts` |
| `src/flight-lab/runtime.ts` | creates the rider after the mixer; updates it each frame; disposes it in `clearModel` |

Details that matter:

- **Skinned clone.** `SkeletonUtils.clone`, not `Object3D.clone` — the latter
  shares skeletons and both copies play the same pose.
- **Own mixer.** Sharing the wyvern's would couple the clip clocks: pausing the
  wyvern to inspect a pose would freeze the rider mid-breath.
- **Clip mapping** is an explicit table, not pattern matching. Eighteen wyvern
  clips map onto four rider clips: banks lean, combat and takeoff/landing brace,
  everything else idles. Unknown clips fall back to idle rather than throwing.
- **Mixer flush.** The rider has the same static-track problem as the wyvern, so
  `flushMixerBindings` is applied to its mixer too. That function reaches into
  three.js private fields (`_bindings`, `_accuIndex`) and is version-fragile;
  `mixerBindingsAreSupported()` exists so a future three.js upgrade can surface
  the break instead of silently reintroducing pose drift.

---

## 7. Verification

- `test/rider-runtime-contract.test.js` (7): contract match, orientation read
  geometrically, clip set, tri budget, and a mutated GLB that must be rejected.
- `test/rider-mount.test.js` (8): seat placement, scale applied exactly once,
  offset consistency, non-uniform-scale rejection, clip coverage, and a check
  that `mountData.ts` is regenerated rather than hand-edited.
- Live scene, measured through a temporary debug handle (since removed): rider
  world scale 1.341e-3 matching the wyvern, rider origin 0.221 world units above
  Spine3, 1 skinned mesh, 2,860 tris, 4 clips.
- Screenshot in light theme confirms the rider sits on the back at the shoulder.

---

## 8. Known limitations

- The rider is low-poly and rigid-skinned. It reads as a small armoured figure,
  not a detailed character.
- Only four clips. `rider_brace` covers death, which is a compromise — a slump
  would be better.
- No IK. On a wyvern whose spine bends hard in `bankLeft`, the rider follows the
  spine rigidly rather than counter-rotating to keep its head level.
- The default chase camera frames the 15.7 m wingspan, so the rider is small on
  screen. That is framing, not scale.
