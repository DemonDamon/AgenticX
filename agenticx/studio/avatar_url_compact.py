#!/usr/bin/env python3
"""Compact avatar URLs before persisting chat history rows.

Inline data URLs must not be baked into every message — they bloat
messages.json and the Desktop message list. Registry portraits are
resolved live at display time.

Author: Damon Li
"""

from __future__ import annotations

_MAX_STORED_AVATAR_URL_LEN = 2048


def compact_stored_avatar_url(url: str) -> str:
    """Drop data: and overlong avatar URLs; keep short http(s)/path refs."""
    raw = str(url or "").strip()
    if not raw:
        return ""
    if raw.startswith("data:"):
        return ""
    if len(raw) > _MAX_STORED_AVATAR_URL_LEN:
        return ""
    return raw
