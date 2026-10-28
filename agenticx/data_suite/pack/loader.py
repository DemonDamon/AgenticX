from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from agenticx.data_suite.pack.manifest import LoadedPack, PackError, PackManifest

_SECTION_ATTRS = (
    "channels",
    "dictionary",
    "quality",
    "tags",
    "boards",
    "idmapping",
    "iam",
)


def _read_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _load_section(root: Path, rel: str | None) -> Any | None:
    if not rel:
        return None
    path = root / rel
    if path.is_file():
        return _read_yaml(path)
    if not path.is_dir():
        return None
    # Prefer a same-named yaml inside the directory, else merge *.yaml/*.yml/*.json
    preferred = [
        path / f"{path.name}.yaml",
        path / f"{path.name}.yml",
        path / "pack_section.yaml",
    ]
    for cand in preferred:
        if cand.is_file():
            return _read_yaml(cand)
    files = sorted(
        p
        for p in path.iterdir()
        if p.is_file() and p.suffix.lower() in {".yaml", ".yml", ".json"}
    )
    if not files:
        return {}
    if len(files) == 1:
        return _read_yaml(files[0])
    merged: dict[str, Any] = {}
    for f in files:
        merged[f.stem] = _read_yaml(f)
    return merged


def load_pack(root: Path | str) -> LoadedPack:
    root = Path(root)
    manifest_path = root / "pack.yaml"
    if not manifest_path.is_file():
        raise PackError(f"missing pack.yaml under {root}")
    raw = _read_yaml(manifest_path)
    if not isinstance(raw, dict):
        raise PackError("pack.yaml must be a mapping")
    manifest = PackManifest.from_mapping(raw)
    sections: dict[str, Any] = {}
    for attr in _SECTION_ATTRS:
        rel = getattr(manifest, attr)
        payload = _load_section(root, rel)
        if payload is not None:
            sections[attr] = payload
    return LoadedPack(root=root, manifest=manifest, sections=sections)
