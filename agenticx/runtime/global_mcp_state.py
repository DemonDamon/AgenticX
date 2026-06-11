#!/usr/bin/env python3
"""Persistent store for the last-connected MCP server names.

Written to ~/.agenticx/mcp_state.json so that Near can restore
connections across restarts without requiring the user to reconnect
manually every time.

Schema:
    {
        "last_connected": ["server-a", "server-b"],
        "quarantined": {"bad-server": 2},
        "updated_at": 1714982400.0
    }
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Dict, List

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


def read_quarantined() -> Dict[str, int]:
    """Return {server_name: consecutive_failure_count} from mcp_state.json."""
    path = _state_path()
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        q = raw.get("quarantined", {})
        if isinstance(q, dict):
            return {str(k): int(v) for k, v in q.items() if isinstance(k, str)}
    except Exception as exc:
        logger.warning("mcp_state.json quarantine read error (ignored): %s", exc)
    return {}


def _write_full_state(last_connected: List[str], quarantined: Dict[str, int]) -> None:
    path = _state_path()
    try:
        path.write_text(
            json.dumps(
                {
                    "last_connected": sorted(set(last_connected)),
                    "quarantined": {k: int(v) for k, v in quarantined.items() if int(v) > 0},
                    "updated_at": time.time(),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    except Exception as exc:
        logger.warning("mcp_state.json write error (ignored): %s", exc)


def write_last_connected(names: List[str]) -> None:
    """Persist connected server names, preserving the quarantine map."""
    _write_full_state(names, read_quarantined())


def record_restore_failure(name: str) -> int:
    """Increment consecutive failure count; return new count."""
    key = str(name or "").strip()
    if not key:
        return 0
    q = read_quarantined()
    q[key] = q.get(key, 0) + 1
    _write_full_state(read_last_connected(), q)
    return q[key]


def clear_quarantine(name: str) -> None:
    """Reset failure count for a server (call on successful manual/auto connect)."""
    key = str(name or "").strip()
    if not key:
        return
    q = read_quarantined()
    if key in q:
        del q[key]
        _write_full_state(read_last_connected(), q)


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
