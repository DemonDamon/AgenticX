"""Tests for turn-interruption notice persistence (plan 2026-06-28)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agenticx.studio.turn_interruption import (
    TURN_INTERRUPTED_KIND,
    append_turn_interruption_notice,
    has_turn_interruption_notice,
    interruption_notice_content,
    resolve_turn_interruption_cause,
)


class _FakeManager:
    def __init__(self, *, interrupt: bool = False) -> None:
        self._interrupt = interrupt

    def should_interrupt(self, _session_id: str) -> bool:
        return self._interrupt


def _session_with_history(rows: list[dict]) -> SimpleNamespace:
    return SimpleNamespace(chat_history=list(rows))


def test_append_skips_when_saw_final() -> None:
    session = _session_with_history([])
    assert append_turn_interruption_notice(session, cause="no_final", saw_final=True) is False
    assert session.chat_history == []


def test_append_no_final_after_tool_result() -> None:
    session = _session_with_history(
        [
            {"role": "user", "content": "继续"},
            {"role": "tool", "content": "exit_code=0\nstdout:\nok", "tool_call_id": "tc1"},
        ]
    )
    assert append_turn_interruption_notice(session, cause="no_final", saw_final=False) is True
    assert len(session.chat_history) == 3
    row = session.chat_history[-1]
    assert row["role"] == "tool"
    assert row["metadata"]["kind"] == TURN_INTERRUPTED_KIND
    assert row["metadata"]["cause"] == "no_final"
    assert "上一步工具执行后未收到模型最终响应" in row["content"]


def test_append_idempotent() -> None:
    session = _session_with_history([{"role": "user", "content": "继续"}])
    assert append_turn_interruption_notice(session, cause="cancelled", saw_final=False) is True
    assert append_turn_interruption_notice(session, cause="cancelled", saw_final=False) is False
    assert len(session.chat_history) == 2


def test_append_skips_without_user_message() -> None:
    """A session with no user turn (e.g. a continuation misfired onto a fresh
    session) must not get a turn_interrupted placeholder — it stays a neutral
    new session instead of showing a spurious 「恢复执行」 card."""
    session = _session_with_history([])
    assert append_turn_interruption_notice(session, cause="runtime_failure", saw_final=False) is False
    assert session.chat_history == []

    tool_only = _session_with_history(
        [{"role": "tool", "content": "exit_code=0", "tool_call_id": "tc1"}]
    )
    assert (
        append_turn_interruption_notice(tool_only, cause="runtime_failure", saw_final=False)
        is False
    )
    assert len(tool_only.chat_history) == 1


def test_append_writes_with_user_message() -> None:
    session = _session_with_history([{"role": "user", "content": "跑一下"}])
    assert append_turn_interruption_notice(session, cause="runtime_failure", saw_final=False) is True
    assert session.chat_history[-1]["metadata"]["kind"] == TURN_INTERRUPTED_KIND


def test_append_runtime_failure_includes_detector_hint() -> None:
    session = _session_with_history([{"role": "user", "content": "跑一下"}])
    assert (
        append_turn_interruption_notice(
            session,
            cause="runtime_failure",
            saw_final=False,
            detector="llm_round_timeout",
        )
        is True
    )
    row = session.chat_history[-1]
    assert row["metadata"]["kind"] == TURN_INTERRUPTED_KIND
    assert row["metadata"]["cause"] == "runtime_failure"
    assert row["metadata"]["detector"] == "llm_round_timeout"
    assert "模型响应超时" in row["content"]


def test_append_without_detector_keeps_runtime_failure_text_unchanged() -> None:
    session = _session_with_history([{"role": "user", "content": "跑一下"}])
    assert append_turn_interruption_notice(session, cause="runtime_failure", saw_final=False) is True
    assert session.chat_history[-1]["content"] == interruption_notice_content(
        cause="runtime_failure",
        session=_session_with_history([]),
    )


def test_has_turn_interruption_notice() -> None:
    session = _session_with_history(
        [{"role": "tool", "content": "x", "metadata": {"kind": TURN_INTERRUPTED_KIND}}]
    )
    assert has_turn_interruption_notice(session) is True


def test_interruption_notice_content_by_cause() -> None:
    session = _session_with_history([])
    assert "已按用户请求中断" in interruption_notice_content(cause="user_interrupt", session=session)
    assert "运行出错" in interruption_notice_content(cause="runtime_failure", session=session)
    assert "连接已断开" in interruption_notice_content(cause="client_disconnect", session=session)


def test_resolve_turn_interruption_cause_priority() -> None:
    mgr = _FakeManager(interrupt=True)
    assert (
        resolve_turn_interruption_cause(
            mgr,
            "sid",
            saw_final=False,
            had_runtime_failure=True,
            client_disconnected=True,
            runtime_cancelled=True,
        )
        == "user_interrupt"
    )

    mgr2 = _FakeManager(interrupt=False)
    assert (
        resolve_turn_interruption_cause(
            mgr2,
            "sid",
            saw_final=False,
            had_runtime_failure=True,
        )
        == "runtime_failure"
    )
    assert (
        resolve_turn_interruption_cause(
            mgr2,
            "sid",
            saw_final=False,
            had_runtime_failure=False,
            client_disconnected=True,
            runtime_cancelled=True,
        )
        == "client_disconnect"
    )
    assert (
        resolve_turn_interruption_cause(
            mgr2,
            "sid",
            saw_final=False,
            had_runtime_failure=False,
            runtime_cancelled=True,
        )
        == "cancelled"
    )
    assert (
        resolve_turn_interruption_cause(
            mgr2,
            "sid",
            saw_final=False,
            had_runtime_failure=False,
        )
        == "no_final"
    )
    assert (
        resolve_turn_interruption_cause(
            mgr2,
            "sid",
            saw_final=True,
            had_runtime_failure=False,
        )
        is None
    )


@pytest.mark.parametrize(
    ("cause", "snippet"),
    [
        ("user_interrupt", "已按用户请求中断"),
        ("cancelled", "本轮生成已取消"),
        ("unknown", "本轮请求已中断"),
    ],
)
def test_all_cause_messages_non_empty(cause: str, snippet: str) -> None:
    text = interruption_notice_content(cause=cause, session=_session_with_history([]))
    assert snippet in text
