# V2 Wyvern Repair Baseline (Stage 0)

**Date**: 2026-10-20  
**Status**: Stage 0 Complete (Read-Only Baseline Verified)

---

## 1. SHA-256 Hashes and File Identities

| Asset Path | SHA-256 Hash | Size (Bytes) | Contract Alignment |
|---|---|---|---|
| `public/models/wyvern-v2-rig.glb` | `2ef4eb1bdbca142d224041bccf16e192258d1936ffa94cb0bf78f07c4afb1b8c` | 5,685,288 | Matches `scripts/blender/wyvern_v2_runtime_contract.json` exactly |
| `public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb` | `2ef4eb1bdbca142d224041bccf16e192258d1936ffa94cb0bf78f07c4afb1b8c` | 5,685,288 | Synchronized with 14 Oct promoted candidate |
| `public/models/wyvern-v2-membrane-lab-candidate.glb` | `2ef4eb1bdbca142d224041bccf16e192258d1936ffa94cb0bf78f07c4afb1b8c` | 5,685,288 | Synchronized with 14 Oct promoted candidate |

*Resolution of Note Discrepancy*: Older 8 October hash (`b0667a76...`) was superseded by the 14 October 18-clip panel coordination promotion (`2ef4eb1b...`). Current active runtime is the coordinated 18-clip package.

---

## 2. Structural & Contract Audit

Run: `python3 scripts/blender/cli.py audit-glb public/models/wyvern-v2-rig.glb`
- **Result**: `passed: true` (0 errors, 0 warnings)
- **Skin count**: 1
- **Joints**: 92 canonical joints
- **Meshes**: 
  - `WyvernBody_Rebuild` (34,614 tris, 24,528 verts, skin index 0)
  - `WyvernMembrane_ExportSafe` (15,258 tris, 8,249 verts, skin index 0)
- **Clips**: 18 canonical clips present

---

## 3. Motion & Loop Seam Audit

Run: `node tools/audit-all-clips.mjs public/models/wyvern-v2-rig.glb`
- **Bank Mirrored Trajectory Residual**: `0.0011 m`
- **Bank Opposed Body Rotation Residual**: `0.0000 rad`
- **Root Travel**: `0.0000` across all 18 clips
- **Loop Seams**:
  - `bankLeft`: seam(rad) `0.0008`, seam(rig) `0.0012`
  - `bankRight`: seam(rad) `0.0008`, seam(rig) `0.0006`
  - `cruise`: seam(rad) `0.0007`, seam(rig) `0.0000`
  - `dive`: seam(rad) `0.0007`, seam(rig) `0.0008`
  - `glide`: seam(rad) `0.0007`, seam(rig) `0.0006`
  - `hover`: seam(rad) `0.0007`, seam(rig) `0.0000`
  - `idle`: seam(rad) `0.0009`, seam(rig) `0.0000`
  - `rest`: seam(rad) `0.0006`, seam(rig) `0.0000`
  - `scout`: seam(rad) `0.0007`, seam(rig) `0.0000`
  - `speed`: seam(rad) `0.0008`, seam(rig) `0.0004`
  - `walk`: seam(rad) `0.0008`, seam(rig) `0.0000` (walk mirror asymmetry `9.5050 m` - intentional gait)

---

## 4. Test Suite Execution

Run: `pnpm test:fast`
- **Total tests**: 873 passed / 873 total (0 failures, 0 skipped)
- **Duration**: ~60.08s
- Key coverage verified: single-skin invariant, 60 wing bones, 18 panel coordinations, gait kinetics, and flight rig procedural stability.
