# 05. Interactive flight testing

Status: proposed later extension. Priority: P2. Depends on: 01–04.

## Outcome and boundary

Add an explicit flight testing mode alongside the existing stationary inspection mode. Use a small repeatable obstacle course to evaluate takeoff, sustained flight, banking, boost, descent and landing. Keep entry into flight testing deliberate so inspection controls remain predictable.

This is a larger optional product extension. The current lab previews clips and procedural poses; its preset telemetry does not establish flight physics. Confirm the current gameplay controller contract during implementation before promising parity.

## Implementation checklist

- [ ] Inspect `src/game/player.ts`, `src/game/session.ts`, `src/game/wyvernRig.ts`, and the camera integration. Identify which motion/animation contracts can be reused without importing the full game session into the lab.
- [ ] Write a focused ADR if sharing flight policy requires a new module boundary. Pure motion policy can live in core; Three.js animation and rendering stay in adapters. Preserve ported Sanctuary code.
- [ ] Add a deterministic course with open cruising space, turn gates, a climb/descent section and a landing surface. Include a reset position and safe boundary recovery.
- [ ] Define grounded, takeoff, airborne, landing and reset transitions. State handling owns animation selection; unsupported clips retain the capability warnings from 03.
- [ ] Use the current gameplay input contract where applicable and show the actual bindings. Handle blur, pointer-lock exit and mode switching by clearing held inputs.
- [ ] Measure velocity, height above the course surface, bank, acceleration and elapsed course time from simulation state. Use a fixed simulation step or bounded substeps and test frame-rate independence.
- [ ] Provide a readable third-person chase view and an inspection view. Evaluate camera collision and full-body framing during tight banks, climbs and landing.
- [ ] Add bounded input recording and replay with course seed, controller version, asset revision and simulation settings. Export through 04's report format.

## Acceptance and verification

- Complete takeoff, sustained cruise, both banks, boost, descent, landing and reset with no stuck input or invalid state transition.
- Validate boundary recovery, missed landing, pause/resume, tab blur and exit back to inspection.
- A fixed input sequence at simulated 30/60/120 Hz render schedules produces equivalent fixed-step results within an explicitly chosen position tolerance.
- Telemetry follows actual motion and surface height; collision and landing behavior have browser evidence.
- If gameplay parity is claimed, repeat the relevant flight and camera sequence in Play and record differences. Lab success alone is insufficient.

Out of scope: open-world traversal, combat balance, quests, progression and a replacement physics engine.
