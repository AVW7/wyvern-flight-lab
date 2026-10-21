# Flight Lab improvement plans

Focused rebuild plan: [10 V2 body motion and vertical camera follow](10-v2-body-motion-and-camera-plan.md), 13 September 2026. Start there for the reported wingbeat, membrane, legs, tail and vertical-follow issues, with retained user screenshots and implementation acceptance criteria. Plan 09 remains the broader lab roadmap.

Current plan: [09 Flight Lab improvement plan](09-flight-lab-improvement-plan.md), source-reviewed 13 September 2026. Start there for the current v2-only lab, playback reliability, diagnostic correctness, camera/workspace improvements and reproducible evidence. It sets the current lab implementation order; plan 08 retains animation qualification and promotion gates.

The roadmap below is historical context: proposed, not implemented as a whole. Source review: 5 September 2026. Its 16-specimen baseline no longer describes the current catalogue.

Improve `/flight-lab` as a dependable specimen and animation inspection workspace, then add a bounded flight testing mode. Preserve the existing monochrome light/dark presentation and keep the specimen visually dominant.

## Current baseline

The current source provides 16 curated specimens, six flight modes, clip selection, one-shot actions, pause, seek, frame stepping, looping, four camera presets, skeleton/wireframe/silhouette/streamline overlays, mesh metrics, search, and a bounded animation log. These are existing features to refine, not new deliverables.

Inspection covered `src/app/flight-lab/`, `src/flight-lab/`, and `test/flight-lab.test.js`. Findings below are source observations; rendered behavior, performance, and GLB animation quality have not been verified for these plans. Existing tests cover catalogue availability, clip resolution, and mesh metrics, but do not establish playback or browser correctness.

## Work order

| Plan | Priority | Depends on | Deliverable |
| --- | --- | --- | --- |
| [01 Playback and state reliability](01-playback-and-state.md) | P0 | None | Trustworthy timeline, transitions, loading and controls |
| [02 Camera and inspection workspace](02-camera-and-workspace.md) | P1 | 01 state contract | Reliable framing and accessible inspection controls |
| [03 Capabilities and animation diagnostics](03-capabilities-and-diagnostics.md) | P1 | 01 | Explain supported actions and expose animation defects |
| [04 Reproducible comparison and reports](04-comparison-and-reports.md) | P2 | 02, 03 | Repeatable A/B inspection and shareable evidence |
| [05 Interactive flight testing](05-interactive-flight.md) | P2, later extension | 01–04 | Bounded flight course with measured telemetry |

Start with 01. Deliver each plan separately; 05 is a larger proposed extension and is not a prerequisite for a useful lab.

## Shared implementation constraints

- Read relevant installed Next.js guides before changing route or React integration code.
- Follow `CONTEXT.md` and ADRs 0001–0004. Keep lab changes local; the Studio Engine snapshot seam remains unchanged.
- Runtime owns Three.js objects, animation, rendering and disposal. React owns controls and discrete presentation state. Publish sampled telemetry outside the animation callback; do not call React setters from frame callbacks.
- Keep any new `src/core/` helpers free of Three.js, React and browser globals. Asset metadata belongs to the existing Asset Registry; lab-only display settings can remain in the lab catalogue.
- Preserve cached model geometry and textures. Dispose only resources whose ownership belongs to this lab instance.
- Do not edit ported Sanctuary wyvern modules as a shortcut. Read the Sanctuary brief and porting rules before any later shared integration.
- The working tree already contains substantial in-progress changes, including the Flight Lab. Preserve them and scope implementation commits deliberately.

## Completion evidence

For each implementation, run `pnpm tsc --noEmit`, `pnpm lint`, and `pnpm test`, plus the plan-specific browser checks. Record failures and whether they predate the change. Capture representative screenshots and observed results on a persistent local server. A static test pass is not visual or gameplay proof.

Use young wyvern, Young Wyvern II, a large comparison specimen, a specimen with missing action clips, and a static egg as the minimum inspection matrix. Record browser, viewport, device, asset identity, and actual supported clips. Mark every plan complete only after its acceptance criteria have evidence.
