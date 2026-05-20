#!/usr/bin/env python3
"""Smoke tests for session continuation helpers.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.stall_policy import (
    StallEvaluateInput,
    evaluate_stall_for_continuation,
    parse_todo_tool_content,
    should_trigger_incomplete_end_stall,
    todos_completed,
)
from agenticx.studio.continuation import (
    format_continuation_notice,
    prepare_continue,
    resolve_continuation_prompt,
    should_dedupe_continue,
)


class _FakeSession:
    def __init__(self) -> None:
        self.chat_history: list = []
        self.scratchpad: dict = {}


class _FakeManaged:
    def __init__(self) -> None:
        self.session_id = "test-session"
        self.execution_state = "interrupted"
        self.studio_session = _FakeSession()


def test_resolve_continuation_prompt_interrupted() -> None:
    text = resolve_continuation_prompt("interrupted", execution_state="interrupted")
    assert "todo" in text.lower()


def test_format_continuation_notice_auto() -> None:
    line = format_continuation_notice("desktop_auto_nudge", "stall", round_n=1, max_rounds=2)
    assert "自动续跑" in line
    assert "1/2" in line


def test_prepare_continue_appends_tool_notice() -> None:
    managed = _FakeManaged()
    ok, prompt, round_n, notice = prepare_continue(
        managed,
        reason="interrupted",
        source="desktop_manual",
        execution_state="interrupted",
        skip_dedupe=True,
    )
    assert ok is True
    assert round_n == 1
    assert prompt
    assert notice.get("role") == "tool"
    assert len(managed.studio_session.chat_history) == 1


def test_dedupe_continue_within_window() -> None:
    session = _FakeSession()
    should_dedupe_continue(session, "stall")
    session.scratchpad["__continuation_last__"] = {
        "reason": "stall",
        "source": "desktop_auto_nudge",
        "ts": __import__("time").time(),
    }
    assert should_dedupe_continue(session, "stall") is True


def test_parse_todo_all_done() -> None:
    text = "🗂 任务清单更新\n[x] a\n[x] b\n(2/2 completed)"
    parsed = parse_todo_tool_content(text)
    assert parsed is not None
    assert parsed.all_done is True
    msgs = [{"role": "tool", "tool_name": "todo_write", "content": text}]
    assert todos_completed(msgs) is True


def test_channel_c_stall() -> None:
    assert should_trigger_incomplete_end_stall(
        "interrupted",
        sse_active=False,
        last_message={"role": "tool", "content": "running..."},
        grace_elapsed_sec=10.0,
    )


def test_supervisor_auto_continue_interrupted() -> None:
    result = evaluate_stall_for_continuation(
        StallEvaluateInput(
            execution_state="interrupted",
            sse_active=False,
            silent_seconds=200.0,
            stall_detect_silence_seconds=90,
            last_message={"role": "tool", "content": "partial"},
            session_age_seconds=30.0,
        )
    )
    assert result.should_auto_continue is True
    assert result.continue_reason == "interrupted"
