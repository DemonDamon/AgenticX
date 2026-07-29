#!/usr/bin/env python3
"""Token-window primary trigger for ContextCompactor (FR-1/FR-2/FR-3/FR-4).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging

from agenticx.runtime.compactor import ContextCompactor
from agenticx.runtime.model_context_window import resolve_context_window


class _Resp:
    def __init__(self, content: str) -> None:
        self.content = content


class _LLM:
    def invoke(self, *_args, **_kwargs):
        return _Resp("关键决策: A；工具结果: B；文件改动: C；风险: D")


def test_compactor_default_does_not_compact_on_message_count_alone() -> None:
    """Default constructor must not full-compact on ~40 short messages alone."""
    compactor = ContextCompactor(_LLM())
    messages = [{"role": "user", "content": "x" * 20} for _ in range(40)]
    compacted, changed, summary, count, pending_q = asyncio.run(
        compactor.maybe_compact(messages, model="glm-5")
    )
    assert changed is False
    assert summary == ""
    assert count == 0
    assert pending_q == ""
    assert compacted == messages


def test_compactor_triggers_on_token_threshold(monkeypatch) -> None:
    """Full compact when estimated tokens exceed autocompact threshold."""
    compactor = ContextCompactor(_LLM())
    window = resolve_context_window("glm-5")
    threshold = compactor._compute_autocompact_threshold(window)
    # Force estimate above threshold without building multi-MB fixtures.
    monkeypatch.setattr(
        ContextCompactor,
        "_estimate_token_usage",
        lambda self, messages: threshold + 1,
    )
    messages = [{"role": "user", "content": f"msg-{i}"} for i in range(12)]
    compacted, changed, summary, count, _pending = asyncio.run(
        compactor.maybe_compact(messages, model="glm-5")
    )
    assert changed is True
    assert count > 0
    assert summary
    assert compacted[0]["role"] == "system"
    assert "[compacted]" in compacted[0]["content"]
    assert compactor.last_trigger_reason == "token_window"


def test_compactor_window_matches_resolve_context_window() -> None:
    """AC-1: Compactor window for glm-5 matches shared resolve_context_window."""
    compactor = ContextCompactor(_LLM())
    assert compactor._resolve_context_window_tokens("glm-5") == resolve_context_window("glm-5")
    assert compactor._resolve_context_window_tokens("glm-5") == 128_000


def test_compactor_buffer_env_tightens_threshold(monkeypatch) -> None:
    """AC-3: Raising buffer lowers the autocompact threshold."""
    monkeypatch.delenv("AGX_AUTOCOMPACT_PCT", raising=False)
    monkeypatch.setenv("AGX_COMPACT_SUMMARY_RESERVE_TOKENS", "20000")
    monkeypatch.setenv("AGX_COMPACT_BUFFER_TOKENS", "13000")
    base = ContextCompactor(_LLM())
    window = 128_000
    t_base = base._compute_autocompact_threshold(window)

    monkeypatch.setenv("AGX_COMPACT_BUFFER_TOKENS", "40000")
    tighter = ContextCompactor(_LLM())
    t_tight = tighter._compute_autocompact_threshold(window)
    assert t_tight < t_base


def test_compactor_logs_trigger_reason_on_token_path(monkeypatch, caplog) -> None:
    """AC-4: Compact log includes trigger_reason=token_window."""
    compactor = ContextCompactor(_LLM())
    window = resolve_context_window("glm-5")
    threshold = compactor._compute_autocompact_threshold(window)
    monkeypatch.setattr(
        ContextCompactor,
        "_estimate_token_usage",
        lambda self, messages: threshold + 50,
    )
    messages = [{"role": "user", "content": f"msg-{i}"} for i in range(12)]
    with caplog.at_level(logging.INFO, logger="agenticx.runtime.compactor"):
        asyncio.run(compactor.maybe_compact(messages, model="glm-5"))
    assert any("trigger_reason=token_window" in r.message for r in caplog.records)


def test_compactor_message_escape_explicit_override() -> None:
    """Explicit low threshold_messages still forces compact (escape / test control)."""
    # Rename note: former default-20 behavior is now opt-in via explicit override.
    compactor = ContextCompactor(_LLM(), threshold_messages=8, retain_recent_messages=4)
    messages = [{"role": "user", "content": f"msg-{i}"} for i in range(12)]
    _compacted, changed, _summary, count, _pending = asyncio.run(
        compactor.maybe_compact(messages, model="")
    )
    assert changed is True
    assert count == 8
    assert compactor.last_trigger_reason == "message_escape"
