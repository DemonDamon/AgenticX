"""Resolve the AgenticX on-disk data root (``~/.agenticx`` by default).

Resolution order (first match wins):

1. Environment: ``AGX_HOME`` or ``AGENTICX_HOME`` (non-empty, expanded).
2. Desktop / settings bootstrap: ``~/.agenticx/data_root.json`` ``data_dir`` field,
   or ``near.data_dir`` / ``agenticx_home_dir`` in ``~/.agenticx/config.yaml`` when
   no env override is set (bootstrap reads only the default stub tree under
   ``Path.home() / ".agenticx"``).
3. Default: ``Path.home() / ".agenticx"``.

Changing the data directory in Near Desktop writes the bootstrap pointer and takes
effect after an application restart; there is no silent migration of existing data.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_BOOTSTRAP_DIR_NAME = ".agenticx"
_DATA_ROOT_POINTER_NAME = "data_root.json"
_LEGACY_CONFIG_NAME = "config.yaml"


def default_agenticx_home() -> Path:
    """Canonical default when no env or bootstrap override applies."""
    return Path.home() / _BOOTSTRAP_DIR_NAME


def bootstrap_agenticx_dir() -> Path:
    """Fixed stub directory under the user profile (holds bootstrap pointer only)."""
    return default_agenticx_home()


def data_root_pointer_path() -> Path:
    return bootstrap_agenticx_dir() / _DATA_ROOT_POINTER_NAME


def _normalize_home_path(raw: str) -> Path | None:
    text = str(raw or "").strip()
    if not text or text.lower() in {"none", "null", "~", "~/.agenticx"}:
        return None
    try:
        return Path(text).expanduser().resolve(strict=False)
    except (OSError, ValueError):
        return None


def _env_agx_home() -> Path | None:
    for key in ("AGX_HOME", "AGENTICX_HOME"):
        val = os.environ.get(key, "").strip()
        if not val:
            continue
        resolved = _normalize_home_path(val)
        if resolved is not None:
            return resolved
    return None


def _read_pointer_data_dir() -> Path | None:
    pointer = data_root_pointer_path()
    if not pointer.is_file():
        return None
    try:
        payload = json.loads(pointer.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    raw = payload.get("data_dir") or payload.get("agenticx_home_dir")
    if raw is None:
        return None
    return _normalize_home_path(str(raw))


def _read_bootstrap_yaml_data_dir() -> Path | None:
    cfg_path = bootstrap_agenticx_dir() / _LEGACY_CONFIG_NAME
    if not cfg_path.is_file():
        return None
    try:
        import yaml

        loaded = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
    except Exception:
        return None
    if not isinstance(loaded, dict):
        return None
    near = loaded.get("near")
    if isinstance(near, dict):
        raw = near.get("data_dir") or near.get("agenticx_home_dir")
        if raw is not None:
            resolved = _normalize_home_path(str(raw))
            if resolved is not None:
                return resolved
    for key in ("agenticx_home_dir", "data_dir"):
        raw = loaded.get(key)
        if raw is not None:
            resolved = _normalize_home_path(str(raw))
            if resolved is not None:
                return resolved
    return None


def resolve_agx_home() -> Path:
    """Resolve the active data root using env → bootstrap settings → default."""
    env_home = _env_agx_home()
    if env_home is not None:
        return env_home
    pointer = _read_pointer_data_dir()
    if pointer is not None:
        return pointer
    yaml_home = _read_bootstrap_yaml_data_dir()
    if yaml_home is not None:
        return yaml_home
    return default_agenticx_home()


def agx_home() -> Path:
    """Active AgenticX data root (lazy, call-time resolution)."""
    return resolve_agx_home()


def lazy_home_path(module_name: str, attr: str, *parts: str) -> Path:
    """Resolve ``<agx_home()>/<parts>`` with optional module attribute override."""
    override = sys.modules[module_name].__dict__.get(attr)
    if override is not None:
        return Path(override)
    return agx_home().joinpath(*parts)


def write_data_root_pointer(data_dir: Path | str) -> Path:
    """Persist bootstrap pointer under ``~/.agenticx/data_root.json`` (0600 best-effort)."""
    target = _normalize_home_path(str(data_dir))
    if target is None:
        raise ValueError("data_dir must be a non-empty absolute or ~ path")
    stub = bootstrap_agenticx_dir()
    stub.mkdir(parents=True, exist_ok=True)
    pointer = data_root_pointer_path()
    payload = {"data_dir": str(target)}
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    pointer.write_text(text, encoding="utf-8")
    try:
        pointer.chmod(0o600)
    except OSError:
        pass
    return pointer


def clear_data_root_pointer() -> None:
    """Remove bootstrap pointer so resolution falls back to default ``~/.agenticx``."""
    try:
        data_root_pointer_path().unlink(missing_ok=True)
    except OSError:
        pass
