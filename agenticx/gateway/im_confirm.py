#!/usr/bin/env python3
"""IM confirm flow helpers for gateway adapters.

Author: Damon Li
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass
class PendingConfirm:
    request_id: str
    agent_id: str
    session_id: str
    question: str
    created_at: float


class PendingConfirmStore:
    """In-memory pending confirm store keyed by external sender identity."""

    def __init__(self, ttl_seconds: float = 300.0) -> None:
        self._ttl = max(30.0, float(ttl_seconds))
        self._by_sender: Dict[str, List[PendingConfirm]] = {}

    def _cleanup(self, sender_key: str) -> None:
        now = time.time()
        rows = self._by_sender.get(sender_key, [])
        keep = [r for r in rows if (now - r.created_at) <= self._ttl]
        if keep:
            self._by_sender[sender_key] = keep
        else:
            self._by_sender.pop(sender_key, None)

    def upsert(self, sender_key: str, pending: PendingConfirm) -> None:
        self._cleanup(sender_key)
        rows = self._by_sender.get(sender_key, [])
        rows = [r for r in rows if r.request_id != pending.request_id]
        rows.append(pending)
        # keep newest first, bounded memory
        rows.sort(key=lambda r: r.created_at, reverse=True)
        self._by_sender[sender_key] = rows[:20]

    def get(self, sender_key: str, request_id: Optional[str] = None) -> Optional[PendingConfirm]:
        self._cleanup(sender_key)
        rows = self._by_sender.get(sender_key, [])
        if not rows:
            return None
        if request_id:
            rid = request_id.strip()
            for row in rows:
                if row.request_id == rid:
                    return row
            return None
        return rows[0]

    def remove(self, sender_key: str, request_id: str) -> None:
        rows = self._by_sender.get(sender_key, [])
        rows = [r for r in rows if r.request_id != request_id]
        if rows:
            self._by_sender[sender_key] = rows
        else:
            self._by_sender.pop(sender_key, None)

    def list_for_sender(self, sender_key: str) -> List[PendingConfirm]:
        self._cleanup(sender_key)
        return list(self._by_sender.get(sender_key, []))


def parse_confirm_command(text: str) -> Tuple[str, Optional[str], Optional[str]]:
    """Parse IM-side confirm commands.

    Returns (action, request_id, reason):
      - action: approve | deny | pending | none
    """
    raw = str(text or "").replace("／", "/")
    t = raw.strip()
    if not t:
        return ("none", None, None)

    # Some IM clients prepend reply-quote text before the actual command line.
    # Extract first slash-command segment if the whole message does not start with "/".
    if not t.startswith("/"):
        m_any = re.search(
            r"(?i)/(approve|ok|allow|yes|deny|reject|no|pending|confirm)\b[^\n\r]*",
            t,
        )
        if not m_any:
            return ("none", None, None)
        t = m_any.group(0).strip()

    m = re.match(r"(?i)^/(approve|ok|allow|yes)(?:\s+([a-z0-9\-]+))?\s*$", t)
    if m:
        return ("approve", (m.group(2) or "").strip() or None, None)

    m = re.match(r"(?i)^/(deny|reject|no)(?:\s+([a-z0-9\-]+))?(?:\s+(.+))?\s*$", t)
    if m:
        reason = (m.group(3) or "").strip() or "Denied from IM"
        return ("deny", (m.group(2) or "").strip() or None, reason)

    if re.match(r"(?i)^/(pending|confirm)\s*$", t):
        return ("pending", None, None)

    return ("none", None, None)


def format_pending_hint(pending: PendingConfirm) -> str:
    rid = pending.request_id
    q = pending.question.strip() or "需要你确认后继续执行。"
    return (
        "⏸ 当前任务等待确认\n"
        f"- request_id: `{rid}`\n"
        f"- 问题: {q}\n\n"
        f"回复 `/approve {rid}` 继续，或 `/deny {rid}` 拒绝。"
    )

