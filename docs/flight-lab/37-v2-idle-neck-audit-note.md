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
