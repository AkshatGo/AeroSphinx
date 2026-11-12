"""Provenance records for reproducible runs.

Every experiment must save a manifest containing the Git SHA, environment
and package versions, input hashes, dataset counts and date range, feature
list, source availability rules, split boundaries, model configuration,
random seed, metrics and prediction artefact locations.

This module builds the subset of that manifest that applies to an
ingestion run. Later phases extend it.
"""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

__all__ = ["ProvenanceRecord", "build_provenance", "write_provenance", "git_state"]


@dataclass
class ProvenanceRecord:
    """Provenance for one ingestion or experiment run."""

    run_id: str
    generated_utc: str
    git: dict
    environment: dict
    inputs: dict
    dataset: dict
    rules: dict
    outputs: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return asdict(self)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_state(root: Path) -> dict:
    """Capture the Git SHA, branch and dirty state of the checkout."""

    def run(*args: str) -> str:
        result = subprocess.run(
            ["git", *args], cwd=root, capture_output=True, text=True
        )
        return result.stdout.strip()

    try:
        status = run("status", "--porcelain")
        return {
            "head_sha": run("rev-parse", "HEAD"),
            "branch": run("rev-parse", "--abbrev-ref", "HEAD"),
            "dirty": bool(status),
            "dirty_entries": len(status.splitlines()) if status else 0,
        }
    except FileNotFoundError:  # pragma: no cover
        return {"head_sha": None, "branch": None, "dirty": None}


def _package_versions() -> dict:
    versions = {}
    for name in (
        "numpy", "pandas", "scikit-learn", "xgboost", "joblib",
        "matplotlib", "h5py", "xarray", "netCDF4", "scipy", "PyYAML",
    ):
        try:
            from importlib.metadata import version

            versions[name] = version(name)
        except Exception:
            versions[name] = None
    return versions


def build_provenance(
    run_id: str,
    root: Path,
    inputs: dict,
    dataset: dict,
    rules: dict,
    outputs: dict | None = None,
) -> ProvenanceRecord:
    """Assemble a provenance record for an ingestion run."""
    root = Path(root)
    return ProvenanceRecord(
        run_id=run_id,
        generated_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        git=git_state(root),
        environment={
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "packages": _package_versions(),
        },
        inputs=inputs,
        dataset=dataset,
        rules=rules,
        outputs=outputs or {},
    )


def write_provenance(record: ProvenanceRecord, path: Path) -> Path:
    """Write a provenance record to JSON, creating parent directories."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record.as_dict(), indent=2) + "\n")
    return path
