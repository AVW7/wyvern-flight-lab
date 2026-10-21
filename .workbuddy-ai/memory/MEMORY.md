# Project Memory — wyvern-flight-lab

## V2 GLB / Blender pipeline facts (measured 2026-10-21)

- **The shipped `public/models/wyvern-v2-rig.glb` is NOT an export of any committed blend.**
  Its clips were assembled at GLB level by splicing donor GLBs (`tools/blender/splice_improved_clips.mjs`,
  default donor `assets/blender/wyvern-gothic.glb`). Shipped `walk` is byte-identical to the gothic
  donor's walk; shipped `idle` (Neck1 −21.1° / Neck2 −24.2° / Head −19.3° ≈ −65° baked neck raise)
  came from a donor (`idle-v2-fold-candidate.glb`) that lived outside the repo and is gone.
- **Both Blender sources carry a healthy `idle`**: Neck1 ±1°, Neck2 ±1.3°, Head ±3.4° (quat.x),
  mean ≈0° — a breathing bob, no baked raise. Verified in `models/source/wyvern-rig.blend` (56 bones,
  39 weighted) and `wyvern-rig-v1wing.blend` (106 bones, 106 weighted) — identical fcurve values.
- **Headless export path**: `python3 scripts/blender/cli.py --headless --blend <blend> export --out <glb>`
  (Blender 5.1 at `~/.local/bin/blender`). The exporter uses `export_def_bones=True`, so only weighted
  bones ship: wyvern-rig.blend → 39 joints (shipped rig needs 92 — full re-export from it is not viable),
  wyvern-rig-v1wing.blend → 106. Exporter also bakes + strips the control rig on export.
- **Bug in `cli.py`**: headless mode double-forwards positional subcommand args as options
  (`audit-glb` → `--glb` unrecognized). Workaround: run audit scripts inside Blender directly
  (`blender -b --python …`) or via the MCP session.
- **Ground-mode head lift — FIXED 2026-10-21 (idle only).** New tool
  `tools/blender/splice_neck_head_channels.mjs` re-spliced idle's Neck1/Neck2/Head
  rotation channels from a fresh `wyvern-rig.blend` export into the shipped GLB:
  −65° raise → ≈0° + ±7° head bob. Runtime now sha256 `d916b748…`, 5,977,592 bytes;
  contract `scripts/blender/wyvern_v2_runtime_contract.json` updated per doc 14.
  `land` verified healthy (do not splice the blend's stub land). **Aj confirmed
  2026-10-21: `walk` and `rest` necks are fine as shipped — only `idle` had the issue;
  do NOT re-splice walk.** Same fix applied to the two review candidates
  (`wyvern-v2-membrane-lab-candidate.glb`, `wyvern-v2-idle-walk-flight-lab-candidate.glb`) —
  all three assets share sha256 `d916b748…`.
  Evidence: docs/flight-lab/evidence/2026-10-21-idle-{before,after,after-candidate}.png.
- Shipped GLB is meshopt-compressed (5.7 MB); fresh exports are uncompressed (17.8 MB) — run through
  `tools/blender/compact_v2_glb.mjs` if a full re-export is ever needed.
