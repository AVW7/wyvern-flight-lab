# Blender CLI

Run from the repository root with Python 3. By default the CLI connects to Blender's installed MCP addon on `127.0.0.1:9876`. Open Blender from Finder and start its MCP server first for this mode.

Native headless startup is verified outside the Codex sandbox on this Mac. Explicit `--headless` starts a separate process with factory settings and script auto-execution disabled, then exits after the command. In Codex, this mode requires an approved elevated execution. It is never a fallback when MCP fails. `BLENDER_PATH` is not required.

```sh
python3 scripts/blender/cli.py --headless status
python3 scripts/blender/cli.py --headless exec-script path/to/script.py
python3 scripts/blender/cli.py --headless --blend path/to/candidate.blend audit-scene
```

Use `--blender /absolute/path/to/Blender` to select another executable. The default is `/Applications/Blender.app/Contents/MacOS/Blender`. Only empty factory-startup and status have been verified natively; project loading, rendering, and long authoring jobs have not. A native process does not inherit the GUI's active scene. Headless changes persist only if the command or script explicitly saves or exports. Scripts are trusted executable code even though automatic embedded project scripts are disabled.

```sh
python3 scripts/blender/cli.py status
python3 scripts/blender/cli.py audit-scene
python3 scripts/blender/cli.py exec-script tools/blender/your_script.py
python3 scripts/blender/cli.py --timeout 60 exec-script tools/blender/your_script.py
python3 scripts/blender/cli.py audit-glb public/models/wyvern-v2-rig.glb
```

`audit-glb` runs locally without Blender. `status`, `audit-scene`, `organize`, `probe`, `export`, and `exec-script` run in the connected Blender session. Existing in-Blender command execution remains supported.

`exec-script` runs the supplied file as `__main__` with its real `__file__` path and prints its JSON-serializable `result` variable plus any script output. Scripts and CLI paths are resolved on this machine. The active scene is used; scripts may modify it. Save a separate candidate before authoring work. There is no automatic save or scene rollback.

Global options go before the command. `--port` and `--timeout` apply to MCP mode only. The default 30-second deadline matches the desktop tool execution timeout; raise it explicitly for longer work. A timeout does not cancel Blender's work. Inspect the session before retrying; the client never retries a command automatically. Missing servers, malformed or incomplete replies, and remote exceptions return a nonzero exit code.

The transport uses the installed addon's null-terminated JSON `execute` protocol with `strict_json: true`. Its 10 MiB request limit is mirrored by the client; responses are also bounded to 10 MiB to avoid unbounded buffering on this 8 GB machine.

Verification:

```sh
python3 -m unittest discover -s tools/blender/tests -v
```

See [the crash investigation log](../../docs/BLENDER_CRASH_LOG.md) for startup restrictions and measured recovery evidence.
