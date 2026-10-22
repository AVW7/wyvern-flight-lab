# Project Memory — wyvern-flight-lab

Detail lives in `docs/flight-lab/41-v2-and-blender-rig-audit-task-list.md` (tasks A–E with measured
evidence) and the daily logs. This file is the short list that has cost a session to relearn.

## State

- Doc 41: A1–A3, B1–B3, C1–C5, D1–D5, E1 done. **Open: C6, C7, E2–E4.** Gates: `test:fast` green,
  21/21 Blender unit tests, tsc clean, contract 92 joints / 18 clips.
- Runtime GLB + contract pinned at sha256 `b5f1c1ef…`, 6,732,156 B. All three shipped GLBs are
  byte-identical, asserted by `test/asset-provenance.test.js`.
- `models/source/wyvern-v2-master.blend` is stamped **C1** in `models/source/blend-provenance.json`
  (missing C5, D2–D4). `cli.py export` refuses to write the shipped GLB from it; `--force` overrides.
  Editing the blend invalidates the stamp — `npm run assets:check-provenance` fails until re-stamped.
- **The GLB rebuild order is not idempotent**; start each stage from the previous stage's committed
  asset: `reshape_buzz_clips` → `stabilize_v2_body_and_feet` → `coordinate_all_v2_clips` →
  `reshape_d3_clips` → `reshape_d4_clips` → `reshape_d4_flight_clips` → `rebalance_v2_skin_weights
  --write` → pin contract → sync candidates → `npm test`.
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
- **`mixerBindings.ts` is load-bearing** (no game runtime here; the contract is a publishing gate).

## UI / repo

- One `next dev` per project; 8 GB box — run browsers sequentially, never beside tsc/tests.
- `FlightLabClient.module.css` has a **second responsive system at the bottom** that wins the cascade.
- `.workbuddy-ai/` is tracked in git; keep the daily log and this file current.
