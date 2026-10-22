"""Authoring-source provenance: which pipeline stage each `.blend` actually represents.

The shipped GLB is **not** an export of any committed `.blend`. D2 (takeoff/death),
D3 (idle/walk/attack2), D4 (attack + flight-group retime) and C5 (skin-weight
rebalance) were applied at GLB level, so `models/source/wyvern-v2-master.blend`
still describes the C1 hierarchy while the shipped asset is post-C5. Exporting that
blend over `public/models/wyvern-v2-rig.glb` therefore *succeeds* and quietly reverts
four stages — a silent, plausible-looking regression.

This module makes the mismatch loud in two places:

  - `check_provenance()` verifies every stamp against the file on disk, so a stamp
    cannot rot: edit a `.blend` and its recorded sha256 stops matching, and the
    check fails until someone re-stamps it deliberately.
  - `export_refusal()` blocks `cmd_export` from writing the shipped asset out of a
    blend whose stamp is stale or below the shipped stage. Exports to any other
    path (a candidate, a scratch file) are never gated — that is the legitimate
    workflow.

Importable without Blender: stdlib only, no bpy.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from contract import RUNTIME_CONTRACT_PATH, sha256_file

REPO_ROOT = Path(__file__).resolve().parents[2]
PROVENANCE_PATH = REPO_ROOT / "models" / "source" / "blend-provenance.json"


def _resolve(root: Path, relative: str) -> Path:
    return (root / relative).resolve()


def load_provenance(path: str | Path = PROVENANCE_PATH) -> dict[str, Any]:
    manifest = json.loads(Path(path).read_text())
    if manifest.get("version") != 1:
        raise ValueError(f"unsupported provenance manifest version: {manifest.get('version')!r}")
    if not manifest.get("blends"):
        raise ValueError("provenance manifest lists no blends")
    return manifest


def _shipped_asset(manifest: dict[str, Any], root: Path) -> tuple[Path, str, str]:
    """Return (path, on-disk sha256, contract-pinned sha256)."""
    contract_path = _resolve(root, manifest["contract"])
    contract = json.loads(contract_path.read_text())
    asset = contract["asset"]
    path = _resolve(root, asset["path"])
    if not path.is_file():
        raise FileNotFoundError(f"shipped asset is missing: {asset['path']}")
    return path, sha256_file(path), asset["sha256"]


def check_provenance(path: str | Path = PROVENANCE_PATH, root: Path = REPO_ROOT) -> dict[str, Any]:
    """Verify the manifest against the files it describes. Never raises on mismatch."""
    manifest = load_provenance(path)
    errors: list[str] = []
    report: dict[str, Any] = {"passed": False, "shipped": None, "blends": [], "errors": errors}

    shipped_path, shipped_sha, pinned_sha = _shipped_asset(manifest, root)
    report["shipped"] = {
        "path": str(shipped_path.relative_to(root)),
        "sha256": shipped_sha,
        "pinnedSha256": pinned_sha,
        "bytes": shipped_path.stat().st_size,
    }
    if shipped_sha != pinned_sha:
        errors.append(
            f"{report['shipped']['path']} is {shipped_sha[:16]}… but the runtime contract pins "
            f"{pinned_sha[:16]}…; re-run assets:validate-wyvern or re-pin the contract"
        )

    shipped_stages = set(manifest.get("shippedStages", []))
    for entry in manifest["blends"]:
        blend_path = _resolve(root, entry["path"])
        status = "ok"
        if not blend_path.is_file():
            errors.append(f"{entry['path']} is listed in the provenance manifest but does not exist")
            status = "missing"
            actual_sha, actual_bytes = None, None
        else:
            actual_sha = sha256_file(blend_path)
            actual_bytes = blend_path.stat().st_size
            if actual_sha != entry.get("sha256"):
                status = "stale-stamp"
                errors.append(
                    f"{entry['path']} changed since it was stamped (stamp {str(entry.get('sha256'))[:16]}…, "
                    f"file {actual_sha[:16]}…); its stage is unknown until the manifest is re-stamped"
                )
            elif actual_bytes != entry.get("bytes"):
                status = "stale-stamp"
                errors.append(
                    f"{entry['path']} size {actual_bytes} does not match the stamped {entry.get('bytes')}"
                )

        missing = [stage for stage in entry.get("missingStages", []) if stage in shipped_stages]
        report["blends"].append({
            "path": entry["path"],
            "stage": entry.get("stage"),
            "sha256": actual_sha,
            "stampedSha256": entry.get("sha256"),
            "bytes": actual_bytes,
            "missingStages": missing,
            "exportSafe": status == "ok" and not missing,
            "status": status,
            "reason": entry.get("reason", ""),
        })

    report["passed"] = not errors
    return report


def export_refusal(
    blend_path: str | Path | None,
    out_path: str | Path,
    manifest_path: str | Path = PROVENANCE_PATH,
    root: Path = REPO_ROOT,
    force: bool = False,
) -> str | None:
    """Return a refusal reason when writing `out_path` from `blend_path` would lose work."""
    if force or blend_path is None:
        return None
    manifest = load_provenance(manifest_path)
    shipped_path, _, _ = _shipped_asset(manifest, root)
    if Path(out_path).resolve() != shipped_path:
        return None

    source = Path(blend_path).resolve()
    for entry in manifest["blends"]:
        if _resolve(root, entry["path"]) != source:
            continue
        if not source.is_file():
            return f"{entry['path']} does not exist"
        if sha256_file(source) != entry.get("sha256"):
            return (
                f"{entry['path']} changed since its provenance stamp, so its stage is unknown. "
                "Re-stamp models/source/blend-provenance.json before exporting over the shipped asset "
                "(or pass --force to accept the revert)."
            )
        missing = [stage for stage in entry.get("missingStages", []) if stage in set(manifest.get("shippedStages", []))]
        if missing:
            reason = entry.get("reason", "").strip()
            tail = "Export to a candidate path, or pass --force to accept the revert."
            return f"{entry['path']} is stamped {entry.get('stage')} and is missing {', '.join(missing)}. {reason} {tail}".strip()
        return None
    return None


def format_report(report: dict[str, Any]) -> str:
    lines = []
    shipped = report["shipped"]
    if shipped:
        lines.append(
            f"shipped  {shipped['path']}  {shipped['sha256'][:16]}…  {shipped['bytes']} B"
            + ("" if shipped["sha256"] == shipped["pinnedSha256"] else "  <- does not match the contract pin")
        )
    for blend in report["blends"]:
        lines.append(
            f"blend    {blend['path']}  stage {blend['stage']}  "
            f"{'export-safe' if blend['exportSafe'] else 'NOT export-safe'}  [{blend['status']}]"
        )
        if blend["missingStages"]:
            lines.append(f"         missing: {', '.join(blend['missingStages'])}")
    for error in report["errors"]:
        lines.append(f"error    {error}")
    lines.append("passed" if report["passed"] else "FAILED")
    return "\n".join(lines)
