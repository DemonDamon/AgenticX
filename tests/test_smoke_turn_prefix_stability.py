#!/usr/bin/env python3
"""Guards for turn-prefix stability: batch archive, tool order, implicit cache."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict

from agenticx.cli.agent_tools import studio_tools_for_session
from agenticx.runtime.prompt_cache_policy import (
    PromptCacheConfig,
    apply_prompt_cache_breakpoints,
)
from agenticx.runtime.tool_result_budget import (
    ToolResultBudgetConfig,
    apply_tool_result_budget,
    record_tool_result_meta,
)
from agenticx.runtime.tool_search import (
    ToolSearchConfig,
    project_tools_for_round,
)
from agenticx.runtime.tool_search_runtime import build_runtime_context
from agenticx.studio.session_manager import StudioSession


@dataclass
class _BudgetSession:
    _session_id: str = "sess-prefix-001"
    _tool_result_meta: Dict[str, Any] = field(default_factory=dict)
    _tool_result_tokens_session: int = 0


def _tool_msg(call_id: str, content: str) -> dict:
    return {
        "role": "tool",
        "tool_call_id": call_id,
        "name": "file_read",
        "content": content,
    }


def test_archive_waits_until_batch_threshold() -> None:
    session = _BudgetSession()
    cfg = ToolResultBudgetConfig(enabled=True, keep_rounds=0, archive_batch_tokens=8000)
    small = "S" * 400
    record_tool_result_meta(
        session, round_idx=0, tool_call_id="c-small", tool_name="file_read", content=small
    )
    out, stats = apply_tool_result_budget(
        [_tool_msg("c-small", small)],
        current_round=2,
        session=session,
        cfg=cfg,
    )
    assert stats.archived_replaced == 0
    assert "[tool-result-archived]" not in out[0]["content"]


def test_archive_fires_when_eligible_tokens_cross_batch() -> None:
    session = _BudgetSession()
    cfg = ToolResultBudgetConfig(enabled=True, keep_rounds=0, archive_batch_tokens=8000)
    big = "B" * 40_000
    record_tool_result_meta(
        session, round_idx=0, tool_call_id="c-big", tool_name="file_read", content=big
    )
    out, stats = apply_tool_result_budget(
        [_tool_msg("c-big", big)],
        current_round=2,
        session=session,
        cfg=cfg,
    )
    assert stats.archived_replaced == 1
    assert "[tool-result-archived]" in out[0]["content"]


def test_already_archived_results_are_not_restored() -> None:
    session = _BudgetSession()
    cfg = ToolResultBudgetConfig(enabled=True, keep_rounds=0, archive_batch_tokens=8000)
    archived = "[tool-result-archived] tool=file_read\none_line_summary: kept"
    record_tool_result_meta(
        session, round_idx=0, tool_call_id="c-old", tool_name="file_read", content="X" * 40_000
    )
    out, stats = apply_tool_result_budget(
        [_tool_msg("c-old", archived)],
        current_round=9,
        session=session,
        cfg=cfg,
    )
    assert stats.archived_replaced == 0
    assert out[0]["content"] == archived


def test_projected_tools_order_is_deterministic() -> None:
    session = StudioSession()
    pool = studio_tools_for_session(session)
    ctx = build_runtime_context(
        session=session, full_openai_tools=pool, config=ToolSearchConfig(mode="always")
    )
    first = [
        t["function"]["name"]
        for t in project_tools_for_round(ctx, full_openai_tools=pool)
    ]
    second = [
        t["function"]["name"]
        for t in project_tools_for_round(ctx, full_openai_tools=pool)
    ]
    assert first == second


def test_kimi_uses_implicit_prefix_without_cache_control() -> None:
    cfg = PromptCacheConfig(enabled=True, provider_allowlist=["anthropic"])
    messages = [{"role": "system", "content": "stable prefix " * 80}]
    out, telemetry = apply_prompt_cache_breakpoints(messages, provider_name="kimi", cfg=cfg)
    assert telemetry["cache_mode"] == "implicit_prefix"
    assert out[0].get("cache_control") is None
