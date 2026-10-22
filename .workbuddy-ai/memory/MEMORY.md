# Project Memory — wyvern-flight-lab

## Start here

- **Doc-41 state:** A1–A3, B1–B3, C1–C5, D1, D2, D3, D5 done. **D4 partial** (attack shipped;
  cruise + banks blocked by product invariants). **E1 partial** (`poseEnvelope.ts` + `Scan` wiring +
  `assets:audit-pose-envelope`; validator wiring + viewport ring open). **Open: C6, C7, D4 remainder,
  E1 remainder, E2–E4.** Gates: `npm run test:fast` **170/170**, 21/21 Blender unit tests, tsc
  clean, contract 92 joints.
- **Runtime GLB + contract pinned at** sha256 `bef7a09a…`, 6,368,564 B.
- **GLB rebuild order** — every stage is NOT idempotent; start each from the *previous* stage's
  committed asset (`git show <commit>:public/models/wyvern-v2-rig.glb`), never its own output:
  `reshape_buzz_clips` → `stabilize_v2_body_and_feet` → `coordinate_all_v2_clips` →
  `reshape_d3_clips` → `reshape_d4_clips` → `rebalance_v2_skin_weights --write` (weights only) →
  pin contract → sync candidates → `npm test`.
- C5 refuses when median panel web share is already >15% (pre 1.7%, post 43.5%); `--force`
  overrides. Verified: pre-C5 asset + tool + `compactGlb` = `bef7a09aa131…` exactly.
- **Any weight change invalidates `src/flight-lab/rider/mountData.ts`** → re-run
  `node tools/calibrate-rider-mount.mjs --write`.
- **Never `git checkout -- <asset>` mid-session.** HEAD is stale while you work.

## Vertex coords are NOT world coords (C5 — cost a session)

- Mesh-local → bind world is `jointWorld(j) · inverseBindMatrix(j)`, **joint-invariant** (max dev
  2.4e-3 over 92 joints at magnitude 2188): uniform scale **2187.9565**, translation
  `(0, 531, −1042.85)`. NOT the mesh node transform — both mesh nodes are roots, identity.
- `WyvernBody_Rebuild` `POSITION` is **normalized SHORT** (5122, `normalized: true`;
  `KHR_mesh_quantization` in `extensionsRequired`) → divide by 32767. Membrane is float.
- Use `readSkin()` / `editSkinWeights()` (bind-world, normalization-aware). Mirror-keying needs
  `{ space: "local" }`: the bind matrix carries ~0.0002 rotation, so world `X` drifts ~0.4 at z≈1000.## Skin weights (C5, measured)

- **`Spine3`'s mass is the neck, not the chest** — 92% above `Neck1.head`; the chest carries ~63 of
  5,624.8, so doc 41's "20× thoracic cliff" is a metric artifact. Real defect: `Spine3` owned the
  `Neck1` span (3,832 verts nearest `Neck1`); C5 hands 50% to the nearest neck bone.
- Full four-influence vertices have no free slot → evict the smallest **non-protected** influence,
  not the global smallest (that rule skipped 825 web verts; `L_WingPanel2_0` stuck at 8.4%).
- `cruise` `maxMembraneX` is **2780.9 with and without C5** — extent comes from digit-tip vertices
  the web pass never touches. Weight work cannot move D4's cruise gate.
- `dominant bone == nearest bone segment` is reported, never gated (28.8% → 51.7%; healthy rigs
  score low because surface vertices are often marginally nearer an unrelated bone).

## Pose envelope / Scan (E1, measured 2026-10-22)

- `src/flight-lab/poseEnvelope.ts`: five detectors measured against **bind**, median over the clip
  (a peak envelope flags every healthy flight clip), scoped to the postural chain
  (`Body, Spine1..3, Neck1..2, Head`) because distal wing bones legitimately hold >18°.
- **`CANONICAL_TRANSITIONS` is only `takeoff→cruise` and `land→idle`.** Loop-to-loop pairs differ by
  8 bones / 39.9° (`cruise→bank*`) and 22 bones / 44.2° (`idle↔walk`) on a *healthy* asset — they are
  crossfaded, so the delta is a phase. Adding them makes the detector permanently red.
- **Mixer trap:** writing a bone rotation then `mixer.update(0)` on a paused action leaves that action
  unable to write the pose again (second seek reads the untouched bone). `scanSeam` borrows the
  playback mixer, so **a second `Scan` press measures a stale pose** — still unfixed there.
  `sampleClipPoses` uses a private mixer + bind substitution for un-animated bones.
- Probe: `npm run assets:audit-pose-envelope` → 18/18 clips clean, exit 0; re-injecting the three
  historical defects yields 4 / 1 / 1 anomalies.

## D4 remainder — why cruise/banks are not shipped

Both clear the dynamics gate under amplification and break a product invariant when they do:
**cruise** needs 1.68× but the gate samples one frame (t = 1.0 s) requiring `maxMembraneX > 2500`
(authored 2780.9 → 2256.4 at gain); tip compounding means no gain satisfies both, though the
pose-independent invariant `maxMembraneX >= wingTipPos.x` still holds there. **banks** need 6.7× +
smoothing to reach their mean floor, which moves cadence 0.500 → 1.500 Hz and breaks the 8%
flight-group lock. The fix for both is **authored motion**, not a scale factor.
## Blender control rig (C4, measured)

- **`CANONICAL_CONTACT_PLANE_Z = -2.6549`** = measured world-Z sole (1,084 foot verts). Not
  `-184.0` (glTF `Body`-relative) and not `+142.2` (= `Foot.tail.z`, 144.9 above the sole).
- **`CTRL_Pole_Elbow_L/R`** on the outward bisector; `pole_angle` `L = 164.0°`, `R = 9.5°`. Wrong
  branch displaces the wing **176.47°** at rest. Probe `tools/blender/audit_v2_control_rig.py`.
- **Panel bisect must be solved, never constrained**: a 20° digit owes 10.00°; rigid parenting
  gives 20.00°, a LOCAL `COPY_ROTATION` pair 28.20°, WORLD + `use_offset` 110.86°.
- **Traps:** `matrix_basis` ignores constraints (read `pb.matrix`); flush `view_layer.update()` 3×
  after touching a driver-driven influence; only a **reopened-file** pass is authoritative; a
  bend-plane test cannot see a 180° pole flip.

## Rig facts that constrain every edit

- **V1 and V2 are 100× apart in world scale** (62.7 vs 6266.8 bbox). Normalise before comparing.
- **Leg chain `Body > Spine1 > L_LegRoot`** — Spine1 is a leg ancestor; Body/Spine1/legs PROTECTED.
- Panels are children of digits, but the panel test compares against the slerp of two *adjacent*
  digits — rotate `WingHand` or above, never a `WingD*` digit alone.
- **V1's clips carry a continuous motion floor** because V1 keys all 640 tracks; V2's deficit was
  that floor, not amplitude (the whole D3 insight).

## V2 GLB / Blender pipeline

- **The shipped GLB is not an export of any committed blend** — clips were spliced at GLB level.
- Headless export: `python3 scripts/blender/cli.py --headless --blend <b> export --out <glb>`
  (Blender 5.1, `~/.local/bin/blender`). `cli.py` headless double-forwards positional args — run
  audit scripts via `blender -b --python …`. Fresh exports are ~3× larger → `compact_v2_glb.mjs`.
- The −65° baked ground-mode idle raise came from `splice_neck_head_channels.mjs` (fixed A1–A2);
  `walk`/`rest` necks were fine — do NOT re-splice walk. `upgrade_v2_rig_ground_and_membrane.mjs`
  cannot run (donor GLB gone).

## Architecture facts that change how you work

Full analysis: `docs/flight-lab/40-architecture-audit-and-prioritized-path.md`.

- **`mixerBindings.ts` is load-bearing — DO NOT delete.** `runtime.ts` calls
  `flushMixerBindings(mixer)` every frame or static-track bones hold procedural values and the pose
  drifts permanently. No test.
- **No game runtime here**: `src/app/` is 2 routes, both the Flight Lab. The contract is a
  **publishing gate**, not a runtime gate (zero `src/` references).
- `src/` 14.6k LOC vs `tools/`+`scripts/` 28.9k — tooling is 1.98× the runtime; **18 of 44 src
  modules have no test**, exactly the stateful half (`membraneSurfaceRuntime`, `riderRuntime`,
  `rig/*`, `environment`, `neckSpring`, `modelLoader`…).
- **Three competing clip-alias tables**; the inline one in `runtime.ts` (17 entries) wins.
  `ClipResolutionStatus` is built and tested but dropped by runtime — ~40 lines to wire; M1 wants it.

## UI / browser facts

- **Mobile reachability P0 closed**: 107 controls, 0 unreachable (chromium + webkit, 390×844 and
  360×800; drawers scroll internally). Probes `scripts/probe-mobile-reachability.mjs`,
  `probe-mobile-drawers.mjs` — **prove a new probe against the known-bad CSS**
  (`git show 2b8373d:…FlightLabClient.module.css`) before trusting green.
- `FlightLabClient.module.css` has a **second responsive system at the BOTTOM** (≤1050px drawers,
  ≤720px phone chrome) that wins the cascade over the header block at the TOP — check both.
- One `next dev` per project (`.next/dev/lock`); on this 8 GB box run browsers sequentially, never
  beside tsc/tests.

## Repo conventions

- **`.workbuddy-ai/` is tracked in git** (re-added 2026-10-21 at Aj's request) so other agents work
  from committed memory. Keep the daily log and this file current, commit with the work.
- Docs map: `39` roadmap M1–M11, `40` architecture audit, `41` task list A–E, `42` rig/pipeline ref.
