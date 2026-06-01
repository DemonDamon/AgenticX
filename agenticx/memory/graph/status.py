#!/usr/bin/env python3
"""Persist ingest queue status for memory graph.

Author: Damon Li
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from agenticx.memory.graph.config import DEFAULT_STATUS_PATH, MemoryGraphConfig, load_memory_graph_config

# 可重入锁：write() 内部会再次进入 read() 的临界区，普通 Lock 会自死锁并冻结事件循环
_lock = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_state() -> Dict[str, Any]:
    return {
        "pending_jobs": 0,
        "last_success_at": None,
        "last_error": None,
        "last_error_at": None,
        "node_count": 0,
        "edge_count": 0,
        "completed_jobs": 0,
    }


class MemoryGraphStatusStore:
    """JSON status file at ~/.agenticx/memory/graph_ingest.json."""

    def __init__(self, path: Optional[Path] = None) -> None:
        cfg = load_memory_graph_config()
        self.path = Path(path or cfg.status_path or DEFAULT_STATUS_PATH).expanduser()

    def _read_unlocked(self) -> Dict[str, Any]:
        if not self.path.exists():
            return _default_state()
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return _default_state()
        if not isinstance(raw, dict):
            return _default_state()
        state = _default_state()
        state.update(raw)
        return state

    def _write_unlocked(self, state: Dict[str, Any]) -> Dict[str, Any]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        return state

    def read(self) -> Dict[str, Any]:
        with _lock:
            return self._read_unlocked()

    def write(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        with _lock:
            state = self._read_unlocked()
            state.update(patch)
            return self._write_unlocked(state)

    def increment_pending(self, delta: int = 1) -> None:
        with _lock:
            state = self._read_unlocked()
            state["pending_jobs"] = max(0, int(state.get("pending_jobs", 0)) + delta)
            self._write_unlocked(state)

    def record_success(self, *, node_count: int = 0, edge_count: int = 0) -> None:
        with _lock:
            state = self._read_unlocked()
            state.update(
                {
                    "pending_jobs": max(0, int(state.get("pending_jobs", 0)) - 1),
                    "last_success_at": _now_iso(),
                    "last_error": None,
                    "last_error_at": None,
                    "completed_jobs": int(state.get("completed_jobs", 0)) + 1,
                    "node_count": node_count,
                    "edge_count": edge_count,
                }
            )
            self._write_unlocked(state)

    def record_failure(self, message: str) -> None:
        with _lock:
            state = self._read_unlocked()
            state.update(
                {
                    "pending_jobs": max(0, int(state.get("pending_jobs", 0)) - 1),
                    "last_error": str(message)[:500],
                    "last_error_at": _now_iso(),
                }
            )
            self._write_unlocked(state)

    def set_counts(self, *, node_count: int, edge_count: int) -> None:
        self.write({"node_count": node_count, "edge_count": edge_count})
