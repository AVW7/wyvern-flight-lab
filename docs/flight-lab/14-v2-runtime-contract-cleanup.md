# V2 runtime rig contract and export cleanup

2026-10-01. This is the current structural authority for Flight Lab V2. It supersedes historical runtime skin counts and hashes in handoffs 07 and 12, while preserving their original evidence.

## Identity and source separation

| Asset | Authority | Verification |
| --- | --- | --- |
| Gothic authoring source | `assets/blender/wyvern-gothic.glb`; source contract `scripts/blender/wyvern_v2_rig_contract.json` | `pnpm assets:audit-source-glb` |
| Current Flight Lab runtime | `public/models/wyvern-v2-rig.glb`; runtime contract `scripts/blender/wyvern_v2_runtime_contract.json` | `pnpm assets:audit-glb` or `pnpm assets:validate-wyvern` |
| Source animation envelope | Original source-specific numeric clip validator | `pnpm assets:validate-source-clips` |

Runtime SHA-256: `76b6f89f75d688b5e739ddd7295cd3e64a6d4c8e994751597c8872b7b5cc20cf`; 5,921,572 bytes. Source SHA-256 remains `f334e78569c701bbfefe43ef9816147e200c56bdcb3a8a58889a9f13c6d2956e`. The runtime manifest records derivation, evidence, and the limits of structural qualification separately from source identity.

## Export cleanup

The runtime previously contained one populated scene plus ten empty review scenes. Only the populated scene remains. The unbound external container and skin label `WyvernRig.001` were standardized to `WyvernRig`; exported bones and both mesh-object names remain unchanged. Binary data is byte-identical to the pre-cleanup snapshot, as are animation, mesh, accessor, buffer-view, material, texture, and image declarations. The package shrank by 464 bytes. Existing jaw geometry and the shared-skin repair were preserved.

## Enforced runtime contract

`tools/blender/runtime_rig_contract.mjs` checks the real runtime, with Meshopt-capable accessor decoding:

- One active scene, one shared skin, exact 92-joint names/order/parents, valid acyclic hierarchy, and both mesh bindings.
- Exact node rest transforms, inverse bind matrix contents, geometry, joint/weight attributes, materials, textures, and image content fingerprints.
- Source-compatible canonical 18-clip inventory and per-clip bone/channel bindings, unique targets, correct sampler output shapes/counts, finite keys, strictly increasing times, and first key at zero.
- A pinned whole-file hash for the shipped package. Even an animation-only change requires an explicit updated runtime fingerprint.

The manifest captures a structural baseline of the existing runtime. It does not approve inherited visual defects merely by recording them.

## Packaging and promotion boundaries

All eight `package_v2_*.mjs` scripts validate their input and output against the runtime structure and write separate `/tmp/*-candidate.glb` outputs by default. An explicit first argument selects a candidate destination. Legacy base/donor paths still identify historical studies; those packages fail rather than silently accept incompatible old rig metadata. The compactor validates runtime-shaped output too. Its generic non-V2 behavior remains available.

`writeValidatedRuntimeRig` validates before writing, then replaces the destination atomically. Candidate destinations permit changed animation curves while retaining the pinned rig, geometry, materials, and bindings. The actual shipped path additionally requires the exact pinned hash, so an unreviewed package cannot replace it. This is a deliberate promotion boundary, not automatic fingerprint regeneration.

Review workflow:

1. Produce a separate candidate. Run `node tools/blender/runtime_rig_contract.mjs /absolute/candidate.glb --candidate`.
2. Capture the changed-action numeric, visual, transition, and runtime evidence required by its work order. Retain baseline identity and explain the intended difference.
3. For an animation-only accepted change, explicitly update the runtime manifest's `asset.sha256`, `asset.bytes`, and provenance/evidence together with promotion. Do not refresh the signature to make a failing structural candidate pass.
4. For an intentional geometry or rig change, audit the source, binding, deformation, and downstream consumers first; review the signature diff as part of that change.
5. Promote only bytes that pass the strict pinned audit and run the normal repository gates. Never auto-update a manifest as part of the audit or package command.

The earlier jaw geometry study now writes a separate candidate and refuses the runtime path. Its geometry changes require the geometry-review workflow; it cannot use animation-only packaging to bypass the fingerprint.

## Regression evidence

The cleanup check first failed on 11 scenes, then passed after removing the ten empty scenes. Runtime tests check the pinned package, source/runtime command separation, corrupt candidate rejection without touching the destination, and refusal of unpinned shipped bytes. Eighteen semantic mutants are rejected without relying on the whole-file hash, including skin duplication, scene residue, bone/name/order/hierarchy drift, changed bind data, mesh binding, geometry, weights, materials, clip inventory, channel targets, sampler shape/count, delayed first key, and nonfinite times. They also run in `pnpm invariants:mutate`.

## Remaining qualification

No browser or dev server was needed for byte-preserving scene/name cleanup and structural gates. Visual idle quality, skin intersections, ground contacts, Blender round-trip parity, and gameplay promotion remain separate work orders. This cleanup supplies reliable identity and prevents structural drift; it does not claim those visual/gameplay checks were performed.

## Completed repository gates

The cleaned package passed all 829 fast tests, all 114 mutation checks, TypeScript, lint, all 16 wildlife routines, both source and runtime audits, and the documentation synchronization check. The new runtime tests contribute 24 checks, including write/promotion boundaries. Audit snapshots are retained in `evidence/2026-10-01-runtime-contract/`.

## Test consolidation (2026-10-01)

The initial 24 runtime checks and separate skin test were reduced to three behavioral tests: pinned runtime/source distinction, corrupt-candidate destination preservation, and candidate-write versus shipped-promotion behavior. Direct scene/skin assertions, exact package-command string assertions, a duplicated hash test, and unit-suite repetitions of the eighteen semantic mutants were removed. All eighteen mutants remain in the dedicated mutation suite; its earlier duplicate shared-skin mutant was removed. Historical gate totals above describe the pre-consolidation run.

Post-consolidation verification: all 807 fast tests and all 113 mutation checks passed, with lint and documentation synchronization clean. The reduction removes 22 duplicate or implementation-specific test cases and one duplicated mutation, while retaining all eighteen runtime-contract corruption cases.
