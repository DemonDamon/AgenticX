#!/usr/bin/env python3
"""Persistent store for the last-connected MCP server names.

Persisted via the session storage backend (``agenticx.studio.storage``):
the default local backend keeps the legacy ``~/.agenticx/mcp_state.json``
file byte-identical; the redis backend shares the state across replicas.
Near restores connections across restarts without requiring the user to
reconnect manually every time.

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

from agenticx.studio.storage.factory import get_storage_backend, get_sync_storage
from agenticx.studio.storage.local_file import LocalFileBackend

logger = logging.getLogger(__name__)

_DEFAULT_FILENAME = "mcp_state.json"


def _state_path() -> Path:
    """Local-mode file location; kept as the monkeypatchable extension point."""
    base = Path("~/.agenticx").expanduser()
    base.mkdir(parents=True, exist_ok=True)
    return base / _DEFAULT_FILENAME


def _load_state() -> Dict:
    """Load the raw state dict.

    Local mode reads through the legacy ``_state_path()`` resolver so tests
    and embedders redirecting the file keep working; other backends go
    through the storage facade.
    """
    if isinstance(get_storage_backend(), LocalFileBackend):
        path = _state_path()
        if not path.exists():
            return {}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            return raw if isinstance(raw, dict) else {}
        except Exception as exc:
            logger.warning("mcp_state.json read error (ignored): %s", exc)
            return {}
    return get_sync_storage().load_mcp_state()


def _save_state(state: Dict) -> None:
    if isinstance(get_storage_backend(), LocalFileBackend):
        path = _state_path()
        try:
            path.write_text(
                json.dumps(state, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except Exception as exc:
            logger.warning("mcp_state.json write error (ignored): %s", exc)
        return
    get_sync_storage().save_mcp_state(state)


def read_last_connected() -> List[str]:
    """Return the last-connected server names, or [] if the state is absent/corrupt."""
    raw = _load_state()
    names = raw.get("last_connected", [])
    if isinstance(names, list):
        return [str(n) for n in names if isinstance(n, str) and n.strip()]
    return []


def read_quarantined() -> Dict[str, int]:
    """Return {server_name: consecutive_failure_count} from the persisted state."""
    raw = _load_state()
    q = raw.get("quarantined", {})
    if isinstance(q, dict):
        try:
            return {str(k): int(v) for k, v in q.items() if isinstance(k, str)}
        except (TypeError, ValueError):
            return {}
    return {}


def _write_full_state(last_connected: List[str], quarantined: Dict[str, int]) -> None:
    _save_state(
        {
            "last_connected": sorted(set(last_connected)),
            "quarantined": {k: int(v) for k, v in quarantined.items() if int(v) > 0},
            "updated_at": time.time(),
        }
    )


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
