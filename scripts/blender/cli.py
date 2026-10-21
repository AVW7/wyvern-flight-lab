"""CLI for asset verification and an already-running Blender MCP session.

Usage:
  python3 scripts/blender/cli.py status
  python3 scripts/blender/cli.py audit-scene
  python3 scripts/blender/cli.py exec-script <script.py>

Subcommands:
  audit-glb       Verify an exported GLB against the machine-readable rig contract.
  audit-scene     Verify the open Blender file hierarchy, bones, and actions.
  organize        Organize objects into standard role collections (00 Rig, 10 Geometry, etc.).
  probe           Run live mesh-evaluated axis displacement probe on specific bones.
  export          Sanitize materials and export to game-ready GLB.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Add scripts/blender to sys.path if not present
BLENDER_PKG_DIR = Path(__file__).resolve().parent
if str(BLENDER_PKG_DIR) not in sys.path:
    sys.path.insert(0, str(BLENDER_PKG_DIR))

from contract import CONTRACT_PATH, load_contract, resolve_contract_for_glb


def _ensure_bpy():
    try:
        import bpy
        return bpy
    except ImportError:
        print("Error: This command requires Blender MCP. Open Blender from Finder and start its MCP server.", file=sys.stderr)
        sys.exit(1)


def cmd_audit_glb(args: argparse.Namespace) -> int:
    from audit_glb import audit
    target = Path(args.glb).resolve()
    manifest_path = resolve_contract_for_glb(target, args.manifest)
    contract = load_contract(manifest_path)
    report = audit(target, contract)
    out_json = json.dumps(report, indent=2, sort_keys=True)
    if args.json_out:
        Path(args.json_out).write_text(out_json + "\n")
    else:
        print(out_json)
    return 0 if report.get("passed", False) else 1


def cmd_audit_scene(args: argparse.Namespace) -> int:
    bpy = _ensure_bpy()
    from audit_scene import build_report
    contract = load_contract(args.manifest)
    source_glb = Path(args.source_glb).resolve() if args.source_glb else None
    report = build_report(bpy, contract, source_glb)
    out_json = json.dumps(report, indent=2, sort_keys=True)
    if args.json_out:
        Path(args.json_out).write_text(out_json + "\n")
    else:
        print(out_json)
    return 1 if report.get("errors") else 0


def cmd_organize(args: argparse.Namespace) -> int:
    bpy = _ensure_bpy()
    from organize_review_scene import organize_scene
    contract = load_contract(args.manifest)
    scene = bpy.context.scene
    result = organize_scene(scene, bpy, contract)
    if args.out:
        out_path = Path(args.out).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(out_path))
        result["saved_copy"] = str(out_path)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    bpy = _ensure_bpy()
    from core.context import get_armature_and_mesh
    from rigging.probe import probe_bone_axes

    armature, mesh = get_armature_and_mesh(bpy, args.armature)
    bones = args.bones if args.bones else [
        f"{side}_Wing{part}"
        for side in ("L", "R")
        for part in ("Wrist", "D0P0", "D1P0", "D2P0", "Panel0_0", "Panel1_0")
    ]

    report = probe_bone_axes(
        bpy=bpy,
        armature=armature,
        mesh=mesh,
        bone_names=bones,
        action_name=args.action,
        frame=args.frame,
        nudge_radians=args.nudge,
    )

    out_json = json.dumps(report, indent=2, sort_keys=True)
    if args.json_out:
        Path(args.json_out).write_text(out_json + "\n")
    else:
        print(out_json)
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    bpy = _ensure_bpy()
    from export.gltf import export_wyvern_glb
    out_path = Path(args.out).resolve()
    export_wyvern_glb(bpy, out_path, export_objects=args.objects)
    print(f"Successfully exported GLB to: {out_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cli.py",
        description="Asset verification and commands through an existing Blender MCP session",
    )
    parser.add_argument('--port', type=int, default=9876, help='Local MCP port')
    parser.add_argument('--timeout', type=float, default=30.0, help='Response deadline in seconds (default matches tool execution timeout)')
    parser.add_argument('--headless', action='store_true', help='Explicitly launch native Blender; on this Mac run outside the Codex sandbox')
    parser.add_argument('--blender', type=Path, default=Path('/Applications/Blender.app/Contents/MacOS/Blender'), help='Native Blender executable')
    parser.add_argument('--blend', type=Path, help='Project to load in explicit headless mode')
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    p_status = subparsers.add_parser('status', help='Inspect the connected Blender session')
    p_status.set_defaults(func=cmd_status)
    p_script = subparsers.add_parser('exec-script', help='Execute a Python file in the connected Blender; edits affect its active scene')
    p_script.add_argument('script', type=Path)
    p_script.set_defaults(func=cmd_script)

    # audit-glb
    p_aglb = subparsers.add_parser("audit-glb", help="Verify GLB against rig contract")
    p_aglb.add_argument("glb", type=Path, help="Path to glTF / GLB file")
    p_aglb.add_argument("--manifest", type=Path, default=CONTRACT_PATH, help="Path to rig contract JSON")
    p_aglb.add_argument("--json-out", type=Path, help="Write output to JSON file")
    p_aglb.set_defaults(func=cmd_audit_glb)

    # audit-scene
    p_ascene = subparsers.add_parser("audit-scene", help="Verify open scene against rig contract")
    p_ascene.add_argument("--manifest", type=Path, default=CONTRACT_PATH, help="Path to rig contract JSON")
    p_ascene.add_argument("--source-glb", type=Path, help="Optional source asset to hash-check")
    p_ascene.add_argument("--json-out", type=Path, help="Write output to JSON file")
    p_ascene.set_defaults(func=cmd_audit_scene)

    # organize
    p_org = subparsers.add_parser("organize", help="Organize scene into role collections")
    p_org.add_argument("--manifest", type=Path, default=CONTRACT_PATH, help="Path to rig contract JSON")
    p_org.add_argument("--out", type=Path, help="Target new .blend path")
    p_org.set_defaults(func=cmd_organize)

    # probe
    p_probe = subparsers.add_parser("probe", help="Probe bone axis displacement on evaluated mesh")
    p_probe.add_argument("--armature", default="WyvernRig", help="Name of armature object")
    p_probe.add_argument("--action", default=None, help="Action name to evaluate")
    p_probe.add_argument("--frame", type=int, default=0, help="Frame number to evaluate")
    p_probe.add_argument("--nudge", type=float, default=0.1, help="Nudge angle in radians")
    p_probe.add_argument("--bones", nargs="*", help="List of bone names to probe")
    p_probe.add_argument("--json-out", type=Path, help="Write output to JSON file")
    p_probe.set_defaults(func=cmd_probe)

    # export
    p_exp = subparsers.add_parser("export", help="Export scene to GLB")
    p_exp.add_argument("--out", required=True, type=Path, help="Output .glb filepath")
    p_exp.add_argument("--objects", nargs="+", default=None, help="Objects to include (default: auto-detect V2 two-mesh or legacy single-mesh layout)")
    p_exp.set_defaults(func=cmd_export)

    # control-rig
    p_ctrl = subparsers.add_parser("control-rig", help="Build or bake the 10 Controls layer on WyvernRig")
    p_ctrl.add_argument("--armature", default="WyvernRig", help="Name of armature object")
    p_ctrl.add_argument("--contact-plane-z", type=float, default=None, help="Override canonical ground contact Z")
    p_ctrl.add_argument("--bake", action="store_true", help="Bake control rig onto 92 deform bones and strip controls")
    p_ctrl.add_argument("--json-out", type=Path, help="Write output to JSON file")
    p_ctrl.set_defaults(func=cmd_control_rig)

    return parser


def cmd_control_rig(args: argparse.Namespace) -> int:
    bpy = _ensure_bpy()
    from core.context import get_armature_and_mesh
    from rigging.control_rig import bake_control_rig_to_deform, build_control_rig

    armature, _mesh = get_armature_and_mesh(bpy, args.armature)
    if args.bake:
        report = bake_control_rig_to_deform(bpy, armature, strip_controls=True)
    else:
        report = build_control_rig(bpy, armature, contact_plane_z=args.contact_plane_z)
    out_json = json.dumps(report, indent=2, sort_keys=True)
    if args.json_out:
        Path(args.json_out).write_text(out_json + "\n")
    else:
        print(out_json)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    bpy = _ensure_bpy()
    print(json.dumps({'version': bpy.app.version_string, 'file': bpy.data.filepath,
                      'dirty': bpy.data.is_dirty, 'scene': bpy.context.scene.name,
                      'frame': bpy.context.scene.frame_current, 'objects': len(bpy.data.objects)}, indent=2))
    return 0


def cmd_script(args: argparse.Namespace) -> int:
    _ensure_bpy()
    import runpy
    result = runpy.run_path(str(args.script.resolve()), run_name='__main__').get('result', {})
    print(json.dumps(result, indent=2))
    return 0


def command_arguments(args: argparse.Namespace) -> list[str]:
    forwarded = []
    for key, value in vars(args).items():
        if key in ('func', 'port', 'timeout', 'subcommand', 'headless', 'blender', 'blend') or value is None:
            continue
        if key in ('script', 'glb'):
            forwarded.append(str(value.resolve()) if isinstance(value, Path) else str(value))
            continue
        forwarded.append('--' + key.replace('_', '-'))
        if isinstance(value, list):
            forwarded.extend(str(v) for v in value)
        else:
            forwarded.append(str(value.resolve()) if isinstance(value, Path) else str(value))
    return [args.subcommand, *forwarded]


def run_headless(args: argparse.Namespace) -> int:
    import subprocess
    command = [str(args.blender.resolve()), '--background', '--factory-startup', '--disable-autoexec']
    if args.blend:
        project = args.blend.resolve()
        if not project.is_file():
            raise RuntimeError(f'Blender project does not exist: {project}')
        command.append(str(project))
    command.extend(['--python-exit-code', '1', '--python', str(Path(__file__).resolve()), '--', *command_arguments(args)])
    return subprocess.run(command).returncode


def run_remote(args: argparse.Namespace) -> int:
    from mcp_client import execute
    import textwrap
    code = textwrap.dedent(f'''
        import contextlib, io, runpy, sys
        _cli_stdout, _cli_stderr = io.StringIO(), io.StringIO()
        _cli_argv = sys.argv
        try:
            sys.argv = {[str(Path(__file__).resolve()), *command_arguments(args)]!r}
            with contextlib.redirect_stdout(_cli_stdout), contextlib.redirect_stderr(_cli_stderr):
                try:
                    runpy.run_path({str(Path(__file__).resolve())!r}, run_name='__main__')
                    _cli_exit = 0
                except SystemExit as _exit:
                    _cli_exit = _exit.code if isinstance(_exit.code, int) else (0 if _exit.code is None else 1)
                    if isinstance(_exit.code, str):
                        print(_exit.code, file=sys.stderr)
            result = {{'exit_code': _cli_exit, 'stdout': _cli_stdout.getvalue(), 'stderr': _cli_stderr.getvalue()}}
        finally:
            sys.argv = _cli_argv
    ''')
    result = execute(code, port=args.port, timeout=args.timeout)
    print(result['stdout'], end='')
    print(result['stderr'], end='', file=sys.stderr)
    return int(result['exit_code'])


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.blend and not args.headless:
        parser.error('--blend requires --headless; MCP commands use the already-open scene')
    try:
        if args.headless:
            return run_headless(args)
        if args.subcommand != 'audit-glb':
            try:
                import bpy
            except ImportError:
                return run_remote(args)
        return args.func(args)
    except (RuntimeError, OSError, ValueError) as exc:
        print(f'Error: {exc}', file=sys.stderr)
        return 1


if __name__ == "__main__":
    exit_code = main()
    try:
        import bpy
    except ImportError:
        raise SystemExit(exit_code)
    if exit_code:
        raise RuntimeError(f'Blender CLI command failed with exit code {exit_code}')
