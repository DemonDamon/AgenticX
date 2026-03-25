#!/usr/bin/env python3
"""Tests for LoopDetector and anti-futility helpers.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.agent_runtime import _confirmation_spam_score_for_path
from agenticx.runtime.loop_detector import LoopDetector


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
