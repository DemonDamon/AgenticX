"""Persist visible compaction notices into session.chat_history.

Keep notice content in sync with desktop/src/utils/context-notice.ts
``buildCompactionNoticeText``.

Author: Damon Li
"""

from __future__ import annotations

import uuid
from typing import Any

COMPACTION_PROACTIVE_KIND = "compaction_proactive"
COMPACTION_REACTIVE_KIND = "compaction_reactive"


def build_compaction_notice_content(count: int, *, reactive: bool) -> str:
    """Return notice text matching frontend ``buildCompactionNoticeText``."""
    # keep in sync with desktop/src/utils/context-notice.ts buildCompactionNoticeText
    if reactive:
        return f"上下文接近上限，已压缩 {count} 条历史，任务继续。"
    return f"已压缩 {count} 条较早历史，任务继续。"


def _last_history_row(history: list[Any]) -> dict[str, Any] | None:
    if not history:
        return None
    last = history[-1]
    return last if isinstance(last, dict) else None


def _row_kind(row: dict[str, Any]) -> str:
    meta = row.get("metadata")
    if not isinstance(meta, dict):
        return ""
    return str(meta.get("kind") or "").strip()


def append_or_update_compaction_notice(
    session: Any,
    *,
    count: int,
    reactive: bool,
    agent_id: str | None = None,
) -> bool:
    """Append or in-place update a compaction notice on ``session.chat_history``.

    If the last chat_history row is already the same compaction kind, update its
    content and ``compacted_count`` instead of appending another row (FR-4).
    """
    history = getattr(session, "chat_history", None)
    if not isinstance(history, list):
        return False

    kind = COMPACTION_REACTIVE_KIND if reactive else COMPACTION_PROACTIVE_KIND
    content = build_compaction_notice_content(int(count), reactive=reactive)
    agent = str(agent_id or "meta").strip() or "meta"

    last = _last_history_row(history)
    if last is not None and _row_kind(last) == kind:
        last["content"] = content
        meta = last.get("metadata")
        if not isinstance(meta, dict):
            meta = {}
            last["metadata"] = meta
        meta["kind"] = kind
        meta["compacted_count"] = int(count)
        meta["source"] = "runtime"
        return True

    history.append(
        {
            "id": uuid.uuid4().hex,
            "role": "tool",
            "content": content,
            "agent_id": agent,
            "metadata": {
                "kind": kind,
                "compacted_count": int(count),
                "source": "runtime",
            },
        }
    )
    return True
