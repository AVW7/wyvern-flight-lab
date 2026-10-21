# Wyvern animation quality baseline

What the wyvern rig can demonstrably do, measured; how the authored clips were
built out of that; and how a new clip is held to it without anyone looking at a
picture.

Three files carry the whole thing:

| File | Role |
|---|---|
| `scripts/analyze-clips.py` | Measures all 78 clips in Blender, headless, in ~20 s |
| `validation/wyvern-animations/clip-signatures.json` | The measurements. Committed |
| `validation/wyvern-animations/clip-contracts.json` | The thresholds, each with the vendor clip it came from |

`src/render/assets/animationContracts.test.ts` asserts the second against the
third in `pnpm test`. Blender is needed only to regenerate.

## Why this exists

The review contract in `docs/FLIGHT_ANIMATION_DEVELOPMENT.md` states each
locomotion mode's pose in prose — *"cruise keeps a long, nearly horizontal body
line"*, *"hover puts the centre of mass under the wing roots with the legs
hanging"* — and made fixed-origin renders the approval view. Prose cannot fail a
build and a contact sheet cannot be diffed, so nothing enforced either.

The first run of the analyzer found what that cost. The shipped cruise loop —
documented in `BUILD_NOTES.md` as *"three symmetric 83-degree wingbeats"* — was
measuring:

| channel | shipped `Sanct_Glide` | its own documented source `Battle_Down02` |
|---|--:|--:|
| stroke arc | 27.3° | 96.3° |
| wing elevation range | 5.4° | 84.0° |
| left/right symmetry error | 37.69 | 1.49 |
| body axis | 22.1° nose-up | 7.8° |
| wingbeats | none detectable | 3 |

The two wings sat 38 units apart and never flapped. The `.blend` predated the
recipe rewrite that fixed it, and nothing in the pipeline could tell.

That is the argument for numbers over images in one table: every one of those
five defects is obvious at a glance as a row of digits, and none of them is
obvious in a contact sheet of a near-black dragon.

## The measurement channels

One pass per clip. Pose-bone channels are read on every frame; summary statistics
use 48 evenly spaced frames (matching the retired `survey-flight-clips.py`, so
its published numbers reproduce exactly — swept arc and path length are both
sample-count dependent).

| Channel | Definition | What it decides |
|---|---|---|
| `wing_elev_L/R` | shoulder→wingtip angle above horizontal | the propulsion cycle; its range is stroke amplitude |
| `wing_elev_bias` | signed `L − R` | banking. Zero is level flight; the sign says which way |
| `wing_stroke_asymmetry` | `wing_elev_L.range − wing_elev_R.range` | whether a turn is an authored *deformation* or a rigid offset — a constant rotation shifts both wings without changing how far either travels |
| `wing_azimuth_L` | armature-space azimuth of the same vector | stroke plane, fore/aft sweep |
| `wing_extension_L/R` | ‖tip − shoulder‖ | folded versus spread |
| `body_axis_deg` | head→tail pitch | locomotion mode & hip/body line (forward streamlined ~0-12° vs hover/land upright ≥25°) |
| `root_roll_delta_deg` | wrapped roll deviation of `Bip002_06` from frame 0 | authored roll/pitch flare, which must not double runtime's |
| `pelvis` | span, path length, height | origin contract & hip placement (streamlined high in forward flight vs dropped low in hover) |
| `foot_drop` | pelvis.z − **left** foot.z | leg/feet carriage: tucked trailing in forward flight vs hanging extended in hover/land |
| `foot_drop_R` | the same on the right foot | so a wrong-signed right leg is visible. It was not: `foot_drop` alone had watched one foot since this file existed |
| `foot_asymmetry` | signed `foot_drop − foot_drop_R` | drift guard, and the channel that found the hind-limb mirror. Flight used to sit at 0.63–1.05 — the vendor base pose's own left/right difference, inherited, not authored. `mirror_legs` takes it to 0.04–0.06 |
| `head_reach` | horizontal and vertical offset from the pelvis | head position & neck intent: forward extended in flight vs level/alert counter-bent in hover |
| `head_reach.lateral` | **signed** x of the head relative to the pelvis | which way the head is looking. The pose contract has always asked a banking wyvern to "look/lean into the turn" and nothing measured it, so the lean shipped on the wrong side. It is the head bone's own origin, so only a bend *above* it in the neck moves it — rotating the head bone itself is invisible here by construction (probed: 0.000 on every channel at 0.70 rad) |
| `tail_reach` | horizontal, vertical, and **signed** lateral offset | tail job; a bank's counterbalance is a direction |
| `jaw_deg` | jaw rotation from rest | mouth |
| `toe_deg` | lead hind-toe local-**X** rotation from rest | the toe fan's *sweep*. Swings ±40° for under 0.09 of change in outer-toe span, so it can move a long way without the silhouette moving. Kept because the grounded contracts are calibrated against it |
| `toe_curl_deg` | lead hind-toe local-**Z** rotation from rest | the axis that actually opens and closes the claw: −0.50 rad spreads the fan 1.54 → 1.73 and drops the tips 0.44, +0.50 gathers it to 1.15. This is the one a flight contract gates |
| `symmetry_error` | wingtip distance after reflecting the left one through the sagittal plane | baseline asymmetry a per-side delta cannot fix |
| `wingtip_L/R.lateral` | **signed** x of each wingtip relative to the pelvis | which side each wing is actually on |
| `ground_clearance` | lowest point of the evaluated skin | `yOffset`, and whether geometry passes through terrain |
| `loop` | first-vs-last pose displacement, mean and max | loopability |
| `cycle` | wingbeats, cadence in Hz, frames per beat | mode identity and phase-group compatibility |

Two notes that matter when reading them:

- **`root_roll_deg` raw is useless as a contract channel.** This rig sits near
  ±180° on most clips, so a pose that never rolls reports a 355° range purely
  from the wrap. `root_roll_delta_deg` is the wrapped deviation from the opening
  frame, which is the question a contract actually asks.
- **`ground_clearance` measures reach below the origin, not altitude.** No clip
  translates its root. `Battle_Up`'s sweep from `+1.76` to `−23.29` is the wings
  and tail extending, not the body rising.
- **`symmetry_error` reflects, it does not compare magnitudes.** An earlier form
  scored `|left.x| − |right.x|`, which rates two wings stacked on the *same* side
  as perfectly symmetric — identical to a correct mirror. The reflected form
  agreed with it on 43 of the 78 clips measured at the time, diverging only where a wingtip crosses
  the midline, which is exactly where the magnitude form under-reported:
  `Battle_SkyMoveL` 12.10 → 14.00, `Battle_Skill11_L` 18.90 → 22.40, the
  fly-away cinematic `Spawn01` 8.40 → 56.32. `wingtip_L/R.lateral` states the
  side directly so the check does not depend on reading a distance at all.

## The capability envelope

Fifty-two artist-authored clips establish the bar. Everything an authored clip is
held to is somewhere in this table.

| Capability | Extreme | Clip |
|---|--:|---|
| Widest stroke arc | 179.4° | `Battle_SkyMoveL` |
| Largest wing-elevation range | 162.2° | `Battle_SkyMoveL` |
| Most nose-up body axis | 58.4° | `Battle_Skill08` |
| Most nose-down body axis | −18.1° | `Damage_Staggering_Right_Body` |
| Best achievable symmetry | 0.28 | `Battle_Stand` |
| Best symmetry in a powered beat | 1.25 | `Battle_Up` |
| Largest authored stroke asymmetry (a real turn) | 52.8° | `Battle_SkyMoveL` |
| Maximum wing extension (semi-span) | 20.3 | `Battle_Skill07` |
| Maximum foot drop below the pelvis | 5.6 | `Battle_Down02` |
| Maximum lateral tail span | 41.6 | `Battle_SkyMoveL` |
| Maximum jaw open | 90° | `Death`, `Spawn`, others |
| Deepest reach below the origin | −37.4 | `Damage_Add_Groggy` (additive delta) |
| Wingbeat cadence range | 0.11–1.08 Hz | across 46 clips with a detectable cycle |

37 of the 52 loop. 46 have a detectable wingbeat cycle; the six that do not are
the near-static idles and the additive delta poses.

**The cruise bar specifically.** `Battle_Down02` is the measured cruise source
(see `BUILD_NOTES.md` for why it beat the skill clips): 96.3° arc, 84.0°
elevation range, 1.49 symmetry error, 7.8° mean body axis, and a pelvis that does
not move on any of its 112 frames. `Battle_Up` reaches further — 109.7° arc — but
holds a 23.5° body axis, which is why it stayed the takeoff.

## How the authored clips were created

`scripts/build-sidecar.py` does not hand-key bones. It **samples
measured poses out of the artist's own clips and re-times them**, which is why
the sanctuary clips move like the vendor ones instead of like a programmer's idea
of a dragon.

The unit is a `PoseKey`:

```python
PoseKey(dest=48, source=GLIDE, frame=38, rotations=…, mirror="L", post_rotations=…)
```

- `source` + `frame` name a frame of a vendor action. The whole pose is snapshot
  from it.
- `rotations` are local-space edits layered on top, applied **before** mirroring.
- `mirror="L"` overwrites the right wing chain with the left one's reflection
  through the rig's sagittal plane. The rig is mirrored across X (`L-Clavicle` at
  x=+83.77, `R-Clavicle` at −83.77), so a transform `M` becomes `S @ M @ S`,
  which stays a proper rotation because `det(S)² = 1`.
- `mirror_legs="L"` does the same to `Bip002-{L,R}-Thigh/Calf/Foot`, and is
  stated separately rather than inherited from `mirror` because the two chains
  answer different questions — see the hind-limb section below. Every flight
  recipe sets it; no grounded one does.
- `post_rotations` are applied **after** the mirror. Any deliberate left/right
  asymmetry has to live here — an edit in `rotations` touching a wing chain is
  overwritten by the mirror that follows it.
- `dest` is the destination frame, so re-timing is a table edit.

Five things that are non-obvious and were each learned the expensive way:

1. **A per-side flap delta cannot cancel a baseline asymmetry, only offset it.**
   Sampling one frame of an asymmetric swoop is what left the pre-rebuild cruise
   loops with 37.7 symmetry error. `mirror` exists to remove the baseline before
   any asymmetry is added.
2. **The wing clavicles are children of the neck on this rig.** A lateral neck
   sway swings both wings with it and reads as wingtip asymmetry — measured at
   23.5 peak error with it, 6.4 without. Flight keys therefore bend the neck in
   the sagittal plane only. The chain has exactly two useful axes, probed at
   0.30 rad across the flight pose and the three grounded poses the recipes
   sample:

   | axis | effect | argument |
   |---|---|---|
   | local Z | head down 0.42–0.59, and back | `down` |
   | local Y | head sideways 0.12–0.72 | `side` |
   | local X | 0.05–0.10 sideways | nothing |

   **Both neck arguments named the wrong axis, and had done since they were
   written.** `down` drove local X — the inert one — and `side` drove local Z,
   which lowers the head. So every recipe using them had its two layers swapped
   with one of them dead: the groom's *"turn back to preen the folded wing"* was
   lowering the head 1.5 units and turning it nowhere, and the drink's `down=0.34`
   did nothing at all. Flight keys passed the same broken `down` at ±0.012 rad,
   which was a no-op three times over. Corrected, the groom swings its head 10.4
   units laterally against 1.7 vertically, and the drink and calm reach 0.6 and
   0.3 further down.
3. **The body root's pitch axis is local Y, not X.** Verified by rotating a posed
   rig and reading the head-to-tail angle back: local Y by −32° takes the body
   from 13.4° to 45.4° nose-up, while local X only yaws it. An earlier recipe
   rotated local X by 74° intending a forward flight line, and got a yaw.
4. **Equal signs bank; opposite signs move both wings together.** This entry
   used to state the exact opposite, and so did the recipe it described — see
   the bank section below for the probe that settled it. `wing_float_sides(a, a)`
   reaches 23.6° of left/right elevation bias at 0.12 rad; `(a, −a)` moves the
   bias by 0.11° across the whole usable range, which is nothing. The wing
   chains are mirrored, so the same local X points opposite ways in world space.
   Opposite signs are therefore the *common mode* — the only edit that can raise
   or lower a held wing symmetrically, which is what `held_wing_keys` uses. The
   `bank` mode contract asserts `wing_elev_bias.range ≥ 5` so a fourth attempt
   cannot ship silently.
5. **`PoseKey.body` freezes an asymmetry along with the flare it was added to
   remove.** Holding every non-wing bone at `Battle_Down02` f40 is what keeps the
   landing flare out of a cruise loop, but that frame is a landing: its
   `foot_drop` measures 4.263 on the left against 3.544 on the right. Nothing in
   any recipe authored that gap and every flight clip carried it — 0.63–1.05 of
   `foot_asymmetry`, on a symmetric cruise loop, which reads as a broken model
   rather than as a pose. `mirror_legs` applies the wings' own component-wise
   local mirror to `Bip002-{L,R}-Thigh/Calf/Foot` and takes the residual to
   0.04–0.06, an order below what the wings already accept.

   **The direction is a measurement, not a convention.** Both are equally good at
   symmetry — probed on the rig, R onto L lands 3.419/3.544 and L onto R lands
   4.263/4.383, each about 0.12 apart — so the choice was made on a different
   channel. `foot_drop` watches the *left* foot alone, and every mode's limb
   carriage band is derived from it. Mirroring L onto R therefore leaves cruise
   at 2.95, hover at 4.15 and dive at 2.20, moving only the foot that was
   drifting; R onto L would have shifted the whole family down 0.72 and put
   cruise, scout, glide and hover outside their own bands while buying no extra
   symmetry. The mirror is safe to apply after the tuck edits because
   `LIMB_FLEX_AXIS` is local Z on both sides, and a rotation about the reflection
   normal survives the reflection unchanged.

   It moves one foot 0.86 units fore/aft as well as 0.8 down, which is why it was
   deferred out of the carriage change and reviewed on its own. Nothing else
   moved with it: across all 78 clips the regenerated signatures differ only in
   `foot_drop_R`, `foot_asymmetry` and `skin_side_balance`, and the last of those
   moves *toward* zero on every clip. `ground_clearance` is unchanged, so no
   `yOffset` and no camera envelope followed.

A cruise beat is then one `flight_keys()` call: nine measured landmark frames of
`Battle_Down02`'s f40–f66 cycle, each keeping its own share of the beat, so the
artist's timing survives the retiming to whatever `beat_frames` the mode uses.
Nothing in the recipe decides which half of the stroke gets more time; the source
already did. The last key repeats the first key's source frame and edits exactly,
so the loop closes bit-for-bit. Both banks and the hover call the same function,
which is why their wingbeats agree.

**Sampling density is a quality channel, not an implementation detail.** The
first version of this recipe used four landmarks per beat. Four keys 12 frames
apart reconstruct the artist's own curves to a mean error of 5.6°; nine reach
1.0°, and between sparse keys Blender's AUTO_CLAMPED bezier fills the gap with a
smooth arc nobody authored. What that cost was not amplitude — elevation range
measured 84.6° against the source's own 81.4° — but the two channels nothing was
watching:

| channel | four landmarks | nine landmarks | vendor cycle |
|---|--:|--:|--:|
| stroke-plane azimuth range | 40.5° | 52.1° | 53.9° |
| wing extension range (the wrist fold) | 5.15 | 6.37 | 6.2 |
| reconstruction error vs the source | 5.6° | 1.0° | — |

`wing_azimuth_L.range` and `wing_extension_L.range` are now contract channels for
exactly this reason: a beat can hold full amplitude and still have lost the
figure-eight sweep and the fold that make it read as a wing rather than a hinge.

### Two things the source will not hand over

**The beat arrives welded to a landing flare.** `Battle_Down02` is a landing, and
across f40–f66 its pelvis pitches from −50.7° to −88.0° while the spine
counter-rotates to hold the head-to-tail line level. Sampling whole poses baked
that flare into a cruise loop, which then snapped back once per cycle — 11.4° of
`root_roll_delta_deg` range. So `PoseKey.body` takes every bone except the wing
chains from one steady frame, and only the wings cycle. It now measures 0.0.

Freezing only the flight root is not a cheaper version of this. Measured: it
leaves the spine's counter-rotation uncompensated and swings the body line from
2.2° to 39.6° over a single beat. The torso motion and its counter are one
authored gesture; take one without the other and it breaks.

The cost is that head, tail and legs stop moving, so `body_response` adds a
restrained neck-and-tail see-saw phased against the stroke, **lagged down the
body**: the chest takes the current landmark, the neck the one before it, the
tail the one before that. `docs/FLIGHT_ANIMATION_DEVELOPMENT.md` had asked
forward flight for "overlapping secondary motion (head lags behind the power
stroke phase by ~1 landmark)" from the start, and only the tail lagged — the
neck moved on the same frame as the wings, which reads as one rigid piece.

The lag is exact by construction rather than measured, because it is a table
lookup on `BEAT_LANDMARKS` rather than a time offset: key *i* carries landmark
*i*'s wing pose at destination fraction *i*, and landmark *i−1*'s neck value at
that same destination. Over the nine landmarks of `Battle_Down02` f40–f66 that
averages 5.33 destination frames of neck lag and 10.67 of tail lag on a 48-frame
beat — 0.11 and 0.22 of a cycle, 0.22 s and 0.44 s at 24 fps. The repeated first
key still closes every loop bit-for-bit, and `cycle`, `duration_s`, `pelvis` and
every limb channel measured unchanged.

What moved is the consequence: with the three no longer swinging in lockstep,
their contributions to the head-to-tail line partly cancel instead of adding, so
`body_axis_deg.range` fell from 8.63 to 7.87 on cruise, 8.54 to 7.60 on scout,
8.89 to 7.90 on speed and 8.16 to 7.21 on hover, and `tail_reach.vertical.range`
came down about 10% across the family. That is what the new `body_axis_deg.range`
ceiling guards. **It is a proxy, and the contracts say so:** a phase channel would
gate the lag directly and does not exist yet. Adding one — the shift maximising
correlation between `wing_elev_L` and each of `head_reach_vertical` and
`tail_reach_vertical`, normalised by `cycle.beat_frames` — is the obvious next
measurement. Its amplitudes come
from a probe, because the chains bend about their own local Z and answer very
differently: 0.30 rad moves the head 0.45 and the tail tip 1.46. It deliberately
does not reproduce the 1.75 of head travel the old loop measured — that number
was the flare, not a wingbeat, and matching it with the neck alone would take a
33° bend.

**`root_roll_delta_deg` is not roll.** Probed by rotating the flight root and
reading both channels back, its local Y moves `root_roll_deg` by exactly +0.2 rad
and `body_axis_deg` by −0.2, and the pelvis tracks it 1:1. The channel measures
torso pitch. The contract's ceiling is still the right ceiling — it is what
catches the flare — but it was guarding under a wrong name.

## Measured rig axes

Every number here came from posing the live rig and reading the channel back, and
every one of them contradicted a plausible guess that had already shipped. Probe
before trusting any of it again; the method is one MCP call, in
`[[blender-mcp-rig-probing]]` terms: pose a bone, read, restore.

| Chain | Axis | Effect per 0.30 rad | Used by |
|---|---|---|---|
| Neck (4 bones, weighted) | local **Z** | head 0.42–0.59 **down**, and back | `neck_bend(down=)`, `body_response` |
| Neck | local **Y** | head 0.12–0.72 **sideways** | `neck_bend(side=)`, `neck_bank` |
| Neck | local X | 0.05–0.10 sideways — inert | nothing |
| Tail (6 bones, weighted) | local **Z** | tail tip 1.46 **up** | `body_response` |
| Tail | local **Y** | tail tip 1.77 **lateral** | `tail_bend` |
| Spine1 | local **Z** | head 0.65 **up** and 1.72 back per 0.20 rad; pelvis and feet unchanged | `torso_recoil` |
| Hind thigh/calf/foot | local **Z**, **same sign both sides** | the sagittal flexion axis: thigh swings the foot 1.32 **forward and up**, calf 0.84 forward and **down**, ankle 0.43. Left and right take the *same* local sign | `hind_leg_tuck`, `hind_leg_pulse` |
| Hind thigh/calf/foot | local **X** | down-the-limb, so it twists: the calf's is **exactly 0.000** on the foot head. This is what `hind_leg_pulse` used to drive | nothing |
| Hind toes ×8 | local **Z** | the only useful toe axis. −0.50 rad **spreads** the fan (outer-toe span 1.54 → 1.73) and drops the tips 0.44; +0.50 rad **gathers** it (span → 1.15) and lifts them | `toe_curl` |
| Hind toes ×8 | local **X** | swings the whole fan together: ±40° of `toe_deg` for ≤0.09 of span change. Reads as inert in silhouette. This is what `toe_curl` used to drive, and what `toe_deg` still measures | nothing |
| Flight root `Bip002_06` | local **Y** | **1:1**: `root_roll_deg` +θ, `body_axis_deg` −θ. Positive is nose-**down** | `cruise_body_pose` |
| Flight root | local X / Z | ±0.5° — inert | nothing |
| Wing shoulder chain ×2 | `(a, a)` | 23.6° of left/right elevation **bias** at 0.12 rad — this is a bank | `bank_wings` |
| Wing shoulder chain ×2 | `(a, −a)` | bias unchanged (2.58 → 2.69 across the range); both wings move **together** | `held_wing_keys` |
| Neck, all four bones | local **Y**, 0.12 / 0.30 total | head 0.28 / 0.71 lateral — **and each wingtip 0.39 / 0.96, symmetry error +0.6 / +2.0** | nothing, now |
| `Neck2` + `Head` only | local **Y**, 0.30 / 0.60 total | head 0.29 / 0.57 lateral, wingtips **0.000**, symmetry error **0.000** | `neck_lean`, `NECK_YAW_WEIGHTS` |
| Spine ×4 (`torso_recoil`) at the **flight** base pose | local Z, ±0.30 | body axis ∓6.3°, head 2.4 up / 1.6 down — and `head_reach.horizontal` **falls** either way (−0.32 / −0.16) | `body_response` |
| Hind thigh/calf/foot, **mirrored** | reflect local basis `(w, −x, −y, z)` | copies one limb onto the other: residual `foot_asymmetry` 0.72 → ~0.12 at the base pose, 0.04–0.06 in the shipped clips. Also moves that foot 0.86 fore/aft. Preserves a local-Z tuck exactly, so it composes with `hind_leg_tuck` in either order | `mirror_hind_leg` |

Six consequences worth stating outright, because each one shipped wrong:

- **`root_roll_delta_deg` does not measure roll on this rig.** It measures the
  flight root's own pitch, negated, and the pelvis tracks it 1:1 (−50.7° to
  −88.0° across `Battle_Down02` f40–f66, against `root_roll`'s 140.8 → 179.6).
  Its contract ceiling is still the right ceiling — it is what catches the
  landing flare — but it was guarding under a wrong name for as long as it
  existed.
- **A neck argument named `down` drove the one axis that does nothing.** Four
  grounded recipes had their two neck layers swapped, with the active one inert,
  for as long as they had existed.
- **Three successive bank recipes drove the wing chains with the sign that has
  no effect**, so every shipped bank measured flat while the docs quoted numbers
  the `.blend` had never held.
- **`hind_leg_pulse` drove the limb's own long axis with mirrored signs**, which
  is the same defect as the banks one chain over: local X runs down the limb, so
  the calf edit moved the foot head by exactly 0.000 and the whole helper bought
  0.04 units of travel on a 44-unit creature. The flexion axis is local Z and it
  takes the *same* sign on both sides, not opposite ones.
- **`toe_curl` drove the axis that does not change the silhouette**, and
  `toe_deg` still measures that same axis — so the one channel nominally
  watching the claws was blind to spread and curl alike. Spread and curl are
  both local Z; `toe_curl_deg` measures it.
- **"The wing clavicles are children of the neck" is only true of the proximal
  neck.** The constraint lives on `Neck` and `Neck1`; below them a lateral lean
  costs exactly nothing, measured. For as long as that went unprobed, `neck_bank`
  spread its lean over all four bones and was therefore capped at 0.055 rad — 0.13
  units of head travel bought with 0.20 of symmetry error, the worse half of the
  trade — and the runtime handed the *full* yaw to all three neck bones every
  frame, which is the same trap rebuilt one layer up.
- **The bank's neck lean was on the wrong side.** `bank` is +1 for left and a
  positive `side` turns the head to the rig's right, so `neck_bank(bank * 0.055)`
  sent the head to the turn's *outside*, following the tail's counterbalance
  instead of opposing it. Shipped clips measured `head_reach.lateral` at −0.04 on
  the left bank and +0.22 on the right, against level flight's +0.09. The runtime
  carried the identical inversion in `turnLeadYaw`. Neither could be seen until
  the channel existed — which is the whole argument for adding one when a
  contract row has no rule.
- **`torso_recoil` is a pitch control at the flight pose, not an elongation
  one.** Its docstring's "+0.20 rad lifts the head 0.65 and draws it back 1.72"
  was measured at the *stand* pose. At `Sanct_Cruise` f0 the same edit arcs the
  head through ±6° of body axis and *shortens* `head_reach.horizontal` in both
  directions, because the head is already near its maximum forward reach there.
  There is no spine edit that lengthens the forward-flight silhouette; the only
  lever that does is `neck_bend(down=)` driven negative.
- **The wings were mirrored and the legs were not**, for as long as both existed.
  A `mirror` argument that reads as "make this key symmetric" only ever covered
  one chain, so eight flight clips shipped with a 0.63–1.05 left/right foot
  difference that no recipe authored and no rule could see until `foot_drop_R`
  existed. `mirror_legs` is stated per key for that reason: an implicit mirror is
  what hid this.

The pattern is the same each time: a sign or an axis was reasoned about instead
of measured, the result looked plausible in a render, and only a channel
measurement found it. Anything in this table is cheap to re-verify and expensive
to assume.

## The mode contracts

Each rule in `clip-contracts.json` carries a `because` naming the measurement it
came from. A threshold with no derivation is a number someone liked.

| Mode | Clips | The rule that defines the mode |
|---|---|---|
| `cruise` | `Sanct_Cruise` | ≥70° arc, ≥45° stroke-plane azimuth, ≥5.5 wing extension range, body axis within ±15°, symmetry ≤2.0, level wings, anchored pelvis, ≤2° torso pitch |
| `scout` | `Sanct_Scout` | cruise mechanics at ≤0.42 Hz cadence and ≥2 beats; it is a loitering mode, not a new attitude |
| `bank` | `Sanct_BankL/R` | cruise posture, plus ≥5° of left/right elevation difference, each wing on its own side |
| `bank_left` | `Sanct_BankL` | bias ≤ −8° (left wing low), tail lateral ≤ −0.4 (tail to the right), stroke asymmetry ≤ −20° (inside wing sweeps less) |
| `bank_right` | `Sanct_BankR` | the exact mirror |

### Limb and neck carriage, per mode

Wings are not the only thing a flight mode is made of, and for a long time they
were the only thing measured. Every forward-flight clip held `foot_drop` inside
0.06 units and `toe_deg` at exactly 0.00 across its whole loop, and no rule in
any mode noticed, because no mode had a rule on a limb. The prose contract in
`docs/FLIGHT_ANIMATION_DEVELOPMENT.md` had described all of this from the start.

As measured after the carriage was authored:

| Mode | `foot_drop.mean` | `foot_drop_R.mean` | `toe_curl_deg.mean` | `head_reach.h` | `head_reach.v` |
|---|--:|--:|--:|--:|--:|
| `dive` | 2.20 | 2.16 | +19.52 | 11.08 | −3.89 |
| `speed` | 2.33 | 2.27 | +19.52 | 11.79 | 0.06 |
| `cruise` / `bank` | 2.95 | 2.89 | +9.79 | 11.45 | 2.13 |
| `scout` | 3.06 | 2.99 | +7.49 | 10.99 | 3.00 |
| `glide` | 3.09 | 3.03 | +9.79 | 11.57 | 1.24 |
| `hover` | **4.15** | **4.10** | **−17.99** | **8.72** | **6.76** |
| `hunt_carry` | 4.25 | 3.53 | +16.66 | 11.10 | 1.59 |

The two foot columns agree to 0.06 on every mirrored clip, and `hunt_carry` is
the one flight loop that does not mirror: its legs are gripping a carcass
between them, which is a contact pose like the grounded clips, so its 0.72 gap
is the base pose's and is meant to stay.

Three separations do the work, and each is what the contracts gate:

- **Tucked against hanging.** The aerodynamic family sits at 2.20–3.09 and the
  hanging family at 4.15–4.25. The gap, not the absolute value, is the mode.
  Hover has to be authored *against its own −30° root pitch*, which swings the
  feet up toward the pelvis on its own: a token −0.15 tuck measured 3.54, barely
  half a unit clear of cruise, and it took −0.7 to reach a real hang.
- **Claws gathered against open.** Every aerodynamic mode is positive, hover is
  negative. The sign is the rule; the magnitudes either side of it are free.
- **Neck reach.** Hover's 8.72 against 10.99–11.79 everywhere else is the neck
  drawn back over an upright torso rather than reaching down the flight path,
  and `head_reach.vertical` orders the whole family from dive's −3.89 to hover's
  +6.76.

Cruise and both banks measure *identically* on all four channels. That is
required, not incidental: they share `phaseGroup: "flight"`, so a leg carriage
that drifted apart between them would pop across the crossfade.

**A bank has two layers, and it needs both.** *Attitude* is the constant roll —
one wing low for the whole loop, measured as `wing_elev_bias`. *Mechanics* is the
differential: the inside wing does less work and travels less far, measured as
`wing_stroke_asymmetry`.

**Every bank recipe until now produced neither, and the reason was a sign.**
`bank_wings` drove the two wing chains with opposite signs, on the stated rule
"opposite signs bank; equal signs flap". Probed on the rig with the mirror
applied — the state the recipe actually runs in — that is backwards:

| recipe | `wing_elev_bias` | `wing_stroke_asymmetry` |
|---|--:|--:|
| unbanked baseline | 2.67 | −1.1 |
| `(a, −a)` at a = 0.12 | 2.58 | 0.0 |
| `(a, −a)` at a = 0.25 | 2.69 | 1.4 |
| **`(a, a)` at a = 0.12** | **23.63** | **15.7** |
| **`(a, a)` at a = 0.25** | **42.23** | **34.1** |

Opposite signs move the bias by nothing at all across the whole usable range.
The chains are mirrored, so the same local X points opposite ways in world
space: equal signs separate the tips, opposite signs move them together and
merely modulate the flap. The shipped banks measured `wing_elev_bias.mean` +3.24
against a contract demanding −8 or lower, and +0.68 asymmetry against −20 — that
is, `pnpm test` was failing on four bank rules, and the numbers this document
previously quoted (−11.1 and −32.1) were never in the `.blend`.

One constant now supplies both layers, because the geometry couples them:
holding the inside wing low also shortens its stroke. At 0.18 rad the banks
measure ∓24.3/+29.8 of attitude and ∓29.1/+27.4 of mechanics, against the 52.8
the artist's own banking turn `Battle_SkyMoveL` reaches.

The lesson is the one this whole system exists for, applied to itself: a
threshold with a derivation can still be guarding a channel that no longer
measures what its `because` says, and a document can quote a number the asset
never had. Only a measurement of the shipped file closes that gap.

The remaining modes, continuing the table above:

| Mode | Clips | The rule that defines the mode |
|---|---|---|
| `hover` | `Sanct_Hover` | body axis ≥25° nose-up, ≥4 beats, ≥70° arc, level wings |
| `speed` | `Sanct_Speed` | cruise's rules plus ≥0.75 Hz cadence, ≥4 beats, and a body axis nose-down on every frame |
| `glide` | `Sanct_Soar` | wing elevation range 3–14° (so `cycle` is null), ≥15.5 held extension, ≤2 extension travel, flattest body line |
| `dive` | `Sanct_Dive` | the same no-propulsion rules, plus body axis ≤−25° mean and ≤−20° on every frame, and ≤12.5 held extension |
| `grounded_loop` | six ambient loops | exact loop, clearance ≥ −2.5, restrained pelvis travel |
| `grounded_gesture` | four one-shots | planted clearance |
| `vendor_cruise_source` | `Battle_Down02`, `Battle_Up` | a guard on the bar itself, so rebuilding the vendor GLB cannot silently rebase every threshold under it |

Two structural rules live in the test rather than the data, because they are
about the manifest, not about one clip:

- **Every clip the manifest can play must have been measured.** A clip name
  present in neither GLB binds no tracks; three.js does not throw, so the failure
  is a wyvern frozen in its rest pose in exactly one state.
- **Clips sharing a `phaseGroup` must share duration and beat count.**
  `GameModel` preserves *normalized* playback time across a crossfade, which only
  keeps two loops in step when a normalized phase means the same thing in both.
  This is why hover is not in the `flight` group: it is 4 beats to cruise's 3 in
  the same 6.00 s, and cadence is precisely what makes it a different mode.

## Reading a trace

`pnpm assets:analyze-clips --trace Sanct_Cruise` prints every frame:

```text
trace Sanct_Cruise
  frames 0..144 @ 24fps = 6.0s  ·  3 beats, 0.5Hz
  frame   elevL   elevR   azimL    extL    body    roll  footDr   headH   tailH   symEr
      0   -25.3   -27.4    53.7    16.2     3.2   140.8     4.3    11.5    17.1     0.8  ·················#
     12   -53.5   -56.8    18.5    15.2     4.7   140.8     4.3    11.7    17.3     1.1  ·········#
     24    -0.5    -4.0    11.9    15.9     1.1   140.8     4.3    11.2    16.9     1.2  ·······················#
     36    40.4    38.6    60.5    12.6    -0.4   140.8     4.3    10.9    16.7     0.9  ··································#
     48   -25.3   -27.4    53.7    16.2     3.2   140.8     4.3    11.5    17.1     0.8  ·················#
```

The bar tracks wing elevation across −90…+90. Three rises and falls is a
three-beat loop; a flat bar is a clip with no wingbeat in it — which is exactly
what `Sanct_Soar` and `Sanct_Dive` are, and why both report `cycle: null`. `elevL` and `elevR`
tracking each other within a degree is a symmetric beat. Frame 48 returning
exactly to frame 0's values is the cycle closing.

Run it on the vendor source to see the same mechanics in the artist's hand:
`--trace Battle_Down02` reproduces the landmarks the cruise recipe is built from
— f40 −26.0°, f45 −51.6°, f52 −2.4°, f61 +28.7°, f63 +16.5° — and the two
channels the loop is held to alongside them, azimuth sweeping 11.2°…62.5° and
extension folding 11.4…17.0 across the same window.

## Validation

The analyzer measures both the vendor file and the authored sidecar on **one
rig**: the decompressed vendor GLB supplies the skinned armature and its 52
actions, and the `Sanct_*` actions are appended from the tracked `.blend` with
`bpy.data.libraries.load`. That is what makes vendor and authored numbers
comparable, and it is the only configuration in which `ground_clearance` is
measurable for an authored clip — the tracked `.blend` is armature-only and the
shipped sidecar's joints import as Empties, so neither can be posed against a
skin.

It was validated by reproducing three tables built independently of it:

| Source | Rows | Result |
|---|--:|---|
| `docs/WYVERN_ANIMATIONS.md` catalogue — frames, duration, ground-Y min…max, loop error | 52 | reproduces; 4 rows differ by 0.02–0.06 rounding |
| `BUILD_NOTES.md` — authored actions' measured ground Z | 13 | reproduces except `Sanct_Nuzzle` and `Sanct_Calm`, whose `.blend` bake predated the recipe |
| `vendor-flight-survey.json` *(retired)* — arc, tip path, symmetry, body axis, semi-span | 10 | reproduced exactly on every column at the time of validation (see the note below on `symmetry_error`); source file since removed |

Run it at `--clearance-samples 13` to repeat that comparison; the shipped
signatures use 48. One column has since moved on purpose: `symmetry_error` was
corrected from a magnitude comparison to a reflection, which changes 22 of the 78
clips — all of them poses that swing a wing across the midline. The three numbers
the contracts are built on (`Battle_Up` 1.25, `Battle_Down02` 1.49,
`Battle_Stand` 0.28) are unchanged, because none of those poses crosses a wing.

**Why 48 and not 13.** The minimum of a sparse sample over-estimates clearance,
and clearance sets `yOffset`. 56 of the 78 clips measured at the time moved between the two densities
and some move a lot — `Battle_Attack02` from −4.14 to −7.74, `Battle_Skill01`
from −3.95 to −8.89. Two shipped offsets were wrong because of it:
`Sanct_Nuzzle` was wired at −1.73 against a true low point of +1.19, and
`Sanct_Calm` at −0.95 against +0.58. The catalogue in `WYVERN_ANIMATIONS.md`
still carries its original 13-sample column; `clip-signatures.json` is
authoritative.

## Regenerating

```bash
pnpm assets:analyze-clips
```

Stages a decompressed vendor copy, measures, writes the signature file, prints
the 78-clip summary. Add `--trace <clip>` for per-frame output. The vendor GLB
is never re-exported and the tracked `.blend` is never saved.

After any authoring change the order is: regenerate the `.blend`, rebuild the
sidecar, re-measure, and let `pnpm test` judge it.

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  assets/blender/drogon-sanctuary.blend \
  --python scripts/build-sidecar.py -- --source-glb /tmp/drogon-source.glb
pnpm assets:drogon-sidecar && pnpm assets:validate-sidecar
pnpm assets:analyze-clips
pnpm test
```

The signature file is committed on purpose. A regenerated measurement lands as a
per-channel diff, so a change to one clip's wingbeat is visible as the numbers
that moved — which is the review artifact a contact sheet was never able to be.

## Historical traps and root-cause analysis

For future agents and contributors, this section catalogs the 10 major technical traps discovered during the V1 model probe and why visual-only reviews missed them:

1. **Wing Bone Assumption**: Assuming bones named `wing_*` existed. The rig actually uses front arm/hand chains (`Bip002-{L,R}-Clavicle → UpperArm → Forearm → Hand → Finger0..5`).
2. **Membrane Tearing**: Mirroring finger bones without mirroring the sibling `Bone040_056`..`Bone069_0119` membrane helper chains, stretching 278 triangles past 5× their length.
3. **Jaw Bone Identity**: Mapping jaw motion to `B_Face_Jaw` (which belongs to the human rider `Bip001`) instead of **`Bip002-Ponytail1_016`** (which controls 4,220 vertices on Drogon's lower muzzle).
4. **Reversed Neck Axes**: `down` driving local X (an inert axis) while `side` drove local Z (head down/up). Every preen, groom, and drink pose had its neck layers swapped with one axis completely dead.
5. **Body Pitch Axis**: Assuming local X pitched the body when local X actually yawed it; local Y is the real pitch axis.
6. **Banking Sign Rules**: Assuming opposite signs banked the wings. Because the rig is mirrored across X, **equal signs bank** (`wing_elev_bias`), while opposite signs raise/lower both wings together.
7. **Frozen Cruise Flap Defect**: The shipped cruise loop had **0 detectable wingbeats**, a 27.3° stroke arc, and a 37.7 symmetry error because the `.blend` predated the recipe rewrite.
8. **Baking Landing Flare into Cruise**: Sampling full body poses from `Battle_Down02` (a landing clip) baked a -50° to -88° pelvis pitch flare into forward flight, snapping the body line every loop.
9. **Asymmetric Hind-Limb Carriage**: Every flight clip inherited a 0.63–1.05 unit foot asymmetry (`foot_drop` left vs right) from the vendor base pose.
10. **Sparse Keyframe Re-bezierization**: Sampling 4 landmarks per beat caused Blender's `AUTO_CLAMPED` Bezier solver to invent smooth arcs that flattened stroke azimuth (from 53.9° to 40.5°) and erased the wrist fold.

### Why They Were Missed
- **Visual & Prose Review**: Prose ("*cruise keeps a horizontal body line*") cannot fail a CI build, and contact sheets of near-black dragons hide pose errors and pitch offsets.
- **Unprobed Rig Geometry**: Intuitions about rotation signs and bone names contradicted actual rig transforms until numerically measured via `pnpm assets:analyze-clips`.

