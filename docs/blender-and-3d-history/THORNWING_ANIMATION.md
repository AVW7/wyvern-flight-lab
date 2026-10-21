# Thornwing animation pipeline

Thornwing is a separately rigged, playable Tier 2 wyvern derived from the Model
Library's Forest Wyvern Display. It is not a replacement for that display asset
or for the shared `wyvern.glb` used by the other species. This document records
the reproducible asset boundary, runtime compatibility contract, seven-action
vertical slice, and the checks required before changing it.

## Source, output, and provenance

The authoritative input is the committed, optimized static model:

```text
public/models/library/forest-wyvern-display.glb
```

Its embedded import metadata identifies the original file as
`Meshy_AI_Forest_Wyvern_0808182041_texture.glb`. The committed input contains
one optimized mesh and no skin or animation; it was reduced from the
1,013,087-triangle source by `scripts/import-meshy-library-assets.mjs` with an
approximately 38,400-triangle target. Blender evaluates the committed derivative
at 35,947 triangles, which the generated signature and validator preserve. The
Thornwing build reads this committed GLB directly, so the external high-density
Meshy file is not required to reproduce the playable asset.

The pipeline writes a separate derivative:

```text
public/models/thornwing.glb
```

It never overwrites or re-exports the Forest Wyvern Display. There is no tracked
`.blend`: `scripts/build-thornwing.py` drives Blender headlessly, and
`scripts/build-thornwing-blender.py` performs the re-pose, rigging, weighting,
animation, and GLB export. The original UVs and materials are retained, and the
pipeline keeps the optimized web mesh rather than pulling geometry from the
million-triangle source.

The source filename and embedded Meshy metadata establish provenance, not a
licence grant. Before distributing the game or this derivative outside the
repository, verify the originating Meshy account/asset's current commercial and
redistribution rights and record any required attribution in the project's
credits. Do not infer permission from the fact that the optimized GLB is
committed.

## Compatible custom rig

Thornwing has a purpose-built six-limbed rig. It shares the runtime names that
sanctuary gaze, spine, tail, leg, and action code resolves through
`src/render/rigBones.ts`, while adding a distinct front-leg chain on each side.
Chains are ordered root to tip:

| Purpose | Authored bones |
|---|---|
| Root and torso | `Root`, `RootMotion`, `Body`, `Spine1` -> `Spine2` -> `Spine3` |
| Neck and face | `Neck1` -> `Neck2` -> `Head`; `Jaw` |
| Tail | `Tail1` -> `Tail2` -> ... -> `Tail10` |
| Left wing spar | `L_WingShoulder` -> `L_WingElbow` -> `L_WingWrist`; sibling `L_WingFinger1`, `L_WingFinger2`, and `L_WingFinger3` branches under the wrist, with their matching end bones |
| Right wing spar | Mirrored `R_Wing*` names and sibling finger branches |
| Hind legs | `L_Thigh` -> `L_Calf` -> `L_Foot`, mirrored as `R_*` |
| Front legs | `L_FrontLegRoot` -> `L_FrontUpper` -> `L_FrontLower` -> `L_FrontFoot`, mirrored as `R_*` |

Compatibility is by these authored names and chain roles, not by sharing the
old Drogon skeleton or bind matrices. The optimized source mesh remains the
authoritative input. The build skins a copy, evaluates a symmetric neutral
pose, bakes those evaluated coordinates into the derivative mesh, and applies
the same pose as its new rest matrices. This visibly re-poses only Thornwing;
the display GLB, UVs, and material remain untouched. Skin weights must be
finite, normalized, and limited to four bone influences per vertex.

The authoring coordinate convention is creature-forward **-Y**, up **+Z**, and
creature-left **+X** in the Blender scene. Pose keys convert XYZ Euler deltas to
quaternions in each bone's local frame before export:

| Motion | Thornwing local axis convention |
|---|---|
| Body, spine, neck, and tail pitch | Local X |
| Neck/tail lateral bend | Local Z |
| Wing shoulder flap | Local Y; downstroke is positive on the left and negative on the right |
| Wing fore/aft sweep | Local Z with mirrored left/right signs |
| Front- and hind-leg gait flexion | Primarily local X, with mirrored lateral adjustment on local Z |
| Jaw opening | Local X |
| Visual ground alignment on `RootMotion` | Local Y, which is measured as scene +Z for this bone |

Do not copy axis signs or numeric effects from the Drogon tables in
`docs/WYVERN_ANIMATION_BASELINE.md`. Those measurements describe a different
armature. The Thornwing build establishes its own local bases, the validator
checks the named chains against the exported skin, and
`validation/thornwing-animations/clip-signatures.json` is the source of truth
for the resulting motion. Probe the exported rig and regenerate that signature
before changing a bone axis, mirror rule, or runtime offset; never approve an
axis from a plausible visual guess.

## Seven-clip contract

All actions are authored and exported at **24 fps**. Frame counts below are
duration frames (`duration x 24`), independent of whether Blender also samples
both endpoints while closing a loop.

| Clip | Duration | Playback | Motion contract |
|---|---:|---|---|
| `idle` | 6.0 s / 144 frames | Seamless loop | Planted neutral stance with breathing, restrained looking, and a secondary tail response. |
| `walk` | 2.0 s / 48 frames | Seamless loop | Low prowling gait; front and hind limbs use diagonal contacts while the wings remain folded. |
| `takeoff` | 2.0 s / 48 frames | One-shot -> `cruise` | Crouch and six-limb push-off into a readable power stroke; no root-motion authority is exported to gameplay. |
| `cruise` | 3.0 s / 72 frames | Seamless loop | Near-level forward flight with exactly two symmetric, readable wingbeats and negligible root drift. |
| `land` | 2.0 s / 48 frames | One-shot -> `idle` | Braking flare, leg extension, planted touchdown, and recovery to the idle endpoint. |
| `attack` | 1.5 s / 36 frames | One-shot | Bite/lunge that reads from either a planted or airborne base state; the action channel restores the base loop. |
| `death` | 3.0 s / 72 frames | One-shot | Full collapse that clamps on its terminal pose. |

The validation contracts, rather than this prose, approve the shipped bake:

- `idle`, `walk`, and `cruise` close below `0.01` radians/units at the loop seam.
- Grounded loops penetrate no farther than `0.02 m` below the ground plane.
- `cruise` contains exactly two beats, at least a 50-degree stroke range, no
  more than 5 degrees of left/right stroke-range difference, a -5 to +15 degree
  body line, and negligible root drift.
- `takeoff`, `land`, `attack`, and `death` are one-shots. `takeoff` chains to
  `cruise`, and `land` chains to `idle`.

These are acceptance thresholds, not claims about the exact measured result.
Read the generated signature for actual clearance, seam, body, wing, root, and
skinning values. When a rebuild changes a number, commit and review the
signature diff rather than copying rounded observations into this guide.

## Runtime mapping and intentional reuse

The manifest entry is `wyvern.thornwing`, loading `/models/thornwing.glb` at
`scale: 6`. The build measures the evaluated skin and bakes cosmetic
`RootMotion` ground correction into every grounded frame. Takeoff releases that
correction after push-off, landing acquires it at touchdown, and cruise keeps a
stationary authored origin. Ground and flight specs therefore use `yOffset: 0`.
Because the same authored attack is valid in both contexts, `attackAir`,
`breatheAir`, and airborne `drop` apply the measured `-1.052532` rig-unit
counter-fit that cancels its neutral ground carrier without changing the clip.
Gameplay and scene motion still own world translation and flight altitude. A
future offset change must come from regenerated clearance measurements, not
viewport tuning.

Only seven source actions ship in this vertical slice, but every `ModelState`
has an explicit safe mapping:

| Runtime states | Source clip and playback |
|---|---|
| `idle` | `idle` loop |
| `fly` | `takeoff`, one-shot, then `cruise` |
| `airborne`, `cruise`, `scout`, `speed`, `glide`, `dive`, `bankLeft`, `bankRight`, `hover`, `huntCarry` | `cruise` loop, `phaseGroup: "thornwing-flight"` |
| `walk`, `run`, `hop` | `walk` loop |
| `attack`, `breathe`, `huntGrip`, `huntFinish`, `pickUp` | `attack`, one-shot, grounded carrier |
| `attackAir`, `breatheAir`, `drop` | `attack`, one-shot, measured airborne counter-fit |
| `land` | `land`, one-shot, then `idle` |
| `death` | `death`, one-shot |
| `rest`, `sleep`, `sit`, `seated`, `rise`, `eat`, `drink`, `groom`, `perch`, `nuzzle`, `calm`, `offer`, `pet`, `inspect` | `idle` loop |

The reuse is deliberate: sanctuary behavior, Highlands, battle, breeding, and
the Model Library must always receive a valid pose instead of the bind pose.
No new gameplay rendering API is introduced. Stats, collision, range, movement,
and save behavior remain in `src/core/**`; the GLB and its fitted scale are
cosmetic.

## Rebuild and review

Run the public package commands from the repository root, in this order:

```bash
pnpm assets:thornwing
pnpm assets:analyze-thornwing
pnpm assets:validate-thornwing
pnpm assets:contact-sheet-thornwing
```

- `assets:thornwing` rebuilds `public/models/thornwing.glb` from the committed
  Forest Wyvern Display through the two `build-thornwing` scripts.
- `assets:analyze-thornwing` uses `scripts/analyze-thornwing.py` and
  `scripts/analyze-thornwing-blender.py` to write the numeric approval artifact
  at `validation/thornwing-animations/clip-signatures.json`.
- `assets:validate-thornwing` checks the required bones and seven actions,
  mirrored neutral-rest limbs, finite and four-influence normalized skinning,
  exact action durations, bindings, GLB size/triangle budget, runtime-fit
  safety, the visibly baked rest-pose delta, and the signature's SHA-256
  identities against both the display input and shipped GLB.
- `assets:contact-sheet-thornwing` uses the two
  `render-thornwing-contact-sheet` scripts to write the visual review artifact
  at `docs/images/thornwing-animation-contact-sheet.png`.

The contact sheet is required for silhouette, deformation, texture, and framing
review, but it does not replace the numeric gate. It recenters each sampled pose;
the two-beat cruise row deliberately samples 0%, 12.5%, 25%, 37.5%, and 50% so
the downstroke and upstroke cannot alias into five identical images. It cannot
prove loop closure, root stability, stroke symmetry, or ground contact.

After the asset-specific commands, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm sim:battle
```

Finally inspect `/models?model=wyvern.thornwing` and exercise idle, walk,
takeoff/cruise/landing, attack, and death. Check adult and hatchling scale,
ground contact, selection/name overlays, the widest wing silhouette, camera
near-plane clearance, sanctuary motion, and both airborne and grounded battle
actions. The balance harness is required because Thornwing is a new species,
even though the model itself must not supply gameplay dimensions.

## Known limitations

- This is seven-clip state coverage, not a bespoke animation for every state.
  Banking, hover, speed, glide, dive, scout, sleep, feeding, grooming, social,
  breath, and hunting variants intentionally reuse the nearest safe clip.
- The same attack is used on the ground and in the air and stands in for breath
  and hunting actions. It has no breath-specific mouth timing or effect socket
  event track.
- The authored front legs preserve the six-limbed silhouette, but the initial
  runtime procedural layers use the shared canonical head/spine/tail/wing/hind-
  leg contract; front-leg procedural reactions are future work.
- The original textures and material appearance are retained without a
  Thornwing-specific recolour pass.
- The optimized source budget is retained at 35,947 evaluated triangles. A
  lower-detail skinned LOD is not part of this vertical slice, so multi-creature
  scenes still depend on the existing mixer, frustum, distance, and shadow LOD
  behavior.
- The script-built GLB is authoritative. Manual edits to a temporary Blender
  scene are discarded on the next rebuild unless encoded in the build script.
