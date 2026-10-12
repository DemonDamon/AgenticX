#!/usr/bin/env python3
"""Persist + sanitize for Jev decision rows.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.agent_runtime import _sanitize_context_messages
from agenticx.runtime.group_router import GroupReply
from agenticx.studio.server import _persist_jev_decision


def test_persist_jev_decision_is_idempotent() -> None:
    session = SimpleNamespace(chat_history=[])
    reply = GroupReply(
        agent_id="__jev__",
        avatar_name="Jev",
        avatar_url="",
        content="Jev（jev-1.13.0）→ 派给成员 财务 · 90% · 自动",
        skipped=True,
        event_type="group_jev_decision",
        tool_name="jev",
        confirm_context={
            "kind": "jev_decision",
            "purpose": "group_routing",
            "action": "route_to",
            "target_ids": ["fin"],
        },
    )
    _persist_jev_decision(session, reply)
    _persist_jev_decision(session, reply)
    assert len(session.chat_history) == 1
    row = session.chat_history[0]
    assert row["role"] == "tool"
    assert row["tool_name"] == "jev"
    assert row["agent_id"] == "__jev__"
    assert row["metadata"]["kind"] == "jev_decision"


def test_sanitize_drops_jev_decision_and_kb_gate() -> None:
    history = [
        {"role": "user", "content": "hi"},
        {"role": "tool", "content": "Jev → 派给成员", "metadata": {"kind": "jev_decision"}},
        {"role": "tool", "content": "Jev → 跳过检索", "metadata": {"kind": "jev_kb_gate"}},
        {"role": "assistant", "content": "ok"},
    ]
    sanitized = _sanitize_context_messages(history)
    kinds = [
        (row.get("metadata") or {}).get("kind")
        for row in sanitized
        if isinstance(row, dict)
    ]
    assert "jev_decision" not in kinds
    assert "jev_kb_gate" not in kinds
    assert any(row.get("role") == "user" for row in sanitized)
    assert any(row.get("role") == "assistant" for row in sanitized)
