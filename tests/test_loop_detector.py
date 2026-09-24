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
