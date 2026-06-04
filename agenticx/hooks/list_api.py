#!/usr/bin/env python3
"""Synchronous hooks list payload builder for /api/hooks (runs in a worker thread).

Author: Damon Li
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_HOOKS_LIST_CACHE_TTL_SECONDS = 20.0
_hooks_list_cache: Optional[Tuple[float, Dict[str, Any]]] = None


def invalidate_hooks_list_cache() -> None:
    global _hooks_list_cache
    _hooks_list_cache = None

from agenticx.hooks.loader import (
    build_hook_search_paths,
    deduplicate_hooks,
    discover_declarative_hooks,
    get_hook_settings_from_config,
)


def build_hooks_list_payload() -> Dict[str, Any]:
    """Scan bundled + declarative hook paths and return the /api/hooks response body."""
    global _hooks_list_cache
    now = time.monotonic()
    if _hooks_list_cache is not None and (now - _hooks_list_cache[0]) < _HOOKS_LIST_CACHE_TTL_SECONDS:
        return _hooks_list_cache[1]

    try:
        settings = get_hook_settings_from_config()
        disabled_set = set(
            str(item).strip()
            for item in (settings.get("disabled") or [])
            if str(item).strip()
        )

        bundled_dir = Path(__file__).resolve().parent / "bundled"
        curated_hooks: List[dict] = []
        if bundled_dir.exists():
            for child in sorted(bundled_dir.iterdir()):
                yaml_path = child / "HOOK.yaml"
                if not yaml_path.exists():
                    continue
                try:
                    import yaml as _yaml

                    with open(yaml_path, "r", encoding="utf-8") as _f:
                        meta = _yaml.safe_load(_f) or {}
                except Exception:
                    meta = {}
                hook_name = meta.get("name", child.name)
                curated_hooks.append(
                    {
                        "name": hook_name,
                        "description": meta.get("description", ""),
                        "events": meta.get("events", []),
                        "enabled": hook_name not in disabled_set,
                        "source": "bundled",
                    }
                )

        raw_configs = discover_declarative_hooks(
            workspace_dir=None,
            preset_settings=settings.get("preset_paths"),
            custom_paths=settings.get("custom_paths"),
            declarative_entries=settings.get("declarative"),
        )
        imported_hooks = deduplicate_hooks(raw_configs)
        for item in imported_hooks:
            item["enabled"] = item["name"] not in disabled_set

        scan_paths = build_hook_search_paths(
            workspace_dir=None,
            preset_settings=settings.get("preset_paths"),
            custom_paths=settings.get("custom_paths"),
        )
        scan_path_items = [
            {
                "source": source,
                "path": str(path.expanduser()),
                "exists": bool(path.expanduser().exists()),
            }
            for source, path in scan_paths
        ]
        source_counts = dict(Counter(c.source for c in raw_configs))
        payload: Dict[str, Any] = {
            "ok": True,
            "curated_hooks": curated_hooks,
            "imported_hooks": imported_hooks,
            "scan_summary": {
                "raw_total": len(raw_configs),
                "deduped_total": len(imported_hooks),
                "source_counts": source_counts,
            },
            "scan_paths": scan_path_items,
        }
    except Exception as exc:
        logger.warning("build_hooks_list_payload error: %s", exc)
        payload = {
            "ok": False,
            "curated_hooks": [],
            "imported_hooks": [],
            "scan_summary": {"raw_total": 0, "deduped_total": 0, "source_counts": {}},
            "scan_paths": [],
            "error": str(exc),
        }

    _hooks_list_cache = (now, payload)
    return payload
