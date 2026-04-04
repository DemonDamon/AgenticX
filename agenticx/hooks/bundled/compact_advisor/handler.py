"""Compact advisor hook: suggest context compaction at logical intervals.

Author: Damon Li
"""

from __future__ import annotations

import logging

from agenticx.hooks.types import HookEvent

logger = logging.getLogger(__name__)

_call_counts: dict[str, int] = {}
_THRESHOLD = 30


async def handle(event: HookEvent) -> bool | None:
    if event.type != "tool" or event.action != "after_call":
        return True

    key = event.session_key or "default"
    _call_counts[key] = _call_counts.get(key, 0) + 1
    count = _call_counts[key]

    if count > 0 and count % _THRESHOLD == 0:
        logger.info(
            "[compact-advisor] Session %s reached %d tool calls — "
            "consider compacting context to preserve quality.",
            key,
            count,
        )
    return True
