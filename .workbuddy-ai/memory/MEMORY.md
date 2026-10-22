# Project Memory — wyvern-flight-lab

Detail: `docs/flight-lab/41-v2-and-blender-rig-audit-task-list.md` + daily logs. Short list of
what has cost a session to relearn.

## State

- Doc 41 done: A1–A3, B1–B3, C1–C6 (+ jaw-amplitude follow-up), D1–D5, E1–E4 (parts 1–2),
  FL-5, BG-2, BG-3 (=C6), **BG-1 safe half**. Open: **C7, E4 part 3, BG-4, BG-5 (no spec)**.
- Gates: `test:fast` **191/191**, Blender tests 31/31, tsc clean, contract 92/18, pose
  envelope 18/18, selftest 6/6, dynamics PASS 9/9. Pin `f5d768a2…` / 6,738,692 B; three
  shipped GLBs byte-identical; `README.md` carries the live size/hash.
- **`npm run blender:sync`** (`tools/blender/sync_v2_pipeline.mjs`) rebuilds the shipped GLB
  from `assets/pipeline/wyvern-v2-stage0.glb` (`88adf57e…`, the `5fb3ab1` asset) through nine
  GLB stages, **asserting each stage's historical sha256** — measured byte-for-byte
  reproduction of the pin in 88 s. Measured order: buzz → stabilize → coordinate → d3 → d4 →
  **C5 weights** → flight group → jaw pivot → jaw restore (doc 41 had C5 after the flight
  group — wrong; the flight group ran on the post-C5 asset). Dry run by default; `--promote`
  installs, re-pins, syncs aliases, recalibrates the rider mount. Enabling changes: `--in` on
  both jaw passes, positional `[base] [out]` on `coordinate_all_v2_clips.mjs`,
  `WYVERN_RUNTIME_CONTRACT` on `runtime_rig_contract.mjs`. Pinned by
  `test/v2-pipeline-sync.test.js`.
- Blend stamped C6, `NOT export-safe`, `missingStages` = C5, D2, D3, D4, C6-glb,
  C6-jaw-restore. `cli.py export` refuses the shipped destination; `--force` overrides.
- The jaw is an **authored pose, not a dynamics channel**: D2/D3/D4 gain passes amplify every
  rotation channel about its bind, so any future gain pass must exclude the jaw or
  `restore_jaw_amplitude.mjs` re-fires. Any weight change invalidates `rider/mountData.ts` →
  `node tools/calibrate-rider-mount.mjs --write`.

## Traps that cost a session

- **`readGlb` returns a view, not a copy** — start every trial from
  `readGlb(Buffer.from(sourceBytes))` or in-place writers compound.
- **`qpow` past 180° wraps the short way**: a gain on a bone near 180° *inverts* the pose.
  Amplify only while `excursion × gain ≤ cap` (`MAX_EXCURSION_DEG = 165`).
- **The membrane set must move as one** — the panel gate compares each panel against the slerp
  of its two adjacent digits, so a per-bone cap desynchronises the web (`PANEL_COUPLED` shares
  one gain from the set's worst member).
- **The dynamics metric is a per-frame maximum across bones** — motion on a bone that never
  holds the maximum changes nothing; verify a probe's silence before reporting it. A gate can
  be *paid for by a broken pose* (`death` passed by 0.6% that was the jaw).
- **Vertex coords are not world coords**: mesh-local → bind world is
  `jointWorld(j)·inverseBindMatrix(j)`, joint-invariant, scale 2187.9565; body `POSITION` is
  normalized SHORT. Use `readSkin` / `editSkinWeights`.
- **A bone's absolute orientation is not a pose** — `Head` is 70.7° pitch / 180° roll at bind.
  Measure against the bind chain (`(bind chain)⁻¹ · (chain now)`), which is 0 at bind.
- **Never measure a pose delta with `2·acos(|dot|)`** (ill-conditioned near identity) — use
  `2·atan2(|v|, w)` on the relative quaternion. **A near-zero rotation has no axis**
  (`v = sin(θ/2)·axis`): skip under `MIN_AXIS_DEG = 0.1`, gate the skip synthetically.
- **A single-frame probe can be measurably blind** — BG-2's `t = 1.0` cruise probe missed the
  tightest frame (286.4 at `t = 0.188` vs peak 3015.9 at `t = 0.875`). Sweep the cycle.
- **Landmarks resolve before the clip does** — wait for `activeClip !== "Loading..." &&
  clipTime > 0.2`, not `getLandmarks().length > 0`.
- **Appending accessors leaves orphans** (`makeAppendor` re-points `sampler.output`); use
  `writeFloatsInPlace()` for uncompressed/tight/offset-0 accessors.
- **`.blend` saves are not byte-deterministic** (pointers serialised); re-stamp after every
  save, never claim a `.blend` hash is reproducible.
- **`attack` ships 139.3% of V1's mean (`0.5%` under its ceiling) by design**; four gain
  reshapes measured and rejected (doc 41 note 20) — the time-varying gain reaches the target
  but injects a membrane jerk the gate cannot see. Needs authored motion in the blend.
- **C6 rest frames**: `EditBone.matrix` scales by the bone's existing length — pass a *unit*
  `Y`, set `tail` after. Re-framing a parent rotates its subtree; compensate with
  `basis_new = C·basis_old` (`C = R_new⁻¹R_old`) on key values *and* Bézier handles.
- **Mixer (three 0.185.1)**: `PropertyMixer.apply` only calls `setValue` when the accumulated
  value changed, so an outside write survives every `update(0)` until `flushMixerBindings` —
  why `runtime.ts` flushes every frame. A paused `update(0)` *does* write static tracks.

## UI / repo

- Specimen picker is 2 entries (`wyvern-v2-rig` + `wyvern-v1-rig`); the two `…-candidate.glb`
  aliases were retired from the catalogue 2026-10-22 (files kept).
- One `next dev` per project; 8 GB box — browsers sequentially, never beside tsc/tests.
- `.workbuddy-ai/` is tracked in git; keep the daily log and this file current.
