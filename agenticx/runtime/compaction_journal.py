#!/usr/bin/env python3
"""压缩的开始/结束记账，以及"锁最后释放"这条不变量。

为什么要有锁
------------
压缩是**破坏性**的：它把一段真实历史换成一段摘要。中途崩溃（进程被杀、断电、OOM）如果
留下的是"看起来已经压缩完了"的状态，那段被遮蔽的原文就再也找不回来了，而且没人知道出
过事。

所以顺序是固定的：

    追加 compaction/start → 建锁 → 干活 → 追加 compaction/end → **最后**删锁

任何一步崩溃，锁都还在。留下的是一个**可检测的孤儿锁**，而不是一句"已完成"的谎。
``detect_orphan`` 让下一次启动看得见它。

反过来说，绝不能先删锁再记 end：那样崩在中间就成了"锁没了、也没记录"，跟正常完成
无法区分。

孤儿锁不阻塞
------------
发现孤儿锁时接管并记一条 warning，而不是拒绝压缩。上一次崩溃不该让这个会话从此
再也压不了——那只会把一次崩溃变成一个永久卡死的会话。
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

LOCK_FILENAME = "compaction.lock"
JOURNAL_FILENAME = "compaction.journal.jsonl"

EVENT_START = "compaction/start"
EVENT_END = "compaction/end"


def _sessions_root() -> Path:
    from agenticx.studio.chat_attachments import _sessions_root as root

    return root()


def session_dir(session: Any) -> Optional[Path]:
    """会话在磁盘上的目录；拿不到 session_id 时返回 ``None``（不落盘也不报错）。"""
    session_id = str(getattr(session, "session_id", "") or "").strip()
    if not session_id or os.sep in session_id or session_id in {".", ".."}:
        return None
    try:
        return _sessions_root() / session_id
    except Exception:
        return None


@dataclass(frozen=True)
class CompactionLock:
    """一次在飞的压缩。``path`` 为 ``None`` 表示没落盘（内存会话），照常工作但不记账。"""

    path: Optional[Path]
    journal: Optional[Path]
    started_at: float
    recovered_from_orphan: bool = False


def _read_lock(path: Path) -> Optional[Dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        # 锁文件内容坏了仍然算锁存在：它的存在本身才是信号，内容只是附加信息。
        return {}
    return raw if isinstance(raw, dict) else {}


def detect_orphan(session: Any) -> Optional[Dict[str, Any]]:
    """上一次压缩留下的锁；没有则 ``None``。

    返回里带 ``age_seconds`` 和 ``pid``，让运维一眼能看出是"刚崩的"还是"很久以前的"。
    """
    directory = session_dir(session)
    if directory is None:
        return None
    lock_path = directory / LOCK_FILENAME
    if not lock_path.is_file():
        return None
    record = _read_lock(lock_path) or {}
    started = float(record.get("started_at") or 0.0)
    return {
        "path": str(lock_path),
        "pid": record.get("pid"),
        "started_at": started,
        "age_seconds": max(0.0, time.time() - started) if started else None,
        "trigger": record.get("trigger", ""),
    }


def _append_journal(path: Optional[Path], record: Dict[str, Any]) -> None:
    if path is None:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        # 记账失败不该让压缩失败；锁本身才是那条不变量。
        logger.debug("compaction journal append failed", exc_info=True)


def begin(session: Any, *, trigger: str = "") -> CompactionLock:
    """记 ``compaction/start`` 并建锁。

    发现孤儿锁时接管并 warning——上一次崩溃不该让这个会话从此再也压不了。
    """
    directory = session_dir(session)
    started_at = time.time()
    if directory is None:
        return CompactionLock(path=None, journal=None, started_at=started_at)

    orphan = detect_orphan(session)
    if orphan is not None:
        logger.warning(
            "compaction: taking over an orphan lock (pid=%s age=%.0fs trigger=%s) — "
            "a previous compaction did not finish",
            orphan.get("pid"),
            float(orphan.get("age_seconds") or 0.0),
            orphan.get("trigger") or "unknown",
        )

    lock_path = directory / LOCK_FILENAME
    journal_path = directory / JOURNAL_FILENAME
    record = {
        "event": EVENT_START,
        "started_at": started_at,
        "pid": os.getpid(),
        "trigger": trigger,
        "recovered_from_orphan": orphan is not None,
    }
    _append_journal(journal_path, record)
    try:
        directory.mkdir(parents=True, exist_ok=True)
        lock_path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    except Exception:
        logger.debug("compaction lock write failed", exc_info=True)
        lock_path = None  # type: ignore[assignment]
    return CompactionLock(
        path=lock_path,
        journal=journal_path,
        started_at=started_at,
        recovered_from_orphan=orphan is not None,
    )


def end(lock: CompactionLock, *, outcome: str, **details: Any) -> None:
    """记 ``compaction/end``，**然后**删锁。

    顺序不能反：先删锁再记 end 的话，崩在中间就成了"锁没了、也没记录"，和正常完成
    无法区分。
    """
    _append_journal(
        lock.journal,
        {
            "event": EVENT_END,
            "outcome": outcome,
            "started_at": lock.started_at,
            "ended_at": time.time(),
            "duration_seconds": round(max(0.0, time.time() - lock.started_at), 3),
            "pid": os.getpid(),
            **details,
        },
    )
    if lock.path is None:
        return
    try:
        lock.path.unlink()
    except FileNotFoundError:
        pass
    except Exception:
        # 删不掉就留成孤儿锁：宁可下次多一条 warning，也不能假装没发生过。
        logger.warning("compaction: lock release failed at %s", lock.path, exc_info=True)
