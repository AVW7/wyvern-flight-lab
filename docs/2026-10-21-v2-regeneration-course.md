# Regenerating the best wyvern: audit of V1-as-reference, and the course I'd take

**Date:** 2026-10-21 · **Audited at:** `2b8373d` · **Instruments:** `tools/audit-wyvern-rig.mjs` (now runs on both rigs), GLB JSON parse, 123-test suite.

V1 is the reference. Fine — but a reference is only useful if the pipeline can measure it, and right
now nothing in this repo could. That was the first thing to fix, and it changed the answer.

---

## 1. What the two rigs actually are

| | V1 `player-wyvern.glb` | V2 `wyvern-v2-rig.glb` |
|---|---:|---:|
| Joints | 292 | 92 |
| Skins | **2** | **1** |
| Non-deforming joints | 127 (43%) | 7 (7.6%) |
| Max influences / vertex | 3 | 4 |
| Triangles | 39,234 | 49,872 (+27%) |
| Clips | 13 | 18 |
| Bind extent | 62.7 units | 6,266.8 units |
| Metres per unit | 0.09247 | 0.000926 |
| Hierarchy depth | 20 | 13 |
| File | 5.92 MB | 5.74 MB |

V1's 292 joints are not 292 bones of dragon. They are:

- **`Bip002_*`** — the wyvern (~150 deforming joints)
- **`Bip001_*`** — a **complete human rider**, parented under `Bip002-Spine3`
- **`Cloak_*`** — 17 cloak bones on that rider
- 127 non-deforming helpers and `_end` tips

So V1 is a *rider-plus-mount* asset. Any harvest that walks the bone list without filtering takes
the rider's arms for wing bones — the audit's first contact-bone guess landed on `Bip001-L-Toe0`,
the human's toe, not the wyvern's.

**V2 is the better rig.** One skin, 7 dead joints instead of 127, a real 5-digit wing with panel
chains, 13 levels of depth instead of 20. That part of the rebuild worked.

## 2. What V1 has that V2 lost: the snap

Peak angular velocity, same clip, both rigs, measured at 60 Hz:

| Clip | V1 peak / mean / p95 | V2 peak / mean / p95 | peak ratio |
|---|---|---|---:|
| Cruise | 13.38 / 1.34 / 5.15 | 6.42 / 1.68 / 4.48 | **2.1×** |
| BankLeft | 49.28 / 4.90 / 16.12 | 12.07 / 1.75 / 6.13 | **4.1×** |
| Takeoff | 84.20 / 2.92 / 10.10 | 6.61 / 2.01 / 5.17 | **12.7×** |
| AttackBite | 95.49 / 1.97 / 5.14 | 8.83 / 1.45 / 6.04 | **10.8×** |
| GroundWalk | 22.14 / 1.23 / 3.57 | 9.65 / 0.72 / 1.78 | 2.3× |
| Idle | 6.44 / 0.18 / 0.57 | 2.73 / 0.05 / 0.16 | 2.4× |
| Death | 26.18 / 2.50 / 7.34 | 10.83 / 0.68 / 1.24 | 2.4× |

Read the cruise row carefully, because it is the diagnosis in one line: **V2's cruise has a higher
mean (1.68 vs 1.34) and half the peak (6.42 vs 13.38).** It is not less motion — it is the same
motion with the accents filed off. A wingbeat that never accelerates reads as swimming.

That is what "I dislike the v2 animations" is, in numbers. Not bad poses. Missing transients.

## 3. Why it happened: the gates reward stillness

Every motion contract in this repo measures smoothness:

- loop seam ≤ 0.001 rad
- panel coordination `maxPanelErr ≤ 0.71°`
- bank mirror residual ≤ 0.0011 m
- root travel 0

All of those are *"don't move unexpectedly"* rules. There is no rule anywhere that says a takeoff
must accelerate. So the rig was iterated toward the only thing being measured, and 14 stages of
corrective shape keys later, takeoff has 8% of the reference's peak.

A gate that only punishes spikes will eventually produce a rig with no spikes. This is the same
failure mode the parent project documented in `WYVERN_ANIMATION_BASELINE.md` — a threshold with a
derivation can still be guarding the wrong channel.

## 4. Five constraints on any regeneration plan

**4.1 The unit scales differ by 100×.** V2 is 6,266 units long; V1 is 62.7 — both 5.8 m. Every
constant carried between them is wrong by two orders of magnitude. `harvest_v1_to_v2.py` still has
`MAX_PAIR_DISTANCE = 1.0` "rig units", which on V2 is **0.16 mm**. Its nearest-donor pairing cannot
succeed on this asset, and the doc's own P0 from 4 October said not to trust that constant until it
was measured on these hashes.

**4.2 The harvest tool is one third built.** `harvest_v1_to_v2.py` supports `cruise`, `bankLeft`,
`bankRight` only; it refuses everything except `--wing-only`; the default cruise recipe names
`Battle_Down02`, an action that exists nowhere in this repo. Body, neck, tail, legs and ground
contact are explicitly out of scope in its own code. The bake and phase-alignment logic underneath
is real work and worth keeping — but as it stands it can transfer wings for 3 of 18 clips.

**4.3 The candidate files are the shipped file.** `wyvern-v2-rig.glb`,
`wyvern-v2-idle-walk-…candidate.glb` and `wyvern-v2-membrane-…candidate.glb` share SHA-1
`67ed571a…`. `34-v2-repair-baseline.md` records this as "synchronized". Practically, the A/B review
surface in Flight Lab has been comparing a file to itself since 14 October, and any "candidate
approved" note in that window is not evidence of anything.

**4.4 One-shot clips are being gated like loops.** V1's takeoff seam is 3.13 rad and its death seam
is 3.14 rad — because they are one-shots, not because they are broken. V2's takeoff seam (1.14) and
land (1.25) get flagged for the same non-reason. Gating closure on a clip that never returns is how
you get an author to file the ending off.

**4.5 The membrane debt is a topology problem wearing 453 shape keys.** That is the count in the
bank study from 8 October. A wing membrane that needs a corrective key per pose is telling you the
edge flow runs across the fold instead of along it, or the panel weights are wrong. Adding key 454
does not fix it.

---

## 5. The course

**Target state:** V2's skeleton and geometry, V1's timing and weight. Not V1 (rider skeleton, two
skins, 43% dead joints), and not today's V2 motion.

### Stage 0 — Instrument (do this first; ~1 day)

Nothing below is checkable without it.

1. `audit-wyvern-rig.mjs` — **done in this pass.** It now runs on both rigs: the `Math.max(...accel)`
   stack overflow on 292 bones, the hardcoded `idle`/`Body`/`Spine1`/`Root`/`L_Toes` names, and the
   literal `CONTACT_BONES` set are all fixed. V1's clearance now reads real numbers; V2's four
   detector self-tests still pass unchanged. One self-test is reported **SKIP** on V1 (its root
   translation has no leverage on the sampled surface) — a documented coverage gap, not a green tick.
2. `validate-wyvern-clips.mjs` — still hard-fails on V1: `no wingtip bone in the GLB; tried WingD0P2,
   WingFinger1_end`. Resolve wingtips by pattern so the reference is auditable by the clip gate too.
3. Add a **dynamics channel** to the audit: peak, p95, mean, and accent count (frames above 50% of
   peak) per clip. Commit V1's values as `validation/v1-dynamics-reference.json`.
4. Add one test that a candidate's SHA differs from the promoted asset's. It would have caught 4.3
   on day one.

### Stage 1 — Normalize the pipeline (~1 day)

- Express every tolerance in **metres**, derived from measured rest-pose error on these exact
  hashes. Kill the `1.0 rig unit` constant.
- Fail the harvest preflight when `bindExtent(v1)/bindExtent(v2)` is not 1 ± 0.01, unless a
  normalization matrix is supplied and logged.
- Replace `CLIP_RECIPES` with the clips V1 actually ships: `FlightCruise`, `BankLeft`, `BankRight`,
  `GroundWalk`, `Takeoff`, `Idle`, `Death`, `AttackBite`, `AttackClaw`, `Roar`, `Hit`,
  `GroundTurnLeft`, `GroundTurnRight`.
- Explicitly exclude `Bip001_*`, `Cloak_*`, `B_*` and `*_end` from donor pairing.

### Stage 2 — Harvest in order of leverage, one mode per candidate

| Order | Clip | Why first | Gate |
|---|---|---|---|
| 1 | cruise | the default state; 2.1× gap | peak ≥ 9.4 (0.7×V1), p95 ≥ 4.1 |
| 2 | bankLeft/Right | worst gap at 4.1×; also the 453-shape-key saga | peak ≥ 34, bias sign holds |
| 3 | takeoff | 12.7× gap, the most visible | peak ≥ 59, land handoff |
| 4 | attack / attack2 | 10.8× gap; combat reads as limp | peak ≥ 67 / ≥ 18 |
| 5 | walk / idle | 2.3× / 2.4×, but contact makes it hard | peak ≥ 15 / ≥ 4.5, foot slip unchanged |
| 6 | death | one-shot, cheap | peak ≥ 18 |

Leave `dive`, `glide`, `hover`, `scout`, `speed`, `breath`, `rest` authored — V1 has no equivalent
for five of them. Hold them to the envelope of their nearest V1 cousin, not to a number I invented.

### Stage 3 — Transfer the body, not just the wings

The 12.7× takeoff gap is not a wing problem. It is spine, neck and leg drive. Extend the transfer
from `--wing-only` to spine/neck/tail/leg chains with the same rest-delta method the tool already
uses, and keep gameplay root translation out of it.

### Stage 4 — Gate on dynamics (the change that matters)

Add to the runtime contract, per mode:

```
peak  ≥ 0.70 × V1 reference
p95   ≥ 0.80 × V1 reference
mean  within 0.70 – 1.40 × V1 reference
accents within ±20% of V1 reference
seam  ≤ 0.001 rad  — loops only; one-shots exempt
```

Without this stage the other five are theatre: the next iteration will smooth it back and every
existing test will stay green.

### Stage 5 — Membrane, by weights rather than keys

Re-weight the membrane to the existing 4-influence budget and fix edge flow along the fold
direction; retire the corrective-key stack. Gate: p95 crease at the bank pose ≤ the current
corrected value **with zero shape keys**. If it cannot be met, the membrane topology is the thing to
rebuild — not the animation.

### Stage 6 — Regenerate candidates honestly

Separate file, different hash, `assets:audit-clips` delta printed, one promotion at a time. Then
delete the stale "candidates" that are byte-identical to the shipped rig.

---

## 6. What I would not do

- **Ship V1.** Two skins, a rider, 43% dead joints, 3 influences, 39k tris. It is the better
  *performance*, not the better *asset*.
- **Rebuild the mesh from scratch again.** V2's geometry is fine; its motion and membrane weighting
  are not. Rebuilding would throw away the one thing that got better.
- **Harvest all 18 clips in one pass.** Every stage doc in this repo that tried a batch produced a
  candidate nobody could qualify.
- **Add shape key 454.**
- **Treat the loop-seam gate as quality.** It measures closure, and closure is the cheapest thing
  to achieve: hold still and you are perfectly closed.

## 7. If I had one day

Fix `validate-wyvern-clips` for V1, add the dynamics channel, and re-time **cruise only** from V1's
`FlightCruise` to hit peak ≥ 9.4 with the seam still ≤ 0.001. One clip, one number, in the lab. If
that reads like V1 in motion, the course is proven and the other 17 are repetition. If it does not,
the thesis is wrong and it cost a day to find out.
