#!/usr/bin/env python3
"""Smoke tests for session continuation helpers.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.stall_policy import (
    StallEvaluateInput,
    evaluate_stall_for_continuation,
    message_looks_like_assistant_final,
    parse_todo_tool_content,
    should_trigger_incomplete_end_stall,
    todos_completed,
)
from agenticx.studio.continuation import (
    finalize_continuation_progress,
    format_continuation_notice,
    is_continuation_user_prompt,
    mark_continuation_progress_start,
    mark_continue_attempt,
    no_progress_reject_reason,
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


def test_prepare_continue_adds_large_artifact_retry_constraints() -> None:
    managed = _FakeManaged()
    managed.studio_session.scratchpad["__last_turn_failure__"] = {
        "detector": "llm_round_timeout",
        "text": "模型响应超时",
        "ts": 123.0,
    }
    ok, prompt, round_n, notice = prepare_continue(
        managed,
        reason="interrupted",
        source="desktop_manual",
        execution_state="interrupted",
        skip_dedupe=True,
    )
    assert ok is True
    assert round_n == 1
    assert notice.get("role") == "tool"
    assert "【续跑约束】" in prompt
    assert "llm_round_timeout" in prompt
    assert "先 file_write 骨架" in prompt
    assert "禁止一次性 file_write 整页超长内容" in prompt


def test_is_continuation_user_prompt_real_user() -> None:
    assert is_continuation_user_prompt("能不能听到？") is False
    assert is_continuation_user_prompt("  hello  ") is False


def test_is_continuation_user_prompt_internal() -> None:
    assert is_continuation_user_prompt("") is True
    assert is_continuation_user_prompt("[auto-nudge] 停滞") is True
    assert is_continuation_user_prompt(resolve_continuation_prompt("stall")) is True
    assert is_continuation_user_prompt(resolve_continuation_prompt("exhausted")) is True


def test_is_continuation_user_prompt_with_retry_constraints() -> None:
    managed = _FakeManaged()
    managed.studio_session.scratchpad["__last_turn_failure__"] = {
        "detector": "streamed_tool_call_truncated",
        "text": "工具参数流式截断",
        "ts": 123.0,
    }
    ok, prompt, _round_n, _notice = prepare_continue(
        managed,
        reason="interrupted",
        source="desktop_manual",
        execution_state="interrupted",
        skip_dedupe=True,
    )
    assert ok is True
    assert is_continuation_user_prompt(prompt) is True


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


def test_prepare_continue_manual_running_skip_dedupe() -> None:
    managed = _FakeManaged()
    managed.execution_state = "running"
    ok, prompt, round_n, notice = prepare_continue(
        managed,
        reason="stall",
        source="desktop_manual",
        execution_state="interrupted",
        skip_dedupe=True,
    )
    assert ok is True
    assert round_n == 1
    assert prompt
    assert notice.get("role") == "tool"


def test_prepare_continue_manual_dedupe_bypass() -> None:
    managed = _FakeManaged()
    mark_continue_attempt(managed.studio_session, "stall", "desktop_manual")
    ok, _prompt, _round_n, _notice = prepare_continue(
        managed,
        reason="stall",
        source="desktop_manual",
        execution_state="interrupted",
        skip_dedupe=True,
    )
    assert ok is True


def test_no_progress_continuation_rejects_after_limit() -> None:
    managed = _FakeManaged()
    managed.studio_session.chat_history = [
        {"role": "user", "content": "生成 HTML"},
        {
            "role": "tool",
            "tool_name": "todo_write",
            "content": "[>] 设计并生成 HTML <- 设计并生成 HTML\n[ ] 保存\n(0/2 completed)",
        },
    ]
    for _ in range(3):
        mark_continuation_progress_start(managed.studio_session)
        finalize_continuation_progress(managed.studio_session, interrupted=True)

    ok, _prompt, _round_n, notice = prepare_continue(
        managed,
        reason="interrupted",
        source="desktop_manual",
        execution_state="interrupted",
        skip_dedupe=True,
    )
    assert ok is False
    assert "无新进展" in notice["reject_text"]
    assert "换模型" in notice["reject_text"]


def test_no_progress_count_resets_after_file_write_progress() -> None:
    session = _FakeSession()
    session.chat_history = [
        {"role": "user", "content": "生成 HTML"},
        {
            "role": "tool",
            "tool_name": "todo_write",
            "content": "[>] 设计并生成 HTML <- 设计并生成 HTML\n[ ] 保存\n(0/2 completed)",
        },
    ]
    mark_continuation_progress_start(session)
    finalize_continuation_progress(session, interrupted=True)
    assert no_progress_reject_reason(session) == ""
    assert session.scratchpad["__continuation_no_progress__"]["count"] == 1

    mark_continuation_progress_start(session)
    session.chat_history.append(
        {
            "role": "tool",
            "tool_name": "file_write",
            "content": "OK: wrote /Users/damon/Desktop/report.html",
        }
    )
    finalize_continuation_progress(session, interrupted=True)
    assert session.scratchpad["__continuation_no_progress__"]["count"] == 0


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


def test_colon_ending_not_assistant_final() -> None:
    assert message_looks_like_assistant_final(
        {"role": "assistant", "content": "继续安装 diagnose:"},
    ) is False
    assert message_looks_like_assistant_final(
        {"role": "assistant", "content": "安装已完成。"},
    ) is True


def test_supervisor_auto_continue_colon_ending_idle() -> None:
    result = evaluate_stall_for_continuation(
        StallEvaluateInput(
            execution_state="idle",
            sse_active=False,
            silent_seconds=130.0,
            stall_detect_silence_seconds=90,
            last_message={"role": "assistant", "content": "继续安装 diagnose:"},
            session_age_seconds=30.0,
        )
    )
    assert result.should_auto_continue is True
    assert result.continue_reason == "stall"


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


def test_supervisor_notice_dedupe_helpers() -> None:
    from agenticx.studio.supervisor import _has_supervisor_notice

    done_msgs = [
        {
            "role": "tool",
            "content": "✅ 任务已完成（5/5）",
            "metadata": {"kind": "unattended_done", "source": "supervisor"},
        }
    ]
    assert _has_supervisor_notice(done_msgs, kind="unattended_done") is True

    fail_msgs = [
        {
            "role": "tool",
            "content": "⛔ 无人值守已停止：已连续运行约 6 小时，达到自动运行时长上限",
            "metadata": {
                "kind": "unattended_failed",
                "source": "supervisor",
                "limit_code": "wall_clock",
            },
        }
    ]
    assert _has_supervisor_notice(fail_msgs, kind="unattended_failed", limit_code="wall_clock") is True
    assert _has_supervisor_notice([], kind="unattended_done") is False


def test_supervisor_uses_recent_continue_as_interrupted_silence_anchor() -> None:
    import time

    from agenticx.studio.supervisor import (
        _last_continue_attempt_ts,
        _supervisor_silence_anchor,
    )

    managed = _FakeManaged()
    old_ts_ms = (time.time() - 29 * 3600) * 1000
    recent_continue = time.time()
    managed.updated_at = time.time() - 5
    managed.studio_session.scratchpad["__continuation_last__"] = {
        "reason": "stall",
        "source": "supervisor",
        "ts": recent_continue,
    }
    messages = [
        {"role": "user", "content": "生成 HTML", "timestamp": old_ts_ms},
        {
            "role": "tool",
            "content": "运行出错，本轮未收到模型最终响应。",
            "timestamp": old_ts_ms,
            "metadata": {"kind": "turn_interrupted", "cause": "runtime_failure"},
        },
    ]

    assert _last_continue_attempt_ts(managed.studio_session) == recent_continue
    assert _supervisor_silence_anchor(managed, messages) == recent_continue

