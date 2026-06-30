#!/usr/bin/env python3
"""Tests for reasoning chain persistence ( FR-1 / FR-2 ).

Covers the backend split helper and SessionManager normalization of the
`reasoning` / `reasoning_seconds` fields on assistant rows.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.memory.session_store import SessionStore
from agenticx.runtime.agent_runtime import _split_reasoning_and_body
from agenticx.studio.session_manager import SessionManager

_THINK_OPEN = chr(60) + "think" + chr(62)
_THINK_CLOSE = chr(60) + "/think" + chr(62)


def test_split_reasoning_and_body_extracts_closed_block() -> None:
    text = _THINK_OPEN + "盘算 17 秒" + _THINK_CLOSE + "这是最终答案"
    reasoning, body = _split_reasoning_and_body(text)
    assert reasoning == "盘算 17 秒"
    assert body == "这是最终答案"


def test_split_reasoning_and_body_extracts_unclosed_tail() -> None:
    text = _THINK_OPEN + "仍在思考"
    reasoning, body = _split_reasoning_and_body(text)
    assert reasoning == "仍在思考"
    assert body == ""


def test_split_reasoning_and_body_no_think_returns_empty_reasoning() -> None:
    reasoning, body = _split_reasoning_and_body("普通正文，无推理")
    assert reasoning == ""
    assert body == "普通正文，无推理"


def test_split_reasoning_and_body_preserves_long_reasoning_for_truncation() -> None:
    # The helper itself does not truncate; truncation happens at the call site.
    long = "x" * 20000
    text = _THINK_OPEN + long + _THINK_CLOSE + "body"
    reasoning, body = _split_reasoning_and_body(text)
    assert len(reasoning) == 20000
    assert body == "body"


def test_normalize_messages_persists_reasoning_and_seconds(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(tmp_path / "sessions")

    sid = "reasoning-persist-session"
    managed = manager.create(session_id=sid)
    managed.studio_session.chat_history = [
        {"role": "user", "content": "q"},
        {
            "role": "assistant",
            "content": "最终答案",
            "reasoning": "盘算 17 秒",
            "reasoning_seconds": 17,
            "references": [],
            "searched_queries": [],
        },
    ]
    assert manager.persist(sid) is True

    reloaded = manager._normalize_messages(managed.studio_session.chat_history)
    assistant_rows = [r for r in reloaded if r["role"] == "assistant"]
    assert assistant_rows, "expected at least one assistant row after normalize"
    last = assistant_rows[-1]
    assert last.get("reasoning") == "盘算 17 秒"
    assert last.get("reasoning_seconds") == 17


def test_normalize_messages_truncates_reasoning_and_skips_zero_seconds(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(tmp_path / "sessions")

    sid = "reasoning-trunc-session"
    managed = manager.create(session_id=sid)
    long_reasoning = "y" * 20000
    managed.studio_session.chat_history = [
        {"role": "user", "content": "q"},
        {
            "role": "assistant",
            "content": "答案",
            "reasoning": long_reasoning,
            "reasoning_seconds": 0,  # must be dropped (>=1 required)
        },
    ]
    manager.persist(sid)

    reloaded = manager._normalize_messages(managed.studio_session.chat_history)
    last = [r for r in reloaded if r["role"] == "assistant"][-1]
    assert last.get("reasoning") is not None
    assert len(last["reasoning"]) <= 16384
    assert "reasoning_seconds" not in last


def test_normalize_messages_legacy_row_without_reasoning_loads_cleanly(tmp_path: Path) -> None:
    """NFR-4: legacy messages.json without reasoning fields must not error."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(tmp_path / "sessions")

    sid = "legacy-no-reasoning"
    managed = manager.create(session_id=sid)
    managed.studio_session.chat_history = [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "旧答案"},
    ]
    manager.persist(sid)

    reloaded = manager._normalize_messages(managed.studio_session.chat_history)
    last = [r for r in reloaded if r["role"] == "assistant"][-1]
    assert "reasoning" not in last
    assert "reasoning_seconds" not in last
    assert last["content"] == "旧答案"
