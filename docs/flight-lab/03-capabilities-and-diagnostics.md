# 03. Capabilities and animation diagnostics

Status: proposed. Priority: P1. Depends on: 01.

## Problem and evidence

The catalogue distinguishes wyverns and eggs, while action buttons largely use the presence of any clip as their availability check. Clip fallback can conceal a missing authored bank or takeoff clip. Mesh metrics currently report triangles, vertices and normalized bounds. Speed and altitude are mode constants in `runtime.ts`; they are not measured flight data.

## Implementation checklist

- [ ] Resolve each mode/action to a capability result: exact clip, explicit alias, fallback or unavailable. Expose the selected clip and reason in the UI.
- [ ] Disable unsupported one-shot actions individually. Permit flight preview fallback only when visibly labelled, and provide a strict inspection option that refuses substitution.
- [ ] Label existing speed and altitude as preview settings or remove them from measured telemetry. Report actual clip time, effective rate and current rendered bank separately from target bank.
- [ ] Show clip duration, track count, animated bone count and unresolved binding warnings. Distinguish a static mesh from an animated specimen whose expected action is missing.
- [ ] Add a deterministic clip inspection pass for invalid durations, non-finite keyframes, unresolved track targets and suspicious loop discontinuities. Treat thresholds as review warnings until calibrated on real specimens.
- [ ] Extend model diagnostics with draw calls, materials, textures and skinning counts where available. Label geometry counts versus rendered workload; do not infer GPU cost solely from triangles.
- [ ] Reuse existing asset metadata and inspect `tools/animcheck.mjs` before adding a second asset-analysis pipeline. Keep lab presentation metadata distinct from canonical Asset Registry facts.
- [ ] Audit skeleton, silhouette and wireframe combinations for correct restoration. Verify ownership and disposal for helper geometry, temporary materials, tunnel geometry and shadow resources.

## Likely files

`src/flight-lab/catalog.ts`, `clipResolver.ts`, `diagnostics.ts`, `types.ts`, `runtime.ts`; `components/FlightControls.tsx`, `components/StageViewport.tsx`; `tools/animcheck.mjs`, `src/core/assetRegistry.ts` as reuse references.

## Acceptance and verification

- A specimen missing BankLeft reports its actual fallback; strict inspection rejects it. A missing Roar cannot be triggered by keyboard or button.
- Synthetic malformed clips produce actionable diagnostics naming the clip and track; valid fixtures remain clean.
- Preview constants cannot be mistaken for measured speed or altitude. Static eggs show useful mesh inspection without flight claims.
- Toggling diagnostic combinations and switching specimens restores the original material appearance.
- After warm-up, repeated specimen switches and route remounts do not produce unbounded lab-owned resource growth. Record cache behavior separately from leaks and compare against a measured baseline.

Out of scope: automatic rig repair, regeneration of GLBs, scientific aerodynamic simulation.
