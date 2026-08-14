#!/usr/bin/env python3
"""Smoke tests for interrupted-turn tool closers (G-001).

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict

import pytest

from agenticx.runtime.agent_runtime import _sanitize_context_messages
from agenticx.runtime.checkpoint import AgentCheckpoint
from agenticx.runtime.interrupted_closers import (
    KIND_NOT_STARTED,
    KIND_OUTCOME_UNKNOWN,
    NOT_STARTED_CONTENT,
    OUTCOME_UNKNOWN_CONTENT,
    close_interrupted_tool_calls,
)
from agenticx.studio.session_manager import SessionManager
from agenticx.studio.storage.backend import SyncStorageFacade
from agenticx.studio.storage.local_file import LocalFileBackend
from agenticx.memory.session_store import SessionStore


def _history_partial() -> list[dict[str, Any]]:
    return [
        {"role": "user", "content": "do two things"},
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "todo_write", "arguments": "{}"}},
                {"id": "c2", "type": "function", "function": {"name": "file_write", "arguments": "{}"}},
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "name": "todo_write", "content": "ok"},
    ]


def _ids_and_answers(messages: list[dict[str, Any]]) -> tuple[set[str], set[str]]:
    tool_call_ids: set[str] = set()
    answered: set[str] = set()
    for msg in messages:
        if msg.get("role") == "assistant":
            for call in msg.get("tool_calls") or []:
                tool_call_ids.add(str(call.get("id", "")))
        if msg.get("role") == "tool":
            answered.add(str(msg.get("tool_call_id", "")))
    return tool_call_ids, answered


def test_outcome_unknown_keeps_pairing() -> None:
    closed = close_interrupted_tool_calls(_history_partial(), dispatched_call_ids=["c2"])
    closer = [m for m in closed if m.get("tool_call_id") == "c2"]
    assert len(closer) == 1
    assert closer[0]["metadata"]["kind"] == KIND_OUTCOME_UNKNOWN
    sanitized = _sanitize_context_messages(closed)
    ids, answered = _ids_and_answers(sanitized)
    assert ids == {"c1", "c2"}
    assert ids <= answered


def test_not_started_copy() -> None:
    closed = close_interrupted_tool_calls(_history_partial(), dispatched_call_ids=[])
    closer = next(m for m in closed if m.get("tool_call_id") == "c2")
    assert closer["metadata"]["kind"] == KIND_NOT_STARTED
    assert "尚未开始" in closer["content"]
    assert "禁止直接重试" not in closer["content"]


def test_outcome_unknown_mentions_verify() -> None:
    assert re.search(r"核验", OUTCOME_UNKNOWN_CONTENT)
    assert "尚未开始" in NOT_STARTED_CONTENT


def test_closer_is_idempotent() -> None:
    first = close_interrupted_tool_calls(_history_partial(), dispatched_call_ids=["c2"])
    second = close_interrupted_tool_calls(first, dispatched_call_ids=["c2"])
    assert first == second


def test_complete_history_unchanged() -> None:
    complete = [
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "todo_write", "arguments": "{}"}},
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "name": "todo_write", "content": "ok"},
    ]
    assert close_interrupted_tool_calls(complete, dispatched_call_ids=["c1"]) == complete


async def test_resume_flag_off_strips_dangling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_INTERRUPTED_CLOSERS", "0")
    monkeypatch.setenv("AGX_RESUME_INTERRUPTED", "1")
    sid = "closer-flag-off"
    sessions_root = tmp_path / "sessions"
    session_dir = sessions_root / sid
    session_dir.mkdir(parents=True)
    (session_dir / "messages.json").write_text("[]", encoding="utf-8")
    (session_dir / "agent_messages.json").write_text(
        json.dumps(_history_partial(), ensure_ascii=False),
        encoding="utf-8",
    )
    store = SessionStore(tmp_path / "sessions.sqlite")
    store._save_session_summary_sync(
        sid,
        "do two things",
        {"execution_state": "running", "created_at": 1.0, "updated_at": 1.0},
    )
    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: sessions_root)
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    storage_factory.reset_storage_backend_for_testing()
    backend = LocalFileBackend(sessions_root=sessions_root, config_dir=tmp_path / "cfg")
    from agenticx.runtime.checkpoint import CheckpointStore

    cp_store = CheckpointStore(SyncStorageFacade(backend))
    cp_store.save(
        AgentCheckpoint(
            session_id=sid,
            turn_id="t1",
            round_idx=1,
            pending_tool_calls=[
                {"id": "c2", "type": "function", "function": {"name": "file_write", "arguments": "{}"}},
            ],
        )
    )

    seen: Dict[str, Any] = {}

    async def _runner(session_id: str, managed, checkpoint) -> bool:
        ids, answered = _ids_and_answers(managed.studio_session.agent_messages)
        seen["dangling"] = ids - answered
        seen["ids"] = ids
        return True

    resumed = await manager.resume_interrupted_sessions(runtime_runner=_runner)
    assert resumed == [sid]
    assert "c2" not in seen["ids"]
    assert seen["dangling"] == set()
