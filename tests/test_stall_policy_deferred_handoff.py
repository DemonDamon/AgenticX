#!/usr/bin/env python3
"""Deferred handoff routes through supervisor evaluate_stall_for_continuation.

Plan-Id: 2026-06-29-deferred-handoff-stall-detection

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.stall_policy import (
    StallEvaluateInput,
    evaluate_stall_for_continuation,
)


def test_deferred_handoff_idle_allows_auto_continue() -> None:
    """idle + handoff body -> should_stall=True, can_continue=True."""
    last = {
        "role": "assistant",
        "content": "我现在进入第二项：直接优化 composition",
    }
    result = evaluate_stall_for_continuation(
        StallEvaluateInput(
            execution_state="idle",
            sse_active=False,
            silent_seconds=130.0,
            stall_detect_silence_seconds=90,
            last_message=last,
            session_age_seconds=300.0,
        )
    )
    assert result.should_auto_continue is True
    assert result.continue_reason == "stall"


def test_idle_with_real_final_does_not_continue() -> None:
    """Regression: idle + a normal final reply must NOT auto-continue."""
    last = {"role": "assistant", "content": "任务已全部完成，文件已保存到 /tmp/out.mp4。"}
    result = evaluate_stall_for_continuation(
        StallEvaluateInput(
            execution_state="idle",
            sse_active=False,
            silent_seconds=130.0,
            stall_detect_silence_seconds=90,
            last_message=last,
            session_age_seconds=300.0,
        )
    )
    assert result.should_auto_continue is False
