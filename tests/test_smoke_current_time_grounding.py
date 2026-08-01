#!/usr/bin/env python3
"""Smoke tests for current time grounding in agent prompts and tools.

Author: Damon Li
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

from agenticx.cli.agent_tools import (
    STUDIO_TOOLS,
    _tool_get_current_datetime,
    studio_tool_is_concurrency_safe,
)
from agenticx.runtime.prompts.current_time import (
    build_current_time_block,
    get_current_time_facts,
)
from agenticx.runtime.prompts.meta_agent import _build_web_search_capability_block

REPO_ROOT = Path(__file__).resolve().parents[1]
_WEEKDAY_CN = ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日")


def test_ac1_build_current_time_block_contains_today_and_rules() -> None:
    block = build_current_time_block()
    today = datetime.now().strftime("%Y-%m-%d")
    assert "## 当前时间" in block
    assert today in block
    assert "禁止" in block
    assert "get_current_datetime" in block


def test_ac2_get_current_time_facts_matches_local_clock() -> None:
    facts = get_current_time_facts()
    expected_date = datetime.now().astimezone().strftime("%Y-%m-%d")
    assert facts["date"] == expected_date
    assert facts["weekday_cn"] in _WEEKDAY_CN


@pytest.mark.parametrize(
    "rel_path,min_count",
    [
        ("agenticx/runtime/prompts/meta_agent.py", 1),
        ("agenticx/studio/server.py", 2),
        ("agenticx/runtime/meta_tools.py", 1),
        ("agenticx/runtime/team_manager.py", 1),
        ("agenticx/runtime/group_router.py", 1),
    ],
)
def test_ac3_prompt_entrypoints_inject_current_time_block(
    rel_path: str, min_count: int
) -> None:
    text = (REPO_ROOT / rel_path).read_text(encoding="utf-8")
    assert text.count("build_current_time_block") >= min_count


def test_ac4_web_search_capability_block_has_hard_exception() -> None:
    block = _build_web_search_capability_block()
    assert "禁止" in block
    assert "get_current_datetime" in block
    assert "[N]" in block


def test_ac5_studio_tools_schema_for_datetime_and_web_search() -> None:
    by_name = {
        str((t.get("function") or {}).get("name", "")).strip(): t
        for t in STUDIO_TOOLS
        if isinstance(t, dict)
    }
    assert "get_current_datetime" in by_name
    params = (by_name["get_current_datetime"].get("function") or {}).get("parameters") or {}
    assert params.get("properties") == {}

    web_desc = str((by_name["web_search"].get("function") or {}).get("description") or "")
    assert "Do NOT use this tool to determine the current date" in web_desc


def test_ac6_tool_get_current_datetime_returns_local_json() -> None:
    raw = _tool_get_current_datetime({})
    payload = json.loads(raw)
    today = datetime.now().astimezone().strftime("%Y-%m-%d")
    for key in ("date", "local_iso", "weekday_cn", "source"):
        assert key in payload
    assert payload["date"] == today
    assert payload["source"] == "local_system_clock"


def test_ac7_get_current_datetime_is_concurrency_safe() -> None:
    assert studio_tool_is_concurrency_safe("get_current_datetime", {}) is True
