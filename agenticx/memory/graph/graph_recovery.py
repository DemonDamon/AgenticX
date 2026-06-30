#!/usr/bin/env python3
"""Detect and auto-recover corrupted Kuzu memory-graph databases.

Kuzu 0.11.x can leave ``graph.kuzu`` unreadable after abnormal shutdown, concurrent
writers, or engine bugs (e.g. DELETE SIGSEGV during rebuild). Symptoms include
``IO exception: Cannot read from file`` with absurd file offsets. This module probes
the DB on cold start and, when corruption is detected, quarantines the bad file and
restores the newest ``*.bak-*`` backup or recreates an empty Graphiti schema.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_CORRUPTION_MARKERS = (
    "io exception",
    "cannot read from file",
    "database file corrupted",
    "invalid page",
    "checksum",
)


def is_kuzu_lock_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "could not set lock on file" in msg or "lock on file" in msg


def is_kuzu_corruption_error(exc: BaseException) -> bool:
    """True for unreadable/corrupt DB errors; false for lock contention."""
    if is_kuzu_lock_error(exc):
        return False
    msg = str(exc).lower()
    return any(marker in msg for marker in _CORRUPTION_MARKERS)


def is_corruption_message(message: str) -> bool:
    """Detect corruption from persisted status strings (UI / graph_ingest.json)."""
    msg = (message or "").lower()
    if is_kuzu_lock_error(RuntimeError(msg)):
        return False
    return any(marker in msg for marker in _CORRUPTION_MARKERS)


def user_facing_graph_error(exc: BaseException) -> str:
    """Plain-language message for Desktop users (no terminal / cp instructions)."""
    if is_kuzu_lock_error(exc):
        return (
            "记忆图谱引擎正忙，请稍等几秒后点「刷新」；"
            "若仍无效，请完全退出并重新打开 Near。"
        )
    if is_kuzu_corruption_error(exc):
        return "记忆图谱本地数据异常，Near 正在尝试自动修复，请稍候…"
    msg = str(exc).strip()
    lower = msg.lower()
    if "timed out" in lower or "超时" in lower:
        return "记忆图谱加载较慢，请稍候再试。"
    if "graphiti-core is not installed" in lower:
        return "当前后端未安装记忆图谱组件，请使用完整版 Near 或联系支持。"
    if len(msg) > 160 or "filedescriptor" in lower or "numbytesread" in lower:
        return "记忆图谱暂时不可用，请稍后点「刷新」重试。"
    return msg


def _quarantine_path(db_path: Path) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return db_path.with_name(f"{db_path.name}.corrupt-{ts}")


def find_latest_backup(db_path: Path) -> Optional[Path]:
    """Return the newest ``graph.kuzu.bak-<ts>`` sibling, if any."""
    pattern = f"{db_path.name}.bak-*"
    candidates: List[Path] = []
    for path in db_path.parent.glob(pattern):
        if path.name.endswith(".wal"):
            continue
        if path.is_file():
            candidates.append(path)
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def probe_kuzu_db(db_path: Path) -> Tuple[bool, Optional[str]]:
    """Open the DB read-only and run a trivial query. Returns (ok, error_message)."""
    path = db_path.expanduser()
    if not path.exists():
        return True, None
    try:
        import kuzu
    except ImportError:
        return True, None
    try:
        db = kuzu.Database(str(path), read_only=True)
        conn = kuzu.Connection(db)
        result = conn.execute("MATCH (n) RETURN count(n) AS c")
        while result.has_next():
            result.get_next()
        if hasattr(db, "close"):
            db.close()
        return True, None
    except Exception as exc:
        if is_kuzu_lock_error(exc):
            return False, str(exc)
        if is_kuzu_corruption_error(exc) or isinstance(exc, RuntimeError):
            return False, str(exc)
        return False, str(exc)


def recover_corrupt_graph_db(cfg: Any) -> Dict[str, Any]:
    """Quarantine a corrupt DB and restore backup or recreate empty schema.

    Must run while this process holds the only write lock on ``cfg.db_path``.
    """
    from agenticx.memory.graph.graph_rebuild import (
        _build_empty_schema,
        _copy_db_files,
        _remove_db_files,
    )

    db_path = Path(cfg.db_path).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    action = "recreated_empty"
    backup_used: Optional[str] = None
    quarantine: Optional[str] = None

    if db_path.exists():
        quarantine = str(_quarantine_path(db_path))
        _remove_db_files(quarantine)
        os.rename(db_path, quarantine)
        wal = str(db_path) + ".wal"
        if os.path.exists(wal):
            os.rename(wal, quarantine + ".wal")
        logger.warning("memory graph: quarantined corrupt db -> %s", quarantine)

    restore = find_latest_backup(db_path)
    if restore is not None:
        ok, err = probe_kuzu_db(restore)
        if ok:
            _copy_db_files(str(restore), str(db_path))
            action = "restored_from_backup"
            backup_used = str(restore)
            logger.warning(
                "memory graph: restored from backup %s after corruption", restore
            )
        else:
            logger.error(
                "memory graph: backup %s also unreadable (%s); recreating empty db",
                restore,
                err,
            )

    if action != "restored_from_backup":
        _remove_db_files(str(db_path))
        asyncio.run(_build_empty_schema(str(db_path), cfg))
        logger.warning("memory graph: recreated empty graph db at %s", db_path)

    try:
        from agenticx.memory.graph.status import MemoryGraphStatusStore

        MemoryGraphStatusStore(cfg.status_path).write(
            {
                "last_error": None,
                "last_error_at": None,
                "last_recovery_at": datetime.now(timezone.utc).isoformat(),
                "last_recovery_action": action,
                "last_recovery_backup": backup_used,
                "last_recovery_quarantine": quarantine,
            }
        )
    except Exception:
        logger.debug("memory graph: failed to persist recovery status", exc_info=True)

    return {
        "action": action,
        "backup": backup_used,
        "quarantine": quarantine,
        "db_path": str(db_path),
    }


def ensure_graph_db_healthy(cfg: Any) -> Optional[Dict[str, Any]]:
    """Probe ``cfg.db_path`` and auto-recover when corrupted. Returns recovery info or None."""
    db_path = Path(cfg.db_path).expanduser()
    ok, err = probe_kuzu_db(db_path)
    if ok:
        return None
    if err and is_kuzu_lock_error(RuntimeError(err)):
        return None
    logger.warning("memory graph: unhealthy db detected (%s)", err)
    return recover_corrupt_graph_db(cfg)
