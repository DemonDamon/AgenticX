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
#: 只剪枝、没摘要。这是**另一件事**，不能共用压缩文案：消息还在原位，没有摘要，
#: "已压缩 0 条较早历史"对用户来说既不准确也看不懂。
COMPACTION_PRUNE_KIND = "compaction_prune"

#: compactor 没给出说明时的兜底文案（正常路径用的是 compactor 返回的 summary）。
DEFAULT_PRUNE_NOTICE = "已清理较早的超大工具结果，历史未被摘要，任务继续。"


def build_compaction_notice_content(count: int, *, reactive: bool) -> str:
    """Return notice text matching frontend ``buildCompactionNoticeText``."""
    # keep in sync with desktop/src/utils/context-notice.ts buildCompactionNoticeText
    if reactive:
        return f"上下文接近上限，已压缩 {count} 条历史，任务继续。"
    return f"已压缩 {count} 条较早历史，任务继续。"


def build_prune_notice_content(summary: str) -> str:
    """剪枝通知直接用 compactor 返回的说明（"剪除了 N 条过大的工具结果…"）。"""
    # keep in sync with desktop/src/utils/context-notice.ts buildPruneNoticeText
    return str(summary or "").strip() or DEFAULT_PRUNE_NOTICE


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


def _append_or_update(
    session: Any,
    *,
    kind: str,
    content: str,
    extra_metadata: dict[str, Any],
    agent_id: str | None,
) -> bool:
    history = getattr(session, "chat_history", None)
    if not isinstance(history, list):
        return False

    agent = str(agent_id or "meta").strip() or "meta"
    metadata: dict[str, Any] = {"kind": kind, **extra_metadata, "source": "runtime"}

    last = _last_history_row(history)
    if last is not None and _row_kind(last) == kind:
        last["content"] = content
        meta = last.get("metadata")
        if not isinstance(meta, dict):
            meta = {}
            last["metadata"] = meta
        meta.update(metadata)
        return True

    history.append(
        {
            "id": uuid.uuid4().hex,
            "role": "tool",
            "content": content,
            "agent_id": agent,
            "metadata": metadata,
        }
    )
    return True


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
    return _append_or_update(
        session,
        kind=COMPACTION_REACTIVE_KIND if reactive else COMPACTION_PROACTIVE_KIND,
        content=build_compaction_notice_content(int(count), reactive=reactive),
        extra_metadata={"compacted_count": int(count)},
        agent_id=agent_id,
    )


def append_or_update_prune_notice(
    session: Any,
    *,
    summary: str,
    agent_id: str | None = None,
) -> bool:
    """剪枝通知走自己的 kind，不带 ``compacted_count``——那个数在这里没有意义。"""
    return _append_or_update(
        session,
        kind=COMPACTION_PRUNE_KIND,
        content=build_prune_notice_content(summary),
        extra_metadata={"pruned_only": True},
        agent_id=agent_id,
    )
