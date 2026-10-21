# Stage 3: what V2's clips actually get wrong

**Date**: 2026-10-21
**Status**: Diagnosis complete. One of nine clips fixed and gated. Five need work this tool cannot do.

---

## 1. Why a second channel was needed

[36-v2-dynamics-gate.md](36-v2-dynamics-gate.md) established that V2 fails a
dynamics gate on 27 checks. It did not explain *why*, and the two plausible
explanations need opposite fixes:

- **the pose travels less** → scale the pose (exaggeration, one number)
- **the pose travels the same but slowly** → compress the timing

Rate alone cannot separate them. `tools/diagnose-clip-dynamics.mjs` adds
**travel**: cumulative `|dq|` over the clip, in degrees, for the bone that
travels most. Cumulative rather than range, because the angle between two
quaternions saturates at 180° — a wing that sweeps 400° and back reports 180
twice, not 400. Summing per-frame deltas has no ceiling.

Run it on either rig:

```
npm run assets:diagnose-dynamics
node tools/diagnose-clip-dynamics.mjs public/models/player-wyvern.glb
```

---

## 2. The measured table

Mapped pairs only, deforming bones, 60 Hz. `travelR` and `p95R` are candidate ÷
reference.

| clip | travelR | p95R | peakR | sustain<br>`p95R/travelR` | duty V1→V2 | class |
|---|---:|---:|---:|---:|---|---|
| cruise | 0.576 | 0.560 | 0.480 | 0.97 | 0.46 → 0.47 | **UNIFORM** |
| bankLeft | 0.275 | 0.262 | 0.245 | 0.95 | 0.14 → 0.15 | **UNIFORM** |
| bankRight | 0.275 | 0.267 | 0.271 | 0.97 | 0.22 → 0.15 | **UNIFORM** |
| attack | 0.081 | 0.092 | 0.092 | 1.13 | 0.17 → 0.36 | **UNIFORM** |
| idle | 0.240 | 0.077 | 0.423 | 0.32 | 0.10 → 0.01 | CONCENTRATED |
| walk | 0.859 | 0.279 | 0.435 | 0.33 | 0.33 → 0.23 | CONCENTRATED |
| attack2 | 0.908 | 0.355 | 1.145 | 0.39 | 0.27 → 0.01 | CONCENTRATED |
| takeoff | 0.179 | 0.267 | 0.079 | 1.49 | 0.01 → 0.52 | BUZZ |
| death | 0.115 | 0.242 | 0.414 | 2.11 | 0.11 → 0.02 | BUZZ |

### The classification rule

One axis: **`sustainRatio = p95R / travelR`**, how much the *sustained* level
moved per unit of total travel.

| class | rule | what it means | what fixes it |
|---|---|---|---|
| `UNIFORM` | 0.6 ≤ r ≤ 1.4 | travel and sustain fell together | gain (exaggeration) |
| `CONCENTRATED` | r < 0.6 | travels, but in brief excursions with dead air between | shape / filled motion |
| `BUZZ` | r > 1.4 | fast motion through a small range — a vibration, not a sweep | range, not rate |

`peak` is deliberately **not** the discriminator. `idle` scores 0.423 on peak,
which reads as "almost half alive", while its `p95` is 0.077 of reference: it is
frozen and twitches occasionally. Doc 36 records that same trap.

---

## 3. What a gain can and cannot do

`tools/amplify-clip.mjs` scales each bone's rotation away from the clip's first
key, preserving the axis. Axis preservation is what makes it exaggeration rather
than corruption: the bone swings the same way, just further. The first key is the
reference so loop seams survive (first == last stays true) and one-shots start
from their authored pose.

Measured on `wyvern-v2-rig.glb`: animation accessors are uncompressed float32,
each in its own bufferView, none shared with mesh data, and the compressed mesh
region ends at byte 695,961 while animation data starts at 695,964. So the patch
changes float values only — same byte length, same offsets, geometry untouched by
construction. `test/wyvern-clip-dynamics-tools.test.js` asserts that invariant
rather than trusting it.

### The plateau limit

A gain that asks for more rotation than a bone's axes can express hits the
per-key cap and produces a **plateau**: a pose frozen at 160° while its
neighbours keep moving. A plateau *raises* `mean` and `p95` while looking like a
hitch, which is precisely the failure mode doc 36 exists to catch. So the tool
refuses to write a result above a 2% capped-key fraction, and
`tools/build-dynamics-candidate.mjs` solves for the largest gain inside that
limit instead of taking the gain the numbers asked for.

```
npm run assets:amplify-dynamics        # derives gains, writes the candidate
```

| clip | gain the travel gap asked for | gain used | capped keys |
|---|---:|---:|---:|
| cruise | 1.74 | **1.74** | 0.0% |
| bankLeft | 3.63 | **2.94** | 1.7% |
| bankRight | 3.63 | **2.94** | 1.7% |
| attack | 12.28 | **3.47** | 0.0% |

`attack` is the clearest statement of the limit: it needs 12× but its axes supply
3.5× before capping. Amplifying further would freeze poses, not exaggerate them.

---

## 4. Result

Gate: **27 failing checks → 20.**

| clip | outcome |
|---|---|
| cruise | **passes all four channels** |
| bankLeft, bankRight | `peak` and `p95` now pass; `mean` still low (0.586 vs 0.7 floor) |
| attack | 3.5× better on every channel, still far short of reference |
| idle, walk, attack2 | untouched — `CONCENTRATED` |
| takeoff, death | untouched — `BUZZ` |

Seven checks closed out of twenty-seven. That is the honest size of the win: one
clip fixed, two improved, five diagnosed but not addressed.

---

## 5. Structural findings worth keeping

These came out of the diagnosis and constrain whatever Stage 3 does next.

**V2 uses no CUBICSPLINE at all.** Every channel is `LINEAR` or `STEP`. STEP is
used *only* on ≤2-key channels (verified: zero STEP samplers have >2 keys), so it
encodes static poses and is harmless. But linear interpolation between keys has no
ease-in/ease-out and cannot overshoot, which caps `peak` independently of
amplitude. V1's `FlightCruise` is CUBICSPLINE with 28 keys; V2's `cruise` is LINEAR
with 145. Densely-sampled linear is a resampling of a smooth curve, so it
reproduces the curve's peak but never exceeds it.

**V2 animates far fewer bones.** Per clip, rotation channels with more than two
keys:

| clip | V1 moving bones | V2 moving bones |
|---|---:|---:|
| attack | 144 of 218 | 43 of 92 |
| takeoff | 147 of 218 | 84 of 92 |
| idle | 62 of 218 | 36 of 92 |

`attack` moves 43 bones against V1's 144. The remaining 49 rotation channels are
constant poses. **No gain can animate a bone that was never keyed** — this is a
coverage problem, and it is why `attack` cannot be rescued by scaling.

**Timing is not the defect.** Measured wingbeat: V1 cruise 1.00 Hz, V2 cruise
1.08 Hz, against a Pennycuick prediction of ~0.71 Hz for this animal. See
[../2026-10-21-research-notes.md](../2026-10-21-research-notes.md). Re-timing
clips will not close the gap.

---

## 6. What Stage 3 still needs

In the order the evidence supports.

1. **`takeoff` and `death` (`BUZZ`)** — sustained rate outran travel, and takeoff's
   duty cycle went 0.01 → 0.52: an explosive motion replaced by a steady wind-up.
   Needs an acceleration profile (ease-out into the launch, dead air before it),
   not more amplitude.
2. **`idle`, `walk`, `attack2` (`CONCENTRATED`)** — travel is fine, the sustained
   level collapsed. `attack2` has *more* peak than reference (1.145) and `p95` at
   0.355: it snaps and then freezes. Needs the motion distributed across the clip.
3. **`attack` coverage** — key the 49 constant channels, then amplify. Currently
   the gain is capped at 3.5× by an axis budget that only exists because the rest
   of the skeleton is inert.
4. **`bank` `mean`** — needs 3.63×, caps at 2.94×. Either accept 2-of-3 channels or
   re-author the bank with a wider axis budget.
5. **Interpolation** — nothing in V2 is CUBICSPLINE. Adding spline tangents to the
   dominant channels would let peaks exceed the sampled keys, which is what V1
   does. This is likely the single highest-leverage change left.

---

## 7. Reproduction

```
npm run assets:diagnose-dynamics     # the table in §2
npm run assets:amplify-dynamics      # derive gains, write the candidate
npm run assets:audit-dynamics:v2     # gate the shipped rig
node tools/build-dynamics-candidate.mjs --gate   # gate the candidate, before/after
```

Tests: `test/wyvern-clip-dynamics-tools.test.js` (12) pins the classifier against
the real measured pair and the quaternion math against closed-form answers.
Both are proven live by mutation: dropping the input normalisation in `amplify`
turns the suite red with a 0.87° error.
