> Follow-up (2026-10-01): the structural/process gaps below are addressed in [runtime contract cleanup](14-v2-runtime-contract-cleanup.md). This audit remains the unchanged September 30 snapshot; current identity is pinned separately.

# V2 rig audit and late skin detection

2026-09-30. Read-only asset audit. Runtime snapshot SHA-256: `3c50d2e04d75fd5cb0a54bab9e3adc4709fd8e54a340bd468bc16856f19f1e25`; 5,922,036 bytes. The runtime changed after the prior skin repair's reported snapshot; an untracked `apply_v2_jaw_closure.mjs` is also now present. This report pins the bytes actually inspected and makes no claim about who changed them.

## Current rig

| Check | Result |
| --- | --- |
| Shared skin | One skin; body and membrane reference skin 0 |
| Joint identity | 92 unique names, exact source-contract order, no missing/extra bones |
| Bone parenting | All 92 bone-parent relationships match the source contract; no cycles or multiple parents detected |
| Skin attributes | All three mesh primitives: zero invalid joint indices, negative/nonfinite weights, nonfinite positions, or unweighted vertices |
| Weight sum | Maximum error 2.22e-16 |
| Actions | 18 exact canonical names, 276 channels each, all target the shared skin; zero duplicate targets |
| Timing/data | Every action starts at 0; finite values and strictly increasing input keys |
| Motion seams | Bank left 0.10098°, bank right 0.08647°, cruise 0.05877°, walk 0.07554°, sampled at approximately 96 Hz |
| Source audit | `assets/blender/wyvern-gothic.glb` passes its pinned contract |
| Runtime against source contract | Fails on source hash, external armature name, scene-parent metadata, scene-root name, and mesh metadata |
| Export residue | Ten empty scenes; external armature name `WyvernRig.001`; two named mesh objects instead of source `WyvernMesh` |

The source-contract bone-row error comes from the external scene-parent name, not changed bone names/order or bone-to-bone parenting. The split body/membrane geometry and changed hash are real variant differences. They need a distinct runtime contract; silently changing the source contract to accept them would discard provenance. Empty scenes and suffixed external names are export hygiene findings, not measured deformation failures.

Two glTF skins sharing bones are legal and can be required when meshes have different bind spaces. The original two-skin file did not contain two independent 92-bone rigs. Its issue was disagreement with the intended shared-skin contract and stale qualification records. Repair required normalizing the membrane bind space before sharing the body skin.

## History verified directly from Git asset bytes

| Date | Commit | Skin count |
| --- | --- | --- |
| 2026-09-12 | `398ee29` | 1 |
| 2026-09-15 | `edcc03f` | 1 |
| 2026-09-16 | `c5d02b4` | 2 |
| 2026-09-18 | `4952744` | 1 |
| 2026-09-19 | `c234da8` | 2 |

The first available committed transition to two skins is 16 September. The exact export operation cannot be established from binary history alone. On 19 September the dual-skin state was explicitly accepted: `package_v2_ground_fold.mjs` and `package_v2_takeoff.mjs` asserted two skins, and `tools/asset-budget.json` explained dual skins as preserving verified inverse bind matrices. Other package scripts asserted one skin. The pipeline had contradictory expectations.

## Why it was detected late

1. **Different audited and loaded files.** `assets:audit-glb` checks `assets/blender/wyvern-gothic.glb`; Flight Lab loads `public/models/wyvern-v2-rig.glb`. A source audit pass cannot qualify the runtime derivative.
2. **The changed state became an expectation.** Two packaging assertions and the budget reason deliberately preserved two skins. The budget test enforced triangles/bytes, not skeleton structure.
3. **Motion evidence did not enforce this structural invariant.** `audit-wyvern-motion.mjs` reports skin count but does not reject two skins; it samples walk/cruise/banks and prints continuity measurements. Existing kinetics tests checked membrane reach and other performance properties without requiring one shared skin.
4. **Documentation stayed at an older snapshot.** Handoff 07 recorded the September 15 one-skin hash while later committed packages alternated between one and two. The source contract created later pinned the separate Gothic source, not those runtime packages.
5. **Review did not reconcile those authorities.** The mismatch should have been reported when the runtime derivative was qualified. Checking actual GLB metadata against the runtime expectation would have surfaced it immediately.

The September 30 repair added an actual runtime skin-count regression test and duplicate-skin mutant, and changed the two conflicting packagers to require one skin. This closes that specific gap. It does not provide a complete runtime fingerprint/hierarchy/mesh contract at every export or promotion boundary.

## Remaining process work

- Keep separate pinned source and approved runtime manifests, with explicit derivation/provenance.
- Validate the final runtime candidate after every export/splice, including shared skin, exact bone names/order/parents, inverse bind matrices, mesh bindings, and canonical clip inventory.
- Require that validation at promotion and in the fast suite; reporting a count is insufficient.
- Update the runtime hash and qualification record with each accepted asset change.

## Evidence and limits

Evidence JSON is in `evidence/2026-09-30-rig-audit/`: runtime structure/weights/keys, source contract, runtime comparison against the source contract, and four-clip motion sampling. Source and runtime audits used `python3 scripts/blender/cli.py audit-glb <path> --json-out <report>`; motion used `node tools/audit-wyvern-motion.mjs public/models/wyvern-v2-rig.glb`. The shared-skin test was rerun successfully against this snapshot.

This audit establishes structural and sampled numerical facts. It does not approve visible idle quality, skin intersections, ground contact, Blender round-trip parity, or gameplay. No model or animation was changed during this audit.
