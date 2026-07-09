#!/usr/bin/env python3
"""Smoke tests: compaction notices persist into session.chat_history.

Covers AC-1 / AC-2 / AC-4 from 2026-07-08-compaction-notice-persist plan.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List

from agenticx.studio.compaction_notice import (
    COMPACTION_PROACTIVE_KIND,
    COMPACTION_REACTIVE_KIND,
    append_or_update_compaction_notice,
    build_compaction_notice_content,
)


class _Session:
    def __init__(self, chat_history: List[Dict[str, Any]] | None = None) -> None:
        self.chat_history = list(chat_history or [])


def _compaction_rows(history: List[Dict[str, Any]], kind: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for row in history:
        if not isinstance(row, dict):
            continue
        meta = row.get("metadata")
        if isinstance(meta, dict) and meta.get("kind") == kind:
            rows.append(row)
    return rows


def test_build_content_matches_frontend_wording() -> None:
    assert build_compaction_notice_content(13, reactive=False) == "已压缩 13 条较早历史，任务继续。"
    assert (
        build_compaction_notice_content(23, reactive=True)
        == "上下文接近上限，已压缩 23 条历史，任务继续。"
    )


def test_ac1_proactive_notice_appended_after_user() -> None:
    """AC-1: proactive notice lands after user row with correct kind/content."""
    session = _Session([{"role": "user", "content": "继续任务"}])
    ok = append_or_update_compaction_notice(
        session,
        count=13,
        reactive=False,
        agent_id="meta",
    )
    assert ok is True
    assert len(session.chat_history) == 2
    assert session.chat_history[0]["role"] == "user"
    notice = session.chat_history[1]
    assert notice["role"] == "tool"
    assert notice.get("tool_call_id") in (None, "")
    assert notice.get("tool_name") in (None, "")
    assert notice["content"] == "已压缩 13 条较早历史，任务继续。"
    meta = notice["metadata"]
    assert meta["kind"] == COMPACTION_PROACTIVE_KIND
    assert meta["compacted_count"] == 13
    assert meta["source"] == "runtime"


def test_ac2_reactive_notice_appended() -> None:
    """AC-2: reactive notice uses reactive kind and wording."""
    session = _Session(
        [
            {"role": "user", "content": "长任务"},
            {"role": "assistant", "content": "处理中"},
        ]
    )
    ok = append_or_update_compaction_notice(
        session,
        count=7,
        reactive=True,
        agent_id="meta",
    )
    assert ok is True
    notice = session.chat_history[-1]
    assert notice["content"] == "上下文接近上限，已压缩 7 条历史，任务继续。"
    assert notice["metadata"]["kind"] == COMPACTION_REACTIVE_KIND
    assert notice["metadata"]["compacted_count"] == 7


def test_ac4_same_kind_updates_in_place() -> None:
    """AC-4: consecutive proactive notices collapse to one row with latest count."""
    session = _Session([{"role": "user", "content": "继续"}])
    append_or_update_compaction_notice(session, count=13, reactive=False, agent_id="meta")
    append_or_update_compaction_notice(session, count=23, reactive=False, agent_id="meta")

    proactive = _compaction_rows(session.chat_history, COMPACTION_PROACTIVE_KIND)
    assert len(proactive) == 1
    assert proactive[0]["metadata"]["compacted_count"] == 23
    assert proactive[0]["content"] == "已压缩 23 条较早历史，任务继续。"
    assert len(session.chat_history) == 2  # user + one notice


def test_proactive_and_reactive_can_coexist() -> None:
    session = _Session([{"role": "user", "content": "继续"}])
    append_or_update_compaction_notice(session, count=13, reactive=False, agent_id="meta")
    append_or_update_compaction_notice(session, count=5, reactive=True, agent_id="meta")

    assert len(_compaction_rows(session.chat_history, COMPACTION_PROACTIVE_KIND)) == 1
    assert len(_compaction_rows(session.chat_history, COMPACTION_REACTIVE_KIND)) == 1
    assert len(session.chat_history) == 3


def test_safe_when_chat_history_missing() -> None:
    class _Bad:
        pass

    assert append_or_update_compaction_notice(_Bad(), count=1, reactive=False) is False
