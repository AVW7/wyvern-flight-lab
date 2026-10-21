# Wyvern v1 → repaired-rig re-authoring source of truth

**Status:** active reference and execution contract.  This document defines how
the complete v1 animation library is captured and rebuilt on the repaired v2
rig.  It is a specification and a backlog; it does not authorize a bulk
retarget or a broad runtime remap by itself.

## The authority chain

Do not choose a reference clip from memory, a render, or a similarly named file.
The authority order is:

1. [`WYVERN_V1_ANIMATION_SOURCES.json`](WYVERN_V1_ANIMATION_SOURCES.json) pins
   the exact source assets and their SHA-256 identities.
2. `public/models/drogon.glb` is the 52-clip vendor base. Its action names use
   `SKM_DaenerysDragon|DaenerysDragon_`, except the explicit stand action.
3. `public/models/drogon-sanctuary.glb` is the 26-clip Sanctuary extension.
4. `validation/wyvern-animations/clip-signatures.json` is the machine-readable
   measurement record for the combined 78 clips at 24 fps.
5. This document supplies the semantic brief, target action name, phase recipe,
   and rebuild order for every clip.

If a prose description conflicts with the pinned asset or signature, the asset
and signature win. Update this document only after re-measuring the source.

The two dragon files in `/Users/ajadvanwyk/Desktop/3d models animals/` are
recorded as **noncanonical candidates**. They have different hashes from the
project source and from each other. They must not be mixed into a rebuild until
explicitly promoted, fingerprinted, and measured as a new reference set.

## Scope and naming

There are **78 source actions**: 52 vendor clips and 26 Sanctuary clips. V2
will retain a concise gameplay-facing action map, but the repaired rig must be
able to reproduce all 78 source performances as distinct authored actions.

`source suffix` below means prepend
`SKM_DaenerysDragon|DaenerysDragon_`. The one exception is `Battle_Stand`, whose
full source name is `SKM_DaenerysDragon|AA_DaenerysDragon_Battle_Stand`.

`target action` is the stable repaired-rig name. A target listed as `planned`
does not exist in v2 yet; it reserves the name and prevents two different v1
performances from being collapsed into one generic clip.

## What “recreate” means

This is **not** a direct skeleton retarget. The rigs are different, and a
channel-for-channel transfer would reproduce neither contacts nor silhouette.
Each rebuilt clip needs:

1. A source identity, duration, loop/one-shot decision, and seven-or-fewer
   named landmarks from the v1 clip.
2. A pose brief for torso, neck/head, tail, legs/toes, arm chain, wing spars,
   and membrane. “Wings move” is not sufficient.
3. A new-rig axis probe before selecting any rotation sign.
4. A fully authored repaired-rig action, with frame 0 at time 0 and the correct
   terminal pose for a one-shot or exact closure for a loop.
5. Numeric verification of ground clearance, left/right intent, body pose,
   wings, local membrane response, and runtime playback.

World-space distances from v1 are evidence, not copied values: use normalized
body/wing proportions when transferring an envelope between rigs. Contact order,
phase relationship, and pose intent are the invariants.

## Required capture record

Before a source action may enter implementation, add a per-action entry to its
authoring work order with these fields:

| Field | Requirement |
|---|---|
| Source | Full v1 action name and pinned source hash |
| Target | Exact repaired-rig action name from this document |
| Playback | Frame range, duration, loop/one-shot, and successor if one-shot |
| Landmarks | Frame 0, anticipation, maximum compression, maximum extension, contact/impact, recovery, final pose as applicable |
| Contacts | Foot/wing-knuckle/toe contacts or an explicit airborne declaration |
| Pose brief | Torso, head/neck, tail, legs, primary wing chain, fingers, membranes |
| Events | Damage window, bite, breath, pickup/drop, flap, landing, or other gameplay marker |
| Measurements | The v1 signature fields used as the target envelope and the repaired-rig acceptance limits |
| Review | Exact commands and resulting measurements; no screenshot-only approval |

For a first capture, sample source frames at normalized times 0%, 12.5%, 25%,
50%, 75%, 87.5%, and 100%, then replace generic samples with the true landmarks.
The source signature gives the frame range; Blender evaluation establishes the
actual pose/event frame. This turns an artist-readable phase sheet into evidence
that can be rebuilt after personnel or tool changes.

Batch A's records live in
[`WYVERN_V1_CORE_CAPTURE_RECORDS.md`](WYVERN_V1_CORE_CAPTURE_RECORDS.md). The
first captured action is `Sanct_Rest` → `rest`; add each subsequent core action
there before changing its repaired-rig curves.

## Rebuild cards

The `card` column in the catalogue selects one of these non-negotiable briefs.

| Card | Rebuild brief |
|---|---|
| `G1` — idle/display | Weight stays over planted feet; small independent breath, head attention, tail drift, folded wing settle, and membrane relaxation. Roar/back-kick are one-shots with a recovery pose, not looping idle variants. |
| `G2` — ground locomotion | Preserve foot and wing-knuckle contact order; body weight transfers before the planted limb leaves. Walk/strafe loops close exactly. The membrane stays slack/supportive, never reads as a flight flap. |
| `G3` — ground turn | Keep at least one support path through the turn; rotate torso/head into direction before the pelvis follows. Left/right pairs must be geometric mirrors unless a source measurement says otherwise. |
| `F1` — takeoff/landing | One-shot: crouch or braking anticipation, peak wing loading, leg push/absorption, then a terminal pose that chains without a pop. Use the current repaired-rig ground-clearance measurement, not v1 `yOffset`. |
| `F2` — powered forward flight | Long body line, legs tucked, neck and tail lag the stroke, fingers/membranes trail wrist and elbow. Wing surface timing must be independent of the shoulder carrier. |
| `F3` — bank/turn flight | Start from `F2`; the inside/outside strokes differ, tail counterbalances, and head looks into the turn. Mirror pairs are authored from one measured side then numerically checked. |
| `F4` — held-wing flight | Glide/soar/dive have a held aerodynamic shape, not a low-amplitude flap. Add only state-appropriate wind-load ripple and membrane tension. |
| `C1` — ground combat | Anticipation → committed strike → recoil/recovery. Feet or wing knuckles remain credible supports except where the source leaves the ground. The strike event gets an explicit frame range. |
| `C2` — airborne combat/skill | Declare the airborne phase and flight-path posture; separate power strokes, attack reach, and recovery. Do not fake a jump by translating the root without contacts or an airborne plan. |
| `D1` — damage/recovery | Directional stagger or additive hit layer. Preserve which side yields, contact stability, groggy entry/loop/exit chaining, and all additive semantics. |
| `D2` — spawn/death/cinematic | One-shot terminal acting. The end pose is intentional and held; death membrane and tail settle are not loop closures. |
| `S1` — sanctuary life | Behavioural loop or transition with readable intent: breathing, sleeping, sitting, eating, drinking, grooming, nuzzling, or calming. Fine head/jaw/toe/membrane timing matters more than large body travel. |
| `S2` — hunt/payload | Clear prey acquisition/release phase, braced jaw/neck, and an explicit payload posture. Carry flight extends the legs only when the source does. |

## Catalogue — vendor base (52)

| Source suffix | Source role and evidence | Target action | Card |
|---|---|---|---|
| `Battle_Stand` | 5.04 s planted stand; canonical wakeful idle | `idle` | G1 |
| `Neutural_Watch` | 15.29 s planted long attention idle | `idleWatch` planned | G1 |
| `Neutural_Roar` | 11.25 s planted display/roar | `roar` planned | G1 |
| `Neutural_BackKick` | 9.38 s planted rear-kick gesture | `backKick` planned | G1 |
| `Battle_Walk` | 2.46 s planted quadrupedal walk; wing knuckles participate | `walk` | G2 |
| `Battle_WalkL` | 2.50 s planted left strafe | `walkLeft` planned | G2 |
| `Battle_WalkR` | 2.50 s planted right strafe | `walkRight` planned | G2 |
| `Battle_TurnL20` | 4.08 s planted shallow left turn | `turnLeft20` planned | G3 |
| `Battle_TurnR20` | 4.08 s planted shallow right turn | `turnRight20` planned | G3 |
| `Battle_TurnL90` | 4.08 s planted quarter left turn | `turnLeft90` planned | G3 |
| `Battle_TurnR90` | 4.08 s planted quarter right turn | `turnRight90` planned | G3 |
| `Battle_TurnL180` | 4.12 s planted half left turn | `turnLeft180` planned | G3 |
| `Battle_TurnR180` | 4.12 s planted half right turn | `turnRight180` planned | G3 |
| `Battle_Up` | 8.12 s takeoff; folded crouch → unfurl → downstroke | `takeoff` | F1 |
| `Battle_Down` | 5.29 s airborne landing variant | `landHeavy` planned | F1 |
| `Battle_Down02` | 4.67 s airborne landing; terminal pose pairs with `Battle_Up` opening pose | `land` | F1 |
| `Battle_SkyMoveL` | 8.33 s airborne left bank; widest measured wing arc in v1 | `airBankLeftVendor` planned | F3 |
| `Battle_SkyMoveR` | 8.33 s airborne right bank | `airBankRightVendor` planned | F3 |
| `Battle_SkyMoveR01` | 8.33 s alternate right airborne bank | `airBankRight01` planned | F3 |
| `Battle_Attack01` | 8.08 s rearing attack | `attack01` planned | C1 |
| `Battle_Attack02` | 8.08 s rearing attack with deeper ground reach | `attack02` planned | C1 |
| `Battle_Attack03` | 6.25 s rearing attack | `attack03` planned | C1 |
| `Battle_Attack04` | 3.33 s airborne attack | `attackAir` planned | C2 |
| `Battle_Attack06` | 3.33 s planted snap-bite: rear → head thrust → recovery | `attack` | C1 |
| `Battle_Skill01` | 7.58 s rearing skill performance | `skill01` planned | C1 |
| `Battle_Skill02` | 7.50 s rearing skill performance | `skill02` planned | C1 |
| `Battle_Skill02_01` | 7.50 s rearing skill variant | `skill02Variant` planned | C1 |
| `Battle_Skill03` | 9.25 s planted breath-shaped action: wind-up → rear → held forward thrust | `breath` | C1 |
| `Battle_Skill03_01` | 9.25 s planted breath-shaped variant | `breathVariant` planned | C1 |
| `Battle_Skill05` | 9.96 s airborne skill | `skillAir05` planned | C2 |
| `Battle_Skill06` | 8.62 s airborne skill | `skillAir06` planned | C2 |
| `Battle_Skill07` | 4.96 s self-contained leap: takeoff → brief air → land → rest | `hop` planned | C2 |
| `Battle_Skill08` | 3.21 s steep airborne skill / nose-up extreme | `skillAir08` planned | C2 |
| `Battle_Skill10_L` | 6.62 s left airborne skill | `skillAir10Left` planned | C2 |
| `Battle_Skill10_R` | 6.62 s right airborne skill | `skillAir10Right` planned | C2 |
| `Battle_Skill11_L` | 6.62 s left airborne skill; high wing elevation range | `skillAir11Left` planned | C2 |
| `Battle_Skill11_R` | 6.62 s right airborne skill; high wing elevation range | `skillAir11Right` planned | C2 |
| `Damage_Staggering_Front_Body` | 3.88 s planted forward stagger | `staggerFront` planned | D1 |
| `Damage_Staggering_Left_Body` | 3.46 s planted left-body stagger | `staggerLeft` planned | D1 |
| `Damage_Staggering_Right_Body` | 3.46 s planted right-body stagger | `staggerRight` planned | D1 |
| `Damage_GroggyStart` | 2.29 s groggy entry | `groggyStart` planned | D1 |
| `Damage_GroggyLoop` | 2.50 s groggy held loop | `groggyLoop` planned | D1 |
| `Damage_GroggyEnd` | 2.83 s groggy recovery | `groggyEnd` planned | D1 |
| `Damage_GroggyAttack` | 9.54 s airborne groggy attack | `groggyAttack` planned | D1 |
| `Damage_Add_BattleStand_Chest` | 1.08 s additive chest-hit layer | `hitChestAdd` planned | D1 |
| `Damage_Add_BattleStand_LeftFoot` | 0.46 s additive left-foot hit layer | `hitLeftFootAdd` planned | D1 |
| `Damage_Add_BattleStand_RightFoot` | 0.46 s additive right-foot hit layer | `hitRightFootAdd` planned | D1 |
| `Damage_Add_Groggy` | 0.79 s additive groggy hit layer | `hitGroggyAdd` planned | D1 |
| `Death` | 14.92 s rearing death | `death` | D2 |
| `Death01` | 12.88 s cinematic death | `deathCinematic` planned | D2 |
| `Spawn` | 6.33 s rearing spawn | `spawn` planned | D2 |
| `Spawn01` | 14.88 s cinematic spawn | `spawnCinematic` planned | D2 |

## Catalogue — Sanctuary extension (26)

| Source action | Source role and evidence | Target action | Card |
|---|---|---|---|
| `Sanct_Sleep` | curled closed-jaw sleep; slow 0.30-unit breath | `sleep` planned | S1 |
| `Sanct_Rest` | wakeful injured low rest; panting jaw | `rest` | S1 |
| `Sanct_Sit` | rest → upright seated transition | `sit` planned | S1 |
| `Sanct_SitLoop` | seated breathing loop | `sitLoop` planned | S1 |
| `Sanct_Rise` | seated → rest transition | `rise` planned | S1 |
| `Sanct_Eat` | planted bite, tear, chew, swallow loop | `eat` planned | S1 |
| `Sanct_Breathe` | ground breath performance | `breatheGround` planned | S1 |
| `Sanct_BreatheAir` | airborne breath performance | `breatheAir` planned | C2 |
| `Sanct_HuntGrip` | reach, bite, and secure prey | `huntGrip` planned | S2 |
| `Sanct_HuntCarry` | powered prey-carry flight; braced neck and jaw | `huntCarry` planned | S2 |
| `Sanct_HuntFinish` | final chew, swallow, scan, idle recovery | `huntFinish` planned | S2 |
| `Sanct_PickUp` | prey/object pickup transition | `pickUp` planned | S2 |
| `Sanct_Drop` | prey/object drop transition | `drop` planned | S2 |
| `Sanct_Drink` | muzzle dip and lap | `drink` planned | S1 |
| `Sanct_Groom` | turn back and preen | `groom` planned | S1 |
| `Sanct_PerchGrip` | subtle talon grip loop | `perchGrip` planned | S1 |
| `Sanct_Cruise` | level cruise; three symmetric wingbeats | `cruise` | F2 |
| `Sanct_Scout` | low-cadence loiter/search; two symmetric wingbeats | `scout` | F2 |
| `Sanct_BankL` | left bank; left wing low, asymmetric inside/outside stroke | `bankLeft` | F3 |
| `Sanct_BankR` | exact mirror of `Sanct_BankL` | `bankRight` | F3 |
| `Sanct_Hover` | nose-up hover; four fast wingbeats | `hover` | F2 |
| `Sanct_Speed` | fast nose-down cruise | `speed` | F2 |
| `Sanct_Soar` | unpowered held-wing glide; no wingbeat cycle | `glide` | F4 |
| `Sanct_Dive` | nose-down stoop; held folded wings; no wingbeat cycle | `dive` | F4 |
| `Sanct_Nuzzle` | lowered-head nuzzle and return | `nuzzle` planned | S1 |
| `Sanct_Calm` | folded-wing settle and slow exhale | `calm` planned | S1 |

## Execution order

Work in batches. A batch is complete only when every action in it has its capture
record, repaired-rig action, and numeric review. Do not bulk-generate the next
batch merely because names are reserved.

1. **A — Core state parity:** `idle`, `walk`, `rest`, `takeoff`, `land`,
   `cruise`, `scout`, `bankLeft`, `bankRight`, `hover`, `glide`, `dive`,
   `speed`, `attack`, `breath`, `death`.
2. **B — Ground mobility and attention:** watch, roar, back-kick, strafes, and
   the six ground turns.
3. **C — Combat vocabulary:** attacks 01–04, skills 01–11 variants, hop, and
   airborne combat.
4. **D — Resilience and lifecycle:** all stagger/groggy/additive layers, death
   variants, and spawn variants.
5. **E — Sanctuary life and prey interaction:** sleep/sit/eat/drink/groom,
   nuzzle/calm/perch grip, and pickup/hunt/carry/drop.

   **Batch E is an authoring job, not a capture job — tested, 2026-08-15.** The
   obvious shortcut is to run the `Sanct_*` actions through the same
   pair-by-rest-position retarget that produced the `v1_*` captures. It does not
   work: those captures render as a torn mesh (`v1_stand` f60 — torso inverted,
   hind legs past the skull, membrane in shards), and their bounding boxes are
   tallest along Y where a standing dragon is tallest along Z. Only the *wing
   chain* of a v1 capture transfers, because the grafted wing bones were built
   from v1's own head/tail/roll and align to under 10 degrees while the original
   v2 bones sit ~90 degrees off theirs. Every Batch E action is a body
   performance — jaw, neck, torso, legs — so the part that transfers is the part
   they do not need. Author them with generator recipes against the v1 measured
   envelopes in `clip-signatures.json`, the way `idle`, `rest` and `walk` were
   built. Two further notes for whoever starts: `drogon-sanctuary.glb` imports
   into Blender as **298 empties, not an armature** (it is meshless and carries
   no skin), so its actions drive object transforms and cannot be read through
   `pose.bones[…]` without a name-mapped bridge; and fixing the full-body
   transfer first would unblock Batches B, C and D as well, which is the larger
   prize if anyone wants to spend the time there instead.

## Verification and promotion

For every rebuilt action:

1. Verify the new rig's axes with a disposable Blender probe; never copy an
   Euler sign from v1.
2. Compare normalized v1 landmarks and the target's measured signature. Review
   contacts, phase relationships, body line, wing arc/extension, and local
   membrane response numerically.
3. Export a disposable GLB first. Run `pnpm assets:validate-wyvern`, then
   `pnpm typecheck`, `pnpm lint`, and `pnpm test`. If a project gate is absent or
   currently broken, record that exact fact with the action rather than silently
   skipping it.
4. Test the final game state: loop selection, one-shot chaining, crossfade,
   ground clearance/manifest offset, and gameplay events.
5. Update the action's capture record, the target signature/contract, this
   catalogue's status, and the runtime map in one reviewable change.

## Change control

Changing a source hash, source action name, target action name, or semantic card
requires: an updated source JSON manifest, regenerated measurements, a note
explaining why the prior evidence was replaced, and review of every dependent
action. The source library is reference data, not a pool of interchangeable
animation files.
