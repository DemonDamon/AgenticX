#!/usr/bin/env python3
"""Cached /api/skills list payload builder (filesystem scan is expensive).

Author: Damon Li
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional, Tuple

_CACHE_TTL_SECONDS = 20.0
_cache: Optional[Tuple[float, Dict[str, Any]]] = None


def invalidate_skills_list_cache() -> None:
    """Drop cached list after install/refresh/settings change."""
    global _cache
    _cache = None


def build_skills_list_payload_sync() -> Dict[str, Any]:
    """Scan skill directories and return the /api/skills response body."""
    global _cache
    now = time.monotonic()
    if _cache is not None and (now - _cache[0]) < _CACHE_TTL_SECONDS:
        return _cache[1]

    try:
        from agenticx.tools.skill_bundle import (
            SkillBundleLoader,
            get_disabled_skill_names_set,
        )

        loader = SkillBundleLoader()
        skills = loader.scan()
        disabled_set = get_disabled_skill_names_set()
        items = [
            {
                "skill_id": f"{getattr(s, 'source', 'unknown')}:{s.name}",
                "name": s.name,
                "description": s.description,
                "location": s.location,
                "base_dir": str(s.base_dir),
                "source": s.source,
                "tag": getattr(s, "tag", None),
                "icon": getattr(s, "icon", None),
                "content_hash": getattr(s, "content_hash", ""),
                "globally_disabled": s.name in disabled_set,
                "conflict_count": len(loader.get_skill_variants(s.name)),
                "variants": [
                    {
                        "skill_id": f"{getattr(v, 'source', 'unknown')}:{v.name}",
                        "source": getattr(v, "source", "unknown"),
                        "base_dir": str(getattr(v, "base_dir", "")),
                        "location": getattr(v, "location", ""),
                        "content_hash": getattr(v, "content_hash", ""),
                    }
                    for v in loader.get_skill_variants(s.name)
                ],
            }
            for s in skills
        ]
        payload: Dict[str, Any] = {"ok": True, "items": items, "count": len(items)}
    except Exception as exc:
        payload = {"ok": False, "items": [], "count": 0, "error": str(exc)}

    _cache = (now, payload)
    return payload
