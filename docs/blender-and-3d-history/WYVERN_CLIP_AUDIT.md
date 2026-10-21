# Wyvern clip audit — mirroring, loop seams, frame-0 starts

Measured facts about the 16 authored clips in `public/models/wyvern.glb`, and the
four defects that were repaired across them — three in the clips (wing mirroring,
loop seams, frame-1 starts) and one in the manifest that plays them (looping
clips in the one-shot action channel). Read this before authoring or editing a
clip on `WyvernRig`, or before adding a state to the action channel.

Re-run any time:

```bash
pnpm assets:wyvern-audit && pnpm assets:validate-wyvern
```

The first checks the authored F-curves in `public/models/wyvern-rig.blend`; the
second checks the exported GLB the way three.js actually plays it. Both exit
non-zero on a defect, so either is usable as a gate. Repair with
`pnpm assets:wyvern-audit --fix`, which also saves the `.blend` and re-exports.

---

## The axis convention, which is the whole reason the bug existed

Probed on the live armature, not reasoned about. Two of these contradict the
obvious guess:

| Bones | Local +X | Local +Z |
|---|---|---|
| `Spine*` / `Neck*` / `Head` | pitches the head **down** | yaws toward −X |
| `Tail1..Tail10` | lifts the tail **up** (opposite sense to the spine) | — |
| Wing shoulder / elbow / wrist | raises **both** wings — **symmetric** | sweeps them in **opposite** directions — **antisymmetric** |
| `Body.location` | — | +Z is world **down** |

So a mirrored wing pose **shares `X`** across the two sides and **must negate
`Z`**. Seven clips gave both wings the same `Z`, which folds one wing forward
across the chest and the other back.

`+Y` is toward the tail, so a positive sweep angle means a wing swept **back**.
Two measured reference poses anchor everything below:

| | body-local sweep | meaning |
|---|---|---|
| `idle` | +37.3 … +38.5° | a folded wing, swept back |
| `cruise` | −11.6 … −11.1° | an extended wing at the neutral `Z` of zero |

---

## What was wrong, and what it measures now

`mirror` is the worst left-vs-right wingtip mismatch over the clip, in displayed
metres, measured in the **Body bone's own frame**. `seam` is the worst per-bone
difference between the first and last frame, over rotation *and* position.

| clip | mirror before | mirror after | seam before | seam after | loops |
|---|---|---|---|---|---|
| `attack` | 15.673 | **0.0009** | 0.785 | **0.0004** ⁵ | no ⁴ |
| `breath` | 5.443 | **0.0009** | 0.001 | 0.001 | no ⁴ |
| `death` | 27.146 | **0.0009** | 300.0 | 300.0 ¹ | no |
| `land` | 23.885 | **0.0009** | 300.0 | 300.0 ¹ | no |
| `rest` | 26.016 | **0.0006** | 0.419 | **0.001** | yes |
| `takeoff` | 24.012 | **0.0009** | 300.0 | 300.0 ¹ | no |
| `walk` | 15.673 | **0.4488** ² | 0.928 | **0.001** | yes |
| `speed` | 0.001 | 0.001 | 5.500 | **0.001** | yes |
| `bankLeft` | 9.054 | 9.054 ² | 0.001 | 0.001 | yes |
| `bankRight` | 9.055 | 9.055 ² | 0.001 | 0.001 | yes |
| `idle` | 0.101 | 0.101 ³ | 0.001 | 0.001 | yes |
| `cruise` `dive` `glide` `hover` `scout` | 0.001 | 0.001 | 0.001 | 0.001 | yes |

¹ A one-shot, so its ends are not required to match. `death`, `land` and
`takeoff` carry a 300-unit `RootMotion` drop by design; `attack` opens on a
wound-up pose and resolves to neutral.
² Asymmetric on purpose — see below.
³ `idle` runs its two wings on the same carrier at slightly different amplitudes
so they drift independently, which is deliberate.
⁵ `attack` was re-authored after this audit (see below), which closed its seam
as a side effect: it now opens *and* closes on the neutral pose.

⁴ Both used to loop and no longer do — see the action-channel section below.
`breath` closes cleanly and *could* loop; it is a one-shot because of how it is
dispatched, not because of anything in the clip. It was re-authored after this
audit as well (see below), which left its mirror and seam where they already
were and changed everything else about it.

**0.0009 m is the floor, not a residual defect.** The rig's own bind pose is
asymmetric by 0.00089 m, so every repaired clip is now as symmetric as this
skeleton can be.

Every clip except `idle` also started at frame 1, putting its first glTF key at
t = 1/24 s; three.js clamps to the first pose for that opening frame, a 42 ms
hitch on every loop. All 15 non-idle clips were shifted to start at frame 0. Relative timing
inside each clip is unchanged — the shift is one number per action — so each
clip is now 1/24 s shorter and starts at t = 0.

---

## Which side survived each repair

Negating either side zeroes the asymmetry, but the two choices keep opposite
poses, so the choice is not arbitrary. Each was made by building both variants
and measuring the resulting sweep against the two references above. The losing
variant in every case put both wings 40–70° **forward across the chest**.

| clip | kept | measured sweep after | the variant that lost |
|---|---|---|---|
| `attack` | R | settles +19.1 back into `idle` | settled −41.3, a 79° pop |
| `breath` | L | holds −1.2, just back of neutral | held −21.3, forward of neutral |
| `death` | L | opens +49.7, near `idle`'s +38 | opened −71.1 |
| `land` | R | brakes forward, ends +19.1 back | ended −41.3 |
| `rest` | R | +47.7, a tight fold | −69.2, both wings across the chest |
| `takeoff` | L | opens and closes +29.3 | opened −51.3 |
| `walk` | R | +19.1 back, matching `rest`'s fold | −41.3, forward |

There is no single convention to apply mechanically: the clips were authored
independently and `rest`/`walk`/`land`/`attack` used the opposite sign to
`breath`/`death`/`takeoff`. The table above records the resolution per clip.

---

## The manifest side: action-channel clips must be one-shots

Auditing "clips the manifest loops" turned up two entries that loop but must not.
This is a manifest defect, not a clip defect — both clips are fine.

`GameModel` emits `onActionFinished` for `loop: false` specs **only**, and that
callback is the single mechanism that clears a tell: every caller drops its
action when the token comes back. A looping spec in the action channel therefore
never ends. The sanctuary director already states the invariant in a comment —
*"Active one-shot, retained until GameModel says its mixer action ended"* — but
nothing enforced it.

| state | was | now | what the bug looked like |
|---|---|---|---|
| `attack` | looping | `loop: false` | Ground attacker stuck in the attack tell, snapping 45° back to the wind-up on every wrap. Its seam is 0.785 for exactly that reason: the clip opens on a wound-up pose and resolves to neutral, so its ends were never meant to meet. `attackAir` was already correct. |
| `breathe` | looping | `loop: false` | Worse, because it latches something else: `BreathVFX` sets `active` from `actor.breathing \|\| action?.state === 'breathe'` and **restarts** its 0.85 s burst while `active` holds. With the action never clearing, one breath attack left the fire looping permanently. `actor.breathing` itself is a clean single-tick flag, reset at the top of every tick, so clearing the action is all that was needed. |

`src/render/assets/manifest.action-channel.test.ts` locks both, and cross-checks
the state list against the `setAction` call sites so a new tell cannot be added
without being a one-shot.

## The action channel does not re-plant the model

The second thing a tell must not do. `GameModel` positions the model from a
clip's `yOffset` — the measured drop of that pose below the rig origin, negated —
and it used to take that from the *playing* spec. `attack` and `breath` carry
`yOffset: 0` against `idle`'s 152.89, so a grounded wyvern sank **1.10 m** the
instant it bit or breathed, and popped back when the tell cleared.

Measuring the tells and giving them their own numbers does not fix it. Their
poses do hang lower — `breath`'s bottoms out at 277.4 rig units and `attack`'s at
402.0 against `idle`'s 152.9 — but a tell is played over *several* bases, and the
same clip has to be right over all of them:

| base state | plant |
|---|---|
| `idle` | 152.89 |
| `walk` | 85.57 |
| `rest` | 368.80 |
| every airborne state | 0 |

So the offset is **inherited** instead. `resolvePlantSpec` in
`gameModelPlayback.ts` returns the base state's spec whenever an action-channel
override is playing, and the playing spec otherwise. A tell is a transient
overlay on whatever locomotion is underneath, not a new stance, so it holds the
plant that locomotion already established — and an airborne tell inherits 0,
which is what the scene wants there anyway. `attack` and `breathe` keep their own
offsets for when they are requested as ordinary *base* states, which `pickUp`,
`huntGrip`, `drop` and `huntFinish` all do.

This is continuous at both edges by construction: the plant is the base spec
before the tell, during it, and after it clears, because `active` never changes
while an override is playing (`chainedFrom` is null then, so the `next` chain
cannot fire) and the override clears without touching it.
`gameModelPlayback.test.ts` asserts the inheritance for all four tells against
all three grounded loops, using the manifest's real numbers.

What this does *not* address: the tells' wings are not run through the pipeline's
lift pass — `lift-v1-wing-clips-blender.py` takes `idle,rest,walk,takeoff,land`
only — so their neutral frames keep the gothic rig's unlifted bind fold, which
hangs about 117 rig units (0.84 m) lower than `idle`'s lifted one. That gap is a
property of the clip pair and was there before the plant changed; it was simply
buried under the 1.10 m the plant was moving on its own. It scopes itself to assets that actually load a model:
the `unit.*` entries are `url: null` placeholders, and their looping `attack` is
fine because `attack` is legitimate as a *base* state — it only has to be a
one-shot when the action channel dispatches it.

## What is asymmetric on purpose

`bankLeft` and `bankRight` hold ~9 m of wingtip asymmetry and are **correct**.
A bank beats the outboard wing deeper than the inboard one. They carry no `Z` at
all — the asymmetry is entirely on `X`, the symmetric lift axis, at different
per-side amplitudes (shoulder 25° vs 50°, elbow 5/−10° vs ±15°). The two clips
are exact left/right swaps of each other, key for key, and the validator checks
that they stay within 0.5% of each other rather than requiring symmetry.

`walk` holds 0.4488 m of asymmetry and is also **correct**. The vendor walk is
quadrupedal: its wing knuckles approach the ground on alternating steps, rather
than both wings acting as a locked decorative carrier. The rebuilt clip follows
that cadence with a restrained 0.9° shoulder settle and keeps the Z sweep
mirrored, so it reads as relaxed weight transfer rather than a flap. The runtime
validator requires at least 0.1 m of walk asymmetry; that catches a regression
back to rigid, synchronized wings without confusing it with a bank.

---

## Traps worth keeping

- **Most clips key only 2–8 of the 56 bones.** In Blender an unkeyed bone silently
  carries the previously evaluated action's pose into the next measurement, which
  is enough to make an exactly-symmetric clip report a residual. Both tools reset
  to the rest pose before every action. The exported GLB is fully baked
  (168 tracks, every bone every frame) so this is an authoring-side hazard only.
- **A world-space symmetry check is invalid on a clip that tumbles the body.**
  `death` rolls `RootMotion` 90°/45°/30°, and a world or armature-space
  comparison reports ~36 m of mismatch on a pose that is exactly symmetric. The
  measurement has to happen in the Body bone's own frame; there the same clip
  reads 0.0013 m.
- **Seeking a three.js `AnimationAction` is easy to get silently wrong.**
  `mixer.setTime()` resets every action's own time to zero, and `action.paused`
  makes the mixer skip the action entirely — either one pins every sample to
  frame 0, which scores a known-broken model a clean pass. Assign `action.time`
  and step the mixer by a zero delta. `LoopRepeat` also wraps a request for
  exactly `duration` back to 0, so a seam check needs `LoopOnce`.
- **A rotation-only seam check misses the body bob.** All three loop seams
  repaired here — `speed` 5.500, `walk` 0.928, `rest` 0.419 — were on
  `Body.location`, and score a clean zero if only quaternions are compared.


---

## The `attack` re-author, and the strike pool

`attack` as audited was v1's `Battle_Attack06` at its capture length: 81 frames,
3.333 s, of which the last 40 were a drift back to neutral, with 11.1 degrees of
wing elevation across the whole clip. As a battle tell that is too slow — the sim
resolves the blow on one tick while the clip is still winding up — and it opened
on a wound-up pose, which is what its 0.785 seam was, and what popped on
`attackAir`'s 0.16 s fade-in.

`scripts/author-wyvern-attack-blender.py` replaces it with a 36-frame (1.500 s)
strike on the same rig: neutral → wind-up (f9) → strike (f15) → bite (f18) →
neutral (f33, held to f36). Measured against the clip it replaces:

| | before | after |
|---|---|---|
| duration | 3.333 s | 1.500 s |
| head path | 15.20 | 15.61 |
| head pitch swing | 131.9° | 137.9° |
| wing elevation | 11.1° | 44.0° |
| mirror | 0.0009 m | 0.0010 m |
| seam | 0.785 | 0.0004 |

The same head travel in 45% of the time, with the wings actually mantling. Only
local X is authored, so the antisymmetric Z channel keeps its bind value and the
left/right mirror is symmetric by construction rather than by repair. The script
runs against **both** authoring blends — `wyvern-rig.blend` feeds `wyvern.glb`,
and `wyvern-rig-v1wing.blend` is what `pnpm assets:gothic-wing` retargets into
the shipped `wyvern-gothic.glb`, so authoring only the first leaves gameplay on
the old performance.

Two v1 captures ship beside it as a pool, promoted by
`scripts/author-wyvern-attack-variants-blender.py` after
`retarget-v1-ground-clips-blender.py`:

| clip | source | length | used by |
|---|---|---|---|
| `attack` | authored | 1.500 s | `attack`, `attackAir` |
| `attack2` | v1 `Battle_Attack06` | 3.333 s | `attack` |
| `attackAir2` | v1 `Battle_Attack04` | 3.333 s | `attackAir` |

`GameModel` picks from the pool by the model's `seed`, so the choice is stable
per wyvern and a rank of them does not strike in lockstep. The two v1 clips lead
with one side — 15.4 and 16.2 m of wingtip asymmetry — and are listed in
`validate-wyvern-clips.mjs`'s asymmetric-by-design set for that reason, the same
exemption the banks and `walk` carry. v1's `Battle_Attack01` is deliberately not
promoted: at 195 frames it is 8.1 s, and the only way to fit it as a tell is a 3×
retime that reads as a fast-forward.


## The `breath` re-author, and where the jet points

`breath` as audited was the procedural pass in `scripts/author-organic-ground.py`
— 48 frames at 24 fps, four blocks of linear interpolation. Four things measured
wrong at once, and only the last is visible in a still:

**It opened with 12 frames of nothing.** `Body`, `Neck1`, `Neck2`, `Head`, `Jaw`
and the whole tail held their frame-0 value exactly from f0 to f12. The only
motion in the first half-second was the wing carrier's 2.5-degree idle flutter.
That is a quarter of a clip whose entire job is to be a legible tell.

**The gape was small, and late.** It peaked 31.8 degrees off the closed jaw at
t = 1.63 s — two-thirds of the `attack` bite's 48.1, on the one clip in the set
that exists to hold a mouth open. `BreathVFX` ignites on the frame the action
starts and restarted its 0.85 s burst for as long as `action?.state ===
'breathe'` held, so for the first 1.15 s — 58% of the clip — fire poured out of a
shut mouth.

**The jet pointed at the ground.** `BreathVFX` aims along the tangent from the
last neck link to the skull, and `tryBreath` in `core/combat/encounter.ts` tests
a strictly **horizontal** cone out to `breathRange`. The audited clip swung that
tangent from −14.3° at rest up to +20.7° at t = 1.0, then down through 68 degrees
to **−47.7°**, and held the widest gape there. The fire was drawn nowhere near
what it damaged.

**Nothing braced.** `Tail1` held 148.5° and `Tail5` held 2.4° for all 49 frames.
An animal emitting a jet absorbed no recoil anywhere.

`scripts/author-wyvern-breath-blender.py` replaces it over the same 48 frames:
neutral → inhale (f7) → ignition (f11) → jet (f11–f34) → cutoff (f40) → neutral
(f45, held to f48). Measured on `wyvern-gothic.glb` before and after:

| | before | after |
|---|---|---|
| first frame a body channel leaves the frame-0 pose | f13 | **f1** |
| gape travel | 31.8° | **51.0°** |
| gape at the flame window | 3.7° open at 0.85 s | **>30° throughout** |
| jet aim while the mouth is open | +20.7° … −47.7° | **−14.7° … −8.3°** |
| `Tail3` travel | 0.0° | **3.5°** |
| wing elevation | 4.5° | **37.7°** |
| mirror | 0.0010 m | 0.0010 m |
| seam | 0.0006 | 0.0006 |

Only the wing carrier moved in the audited clip's first twelve frames, and only
by its 2.5-degree idle flutter — hence the two different "first frame" answers
for the same clip.

### Where the jet points is solved, not guessed

Probed on the armature: every bone from `Body` through `Neck2` moves the skull
tangent by exactly **−1.0 degree per +1 degree of local X**, and `Head` moves it
by **0.0** — it rotates the skull below the point the tangent is measured from,
so it aligns the muzzle with the fire and does nothing to aim it. Therefore

    aim = −14.32° − sum(Body, Spine1, Spine2, Spine3, Neck1, Neck2)

The −14.32° is the bind pose's own aim, and it is already the line this animal
needs: a grounded wyvern's head sits 793 rig units up — 5.71 m at `WYVERN_FIT` —
so −14.32° reaches a ground target's torso at 16.5 m, the middle of the 14–18 m
`breathRange` band in `core/data/config.ts`. The jet holds a chain sum near zero
and lets recoil walk it *up* a few degrees, rather than sweeping past neutral.

### The cutoff was trimmed by measurement, not by eye

The first pass put +8 degrees of follow-through on `Body` and the spine at the
cutoff. On the gothic mesh that dropped the lowest vertex to −232.7 rig units
against the clip's own neutral of −120.2, punching the chin 0.56 m through the
plane `idle` stands on for six frames. Moving the same +8 of aim onto `Neck1`
and `Neck2`, which do not pitch the chest, and zeroing the tail's undershoot,
brings the worst frame to −155.9 — within 3 rig units, 0.02 m, of `idle`'s own
−152.9.

### The burst was re-timed to the gape

`BREATH_VFX_LEAD_SECONDS` (0.4 s) delays ignition to the frame the mouth is
actually open, and the burst no longer restarts itself while the action holds.
That restart is what hid the old clip's timing: a 0.85 s burst ran two and a bit
times per breath and outlived the clip by its release tail, so the fire was
always on and never had to agree with the mouth. `manifest.breath-clip.test.ts`
derives its flame window from those two constants, so the clip and the effect
cannot drift apart without failing.

### One trap this re-author surfaced

`author-wyvern-wing-surfaces-blender.py` stamps the response layer it adds onto
the action and **subtracts that recorded layer** before re-applying, so a second
run replaces the flex rather than doubling it. Both re-author scripts wipe every
F-curve — which removes the layer but left the stamp behind. `attack` had been
sitting in that state since its own re-author: no membrane curves, but still
marked as carrying a response, so the next surface pass would have subtracted a
flex that was not there and baked its negative into the carrier. Both scripts now
delete the marker with the curves, and the surface pass has been re-run, which is
what restored `attack`'s membrane response to `wyvern.glb`.
