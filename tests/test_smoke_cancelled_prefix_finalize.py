#!/usr/bin/env python3
"""Smoke tests for cancelled-prefix finalize (interrupted visible history).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime import agent_runtime as runtime_module
from agenticx.runtime.agent_runtime import _sanitize_context_messages
from agenticx.runtime.harden_flags import cancelled_prefix_finalize_enabled
from agenticx.studio.server import _finalize_partial_assistant_if_needed


class _FakeResponse:
    def __init__(self, content: str, tool_calls: list | None = None) -> None:
        self.content = content
        self.tool_calls = tool_calls or []


class _PartialStreamLLM:
    """Yield a visible prefix, then hang so the watchdog can raise UserStop."""

    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("", [])

    def stream(self, *_args, **_kwargs):
        yield "部分回答"

    def stream_with_tools(self, *_args, **_kwargs):
        yield {"type": "content", "text": "部分回答"}


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


def _isolate_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_CANCELLED_PREFIX_FINALIZE", raising=False)
    monkeypatch.setattr("agenticx.runtime.harden_flags._config_bool", lambda _key: None)


def _patch_watchdog_stop_after_first_chunk(monkeypatch: pytest.MonkeyPatch) -> None:
    """Raise UserStop after the first real stream chunk so the prefix is buffered."""
    original = runtime_module._iter_sync_stream_with_watchdog

    async def _one_chunk_then_stop(**kwargs):
        agen = original(**kwargs)
        try:
            async for item in agen:
                if item is runtime_module._STREAM_WAITING_HINT:
                    continue
                yield item
                raise runtime_module._StreamWatchdogUserStop()
        finally:
            await agen.aclose()

    monkeypatch.setattr(runtime_module, "_iter_sync_stream_with_watchdog", _one_chunk_then_stop)


async def _run_until_stop(
    runtime: AgentRuntime,
    session: StudioSession,
    *,
    agent_id: str,
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    async for event in runtime.run_turn("continue", session, agent_id=agent_id):
        items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
    return items


def test_flag_defaults_on_and_env_off(monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate_flag(monkeypatch)
    assert cancelled_prefix_finalize_enabled() is True
    monkeypatch.setenv("AGX_CANCELLED_PREFIX_FINALIZE", "0")
    assert cancelled_prefix_finalize_enabled() is False


def test_meta_stream_cancel_commits_visible_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_watchdog_stop_after_first_chunk(monkeypatch)
    runtime = AgentRuntime(_PartialStreamLLM(), _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_run_until_stop(runtime, session, agent_id="meta"))
    assert events[-1]["type"] == EventType.ERROR.value
    assert session.agent_messages[-1] == {"role": "assistant", "content": "部分回答"}


def test_partial_protocol_markup_is_stripped() -> None:
    runtime = AgentRuntime(_PartialStreamLLM(), _ApproveGate())
    session = StudioSession()
    wrote = runtime._finalize_cancelled_prefix(
        session,
        "<think>想一半",
        agent_id="meta",
        is_system_trigger=False,
    )
    assert wrote is False
    assert session.agent_messages == []
    assert session.chat_history == []


def test_empty_prefix_writes_nothing() -> None:
    runtime = AgentRuntime(_PartialStreamLLM(), _ApproveGate())
    for raw in ("", "   "):
        session = StudioSession()
        wrote = runtime._finalize_cancelled_prefix(
            session,
            raw,
            agent_id="meta",
            is_system_trigger=False,
        )
        assert wrote is False
        assert session.agent_messages == []
        assert session.chat_history == []


def test_no_tool_calls_in_finalized_row() -> None:
    runtime = AgentRuntime(_PartialStreamLLM(), _ApproveGate())
    session = StudioSession()
    wrote = runtime._finalize_cancelled_prefix(
        session,
        "部分回答",
        agent_id="meta",
        is_system_trigger=False,
    )
    assert wrote is True
    row = session.agent_messages[-1]
    assert row == {"role": "assistant", "content": "部分回答"}
    assert "tool_calls" not in row


def test_flag_off_restores_old_behavior(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_watchdog_stop_after_first_chunk(monkeypatch)
    monkeypatch.setenv("AGX_CANCELLED_PREFIX_FINALIZE", "0")
    runtime = AgentRuntime(_PartialStreamLLM(), _ApproveGate())
    session = StudioSession()
    before = list(session.agent_messages)
    asyncio.run(_run_until_stop(runtime, session, agent_id="meta"))
    assistant_rows = [m for m in session.agent_messages if m.get("role") == "assistant"]
    assert assistant_rows == []
    assert len(session.agent_messages) >= len(before)


def test_avatar_and_group_member_cancel_also_commit_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_watchdog_stop_after_first_chunk(monkeypatch)
    runtime = AgentRuntime(_PartialStreamLLM(), _ApproveGate())
    avatar_session = StudioSession()
    group_session = StudioSession()
    asyncio.run(_run_until_stop(runtime, avatar_session, agent_id="avatar-x"))
    asyncio.run(_run_until_stop(runtime, group_session, agent_id="group-member-kev"))
    assert avatar_session.agent_messages[-1]["content"] == "部分回答"
    assert group_session.agent_messages[-1]["content"] == "部分回答"


def test_sanitizer_keeps_interrupted_prefix_row() -> None:
    prefix_row = {"role": "assistant", "content": "部分回答"}
    notice_row = {
        "role": "tool",
        "content": "已中断",
        "metadata": {"kind": "turn_interrupted"},
    }
    out = _sanitize_context_messages(
        [
            {"role": "user", "content": "hi"},
            prefix_row,
            notice_row,
        ]
    )
    assert any(row.get("content") == "部分回答" for row in out)
    assert not any(
        isinstance(row.get("metadata"), dict)
        and row["metadata"].get("kind") == "turn_interrupted"
        for row in out
    )


def test_sse_finalize_skips_when_runtime_already_wrote() -> None:
    already = SimpleNamespace(
        chat_history=[
            {
                "role": "assistant",
                "content": "已展示前缀",
                "metadata": {
                    "source": "interrupted-partial",
                    "interrupted": True,
                    "turn_terminal": False,
                },
            }
        ]
    )
    assert (
        _finalize_partial_assistant_if_needed(
            already, "另一截残句", saw_final=False
        )
        is False
    )
    assert len(already.chat_history) == 1

    ordinary = SimpleNamespace(
        chat_history=[{"role": "assistant", "content": "上一轮完整回复"}]
    )
    assert (
        _finalize_partial_assistant_if_needed(
            ordinary, "本轮残句", saw_final=False
        )
        is True
    )
    assert len(ordinary.chat_history) == 2
    assert ordinary.chat_history[-1]["metadata"]["source"] == "interrupted-partial"
