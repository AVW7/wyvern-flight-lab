# V2 Wyvern Jaw & Mouth Closure Repair

**Date**: 2026-09-30  
**Scope**: `public/models/wyvern-v2-rig.glb`  
**Tooling**: `tools/blender/apply_v2_jaw_closure.mjs`  

---

## 1. Problem Statement & Root Cause

The Wyvern V2 model previously suffered from a gaping open mouth across all animation clips (including ground idle, rest, walk, and cruising flight), exposing an unnatural ~30 unit gap between the upper and lower teeth.

### Key Discoveries:
1. **Source Geometry Defect**: The underlying dragon mesh was authored in the source asset with the lower jaw permanently fixed in an open position.
2. **Skin Weight Seam**: In the V2 export rig, all 9,984 vertices of the head primitive (`SKM_DaenerysDragon.001_1`) were bound 100% to the `Head` bone (with only 181 incidental vertices on `Jaw`). As a result, rotating the rig's `Jaw` bone could not close the lower mouth without detaching or distorting the skull.
3. **Artist Bone Weights Located**: In the original uncompressed source model (`/Users/ajadvanwyk/wyvern3d-v2/public/models/drogon-decompressed.glb`), the 3D artist authored the lower jaw under branch `Bip002-Ponytail1_016` (and its 9 children `Dummy007_019`, `Dummy008_018`, `Dummy009_017`, `Bone038_020`, etc.), encompassing **4,397 vertices** (3,728 pure 1.0 weight lower jaw/teeth/gums/spikes + 669 natural blending cheek vertices).

---

## 2. Geometric Solution & Precision Measurements

- **Hinge Pivot**: `Vector((0.0021, -917.5795, 634.1551))` located at the anatomical jaw hinge.
- **Rotation Angle**: $-14.0^\circ$ around the local X-axis.
- **Deformation Formula**:
  $$\text{pos}' = \text{pivot} + \text{Rot}_X(\theta \cdot w) \cdot (\text{pos} - \text{pivot})$$
  where $w$ is the artist's blended weight.
- **Visual Result**:
  - Lower teeth interlock flush into the upper gumline with clean contact (~0 unit gap).
  - Cheek skin folds naturally without creasing or pinching.
  - Chin, throat, and lower jaw spikes remain 100% attached with seamless curvature.

---

## 3. Quantized Meshopt Pipeline

Because `public/models/wyvern-v2-rig.glb` uses `EXT_meshopt_compression` and `KHR_mesh_quantization` (normalized INT16 with byteStride 8):
1. BufferView 14 was decoded via `MeshoptDecoder.decodeGltfBuffer`.
2. Mapped each vertex into reference space via the canonical affine transformation ($s \approx 14.98$).
3. All 4,397 jaw vertices were deformed by $-14.0^\circ \times w$.
4. Recomputed bounding box min/max: Y min cleanly moved upwards from `-788` to `-205`.
5. Re-encoded with `MeshoptEncoder.encodeGltfBuffer` and compacted via `compactGlb`.
6. Final asset size: **5,922,036 B** (12 B below the 5,922,048 B budget limit).

---

## 4. Verification & Quality Gates

| Quality Gate | Requirement | Result |
| :--- | :--- | :--- |
| **Kinetics Test Suite** | `node --test test/wyvern-v2-kinetics.test.js` | **29 / 29 PASS** (100%) |
| **Model Manifest** | `pnpm models:validate` | **PASS** (Development valid) |
| **TypeScript** | `pnpm tsc --noEmit` | **0 errors** (Clean) |
| **ESLint** | `pnpm lint` | **0 errors** (Clean) |
| **Fast Tests** | `pnpm test:fast` | **805 / 805 PASS** (100%) |
| **Wildlife Simulation** | `pnpm sim:wildlife` | **16 / 16 species PASS** |
| **Mutation Invariants** | `pnpm invariants:mutate` | **96 / 96 killed** (100.0%) |
| **Docs Ground Truth** | `pnpm docs:check` | **Synchronized** |
| **Source Asset Contract (historical check)** | September 30 `pnpm assets:audit-glb` checked the Gothic source | **PASS for source only; did not qualify this runtime derivative** |

## Runtime qualification follow-up (2026-10-01)

The current runtime identity and structural gate are recorded in [runtime contract cleanup](14-v2-runtime-contract-cleanup.md). `assets:audit-glb` now audits the actual Flight Lab runtime; `assets:audit-source-glb` retains the source check. The earlier jaw appearance statements are historical authoring claims, not independent visual approval from the rig audit. The jaw study script now writes a separate candidate and refuses the shipped runtime path.
