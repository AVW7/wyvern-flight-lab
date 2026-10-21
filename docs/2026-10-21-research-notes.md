# Research Notes — Dragon Flight Timing and Rider Motion

**Date**: 2026-10-21
**Status**: Working notes. One hypothesis tested and rejected.

---

## 1. How fast should a wyvern beat its wings?

The V2 animation deficit was first described as "the clips are too flat". A
flatness claim invites the question *how much motion should there be?* rather
than *how much did V1 have?* — because V1 is a reference, not a physical truth.
So: derive the expected wingbeat frequency independently.

Pennycuick's wingbeat law for flapping flight:

```
f = m^(3/8) · g^(1/2) · b^(-23/24) · S^(-1/3) · ρ^(-3/8)
```

with `m` body mass (kg), `g` 9.81 m/s², `b` wingspan (m), `S` wing area (m²),
`ρ` 1.225 kg/m³.

Inputs for the V2 wyvern, from `tools/measure-wyvern-saddle.mjs` and the rider
scale derivation (400 units per metre):

| Quantity | Source | Value |
|---|---|---|
| Wingspan `b` | membrane mesh bbox | 6266.8 u = 15.7 m |
| Wing area `S` | membrane bbox × 0.5 (two wings, planform) | ≈ 45.5 m² |
| Body mass `m` | span³ scaling from a 3.5 m / 9 kg seabird | ≈ 800 kg |

```
f = 800^0.375 · 9.81^0.5 · 15.7^(-23/24) · 45.5^(-1/3) · 1.225^(-0.375)
  = 12.26 · 3.132 · 0.0714 · 0.2801 · 0.9267
  ≈ 0.71 Hz
```

**≈0.7 Hz, a 1.4 s beat.** Over a 6-second loop that is roughly four full
wingbeats.

The mass figure is the weakest input — span³ scaling from a seabird is crude and
a fantasy wyvern's mass is unconstrained. Treat 0.7 Hz as an order-of-magnitude
anchor (call it 0.5–1.5 Hz), not a precise target. What it establishes is that
**a 6-second cruise loop is the right length for a few beats**, not that it is
too long or too short.

---

## 2. Measured beat counts

Counted directly from the per-frame max angular velocity series (excursions above
50% of peak, halved to give full cycles):

| Clip | Duration | Half-cycles | Implied frequency |
|---|---:|---:|---:|
| V1 `FlightCruise` | 6.00 s | 12 | 1.00 Hz |
| V2 `cruise` | 6.00 s | 13 | 1.08 Hz |

Both sit inside the plausible band. **V2's beat timing is fine.**

---

## 3. Hypothesis tested and rejected

An earlier version of `docs/flight-lab/36-v2-dynamics-gate.md` proposed that
nine V2 clips sharing exactly 6.0000 s / 145 keys indicated a generator emitting
fixed-length loops, and that this "caps the dynamics it can express". That was
flagged as an unproven hypothesis at the time.

The beat counts refute it in the form stated. A 6-second loop holds the correct
number of beats at a physically plausible frequency; V2 is not starving its clips
of beats by fixing their length. Both V1 and V2 have ~1 Hz cruise.

What actually differs is **amplitude**: peak 766.7 vs 367.8 deg/s, p95 582.4 vs
326.1, mean 382.2 vs 197.9 — V2 at 48%, 56% and 52% of V1 on the same beat
count. The fixed 6-second length is a *stylistic* uniformity (nine clips the same
duration regardless of content), not a mechanical cause of the deficit.

This matters for Stage 3: re-timing the clips would not fix them. Adding
amplitude — specifically restoring the transients that `attack` and `takeoff`
lost — is the lever.

---

## 4. What the literature says about rider motion

Searches on rider-on-mount animation mostly return general animation courses
rather than specific technique, so this section is deliberately short and marked
as low-confidence.

The transferable idea is **counter-rotation**: a rider does not rigidly follow
the mount's spine. The head stays closer to level than the torso, and the torso
lags the mount's vertical acceleration. In practice that means the rider's neck
and head should rotate *against* the spine's roll, which is what
`rider_leanLeft` / `rider_leanRight` do (chest rolls 0.25–0.30 of the lean, neck
−0.35, head −0.45 — see `tools/blender/build_rider.py`).

The current implementation is a first-order approximation: the rider's root
follows Spine3 rigidly, and only the rider's own clip supplies counter-rotation.
There is no IK and no vertical lag, so on hard wingbeats the rider will move with
the spine rather than absorbing it.

---

## 5. Sources

- Pennycuick, C. J. — wingbeat frequency scaling in flapping flight. The form
  used above is the standard allometric relation; verified numerically here
  rather than quoted from a specific table.
- Springer, *Form and Function in Avian Flight* — scaling of wingbeat kinematics
  and performance with size.
  https://link.springer.com/chapter/10.1007/978-1-4615-6787-5_1
- *Movement Ecology* (2025) — bat wingbeat frequencies in pursuit, including
  3.57 Hz during gliding phases, useful as a small-flyer sanity check.
  https://link.springer.com/article/10.1186/s40462-025-00608-8
- Nature Communications, *The biomechanical origin of extreme wing allometry in
  hummingbirds* — why wingbeat frequency and wing shape co-vary.
  https://www.nature.com/articles/s41467-017-01223-x
