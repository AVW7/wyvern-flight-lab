# Blender crash investigation log (macOS)

**Status:** Native factory-startup verified outside the Codex sandbox. Sandboxed startup and long-session allocator corruption remain unresolved.
**Updated:** 2026-10-08
**Machine:** Mac15,3, Apple Silicon, macOS 26.6.2, 8 GB unified memory.

## CLI readiness

- Installed Blender 5.1.1 executable: `/Applications/Blender.app/Contents/MacOS/Blender`.
- Earlier sandboxed headless startup exited 139 (SIGSEGV) before Python ran. On 2026-10-08 the same installed executable successfully started with factory settings outside the sandbox, ran Python, and exited 0. See the native verification entry below.
- `BLENDER_PATH` remains unset. The explicit CLI `--headless` mode accepts `--blender` instead; the default is the installed executable above.
- MCP remains the default for interactive work. Native headless mode requires explicit authorization and approved execution outside the sandbox; project loading and rendering are not yet verified in that mode.

## Findings

### 1. Blender 5.1.1 startup crash in Metal capability detection

Two Codex-parented 5.1.1 reports, at 2026-10-07 17:30:38 and 19:46:38 +0200, have the same null-address `EXC_BAD_ACCESS` path:

`_platform_strstr` → `supports_barycentric_whitelist` → `MTLBackend::metal_is_supported` → `GPU_backend_type_selection_detect` → `WM_init`.

This is strong evidence that a missing Metal device reaches the vendor-name `strstr` check during startup. Blender `main` now checks whether `MTLCreateSystemDefaultDevice()` returned `nil` before using it; the inspected `blender-v5.2-release` branch does not. This explains the reproduced 5.1.1 Codex-launch startup crash. The source comparison does not prove that every later crash has this cause, nor that the 5.2.2 GUI crash below took this path. References: [guard on Blender main](https://github.com/blender/blender/blob/main/source/blender/gpu/metal/mtl_backend.mm#L2115-L2132), [5.2 release implementation](https://github.com/blender/blender/blob/blender-v5.2-release/source/blender/gpu/metal/mtl_backend.mm#L2040-L2105).

### 2. IlmThread wait-loop crashes

The supplied report is Blender 5.1.1 on 2026-10-08 08:43:55 +0200. It launched at 08:43:54, with `codex` as parent, and died with `SIGSEGV`. The faulting thread's top frames are `semaphore_wait_trap`, dispatch semaphore wait, and `IlmThread::DefaultThreadPoolProvider::threadLoop`. A waiting worker stack identifies where the thread was when the signal arrived; it does **not** establish that OpenEXR caused the crash.

Similar local reports are:

- `~/Library/Logs/DiagnosticReports/Blender-2026-10-08-084720.ips`: 5.1.1, Codex parent, same wait-loop stack.
- `~/Library/Logs/DiagnosticReports/Blender-2026-10-08-085057.ips`: 5.2.2, Codex parent, same wait-loop stack. This followed the 5.2.2 UI attempt to open the active V44 study.

The V44 study was last confirmed clean (`bpy.data.is_dirty == False`) through the existing Blender MCP session before the 5.2.2 attempt. No save was made by that attempt. A later MCP read timed out, so the current live session state has not been re-confirmed. Preserve the study and inspect session state before doing any further edits.

### 3. FCurve allocator corruption after a long session

`~/Library/Logs/DiagnosticReports/Blender-2026-10-07-200720.ips` records Blender 5.1.1 launched by `launchd` at 11:46:21 and aborting at 20:07:20 (+0200). `libsystem_malloc` reports `memory corruption of free block`; the stack detects it while `insert_bezt_fcurve` is called through `FCurveKeyframePoints.insert`.

This establishes where the allocator detected corrupted memory, not which earlier operation corrupted it. The report is not an out-of-memory termination and does not prove that the machine's 8 GB RAM caused it. Treat this as separate from both the Metal startup and IlmThread signatures.

## Safe workflow for future agents

1. **Do not launch Blender from Codex**, including factory-startup or background runs. Do not open a second Blender instance. This machine has 8 GB RAM, and the Codex-parented launch path has produced startup crashes. If a new process is required, have the user launch it from Finder after their work is saved, then connect to that already-open session.
2. **Check the active session first.** Use Blender MCP for a small read-only query only if it responds promptly. Confirm the active file, scene, `bpy.data.is_dirty`, and available memory before touching the project. If MCP is unresponsive, stop; do not relaunch Blender automatically.
3. **Protect the study.** Preserve `v44-bankRight-additive-target-80519-corrective.blend`. Before animation/FCurve experiments, create a separately named `.blend` candidate and keep the prior version intact. Save between bounded mutation batches, then verify curve/key counts and the candidate's dirty state.
4. **Keep the reproduction small.** Change one variable per attempt: Blender version, launch origin, startup vs file-open, add-ons, or one FCurve insertion batch. Do not run parallel Blender versions, long stress runs, renders, or a local Blender build on this 8 GB machine.
5. **Record system pressure as evidence.** At the time of a reproduction, capture Activity Monitor's memory-pressure colour, swap used, and Blender's memory reading. Do not infer RAM exhaustion from virtual address size or from the 8 GB hardware limit alone.
6. **Classify by the actual faulting stack.** Do not label every wait-loop crash “OpenEXR” or every allocator abort “FCurve bug.” Keep the full `.ips` report and distinguish the signal, faulting thread, launch parent, and last operation.

## Agent append template

Append one entry per observation. Do not replace earlier evidence.

```text
### YYYY-MM-DD HH:MM TZ — agent / session
- Blender app path, version, build:
- Launch origin and parent process:
- File copy, scene, action, last operation:
- Session duration and last save / dirty status:
- Activity Monitor pressure, swap, Blender memory:
- Crash report path, exception, faulting thread, first useful frames:
- Reproduced? What single variable changed?
- Outcome and next safe step:
```

## Next investigation

- Check whether the nil-Metal-device guard has reached a released macOS build before any later controlled startup check. Keep Blender launches out of Codex.
- The next controlled reproduction should be one Finder-launched clean startup with no project open. Only if that remains stable should an agent connect MCP and consider a copy of the study. Avoid retrying the same Codex launch, which has already produced repeated evidence.
- Investigate the FCurve report separately with a small copied study and short sessions. First determine whether one key insertion or only a larger batch precedes allocator corruption; preserve each candidate and stop at the first new crash.

### 2026-10-08T11:02:29.459794+02:00 — Codex / Finder recovery verification
- Reviewed the latest local reports through `Blender-2026-10-08-085057.ips`. These recent 5.1.1/5.2.2 Codex-parented processes terminated within approximately one second of launch. Their IlmThread wait stacks do not identify a confirmed crashing instruction; retain the separate signatures above.
- Initial MCP query could not connect. User opened Blender from Finder and started MCP; a read-only query then confirmed Blender 5.1.1, PID 5643, an unnamed clean startup scene with three objects. No agent-launched Blender process was used.
- Created `assets/harvest-candidates/2026-10-07/bank-corrective-study/v44-crash-recovery-check.blend` as a byte-identical copy of V44, then loaded only the copy in that existing session with `load_ui=False`. MCP remained responsive: 57 objects, 130 actions, `BankRight_FullIndependentActionProbe` with 8,249 vertices and 453 shape keys. Evaluated frame 81 and restored frame 80; dirty state remained false.
- Original and recovery copy SHA-256: `1b3a9d8b9ed728cd0475ffb99dfc6ae2fc7ea87c36b3b5dda7d51439d5424843`. Evidence: `crash-recovery-check.json` beside the copy. The original study and active runtime models were not edited.
- Removed the automatic Blender subprocess fallback from `tools/blender/author_v2_ground_wing_fold.py`. A mocked launch regression failed before the change and passed afterward without starting Blender. Direct Python execution now explains the MCP requirement and exits.
- Outcome: Finder/MCP startup and study loading are verified as a working recovery route. This does not fix Blender's native binary, establish the IlmThread crash cause, or clear the earlier allocator corruption. No dense FCurve edits or stress runs were attempted. Memory-pressure readings were unavailable.
- Validation: launch regression passed (failed against the previous automatic fallback); TypeScript and lint passed; wildlife simulation passed all 16 routines. The standard fast-test runner was blocked by sandbox `listen EPERM` in tsx before tests ran. Documentation check reports an already-dirty README metrics block out of date; it was not regenerated as part of this crash repair.

### 2026-10-08 — Codex / MCP-backed CLI implementation
- Implemented command-line execution through the existing Finder-launched session in `scripts/blender/cli.py` and `mcp_client.py`. No Blender subprocess is launched and `BLENDER_PATH` remains unused.
- Live CLI `status` and a read-only `exec-script` succeeded against Blender 5.1.1, the V44 recovery copy, frame 80, 453 corrective shape keys, and dirty state false. An intentional script exception returned exit code 1 and its error message. No model changes were made.
- Eight Python regression tests pass: fragmented protocol response, incomplete response rejection, remote exception, malformed JSON, missing server with no process fallback, timeout without retry, script exit propagation and argv restoration, and the prior ground-fold launch policy.
- Usage and limitations are documented in `scripts/blender/README.md`. This is a working command-line interface to the GUI session, not a claim that native headless startup is repaired.

### 2026-10-08 — Codex / native headless repair investigation
- User requested a native headless startup fix after the MCP-backed CLI implementation. Proposed one factory-startup, auto-execution-disabled headless check outside the sandbox, with no project loaded and immediate exit after a `bpy` status query.
- Automatic approval review rejected the launch before execution, citing AGENTS.md's launch prohibition and the risk from repeated native crashes. No new Blender process or crash was produced by this attempt. Explicit approval for that exact controlled check was requested; native execution remains pending.
- Rechecked upstream source: `main`'s `MTLBackend::metal_is_supported` checks the default Metal device for `nil` (comment references issue #163272); `blender-v5.2-release` still lacks that guard at the same call. This confirms the code-level difference for the prior Metal signature, not the cause of the separate IlmThread reports or a validated replacement binary. Sources: https://raw.githubusercontent.com/blender/blender/main/source/blender/gpu/metal/mtl_backend.mm and https://raw.githubusercontent.com/blender/blender/blender-v5.2-release/source/blender/gpu/metal/mtl_backend.mm.

### 2026-10-08 — Codex / native startup verified outside sandbox
- After the user reiterated the native fix request following the exact-test risk explanation, automatic approval allowed an elevated minimal launch of `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python-expr ...`.
- Output: `HEADLESS_STARTUP_OK 5.1.1 True`; build `b70da489d7f4`, built 2026-04-14 01:46:23; `Blender quit`; exit code 0. No project was loaded, rendered, or saved.
- Implemented opt-in `python3 scripts/blender/cli.py --headless status`. Live elevated validation also exited 0 and reported an unnamed factory scene, three objects, frame 1, dirty false. The command launches no MCP server and exits when finished. Native Python command failures are configured to exit nonzero with `--python-exit-code 1`.
- Added regression tests for explicit native flags, child exit-code propagation, and refusing `--blend` without `--headless`. The new-mode test failed before implementation; all ten Python tests now pass. MCP remains the default; there is no automatic switch to native execution.
- An additional live native intentional-exception test was rejected by automatic review because it considered the prior authorization limited to the startup test. It was not executed or bypassed; child exit propagation remains covered by the mocked regression test, not live native evidence.
- A subsequent MCP status check confirmed the original GUI session still responsive on the V44 recovery copy, frame 80, 57 objects, dirty false.
- Conclusion: approved execution outside the sandbox is a verified route for native empty-scene startup and CLI status on the installed 5.1.1 binary. This strongly supports launch-environment involvement, but does not patch the binary or establish the cause of every historical crash. No claim is made for sandboxed startup, project load/render, dense FCurve authoring, or long-session stability.
