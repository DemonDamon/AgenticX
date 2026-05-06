#!/usr/bin/env python3
"""Persistent store for the last-connected MCP server names.

Written to ~/.agenticx/mcp_state.json so that Machi can restore
connections across restarts without requiring the user to reconnect
manually every time.

Schema:
    {
        "last_connected": ["server-a", "server-b"],
        "updated_at": 1714982400.0
    }
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)

_DEFAULT_FILENAME = "mcp_state.json"


def _state_path() -> Path:
    base = Path("~/.agenticx").expanduser()
    base.mkdir(parents=True, exist_ok=True)
    return base / _DEFAULT_FILENAME


def read_last_connected() -> List[str]:
    """Return the last-connected server names, or [] if the file is absent/corrupt."""
    path = _state_path()
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        names = raw.get("last_connected", [])
        if isinstance(names, list):
            return [str(n) for n in names if isinstance(n, str) and n.strip()]
        return []
    except Exception as exc:
        logger.warning("mcp_state.json read error (ignored): %s", exc)
        return []


def write_last_connected(names: List[str]) -> None:
    """Persist the current set of connected server names."""
    path = _state_path()
    try:
        path.write_text(
            json.dumps(
                {"last_connected": sorted(set(names)), "updated_at": time.time()},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    except Exception as exc:
        logger.warning("mcp_state.json write error (ignored): %s", exc)


def add_to_last_connected(name: str) -> None:
    """Add *name* to the persisted list (idempotent)."""
    current = read_last_connected()
    key = str(name or "").strip()
    if not key or key in current:
        return
    write_last_connected(current + [key])


def remove_from_last_connected(name: str) -> None:
    """Remove *name* from the persisted list (no-op if absent)."""
    key = str(name or "").strip()
    if not key:
        return
    current = read_last_connected()
    updated = [n for n in current if n != key]
    if len(updated) != len(current):
        write_last_connected(updated)
