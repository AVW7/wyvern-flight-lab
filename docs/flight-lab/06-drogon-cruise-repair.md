# Drogon cruise repair

For a compact continuation brief and the saved Blender scene, read [NEXT_SESSION.md](NEXT_SESSION.md).

Date: 2026-09-08. Status: cruise motion replaced and inspected in Blender MCP and Flight Lab. This is a focused motion repair, not approval of the entire rig or all 13 animations.

## Reproduced defect

The actual game asset, `public/models/player-wyvern.glb`, contained a turning performance under the name `FlightCruise`. Blender showed large changes in body direction while playing that clip without game code. Three.js AnimationMixer evaluation measured **93.60659657 degrees** between the body's initial and final world orientations. Repeating the clip therefore snaps the body back to its starting orientation.

The sampled pose comparison ranked the original vendor `Battle_SkyMoveR01` closest, but does not establish an exact source identity. That attribution is not needed for the loop defect or repair.

## Repair

Replace only `FlightCruise` with `Sanct_Cruise` from `/Users/ajadvanwyk/wyvern3d/public/models/drogon-sanctuary.glb`, matched by exact bone names. All 876 donor channels resolve. Preserve all meshes, skins, node hierarchy, textures, materials, and the other 12 animation records. Their JSON records were compared for exact equality before and after the replacement.

The restored clip lasts 6 seconds and contains three wingbeats. It retains the original model's wing shapes and existing rig limitations. Both the player runtime and Flight Lab already load this GLB, so neither requires a new controller or alternative animation owner.

Flight Lab now labels this specimen **Drogon (Player Wyvern)**. Its stable specimen ID remains `young-wyvern` for compatibility.

| Identity | SHA-256 |
|---|---|
| Original player GLB | `b7101de18ee7345181b2a50399311a39571ad9ce6ecb4f25e0575ade958d0f90` |
| Sanctuary donor | `83c5fa1000991f477abd8d44e77dabf6ae48775cfa14f65d9410f4887f6347ec` |
| Repaired player GLB | `bd9f61aa62f1534bd3dd7a58286c689154ef2e47084750aae5b89281ae174e5c` |

The donor identity differs from older v2 documentation's pinned source. This report records the file actually inspected; do not substitute a similarly named source silently.

The file grows from 4,802,552 to 5,917,872 bytes because the replacement motion is appended without recompressing existing geometry or other clips. Triangles remain 39,234. The asset budget ledger records that measured size and reason. Old unreferenced animation bytes remain inside the binary buffer; pruning can be a separate measured optimization.

Reproduce the replacement from the original player asset:

```sh
node tools/replace-player-cruise.mjs original-player.glb /path/to/drogon-sanctuary.glb repaired-player.glb
```

The tool rejects an unreviewed donor hash and is idempotent on the repaired asset. It does not modify its input unless explicitly used as the output path.

## Evidence and checks

- Blender MCP: original, v2, current player, and repaired player imported into separate scenes. Source models were not overwritten. A decompressed inspection copy was required because Blender's importer rejected `EXT_meshopt_compression`.
- Blender: original and repaired poses rendered at multiple phases, with 16:9 and 3:2 captures. Repaired pelvis orientation remains steady and its endpoint returns to the initial orientation.
- Regression: `test/player-wyvern-cruise.test.js` evaluates the actual GLB through Three.js, initially failed at 93.6066 degrees, and passes with the replacement. A deliberately corrupted final pelvis rotation is rejected.
- Loop tolerance: 0.1 degrees corresponds to less than one pixel of angular displacement at a 480-pixel radius in the 960-pixel audit render. The orientation hemisphere check rejects body reversals; it is not a complete artistic motion metric.
- Browser: Flight Lab loaded all 13 clips, showed the restored six-second cruise, allowed pause/scrub to 0% and 100% with matching poses, and switched bank-left back to cruise. No captured browser warnings or errors during this check.
- Full gameplay traversal, takeoff/landing continuity, remaining bank clip loop quality, and performance profiling are not established by this repair.

Final repository checks: 549/549 fast tests passed; lint passed; all 16 wildlife simulation routines passed; all 36 invariant mutants were killed; documentation check passed after regenerating metrics with `pnpm run docs`. Type-checking remains blocked by `src/biomeFactory.ts:83`, where concurrent terrain changes reference an unresolved `terrainHeightAt`. That file was not changed by this repair.

> **Resolved 2026-09-08:** the blocker above no longer applies. `terrainHeightAt` is
> exported from `src/scene/terrainSystem.ts:100` with a signature matching the call
> site — it was simply missing from `biomeFactory.ts`'s import block. Adding that one
> import clears `tsc --noEmit` (exit 0). The repair itself still did not touch that
> file, as stated.

Blender scene, raw measurements and rendered comparison are in the local audit artifact folder:

`/Users/ajadvanwyk/.codex/visualizations/2026/09/08/01a081b7-7043-7e71-8f02-500314a5db62/wyvern-flight-audit/`

## Separate rig issue

The original rig's clavicles are children of `Bip002-Neck_012`. A controlled 10-degree local-Y neck rotation at source bank frame 25 displaced the left and right wrists by 8.34% and 10.06% of the baseline wrist-to-wrist span. Restoring the authored clavicle matrices reduced that displacement to approximately 0.000014%. The v2 neck probe left wing roots and wrists stationary.

This is evidence for a future isolated gaze layer, not a fix applied here. Flight Lab does not currently add procedural neck motion, so this coupling was not presented as the cause of its cruise loop snap. Avoid reparenting the original skeleton or bulk-retargeting all clips as part of this repair.

## Next development gate

Keep Fantasy Biomes as the gameplay owner. Review and measure `BankLeft`, `BankRight`, and takeoff-to-cruise transitions next, preserving the repaired cruise as the stable reference. Then validate one controlled flight, interaction, landing and saved return-to-Roost loop in Hearthvale. Further model rebuilding should be driven by a reproduced deformation defect with source-frame evidence.
