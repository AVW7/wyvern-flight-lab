# Flight Lab evidence inbox

Three files, overwritten on every press of **Export** or **Save for AI** in Flight Lab
(`/flight-lab`). They are written by the dev-only route `POST /api/flight-lab/report`
straight into the repo, so a coding agent can be pointed at a path instead of being
handed a download from `~/Downloads`:

> Fix the issue in `docs/flight-lab/inbox/latest-issue.md`.

| file | what it is |
| --- | --- |
| `latest-issue.md` | The ticket. Specimen, model file, clip, frame, pinned joints with their clip-vs-procedural split, the pose-envelope scan, repro steps, and any note typed in the pin banner. |
| `latest-capture.png` | The WebGL canvas at the moment of the press, exactly the frame the ticket describes. |
| `latest-capture.json` | Machine-readable sidecar: full landmark list, camera state, raw anomaly records, every pin. |

Notes for whoever (or whatever) reads this:

- These files are **generated** and git-ignored (`docs/flight-lab/inbox/latest-*`). Copy them
  if you need history; the next export overwrites all three.
- The route only exists under `next dev`. In a production build the UI falls back to a browser
  download and logs that it did.
- `Bind Delta` is the baked `.glb` track against the bind pose; `Procedural Delta` is what
  `src/flight-lab/rig/` added on top. A large bind delta with a small procedural delta is a
  defect in the authored track, not in the runtime rig — and `Procedural Delta` is exactly zero
  when the **Proc** toggle is off.
- Writes are atomic (temp file + rename), so reading while another export runs is safe.
