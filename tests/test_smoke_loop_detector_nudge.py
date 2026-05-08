#!/usr/bin/env python3
"""Smoke: LoopDetector optional nudge from last success fingerprint (FR-8).

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.loop_detector import LoopCheckResult, LoopDetector


def test_nudge_carries_last_success_fingerprint() -> None:
    det = LoopDetector(warning_threshold=3, critical_threshold=5)
    sig = '{"q": 1}'
    det.record_call(
        "find",
        sig,
        has_progress=True,
        result_fingerprint="/Users/x/tech-daily-news-output",
    )
    det.record_call("find", sig, has_progress=False)
    det.record_call("find", sig, has_progress=False)
    r = det.check()
    assert r is not None
    assert r.nudge
    assert "find" in r.nudge
    assert "tech-daily-news-output" in r.nudge


def test_nudge_absent_when_no_prior_success() -> None:
    det = LoopDetector(warning_threshold=3, critical_threshold=5)
    sig = '{"q": 1}'
    det.record_call("find", sig, has_progress=False)
    det.record_call("find", sig, has_progress=False)
    det.record_call("find", sig, has_progress=False)
    r = det.check()
    assert r is not None
    assert r.nudge is None


def test_existing_loopcheckresult_fields_unchanged() -> None:
    det = LoopDetector(warning_threshold=3, critical_threshold=5)
    sig = '{"q": 1}'
    det.record_call(
        "find",
        sig,
        has_progress=True,
        result_fingerprint="/tmp/x",
    )
    for _ in range(2):
        det.record_call("find", sig, has_progress=False)
    r = det.check()
    assert isinstance(r, LoopCheckResult)
    assert r.stuck is True
    assert r.level in ("warning", "critical")
    assert r.detector == "generic_repeat"
    assert "find" in r.message
