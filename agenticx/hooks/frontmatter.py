"""Hook metadata parsing utilities.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml  # type: ignore[import-untyped]


@dataclass
class HookRequirements:
    bins: List[str] = field(default_factory=list)
    env: List[str] = field(default_factory=list)
    os: List[str] = field(default_factory=list)


@dataclass
class HookMetadata:
    name: str
    description: str = ""
    events: List[str] = field(default_factory=list)
    export: str = "handle"
    enabled: bool = True
    requires: HookRequirements = field(default_factory=HookRequirements)
    raw: Dict[str, Any] = field(default_factory=dict)


def parse_hook_metadata(hook_yaml_path: Path) -> HookMetadata:
    """Parse a HOOK.yaml metadata file."""

    payload = {}
    with open(hook_yaml_path, "r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}

    if not isinstance(payload, dict):
        raise ValueError(f"HOOK.yaml must be a mapping: {hook_yaml_path}")

    name = str(payload.get("name", hook_yaml_path.parent.name)).strip()
    description = str(payload.get("description", "")).strip()
    events = [str(item).strip() for item in payload.get("events", []) if str(item).strip()]
    export = str(payload.get("export", "handle")).strip() or "handle"
    enabled = bool(payload.get("enabled", True))

    requires_raw = payload.get("requires") or {}
    if not isinstance(requires_raw, dict):
        requires_raw = {}
    requires = HookRequirements(
        bins=[str(item).strip() for item in requires_raw.get("bins", []) if str(item).strip()],
        env=[str(item).strip() for item in requires_raw.get("env", []) if str(item).strip()],
        os=[str(item).strip() for item in requires_raw.get("os", []) if str(item).strip()],
    )

    return HookMetadata(
        name=name,
        description=description,
        events=events,
        export=export,
        enabled=enabled,
        requires=requires,
        raw=payload,
    )

