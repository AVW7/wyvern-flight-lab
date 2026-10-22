# V2 Runtime Asset Audit Note — Idle Neck Raise Fix

**Date:** 2026-10-21
**Author:** Blaze (WorkBuddy AI agent), for review by **Gemini 4 (Argon)**
**Scope:** `public/models/wyvern-v2-rig.glb` (the Flight Lab V2 runtime asset) and its two review candidates. One defect found, root-caused, fixed, and verified.

---

## 1. Assets under audit

| File | sha256 (post-fix) | Bytes | Role |
|---|---|---|---|
| `public/models/wyvern-v2-rig.glb` | `d916b748d987df64…` | 5,977,592 | **Gameplay runtime asset** — contract-pinned, default specimen, flight rig + rider mount wired to it |
| `public/models/wyvern-v2-membrane-lab-candidate.glb` | `d916b748d987df64…` | 5,977,592 | Review candidate (membrane work) |
| `public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb` | `d916b748d987df64…` | 5,977,592 | Review candidate (locomotion work) |

All three were byte-identical **before** this work and are byte-identical **after** it (the repo audit already flagged A/B between them as a no-op). The V2 rig: 92 joints, 1 skin, 18 clips, meshopt-compressed.

## 2. Defect

In ground mode the wyvern's head was forced into a craned, vertical neck — roughly **65° of baked neck raise above bind pose**, constant across the whole `idle` loop:

| Clip `idle`, local-X pitch vs bind (mean / min / max, degrees; negative = head raised) | Neck1 | Neck2 | Head |
|---|---|---|---|
| Before | −21.1 / −23.3 / −18.9 | −24.2 / −27.0 / −21.4 | −19.3 / −23.5 / −15.1 |
| After | −0.0 / −1.9 / +1.1 | 0.0 / −2.6 / +1.5 | 0.0 / −6.8 / +6.9 |

No procedural code caused it — the runtime's ground path adds no neck motion (verified: `wyvernFlightRig.ts` skips the neck wave when grounded; `gazeController` fallback is `−bodyPitch·0.5`, and body pitch is 0 on the ground; runtime passes `gazeTarget = null`). The raise was baked into the clip data itself.

## 3. Root cause (provenance)

**The shipped GLB's clips were never exported from the committed Blender sources — they were spliced at GLB level from donor GLBs.**

- `tools/blender/splice_improved_clips.mjs` copies whole animation clips from a donor GLB (default donor `assets/blender/wyvern-gothic.glb`) into the runtime rig, mapping channels by bone name.
- Shipped `walk` is **byte-identical to the gothic donor's walk** (Neck1 −8.3/−16.1..−2.6, Neck2 −6.7, Head +3.0) — proof of the mechanism.
- Shipped `idle` matches no file in the repo. It came from `idle-v2-fold-candidate.glb`, referenced by `tools/blender/author_v2_idle_membrane_breath_mcp.py` at a path outside the repo (`/Users/ajadvanwyk/.codex/visualizations/…`) that **no longer exists**. That donor carried the baked neck raise.
- Both committed Blender sources carry a healthy `idle`: `models/source/wyvern-rig.blend` (56 bones, 39 weighted) and `wyvern-rig-v1wing.blend` (106 bones, 106 weighted) have **identical fcurve values** — Neck1 ±1.0°, Neck2 ±1.3°, Head ±3.4° (quat.x), mean ≈ 0°: a breathing bob, no raise.

## 4. Fix

Channel-level splice — new tool `tools/blender/splice_neck_head_channels.mjs`:

- Donor: fresh headless export of the authoring source —
  `python3 scripts/blender/cli.py --headless --blend models/source/wyvern-rig.blend export --out /tmp/donor.glb`
- Replaces **only** the `Neck1/Neck2/Head` rotation channels of `idle`, remapping donor channels to base nodes by name and appending donor samplers. Every other channel (membrane breath panels, wings, legs, jaw) is preserved byte-for-byte.
- Run: `node tools/blender/splice_neck_head_channels.mjs public/models/wyvern-v2-rig.glb /tmp/donor.glb /tmp/candidate.glb idle`
- Applied to all three V2 assets (rig + both candidates).

## 5. Verification

1. **Structural contract** — `node tools/blender/runtime_rig_contract.mjs /tmp/candidate.glb --candidate` passes; the signature (92-joint hierarchy, binds, materials, per-clip bone/channel target lists) is unchanged, so only keyframe *values* moved.
2. **Promotion per doc 14** — candidate → evidence → contract re-pinned: `asset.sha256 = d916b748…`, `asset.bytes = 5,977,592`, provenance/evidence updated. `npm run assets:validate-wyvern` passes with the hash check on.
3. **Tests** — `npm run test:fast`: 161/161 across three post-promotion runs; the rig/GLB subset (99 tests) passed 3/3 targeted runs. **Disclosure:** one earlier run showed a single failure whose name was not captured and which never reproduced in six subsequent runs (three full-suite, three rig/GLB subset) — treated as a flake, not proven benign.
4. **Visual** — before/after screenshots from the running app (localhost:3000, `idle` triggered): `docs/flight-lab/evidence/2026-10-21-idle-before.png`, `…-idle-after.png`, `…-idle-after-candidate.png` (membrane candidate), `…-v1-rig-ok.png`.

## 6. Scope decisions (please sanity-check these)

- **`land` was deliberately NOT spliced.** The shipped `land` is a healthy authored clip (head tucks to Neck2 −14.6° / Head −7.8° at touchdown, flairs to Head +24° mid-fall, ends head-down). The blend's `land` is a stub (Neck1 dip only, no Neck2/Head motion); splicing it would have regressed the landing. The "head lifts as it lands" perception is the transition into ground-mode `idle`, which this fix removes.
- **`walk` and `rest` left as shipped**, confirmed acceptable by the project owner on 2026-10-21. Note `walk` still carries the gothic-donor signature (Neck1 mean −8.3°) — a recorded, accepted deviation, not an oversight.
- **"V1 rig missing" report** (specimen 04) diagnosed as camera state, not an asset defect: zooming the camera into the model reproduces the exact reported viewport; V1 loads and animates correctly in a fresh session; remedy is the camera panel's Fit/Reset.

## 7. Residual risks / open items

- One unexplained, unreproduced test failure (§5.3) — worth a CI run with per-test names captured.
- `src/flight-lab/runtime.ts` has in-flight edits from a concurrent session (rider work); HMR recompiles intermittently blank the dev page. Not touched by this work.
- The healthy-idle donor (`idle-v2-fold-candidate.glb`) is gone; the current fix derives `idle` from `wyvern-rig.blend`. If that blend is ever revised, re-derive rather than assume.
- Pre-fix backups: `/tmp/wyvern-v2-rig.glb.pre-neckfix.bak`, `/tmp/{membrane-lab,locomotion}-candidate.glb.pre-neckfix.bak` (also in git history).

## 8. Reviewer instructions (Gemini 4)

Gemini 4 Argon went globally available 2026-10-13 (Pro: Gemini app + Search AI Mode; Ultra: also AI Studio + Antigravity; developers: paid API via AI Studio / Gemini platform). It is natively multimodal — attach the four PNGs from §5.4 alongside this note.

Please check:

1. **Re-derive the numbers independently.** Recipe — pure Python, no dependencies, reads the GLB directly:

   ```python
   import json, struct, sys, math
   b = open(sys.argv[1], 'rb').read()
   l = struct.unpack('<I', b[12:16])[0]
   j = json.loads(b[20:20+l]); bin_ = b[20+l+8:]
   def acc(i):
       a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
       n = {'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
       d = struct.unpack('<%df' % (a['count']*n), bin_[bv.get('byteOffset',0)+a.get('byteOffset',0):][:a['count']*n*4])
       return [d[k:k+n] for k in range(0, len(d), n)]
   nodes = j['nodes']
   def rest(ni): return nodes[ni].get('rotation', [0,0,0,1])
   def rel(q, r):
       rx,ry,rz,rw = -r[0],-r[1],-r[2],r[3]; x,y,z,w = q
       return (rw*x+rx*w+ry*z-rz*y, rw*y-rx*z+ry*w+rz*x, rw*z+rx*y-ry*x+rz*w, rw*w-rx*x-ry*y-rz*z)
   for an in j['animations']:
       if an['name'] != 'idle': continue
       for c in an['channels']:
           if c['target']['path'] != 'rotation': continue
           nm = nodes[c['target']['node']].get('name')
           if nm not in ('Neck1','Neck2','Head'): continue
           v = acc(an['samplers'][c['sampler']]['output'])
           R = [rel(q, rest(c['target']['node'])) for q in v]
           sx = [2*math.asin(max(-1,min(1,q[0])))*57.2958 for q in R]
           print(nm, round(sum(sx)/len(sx),1), round(min(sx),1), round(max(sx),1))
   ```

   Expected on the fixed asset: Neck1 ≈ 0 (−1.9..+1.1), Neck2 ≈ 0 (−2.6..+1.5), Head ≈ 0 (−6.8..+6.9).

2. **Audit the splice tool** (`tools/blender/splice_neck_head_channels.mjs`, ~120 lines): channel filtering by `bone:path`, node remap by name, sampler index offset when appending donor samplers, the contract's duplicate-target assertion as the safety net. Look for edge cases we didn't hit (donor missing a target bone, CUBICSPLINE donor, multi-strip actions).
3. **Sanity-check §6** — especially the `land` decision and the accepted `walk` deviation.
4. **Flag over-claims.** Anything in this note that the evidence doesn't support.

## 9. Commands used (reproduction)

```bash
BLENDER=~/.local/bin/blender                      # Blender 5.1.1
# 1. donor export from the authoring source
python3 scripts/blender/cli.py --headless --blend models/source/wyvern-rig.blend export --out /tmp/donor.glb
# 2. channel-level splice (repeat per asset)
node tools/blender/splice_neck_head_channels.mjs public/models/wyvern-v2-rig.glb /tmp/donor.glb /tmp/candidate.glb idle
# 3. validate candidate, then promote + re-pin contract, then validate the shipped path
node tools/blender/runtime_rig_contract.mjs /tmp/candidate.glb --candidate
#    (edit scripts/blender/wyvern_v2_runtime_contract.json: asset.sha256, asset.bytes, provenance)
npm run assets:validate-wyvern
# 4. tests
npm run test:fast
```

---

## 10. Review response (2026-10-22)

Gemini 4's six-row audit was performed against **`3db1b15`**, one commit before `5fb3ab1`
("repair V2 pipeline leaks, jaw seal, and Blender export bugs"), which fixed four of the six
rows and re-pinned the asset `d916b748…` → `88adf57e…`. Everything below is re-measured on
the current tree (`bef7a09a…`, 6,368,564 B, 18 clips) and on the historical assets pulled
from git, not restated from the commit message.

| Row | Reviewer verdict | Re-measured | State today |
|---|---|---|---|
| §2 / §8.1 numbers | Verified ±0.1° | **Confirmed exactly** | Arithmetically right, evidentially incomplete — see 10.1 |
| §4 splice tool | Bug, +237 KB | **Confirmed exactly** | Closed in `5fb3ab1`; contract now gates it |
| §3 provenance | Over-claim / hazard | **Half right, wrong mechanism** | Hazard closed; provenance corrected — 10.2 |
| §6 walk | Sound | **Confirmed** | Unchanged, healthy |
| §6 idle droop | +13° nose-down | **Confirmed exactly** | Closed in `5fb3ab1` |
| §6 land → idle snap | 15.89 / 13.00 / 16.98° | **Confirmed exactly** | Closed in `5fb3ab1` |

### 10.1 The §2 table measured the wrong frame

The note's before/after table is `inv(bind) · q` per bone, i.e. *local* pitch. On `d916b748`
that reads ≈0.0° on all three bones — the reviewer's numbers reproduce to 0.1° — while the
**composed postural chain** (`Body·Spine1..3·Neck1·Neck2·Head`, same measure the
`horizon_pitch` detector uses) sits at **+13.0° mean / +13.5° median**. Zeroing three local
channels does not level a head whose `Body` holds +12.95°. The reviewer's own §6 row is the
correct read, and the note should have carried that column.

### 10.2 §3: the hazard was real, the provenance story was not

**Right, and worth the alarm.** At `3db1b15`, `upgrade_v2_rig_ground_and_membrane.mjs`
premultiplied `Neck1 −12°`, `Neck2 −12°`, `Head −8°` onto `idle` (lines 403–405; the review
cites 257–281, which is the accessor writer — line refs drifted). The arithmetic is exact:
shipped `−21.1 / −24.2 / −19.3` minus that `−32.0` leaves `−9.1 / −12.2 / −11.3`, so the
committed upgrader supplied **exactly 32.0° of the 64.6°**. Re-running it would have
re-injected that half. Fixed in `5fb3ab1` → `−4.0 / −5.0 / −3.5` with a do-not-raise comment.

**Wrong, on two counts.**

1. **The −65° predates this repo.** The initial commit's `public/models/wyvern-v2-rig.glb`
   (`8673e12`) is **byte-identical** to the pre-fix backup — both `e8edd574…`, 5,740,476 B.
   No committed script here created it; the other ~33° arrived with the asset.
2. **`author_v2_ground_wing_fold.py` as committed authors a *level* idle.** `Body` +12.95°
   (line 197), `Neck1` −4.1°, `Neck2` −6.2° (lines 231–232), `Head` −5.3° (line 248) — the
   corrected posture, not the defect. It cannot produce −21/−24/−19.
3. The "**+28.6° downward bind-pose offset**" is the *sum* of the three bind pitches
   (`Neck1 −1.32`, `Neck2 −22.27`, `Head −4.96` = −28.55), not an offset on any one bone.
   Dropping it would shift the chain **+28.55°** — opposite sign, wrong magnitude for the
   −17 / −18 / −14 the defect actually needs.

Net: the note's "came only from a deleted external donor" is incomplete — a committed script
supplied half the lift — but the reviewer's mechanism is not the one that produced it.

### 10.3 §4: confirmed, and already gated

`d916b748` carries **390 samplers in `idle`, 114 of them orphaned**, and 5,977,592 B against
5,740,476 B pre-splice = **+237,116 B**, exactly as reported. `splice_neck_head_channels.mjs`
now copies only referenced samplers, and `runtime_rig_contract.mjs:148` asserts
`samplers.length === usedSamplers.size` per clip, so the regression cannot ship again. The
rest-delta, duration and CUBICSPLINE guards the review calls missing exist at lines 90–107.
Current asset: **276 samplers in all 18 clips, zero orphans.** Residual, cosmetic: the splice
never compacts, so the three replaced channels' accessors stay in the JSON as dead entries;
`compactGlb` drops them on the next stage that runs.

### 10.4 §6: idle droop and land handoff, confirmed and closed

- `d916b748` idle chain **+13.0° mean / +13.5° median** (range +5.0…+19.8). `apply_idle_horizon_leveling.mjs`
  (−4.0/−5.0/−3.5) → `88adf57e` **+0.5 / +1.0**. After D3's motion floor the shipped asset sits at
  **+5.5 mean / +5.0 median**.
- `d916b748` land → idle: **Neck2 15.89°, Head 13.00°, R/L_Foot 16.98°** — every figure reproduced.
  `88adf57e`: worst bone **2.02°**. Current: worst **5.75°** (Tail10), Neck2 4.63° — inside the 8° gate.
- walk, as the review says, is sound: `Neck1 −8.5`, `Neck2 −6.5`, `Head +2.4`, chain **+2.5 mean /
  +3.0 median**. The review's −12.0° local sum → +0.8° world was read before D3; the floor moved it
  to +2.5° and the posture is still level.

### 10.5 Not in the review: D4 whips `attack`'s head 108° per key

The strongest finding of this pass came from looking at the clip the review did not name. D4
(`541b3e8`) solved a gain for `attack` and applied it to **every animated bone**, the neck
chain included:

| `attack` | pre-D4 (`562131d`) | shipped (`bef7a09a`) |
|---|---|---|
| Neck1 / Neck2 pitch vs bind | ±8.0° | **±88.45°** |
| Head pitch vs bind | ±18.0° | **±88.45°** |
| Head key-to-key rotation, max / median | 9.8° / 2.3° | **108.1° / 25.1°** |
| Head-bone direction vs bind, max | 40.0° | **175.0°** (head travels 463 rig units, bind offset 177) |

Both gates are blind to it by construction: `POSTURE_EXEMPT_CLIPS` exempts `attack` from every
postural detector, and the dynamics gate measures *how much a clip moves* — which is precisely
what the gain added. `npm run assets:audit-pose-envelope` reports 18/18 clips clean, exit 0, on
an asset whose attack head swings a quarter turn per key. Same failure mode as E1: an
instrument that has only ever been green.

Not fixed here. Capping the postural chain changes the gain `build-dynamics-candidate.mjs`
solves for `attack`, and D4 is already partial and blocked by product invariants. The fix is to
exclude `Body/Spine*/Neck*/Head` from the gain (or cap per-bone rotation at ~35°/key) and let the
gain re-solve; if `attack` cannot reach its dynamics floor without the neck, that is evidence the
gate is the wrong target — the same conclusion `cruise` and the banks already forced.

