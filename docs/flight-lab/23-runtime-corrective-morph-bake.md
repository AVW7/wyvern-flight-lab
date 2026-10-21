# Runtime corrective cruise morph bake, 7 October 2026

The Blender MCP correction from [22](22-blender-mcp-corrective-cruise-rig.md) now has a separate GLB candidate. The active model and player assets remain unchanged. This is a cruise membrane correction; it does not complete the V1 bank, ground animation, transition or design qualification work.

## Candidate and measured evidence

Folder: `assets/harvest-candidates/2026-10-07/runtime-corrective/`.

- Source: `public/models/wyvern-v2-rig.glb`, SHA256 `b0667a7bf5b1484a216ed9851b26ccad3fa6d833a104beb9ed59b1898f725d3c`.
- Candidate: `wyvern-v2-corrective-cruise-explicit-zero-candidate.glb`, SHA256 `3c63a3c648d43efacd5e6f2ad8c1e394f9312bb22d6a76dbf46458a27c8485e1`.
- Size: 19,193,992 bytes. The active asset budget was not increased. This candidate is too large for promotion without optimization and hardware evidence.
- 145 sampled frames at 24 fps, 8,249 membrane vertices, 33 position bases and 97 normal bases. Coefficients are scaled to [-1, 1]. The final coefficient row equals the first.
- Three.js posed position maximum error: 2.184413 rig units; mean error: 0.006661. Bound: 2.333333 units, half a pixel in the inspected macro camera (orthographic scale 4200, width 900).
- Three.js posed normalized normal component maximum error: 0.004400. Bound: 1/127, the source signed normalized INT8 normal component quantum.
- All 17 non-cruise clips reset morph weights to zero after playing cruise.

`runtime-position-audit.json` records the actual GLTFLoader/AnimationMixer geometry evaluation, including normal reconstruction using the Three.js skin-normal shader operation. It tests integer-frame samples, not subframe interpolation, rendered appearance, GPU costs or blended transitions.

## Implementation

`export_corrective_source.mjs` extracts the exact source vertex order, normals, skin joints and weights. Blender MCP fits the mesh-to-imported-bind affine map and verifies exact float32 weight identity. `bake_v2_corrective_mcp.py` evaluates the gated Blender modifier for all 145 frames, solves the linear skin transform backwards, and saves position/normal deltas plus evaluated references. The largest Blender linear-skin reconstruction error was 0.001314 rig units.

`fit_v2_corrective_basis_mcp.py` fits separate position and normal bases. Rank selection uses the measured camera and source quantization bounds above; it does not use an arbitrary target count. Loop endpoint fields are made identical before fitting. `basis-report.json` records the rank/error tables.

`package_corrective_morphs.mjs` appends only morph attributes and weight animation channels. The entire original binary prefix and JSON data are compared against the source after removing these authorized additions. Skeleton, original geometry, weights, textures, materials and bone animation channels must remain identical. The active runtime contract remains strict and unchanged.

The current local Three.js GLTFLoader substitutes the base attribute when a target omits POSITION or NORMAL. Consequently every target supplies both semantics, with explicit shared zero accessors for the unused semantic. The first package, `wyvern-v2-corrective-cruise-candidate.glb`, omitted those zero attributes and failed posed runtime geometry comparison (maximum error 31,554.825 units). It is rejected evidence, not the current candidate.

Four focused tests exercise packaging and corruption: stale source provenance, an open loop, a nonzero ground reset, altered skeleton and missing explicit zero semantics. Run them with `node --test test/corrective-morph-candidate.test.js`.

## Remaining gates

1. Render the exact GLB round trip through Blender MCP at matched 16:9 and 3:2 camera settings and inspect the contact sheets.
2. Measure subframe interpolation and cruise-to-ground blends, including folded wing positions.
3. Reduce package/GPU cost while retaining the measured positional and normal tolerances; measure on the 8 GB target machine.
4. Reconcile the correction with the separate harvested cruise/bank candidates and qualify full clip coverage before considering promotion.

No gameplay asset has been replaced, and no runtime visual or hardware performance acceptance is claimed.
