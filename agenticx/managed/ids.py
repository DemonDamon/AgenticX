#!/usr/bin/env python3
"""ULID and UTC timestamp helpers for Managed Agents.

Author: Damon Li
"""

from __future__ import annotations

import re
import secrets
import time
from datetime import datetime, timezone

CROCKFORD32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def new_ulid(now_ms: int | None = None) -> str:
    """48-bit big-endian millisecond timestamp + 80 random bits, Crockford base32, 26 chars."""
    ts = int(time.time() * 1000) if now_ms is None else int(now_ms)
    value = (ts << 80) | secrets.randbits(80)
    chars: list[str] = []
    for _ in range(26):
        chars.append(CROCKFORD32[value & 31])
        value >>= 5
    return "".join(reversed(chars))


def is_ulid(value: object) -> bool:
    """Return True when value is a 26-character Crockford ULID."""
    return isinstance(value, str) and ULID_RE.fullmatch(value) is not None


def utc_now_iso(now: datetime | None = None) -> str:
    """UTC ISO-8601 with millisecond precision and 'Z', e.g. 2026-10-25T06:00:00.123Z.

    Fixed width so lexicographic order equals time order.
    """
    dt = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse_iso(value: str) -> datetime:
    """Inverse of utc_now_iso (accepts the trailing 'Z')."""
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


__all__ = [
    "CROCKFORD32",
    "ULID_RE",
    "new_ulid",
    "is_ulid",
    "utc_now_iso",
    "parse_iso",
]
