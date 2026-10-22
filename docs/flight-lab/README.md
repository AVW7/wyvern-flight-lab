# Flight Lab Plans, Audits & Active Roadmap

## Active Roadmap & Agent Handoffs (Updated 21 October 2026)

Start here for all current V2 wyvern model, Blender pipeline, and Flight Lab work:

| Document | Scope |
| --- | --- |
| [NEXT_SESSION.md](NEXT_SESSION.md) | Live cross-session handoff log, current asset hashes, and immediate next actions |
| [39 V2 Development Roadmap](39-v2-development-roadmap.md) | Master V2 roadmap (`Milestones M1–M11`), V2 vs V1 capability matrix, and error/anomaly handling plan |
| [40 Architecture Audit & Prioritized Path](40-architecture-audit-and-prioritized-path.md) | Full codebase architecture audit, technical debt register (`D1–D16`), and verified mobile reachability closure |
| [41 V2 & Blender Rig Audit + Coding Agent Task List](41-v2-and-blender-rig-audit-task-list.md) | Independent review of Step 5 note (`37-v2-idle-neck-audit-note.md`), V2 runtime GLB & `src/flight-lab/` bug audit, Blender `.blend` mismatch matrix, Flight Lab AI/detector design, and `Workstreams A–E` |
| [38 Side Panel UI Review & Redesign](38-side-panel-ui-review-and-redesign.md) | WCAG contrast audit, token system, and responsive drawer rework (implemented 2026-10-21) |
| [37 Stage 3 Clip Defect Taxonomy](37-stage3-clip-defect-taxonomy.md) | `UNIFORM` / `CONCENTRATED` / `BUZZ` angular-velocity & travel taxonomy across the 9 mapped clips |
| [37 V2 Idle Neck Audit Note](37-v2-idle-neck-audit-note.md) | Root-cause analysis and channel splice record for the `-65°` ground-idle neck raise |
| [36 V2 Dynamics Gate](36-v2-dynamics-gate.md) | 60 Hz world-space angular velocity gate and V1 reference baseline |
| [35 Rider Asset & Mount](35-rider-asset-and-mount.md) | Standalone 24-bone `wyvern-rider.glb` asset and `Spine3`-calibrated mount runtime |
| [14 V2 Runtime Asset Governance](14-v2-runtime-asset-governance.md) | Mandatory SHA-256 contract pinning and promotion protocol for `public/models/wyvern-v2-rig.glb` |

---

## Historical Plans (September–October 2026)

Focused rebuild plan: [10 V2 body motion and vertical camera follow](10-v2-body-motion-and-camera-plan.md), 13 September 2026. Plan [09 Flight Lab improvement plan](09-flight-lab-improvement-plan.md) (13 September 2026) and [08 Animation and Flight Lab delivery plan](08-animation-and-flight-lab-delivery-plan.md) retain earlier V2 lab and animation qualification history; studies `18` through `34` cover V1-to-V2 wing harvesting, membrane crease studies, and corrective morph bakes.

The initial 5-stage roadmap (`01`–`05`) below is historical context from 5 September 2026. The catalogue in `src/flight-lab/catalog.ts` now holds **two** wyvern specimens — `wyvern-v2-rig` (the runtime rig) and `wyvern-v1-rig` (its comparison reference). The two V2 *candidates* were byte-identical promoted aliases and were retired from the picker on 2026-10-22 so the lab only offers the assets under active work; their GLBs remain on disk for the provenance gate.

| Plan | Priority | Depends on | Deliverable |
| --- | --- | --- | --- |
| [01 Playback and state reliability](01-playback-and-state.md) | P0 | None | Trustworthy timeline, transitions, loading and controls |
| [02 Camera and inspection workspace](02-camera-and-workspace.md) | P1 | 01 state contract | Reliable framing and accessible inspection controls |
| [03 Capabilities and animation diagnostics](03-capabilities-and-diagnostics.md) | P1 | 01 | Explain supported actions and expose animation defects |
| [04 Reproducible comparison and reports](04-comparison-and-reports.md) | P2 | 02, 03 | Repeatable A/B inspection and shareable evidence |
| [05 Interactive flight testing](05-interactive-flight.md) | P2, later extension | 01–04 | Bounded flight course with measured telemetry |

## Shared implementation constraints

- Runtime (`src/flight-lab/runtime.ts`) owns Three.js objects, animation, rendering, and disposal. React (`src/app/flight-lab/FlightLabClient.tsx`) owns controls and discrete presentation state. Publish sampled telemetry outside the animation callback; do not call React setters from frame callbacks.
- Preserve cached model geometry and textures. Dispose only resources whose ownership belongs to this lab instance.
- For each implementation, run `pnpm tsc --noEmit`, `npm run test:fast`, `npm run assets:validate-wyvern`, and `npm run assets:audit-clips`. Remember the 8 GB RAM constraint on this machine: never run `next dev` + headless browser probes concurrently with `tsc` or test suites.
