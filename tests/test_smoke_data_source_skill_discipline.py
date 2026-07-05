"""Smoke tests for data source query discipline (prompt + optional flow guard).

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.runtime.prompts.meta_agent import _build_data_source_discipline


def test_data_source_discipline_mentions_key_tools():
    block = _build_data_source_discipline()
    assert "query_data_source" in block
    assert "list_data_sources" in block
    assert "编造" in block


def test_flow_guard_flags_uncited_quant_claim():
    from agenticx.runtime.data_source_flow_guard import detect_uncited_quant_claim

    reply = "火炬电子今天涨了5.18%。"
    nudge = detect_uncited_quant_claim(reply, tool_calls_this_turn=[])
    assert nudge is not None


def test_flow_guard_allows_claim_backed_by_tool_call():
    from agenticx.runtime.data_source_flow_guard import detect_uncited_quant_claim

    reply = "火炬电子今天涨了5.18%。"
    nudge = detect_uncited_quant_claim(reply, tool_calls_this_turn=["query_data_source"])
    assert nudge is None


def test_query_data_source_skill_passes_guard_scan():
    from agenticx.skills.guard import scan_skill, should_allow

    skill_dir = Path(__file__).resolve().parents[1] / "agenticx/skills/agenticx-query-data-source"
    result = scan_skill(skill_dir, source="builtin")
    allowed, _reason = should_allow(result, source="builtin")
    assert allowed
