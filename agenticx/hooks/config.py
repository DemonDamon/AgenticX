"""Hook configuration loading and eligibility checks.

Author: Damon Li
"""

from __future__ import annotations

import os
import platform
import shutil
from pathlib import Path
from typing import Any, Dict

import yaml  # type: ignore[import-untyped]


DEFAULT_HOOK_CONFIG_PATH = Path.home() / ".agenticx" / "hooks" / "config.yaml"


def load_hook_runtime_config(path: Path | None = None) -> Dict[str, Any]:
    """Load global hook runtime configuration."""

    cfg_path = path or DEFAULT_HOOK_CONFIG_PATH
    if not cfg_path.exists():
        return {"internal": {"enabled": True, "entries": {}}}
    with open(cfg_path, "r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}
    if not isinstance(payload, dict):
        return {"internal": {"enabled": True, "entries": {}}}
    payload.setdefault("internal", {})
    payload["internal"].setdefault("enabled", True)
    payload["internal"].setdefault("entries", {})
    return payload


def save_hook_runtime_config(config: Dict[str, Any], path: Path | None = None) -> Path:
    """Persist global hook runtime configuration."""

    cfg_path = path or DEFAULT_HOOK_CONFIG_PATH
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cfg_path, "w", encoding="utf-8") as handle:
        yaml.safe_dump(config, handle, sort_keys=False, allow_unicode=True)
    return cfg_path


def is_hook_enabled(config: Dict[str, Any], hook_name: str, default_enabled: bool = True) -> bool:
    internal = config.get("internal", {}) if isinstance(config, dict) else {}
    if not bool(internal.get("enabled", True)):
        return False
    entries = internal.get("entries", {})
    if not isinstance(entries, dict):
        return default_enabled
    item = entries.get(hook_name, {})
    if not isinstance(item, dict):
        return default_enabled
    return bool(item.get("enabled", default_enabled))


def check_requirements(requirements: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate runtime requirements and return missing details."""

    missing: Dict[str, Any] = {"bins": [], "env": [], "os": []}
    bins = requirements.get("bins", []) if isinstance(requirements, dict) else []
    envs = requirements.get("env", []) if isinstance(requirements, dict) else []
    oses = requirements.get("os", []) if isinstance(requirements, dict) else []

    for name in bins:
        if shutil.which(str(name)) is None:
            missing["bins"].append(str(name))
    for name in envs:
        if not os.environ.get(str(name)):
            missing["env"].append(str(name))
    if oses:
        current = platform.system().lower()
        normalized = [str(item).lower() for item in oses]
        if current not in normalized:
            missing["os"] = normalized
    return missing

