#!/usr/bin/env python3
"""Cached /api/tools/status payload (subprocess version probes are slow).

Author: Damon Li
"""

from __future__ import annotations

import time
from typing import Any, Callable, Dict, List, Optional, Tuple

_CACHE_TTL_SECONDS = 45.0
_cache: Optional[Tuple[float, List[Dict[str, Any]]]] = None


def invalidate_tools_status_cache() -> None:
    global _cache
    _cache = None


def build_tools_status_sync(
    tool_status_fn: Callable[[str], Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Return tool env status rows; cache to avoid repeated subprocess --version calls."""
    global _cache
    now = time.monotonic()
    if _cache is not None and (now - _cache[0]) < _CACHE_TTL_SECONDS:
        return _cache[1]

    rows = [
        tool_status_fn("liteparse"),
        tool_status_fn("mineru"),
        tool_status_fn("libreoffice"),
        tool_status_fn("imagemagick"),
    ]
    _cache = (now, rows)
    return rows
