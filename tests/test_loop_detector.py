#!/usr/bin/env python3
"""Tests for LoopDetector and anti-futility helpers.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.agent_runtime import _confirmation_spam_score_for_path
from agenticx.runtime.agent_runtime import _persist_steer_text, _tool_args_complete
from agenticx.runtime.harden_flags import max_overflow_retries
from agenticx.runtime.loop_detector import LoopDetector, TurnSteerQueue


def test_loop_detector_generic_repeat_warning() -> None:
    detector = LoopDetector(warning_threshold=3, critical_threshold=5)
    for _ in range(3):
        detector.record_call("list_files", "{}", has_progress=False)
    result = detector.check()
    assert result is not None
    assert result.detector == "generic_repeat"
    assert result.level == "warning"


def test_loop_detector_ping_pong_detected() -> None:
    detector = LoopDetector(warning_threshold=4, critical_threshold=6)
    calls = [("a", "{}"), ("b", "{}"), ("a", "{}"), ("b", "{}")]
    for name, sig in calls:
        detector.record_call(name, sig, has_progress=False)
    result = detector.check()
    assert result is not None
    assert result.detector in {"ping_pong", "generic_repeat", "no_progress"}


def test_loop_detector_no_progress_critical() -> None:
    detector = LoopDetector(warning_threshold=3, critical_threshold=4)
    for idx in range(4):
        detector.record_call(f"tool{idx}", "{}", has_progress=False)
    result = detector.check()
    assert result is not None
    assert result.level == "critical"


def test_loop_detector_tool_saturation_detected() -> None:
    """Many file_write calls with different args but mostly no real progress."""
    detector = LoopDetector(warning_threshold=4, critical_threshold=6)
    marks = [False, False, True, False, False, False]
    for i, hp in enumerate(marks):
        detector.record_call("file_write", f'{{"path":"p{i}"}}', has_progress=hp)
    result = detector.check()
    assert result is not None
    assert result.detector == "tool_saturation"


def test_confirmation_spam_score_for_path() -> None:
    assert _confirmation_spam_score_for_path("/tmp/TODO_FINAL.md") >= 2
    assert _confirmation_spam_score_for_path("/tmp/README.md") == 0


def test_file_edit_first_failure_emits_read_nudge() -> None:
    detector = LoopDetector(warning_threshold=6, critical_threshold=12)
    detector.record_call(
        "file_edit",
        '{"path":"/tmp/demo.html","old_text":"old"}',
        has_progress=False,
        result_text=(
            "ERROR: file_edit_old_text_not_found: old_text not found in file. "
            "Call file_read for the target range."
        ),
    )

    result = detector.check()

    assert result is not None
    assert result.detector == "file_edit_failure"
    assert result.level == "warning"
    assert result.nudge is not None
    assert "file_read" in result.nudge


def test_file_edit_second_failure_on_same_path_is_critical() -> None:
    detector = LoopDetector(warning_threshold=6, critical_threshold=12)
    for old_text in ("old-a", "old-b"):
        detector.record_call(
            "file_edit",
            f'{{"path":"/tmp/demo.html","old_text":"{old_text}"}}',
            has_progress=False,
            result_text="ERROR: file_edit_old_text_not_found: old_text not found in file.",
        )

    result = detector.check()

    assert result is not None
    assert result.detector == "file_edit_failure"
    assert result.level == "critical"
    assert "2" in result.message


def test_successful_file_edit_resets_path_failure_count() -> None:
    detector = LoopDetector(warning_threshold=6, critical_threshold=12)
    signature = '{"path":"/tmp/demo.html","old_text":"old"}'
    detector.record_call(
        "file_edit",
        signature,
        has_progress=False,
        result_text="ERROR: file_edit_old_text_not_found: old_text not found in file.",
    )
    detector.record_call(
        "file_edit",
        signature,
        has_progress=True,
        result_text="OK: edited /tmp/demo.html",
    )
    detector.record_call(
        "file_edit",
        signature,
        has_progress=False,
        result_text="ERROR: file_edit_old_text_not_found: old_text not found in file.",
    )

    result = detector.check()

    assert result is not None
    assert result.detector == "file_edit_failure"
    assert result.level == "warning"


def test_has_seen_result_detects_same_digest() -> None:
    detector = LoopDetector()
    detector.record_call(
        "file_read",
        '{"path":"/tmp/a.txt"}',
        has_progress=True,
        result_digest="abc123",
    )
    assert detector.has_seen_result("file_read", '{"path":"/tmp/a.txt"}', "abc123") is True
    assert detector.has_seen_result("file_read", '{"path":"/tmp/a.txt"}', "other") is False
    assert detector.has_seen_result("file_read", '{"path":"/tmp/b.txt"}', "abc123") is False


def test_has_seen_result_clears_on_reset() -> None:
    detector = LoopDetector()
    detector.record_call(
        "file_read",
        '{"path":"/tmp/a.txt"}',
        has_progress=True,
        result_digest="abc123",
    )
    detector.reset()
    assert detector.has_seen_result("file_read", '{"path":"/tmp/a.txt"}', "abc123") is False


def test_loop_detector_reset_clears_file_edit_failures() -> None:
    detector = LoopDetector(warning_threshold=6, critical_threshold=12)
    signature = '{"path":"/tmp/demo.html"}'
    detector.record_call(
        "file_edit",
        signature,
        has_progress=False,
        result_text="ERROR: file_edit_old_text_not_found",
    )
    detector.reset()

    assert detector.check() is None


def test_empty_plain_repeat_requests_full_answer() -> None:
    detector = LoopDetector(warning_threshold=3, critical_threshold=4)
    issue = None
    for _ in range(4):
        issue = detector.note_assistant_round("", had_tool_calls=False)
    assert issue is not None
    assert issue.detector == "plain_repeat"
    assert issue.nudge == "请给出完整正文。"


def test_tool_round_clears_plain_repeat() -> None:
    detector = LoopDetector(warning_threshold=3, critical_threshold=4)
    detector.note_assistant_round("", had_tool_calls=False)
    detector.note_assistant_round("let me look", had_tool_calls=True)
    issue = detector.note_assistant_round("", had_tool_calls=False)
    assert issue is None


def test_length_truncated_tools_are_not_a_final_answer() -> None:
    detector = LoopDetector(warning_threshold=3, critical_threshold=4)
    issue = None
    for _ in range(4):
        issue = detector.note_assistant_round(
            "let me look that up",
            had_tool_calls=True,
            length_truncated=True,
            tool_args_complete=False,
        )
    assert issue is not None
    assert issue.detector == "length_truncated_tools"
    assert _tool_args_complete([{"function": {"arguments": ""}}]) is False


def test_steer_persist_failure_and_stop_drop() -> None:
    queue = TurnSteerQueue()
    queue.enqueue("follow up")
    assert queue.drain(lambda _text: False) == []
    session = type("S", (), {"chat_history": []})()
    injected = queue.drain(lambda text: _persist_steer_text(session, text))
    assert injected == ["follow up"]
    assert session.chat_history[0]["content"] == "follow up"
    queue.enqueue("late")
    queue.discard()
    assert queue.drain(lambda text: _persist_steer_text(session, text)) == []
    assert len(session.chat_history) == 1


def test_overflow_retry_is_once_per_turn() -> None:
    assert min(1, max_overflow_retries()) <= 1


def test_same_args_same_error_warns_then_halts() -> None:
    detector = LoopDetector(warning_threshold=8, critical_threshold=15)
    args = '{"action":"patch","name":"x","patch_token":"old"}'
    err = "ERROR[VALIDATION]: patch token outdated: file changed since preview. 重新 preview 获取新 token"
    detector.record_call("skill_manage", args, has_progress=False, result_text=err)
    assert detector.check() is None
    detector.record_call("skill_manage", args, has_progress=False, result_text=err)
    warn = detector.check()
    assert warn is not None
    assert warn.detector == "same_args_same_error"
    assert warn.level == "warning"
    assert warn.nudge and "preview" in warn.nudge.lower()
    detector.record_call("skill_manage", args, has_progress=False, result_text=err)
    crit = detector.check()
    assert crit is not None
    assert crit.level == "critical"


def test_same_args_same_error_skill_already_exists() -> None:
    detector = LoopDetector()
    args = '{"action":"create","name":"archify"}'
    err = "ERROR: skill already exists. Use action=view"
    detector.record_call("skill_manage", args, has_progress=False, result_text=err)
    detector.record_call("skill_manage", args, has_progress=False, result_text=err)
    result = detector.check()
    assert result is not None
    assert result.detector == "same_args_same_error"
    assert "exists" in result.message.lower() or "已存在" in result.message

def test_same_class_sandbox_eperm_skillhub_halts_with_different_args() -> None:
    """Same-class ~/.skillhub EPERM should halt even when bash args change."""
    detector = LoopDetector(warning_threshold=8, critical_threshold=15)
    err1 = "bash: /Users/damon/.skillhub/skills_store_cli.py: Operation not permitted"
    err2 = "ERROR: cannot read ~/.skillhub/config.json: Operation not permitted"
    err3 = "PermissionError: [Errno 1] Operation not permitted: '/Users/x/.skillhub/bin'"
    detector.record_call("bash_exec", '{"cmd":"skillhub --version"}', has_progress=False, result_text=err1)
    assert detector.check() is None
    detector.record_call("bash_exec", '{"cmd":"skillhub search archify"}', has_progress=False, result_text=err2)
    warn = detector.check()
    assert warn is not None
    assert warn.detector == "same_class_sandbox_error"
    assert warn.level == "warning"
    assert warn.nudge and "Desktop" in warn.nudge
    detector.record_call("bash_exec", '{"cmd":"cat ~/.skillhub/config.json"}', has_progress=False, result_text=err3)
    crit = detector.check()
    assert crit is not None
    assert crit.level == "critical"
    assert crit.detector == "same_class_sandbox_error"


def test_same_class_sandbox_tmp_eperm_with_different_args() -> None:
    detector = LoopDetector()
    err1 = "mkdir: /tmp/skillhub_dl: Operation not permitted"
    err2 = "mktemp: failed to create file via template in /tmp: Operation not permitted"
    detector.record_call("bash_exec", '{"cmd":"mkdir /tmp/skillhub_dl"}', has_progress=False, result_text=err1)
    detector.record_call("bash_exec", '{"cmd":"mktemp /tmp/foo.XXXX"}', has_progress=False, result_text=err2)
    result = detector.check()
    assert result is not None
    assert result.detector == "same_class_sandbox_error"
    assert result.nudge and "Desktop" in result.nudge


def test_same_class_path_escapes_with_different_args() -> None:
    detector = LoopDetector()
    err1 = "ERROR: path escapes workspace: ~/.agenticx/skills"
    err2 = "ERROR: path escapes workspace: /Users/damon/.agenticx/skills/registry"
    detector.record_call("bash_exec", '{"cmd":"ls ~/.agenticx/skills"}', has_progress=False, result_text=err1)
    detector.record_call("bash_exec", '{"cmd":"ls /Users/damon/.agenticx/skills/registry"}', has_progress=False, result_text=err2)
    result = detector.check()
    assert result is not None
    assert result.detector == "same_class_sandbox_error"
    assert "path_escapes" in result.message or "workspace" in result.message.lower()


def test_same_args_same_error_still_works_alongside_same_class() -> None:
    """Existing same-args deterministic skill_manage tips must keep working."""
    detector = LoopDetector()
    args = '{"action":"create","name":"archify"}'
    err = "ERROR: skill already exists. Use action=view"
    detector.record_call("skill_manage", args, has_progress=False, result_text=err)
    detector.record_call("skill_manage", args, has_progress=False, result_text=err)
    result = detector.check()
    assert result is not None
    assert result.detector == "same_args_same_error"
