# Project Memory — wyvern-flight-lab

Detail: doc 41 + daily logs. Index only; measurements live there.

## State

- Doc 41: A1–A3, B1–B3, **C1–C7**, D1–D5, E1, E2, E3, E4(1–2), FL-5, BG-2, BG-3(=C6), BG-1 safe
  half done. Open: **E4 part 3 (`watch-and-splice`), BG-4, BG-5 (no spec)**.
- Gates: `test:fast` **206/206**, Blender 31/31, tsc clean, contract 92/18, pose envelope 18/18,
  selftest 6/6, dynamics PASS 9/9. Pin `f5d768a2…` / 6,738,692 B; `README.md` carries size/hash.
- The jaw is an **authored pose, not a dynamics channel** — every gain pass must exclude it or
  `restore_jaw_amplitude.mjs` re-fires. Weight changes invalidate `rider/mountData.ts`.
- `wyvern-rig-v1wing.blend` is a reference specimen only (not exported, nothing reads it):
  106 bones, 106 vertex groups (124 before the C7 purge), 35 actions, 1 scene.

## Traps (detail in doc 41)

- **Blender rest-setting.** `matrix_local`'s Y column is a **unit direction** — length lives in
  head/tail, *not* the matrix, so `eb.matrix = <unit-Y matrix>` sets head/direction/roll **and
  preserves the length**; `eb.tail` only when the length differs. Re-framing a parent rotates its
  subtree; compensate with `basis_new = C·basis_old` on keys *and* Bézier handles. **A rest fix's
  blast radius is the mirrored bones *plus all descendants*.**
- **Pose readout.** `pose.bones[n].matrix` is not stable across an Edit-Mode round trip — read
  through `arm.evaluated_get(dg)`, and **discard the first sampling pass** after `open_mainfile`.
- **Angle measurement.** Never `2·acos(|dot|)` (ill-conditioned near identity) — use
  `2·atan2(|v|, w)`. A near-zero rotation has no axis (`v = sin(θ/2)·axis`): skip under
  `MIN_AXIS_DEG = 0.1`. `to_quaternion().angle` on a *matrix difference* is the same trap.
- **Gain passes.** `qpow` past 180° wraps the short way — a gain on a bone near 180° *inverts* the
  pose; amplify only while `excursion × gain ≤ cap` (`MAX_EXCURSION_DEG = 165`). The membrane set
  must move as one (`PANEL_COUPLED` shares one gain). The dynamics metric is a **per-frame maximum
  across bones** — motion on a bone that never holds it changes nothing, and a gate can be *paid
  for by a broken pose*.
- **What you measure is not the pose.** Vertex coords are not world coords — mesh-local → bind world
  is `jointWorld(j)·inverseBindMatrix(j)`, joint-invariant, scale 2187.9565; body `POSITION` is
  normalized SHORT. A bone's absolute orientation is not a pose — use the bind chain.
- One-liners: `readGlb` returns a **view**, not a copy — start every trial from
  `readGlb(Buffer.from(bytes))`. `makeAppendor` leaves orphan bufferViews — use
  `writeFloatsInPlace()`. `.blend` saves are **not byte-deterministic** — re-stamp after every save.
  Landmarks resolve before the clip does — wait for `activeClip !== "Loading..."`. Mixer's
  `PropertyMixer.apply` only calls `setValue` on change, so an outside write survives `update(0)`
  until `flushMixerBindings`.