#!/usr/bin/env python3
"""Tests for scratchpad and memory append tools.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession


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


def test_memory_append_daily_and_long_term(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    memory_dir = workspace / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    daily = memory_dir / "2026-03-10.md"
    daily.write_text("# Daily Memory\n- Date: 2026-03-10\n- Notes:\n", encoding="utf-8")
    long_term = workspace / "MEMORY.md"
    long_term.write_text("# MEMORY.md\n", encoding="utf-8")

    monkeypatch.setattr(agent_tools, "ensure_workspace", lambda **_kwargs: workspace)
    monkeypatch.setattr(agent_tools, "append_daily_memory", lambda _w, note: daily.write_text(daily.read_text(encoding="utf-8") + f"\n  - {note}\n", encoding="utf-8"))
    monkeypatch.setattr(agent_tools, "append_long_term_memory", lambda _w, note: long_term.write_text(long_term.read_text(encoding="utf-8") + f"\n- {note}\n", encoding="utf-8"))
    monkeypatch.setattr("builtins.input", lambda _prompt: "y")

    session = StudioSession()
    result_daily = agent_tools.dispatch_tool(
        "memory_append",
        {"target": "daily", "content": "daily-note"},
        session,
    )
    assert result_daily == "OK: appended to daily"
    assert "daily-note" in daily.read_text(encoding="utf-8")

    result_long = agent_tools.dispatch_tool(
        "memory_append",
        {"target": "long_term", "content": "long-note"},
        session,
    )
    assert result_long == "OK: appended to long_term"
    assert "long-note" in long_term.read_text(encoding="utf-8")
