#!/usr/bin/env python3
"""Tests for scratchpad and memory append tools.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession
from agenticx.runtime.token_budget import TOKEN_BUDGET_SCRATCHPAD_KEY


def test_scratchpad_write_read_and_list() -> None:
    session = StudioSession()
    write_result = agent_tools.dispatch_tool(
        "scratchpad_write",
        {"key": "analysis", "value": "step-1"},
        session,
    )
    assert write_result.startswith("OK:")
    read_result = agent_tools.dispatch_tool(
        "scratchpad_read",
        {"key": "analysis"},
        session,
    )
    assert read_result == "step-1"
    list_result = agent_tools.dispatch_tool(
        "scratchpad_read",
        {"list_only": True},
        session,
    )
    assert "analysis" in list_result


def test_token_budget_scratchpad_entry_is_reserved_and_hidden() -> None:
    session = StudioSession()
    session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] = {
        "version": 1,
        "cumulative_input": 123,
        "cumulative_output": 45,
    }
    session.scratchpad["notes"] = "visible"

    write_result = agent_tools.dispatch_tool(
        "scratchpad_write",
        {"key": TOKEN_BUDGET_SCRATCHPAD_KEY, "value": "reset"},
        session,
    )
    assert write_result.startswith("ERROR: key is reserved")
    assert isinstance(session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY], dict)

    read_result = agent_tools.dispatch_tool(
        "scratchpad_read",
        {"key": TOKEN_BUDGET_SCRATCHPAD_KEY},
        session,
    )
    assert read_result.startswith("ERROR: key is reserved")

    list_result = agent_tools.dispatch_tool(
        "scratchpad_read",
        {"list_only": True},
        session,
    )
    assert list_result == "notes"


def test_memory_append_daily_and_long_term(monkeypatch, tmp_path: Path) -> None:
    """memory_append 分别写进当天的日记和长期 MEMORY.md。

    原来的写法是 monkeypatch agent_tools 上的 ensure_workspace /
    append_daily_memory / append_long_term_memory。但这三个名字是在
    _tool_memory_append 函数体里 `from agenticx.workspace.loader import ...` 现取的，
    打在 agent_tools 模块上根本改不到——桩形同虚设，用例写到的是真实工作区。
    改成只把工作区解析指到 tmp_path，让真正的 append 逻辑跑起来。
    """
    from datetime import date

    from agenticx.workspace import loader as workspace_loader

    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(
        workspace_loader, "resolve_subject_workspace_dir", lambda **_kwargs: workspace
    )
    monkeypatch.setattr(workspace_loader, "resolve_workspace_dir", lambda *_a, **_k: workspace)
    monkeypatch.setattr("builtins.input", lambda _prompt: "y")

    session = StudioSession()
    result_daily = agent_tools.dispatch_tool(
        "memory_append",
        {"target": "daily", "content": "daily-note"},
        session,
    )
    # 返回文案带上了 scope（memory_append 现在区分 subject / user_global 两种写入范围）。
    assert result_daily.startswith("OK: appended to daily"), result_daily
    assert "scope=subject" in result_daily
    today_file = workspace / "memory" / f"{date.today().isoformat()}.md"
    assert "daily-note" in today_file.read_text(encoding="utf-8")

    result_long = agent_tools.dispatch_tool(
        "memory_append",
        {"target": "long_term", "content": "long-note"},
        session,
    )
    assert result_long.startswith("OK: appended to long_term"), result_long
    assert "scope=subject" in result_long
    assert "long-note" in (workspace / "MEMORY.md").read_text(encoding="utf-8")
