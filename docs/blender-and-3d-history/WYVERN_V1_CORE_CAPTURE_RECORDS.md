# Wyvern v1 core capture records

First-pass landmark captures for Batch A in
`WYVERN_V1_REAUTHORING_SOURCE_OF_TRUTH.md`. Each record is evidence for a
repaired-rig rebuild, not a channel retarget. Run
`node scripts/capture-v1-landmarks.mjs <source action>` to reproduce the seven
source samples, then replace or add event/contact frames as the pose review
identifies them. The extractor evaluates canonical glTF playback; a Blender
pose review is still required before a rebuilt action is promoted.

## `Sanct_Rest` → `rest`

| Field | Capture |
|---|---|
| Source | `Sanct_Rest` in the pinned Sanctuary extension (`41aa4d10…e3597c5b`) |
| Target | `rest` on `WyvernRig` |
| Card | S1 — sanctuary life |
| Playback | 0–144 at 24 fps; 6.000 s; exact loop |
| Contacts | Planted, low injured-rest posture throughout. Preserve credible support under both hind feet; do not copy the v1 rig's left/right foot-distance asymmetry to the repaired rig. |
| Event | Pant cycle: jaw is most open at frame 0/144 (−42.90° local X) and most closed at frame 72 (−37.17°). No attack, pickup, or flight event. |

### Landmark pass

| Frame | Phase | Evidence |
|---:|---|---|
| 0 | open-pant loop seam | Maximum sampled open jaw; settled low pelvis; cycle opening pose. |
| 18 | recovery | Jaw begins closing; head and tail start their slow counter-motion. |
| 36 | mid-pant | Jaw continues toward closed; support stays planted. |
| 72 | closed-pant / compression | Maximum sampled jaw closure and deepest sampled left-foot drop; retained as the compression landmark. |
| 108 | release | Mirrors frame 36 on the return to the open-pant pose. |
| 126 | recovery | Mirrors frame 18; head and tail settle back. |
| 144 | exact seam | Matches frame 0; required loop closure. |

### Repaired-rig brief

Keep the animal low, wakeful, and breathing through an open lower jaw. The
torso should heave only enough to read as laboured rest, while head and tail
counterbalance rather than travelling together. Wings stay tightly folded and
their membrane remains still—this is sanctuary rest, not flight readiness. The
current repaired-rig wing-sign evidence applies: wing local X is symmetric lift
and local Z must be negated across sides (`WYVERN_CLIP_AUDIT.md`).

### Numeric review

The source signature is the envelope: 6.000 s, exact loop, 5.71° jaw range,
0.113 pelvis path, and 0.13° authored root deviation. On the repaired rig,
approve an exact 0/144 seam, a planted evaluated-skin low point that determines
the manifest `yOffset`, an open-pant jaw cycle, and the folded-wing sweep
recorded in `WYVERN_CLIP_AUDIT.md`. The new rig's distances are not required to
equal v1's; contact order, phase relationship, and behavioural read are.

### Review status

**Rebuilt and Flight Lab-reviewed 2026-08-04.** The shared `Jaw` repair reversed
its rest bone from the snout-tip → skull direction to skull → snout, and baked
all existing jaw poses back with a maximum 0.00019 matrix-unit preservation
error. A positive local-X turn now moves the weighted lower muzzle forward and
down—the valid opening direction. The repaired `rest` is retimed to the v1
six-second loop and keys 8.6° open at frame 0/144 and 3.4° closed at frame 72
(5.2° range). Its evaluated skin low point is −331.00 rig units at frame 32,
so the runtime manifest uses `yOffset: 331`. The exported clip has an exact
frame-zero seam. `pnpm assets:review-flightlab-rest` evaluates all seven v1
landmarks through all six Flight Lab cameras at 1440×900: every silhouette is
contained; the sanctuary view's largest rest envelope occupies 15.3% width and
12.5% height of the viewport. `pnpm assets:review-flightlab` extends the same
gate to all 16 shipped clips (96 clip/camera rows, 48 samples per non-rest
clip). This is the Batch A camera approval; keep subsequent review in Flight
Lab unless the action's gameplay wiring changes.
