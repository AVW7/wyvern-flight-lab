# Project Memory — wyvern-flight-lab

Detail lives in `docs/flight-lab/41-v2-and-blender-rig-audit-task-list.md` (tasks A–E with measured
evidence) and the daily logs. This file is the short list that has cost a session to relearn.

## State

- Doc 41: A1–A3, B1–B3, C1–C6 (+ the jaw-amplitude follow-up, notes 13–19), D1–D5, E1, E2, E3, E4 (parts 1–2), FL-5 (M1/M4) done. **Open: C7, E4 part 3 (`watch-and-splice`), and Workstream BG (added 2026-10-22).** Gates: `test:fast` 190/190,
  31/31 Blender unit tests, tsc clean, contract 92 joints / 18 clips. Pose envelope 18/18 clean on
  `f5d768a2`; `npm run assets:selftest-pose-envelope` must print **6/6** (it re-injects the three shipped
  defects in memory and exits 1 if a detector goes blind).
- **Workstream BG (doc 41, appended 2026-10-22): BG-2 ✅ and BG-3 ✅ (= Task C6); BG-1, BG-4, BG-5 open.**
  ⚠️ BG-1 and BG-3 both pin `bef7a09a…` / 6,732,156 B — the **pre-C6** asset. BG-1 is blocked by a
  contradiction in its own text: it wants the blend rebuilt from the current GLB *and* a lossless
  blend→GLB round-trip, but D2/D3/D4/C5 were never authored in Blender (GLB-level stages) and `cli.py
  export` refuses the shipped destination for that reason. BG-4's framing is wrong too — every layer it
  wants packaged already exists and is composed by `runtime.ts`, so it is a packaging task whose risk is
  drift from `runtime.ts`. BG-5 was never specified (only the header said "BG-1 to BG-5").
- Runtime GLB + contract pinned at sha256 `f5d768a2…`, 6,738,692 B (jaw amplitude restore, 2026-10-22;
  was `04dbda5c…` / 6,738,716 B after C6, and `b5f1c1ef…` / 6,732,156 B before it). All three shipped GLBs
  are byte-identical, asserted by `test/asset-provenance.test.js`. `README.md` carries the live size/hash —
  update it on every re-pin. `04dbda5c…` is reproducible byte-for-byte from `git show HEAD:…` + 
  `recenter_v2_jaw_pivot.mjs --write`, which is the fastest way back if an experiment dirties the asset.
- **The jaw is an authored pose, not a dynamics channel.** The D2/D3/D4 gain passes amplify every rotation
  channel about its bind and `Jaw` is in neither `PROTECTED` nor `PANEL_COUPLED`, so it was amplified to
  `176.9°/53.7°/179.1°` against the blend's `32.0°/24.0°/50.0°`. `tools/blender/restore_jaw_amplitude.mjs`
  restores it and re-solves `death`'s non-jaw gain. Any future gain pass must exclude the jaw or it
  reintroduces the defect, and the tool then re-fires (it keys off the jaw deviation, so it is idempotent).
- `models/source/wyvern-v2-master.blend` is stamped **C6** in `models/source/blend-provenance.json`
  (missing C5, D2–D4 — and, since the jaw restore, a fifth: `restore_jaw_amplitude`). The blend's C6 and
  the GLB's C6 are *separate* passes: the GLB one is `tools/blender/recenter_v2_jaw_pivot.mjs`, not an
  export. `cli.py export` refuses to write the shipped GLB from the blend; `--force` overrides. Editing
  the blend invalidates the stamp — `npm run assets:check-provenance` fails until re-stamped.
- **The GLB rebuild order is not idempotent**; start each stage from the previous stage's committed
  asset: `reshape_buzz_clips` → `stabilize_v2_body_and_feet` → `coordinate_all_v2_clips` →
  `reshape_d3_clips` → `reshape_d4_clips` → `reshape_d4_flight_clips` → `rebalance_v2_skin_weights
  --write` → `recenter_v2_jaw_pivot` → `restore_jaw_amplitude` → pin contract → sync candidates →
  `calibrate-rider-mount --write` → `npm test`.
- Any weight change invalidates `src/flight-lab/rider/mountData.ts` →
  `node tools/calibrate-rider-mount.mjs --write`.

## Traps that cost a session

- **Vertex coords are not world coords.** Mesh-local → bind world is `jointWorld(j)·inverseBindMatrix(j)`,
  joint-invariant: scale 2187.9565, translation `(0, 531, −1042.85)`. Body `POSITION` is normalized
  SHORT (`/32767`). Use `readSkin` / `editSkinWeights`.
- **Mixer (three 0.185.1).** A paused action + `update(0)` *does* write static tracks (−21.1° in,
  −21.1° out) and `scanSeam` is repeatable across presses. The real trap is narrower:
  `PropertyMixer.apply` only calls `setValue` when the accumulated value changed, so an *outside* write
  to a bound property survives every `update(0)` until `flushMixerBindings` — which is why `runtime.ts`
  flushes every frame. Doc 41's "Scan is broken" claim was wrong and is corrected there.
- **D4 was rate, not amplitude**: the flight group beat at 0.5 Hz against V1's 1.0 Hz, and retiming
  0.5× closed the deficit. Do not trust the "half-cycles above 50% of peak" cadence estimator; the
  authority is `scripts/validate-wyvern-clips.mjs` (dominant DFT bin).
- **Pose envelope (E1)** measures against bind, median over the clip, scoped to the postural chain.
  `CANONICAL_TRANSITIONS` is only `takeoff→cruise` and `land→idle`; loop-to-loop pairs are crossfaded.
- **Blender control rig (C4)**: `CANONICAL_CONTACT_PLANE_Z = −2.6549` (measured sole); pole angles
  `L 164.0° / R 9.5°` (wrong branch displaces the wing 176.47°); panel bisect must be *solved*, never
  constrained; `matrix_basis` ignores constraints; only a reopened-file pass is authoritative.
- **V1 and V2 are 100× apart** in world scale. Leg chain is `Body > Spine1 > L_LegRoot`.
- **A bone's absolute orientation is not a pose.** `Head` sits at **70.7° pitch / 180° roll at bind** —
  Blender bone axes are not the animal's horizon. Any "is this joint wrong?" number must be measured
  against the bind chain (`(bind chain)⁻¹ · (chain now)`), which is 0 at bind.
- **Landmarks resolve before the clip does.** A probe that waits on `getLandmarks().length > 0` pins during
  `"Loading..."` and measures all zeros; wait for `activeClip !== "Loading..." && clipTime > 0.2`.
- **`mixerBindings.ts` is load-bearing** (no game runtime here; the contract is a publishing gate).
- **Editing rest bones (C6).** `EditBone.matrix` multiplies the `Y` column's magnitude by the bone's
  **existing** length, so pass a *unit* `Y` and set `tail` afterwards (passing `y * length` gave
  `Body` `164.07 × 0.0505 = 8.29` and `RootMotion` `200 × 832.57 = 166,513`). Re-framing a **parent**
  rotates its whole subtree — a child's rest-relative transform is recomputed from the new parent rest,
  so preserving the parent's own pose is not enough (measured: `RootMotion` flattening = `98.1301°` on
  every clip). Compensate keys with `basis_new = C·basis_old`, `C = R_new⁻¹R_old`, applied to key values
  **and both Bézier handles** — quaternion product is linear in the right operand. `rotation_quaternion`
  index `1` is the **x** term (Blender stores `w,x,y,z`). Maths lives in
  `scripts/blender/rigging/rest_reframe.py` with tests in `tools/blender/tests/test_rest_reframe.py`.
- **Never measure a pose delta with `2·acos(|dot|)`.** It is ill-conditioned near identity: quaternions
  stored to 6 dp make an *identical* pose read as `0.15°`, and a `0.05°` rotation read as `0°`
  (`cos(θ/2)` rounds to `1.0`). Build the relative quaternion and use `2·atan2(|v|, w)`. This cost a
  debugging detour during C6 — a perfect compensation looked broken.
- **`.blend` saves are not byte-deterministic** (Blender serialises pointer values): the same fix run twice
  from the same pristine blend produced `5c6caebc…` and `8c444461…`. Re-stamping is mandatory after every
  save; never claim a `.blend` hash is reproducible.
- **Moving a joint in a GLB means the channels, not just the node.** glTF has no rest pose: a joint's world
  position is `W_parent · T_channel · A_channel`, and all 18 clips key `Jaw` translation/rotation/scale. The
  edit is `T_channel += δ_local`, `A_channel = (R_new·R_old⁻¹) ⊗ A_channel`, `IBM = inverse(W_new)·(W_old·IBM_old)`.
  **The hinge-axis check cannot see the IBM** — `E = W_parent·local·W_rest⁻¹` cancels it — so assert
  `W·IBM` invariance separately or a wrong bind matrix shifts the whole mesh.
- **Appending accessors leaves orphans.** `makeAppendor` re-points `sampler.output` and leaves the old
  bufferView in the BIN unreferenced (C6 first draft: 37 orphans, +69 kB). Use
  `writeFloatsInPlace()` from `glb_clip_edit.mjs` when the accessor is uncompressed, tight, offset-0
  (most animation accessors are); the IBM is meshopt-compressed and must still be appended.
- **A near-zero rotation has no axis.** `axis = v/|v|` with `v = sin(θ/2)·axis`, so at `θ ≈ 1e-6 rad` the
  direction is float32 noise — `takeoff`/`speed` are two-key static jaw poses and reported **5.29°** of
  "axis error" off nothing. Skip frames under a floor (`MIN_AXIS_DEG = 0.1`) and gate the skipped case with
  a synthetic rotation instead; also fail if *every* clip is skipped.
- **`readGlb` returns a *view*, not a copy** — `binary: bytes.subarray(...)`. Any in-place writer
  (`writeFloatsInPlace`) therefore mutates the source you meant to be a trial *of*, so a loop of trials
  compounds: the first `death` gain probe reported `p95 6973` and looked like a data bug. Every trial must
  start from `readGlb(Buffer.from(sourceBytes))`.
- **`qpow` past 180° wraps the short way**, so a gain applied to a bone already near 180° from bind
  *inverts* the pose instead of exaggerating it (a `1.8×` gain turns `179°` into `−38°`). `death` already
  carries 21 bones past `150°` (`R_Thigh` 179.1°, every `WingD*` panel 179.3°), which is why a uniform gain
  is wrong there however well it scores. Amplify only while `excursion × gain ≤ cap` (`MAX_EXCURSION_DEG =
  165`), computed from the clip's own measured excursion so the result lands *on* the cap.
- **The membrane set must move as one.** The panel gate compares each panel's world deformation against
  the slerp of its two *adjacent* digits, so a per-bone cap desynchronises the web — measured `34.65°`
  against a `1°` limit in `death`, from panels with small excursions being amplified while their digits
  were held. `PANEL_COUPLED` bones share one gain, taken from the set's worst member.
- **The dynamics metric is a per-frame *maximum* across bones**, so adding motion to a bone that never
  holds the maximum changes nothing at all: a `2–14°` tail ripple at `2–4` cycles moves no digit of
  `death`'s `p95`/`mean` even though all 10 `Tail*` channels match `GROUPS.tail` and `ripple()` returns
  non-null. Verify a probe's silence before reporting it as a finding.
- **A gate can be paid for by a broken pose.** `death` passed its mean floor by **0.6%** (`354` vs
  `351.8`), and that 0.6% was the impossible `179°` jaw setting the max rate in 158 of 240 frames.
  Restoring the authored mouth dropped it to `p95 560 / mean 305`. Check what a clip's gate is *made of*
  before assuming a restore is free — it is free in `attack`/`attack2` (jaw never holds the max) and not
  in `death`.
- **`attack` ships at `139.3%` of V1's mean** (`1664.3` against a `1673.7` ceiling) — a `0.5%` margin on
  the *upper* bound. **It is not a defect**: D4 deliberately ran a uniform gain up to the mean ceiling
  and bought the `p95` back with a strike accent, so the clip is parked on a cap by design. The cause is
  **shape**, not scale (`peak/mean` 2.96 vs V1's 4.58), and the mean is **77% head-driven**: `Head` holds
  the frame max in 39 of 89 frames (51.1%), `Jaw` in 19 (26.1%), and because `Jaw` is parented to `Head`
  with a constant local rotation outside the `t=0.10..0.40` mouth opening, the jaw's world rate is
  inherited from the head. **Four gain reshapes measured and rejected** (doc 41 note 20,
  `assets/rig-audits/2026-10-22-c6-jaw-pivot/attack-punctuation.json`): uniform gain tops out at ~5.5%
  and just moves the thin margin to the `p95` channel (`0.85× → 3732` under the `3799.8` floor); uniform
  gain on `PANEL_COUPLED` alone is a near no-op (`1664 → 1637` at gain 0 — those panels are static *at
  bind*, excursion `0.0`); uniform gain on head/neck kills the peak (`4931 → 3471`); a **time-varying
  gain reaches the target** (`mean → 1422`, margin `0.5% → 15.0%`, peak/`p95` held) **but injects a
  membrane jerk** — the wing is a 6-deep chain (`Shoulder>Elbow>Wrist>Hand>Digit>Panel`) and a chain's
  composed angular velocity picks up a term ∝ Σ(dgᵢ/dt), so every window edge spikes (measured
  `2023 → 4670 deg/s`, 2.3× at `t=0.317`). **The gate is blind to it**: it takes the per-frame *maximum*
  across bones, so a rise reads as *more* energy and only improves the numbers. Probe with no write
  path: `tools/blender/probe_attack_punctuation.mjs`. Needs authored motion in the blend.
- **The cruise wingspan test is now full-cycle** (BG-2, 2026-10-22): it sweeps 48 intervals / 49 sample
  points and asserts the peak span plus per-frame membrane-to-wingtip attachment. The old single-frame
  probe at `t = 1.0` was **measurably blind** — it read 372.3 units of clearance where the tightest frame
  in the cycle (t = 0.188) has 286.4; peak is 3015.9 at t = 0.875 (old probe: 2952.7). Cruise is a clean
  1.0 s period over 3.0 s. Don't reintroduce a single-frame probe; and note `clip.keys` is **not** an
  `AnimationClip` property — the house idiom is `const samples = 48` + `(clip.duration * i) / samples`.
- **A self-test can be wrong about itself.** To rebuild a tilted hinge you need the **conjugation**
  `R_tilt·Rx(θ)·R_tilt⁻¹`; composing `Rz·Rx` tilts the *resultant* axis to `atan(2.09/5) = 22.69°` and the
  self-test "fails" on a correct instrument.
- **`test/wyvern-v2-kinetics.test.js` pins the jaw socket** `y` (now `JAW_REST_SOCKET_Y = 19.44`, was
  `9.80`; vendor `351.38`). Any pivot move breaks 6 tests until that constant is updated — that is the
  assertion working, not a regression.
- **The `attack`/`attack2`/`death` jaw amplitudes now match the blend** (`32.0/24.0/50.0°`) — fixed
  2026-10-22 by `restore_jaw_amplitude.mjs`. The cause was the D2/D3/D4 gain passes, not the export; the
  giveaway was that `breath`, `attackAir2` and `idle` were never gain-passed and agreed exactly. The export
  relation the restore relies on is `channel(k) = rest_glb · basis(0)⁻¹ · basis(k)` (the exporter writes the
  **frame-0 pose** as the node TRS, not the armature rest — `rest·basis(k)` is off by a constant `2.090°`).
- **`sampleClipPoses` flushes every step on purpose** (+4.8 ms on a ~21 ms scan). It changes no sample —
  the private mixer already writes — but it makes the static-track invariant structural. Don't delete it
  as dead code; the E1 test `a scan reads the authored static pose even when the bone was left elsewhere`
  is what guards it.

## UI / repo

* Flight Lab specimen picker is **2 entries** — `wyvern-v2-rig` + `wyvern-v1-rig`. The two `…-candidate.glb`
  promoted aliases were retired from the catalogue 2026-10-22 (files kept: provenance gate + upgrade tool).
- One `next dev` per project; 8 GB box — run browsers sequentially, never beside tsc/tests.
- `FlightLabClient.module.css` has a **second responsive system at the bottom** that wins the cascade.
- `.workbuddy-ai/` is tracked in git; keep the daily log and this file current.
