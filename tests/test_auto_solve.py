#!/usr/bin/env python3
"""Tests for auto-solve strategy."""

from __future__ import annotations

from agenticx.runtime.auto_solve import AutoSolveMode


def test_auto_solve_simple_request() -> None:
    mode = AutoSolveMode()
    result = mode.enrich_prompt("请解释这个报错是什么意思")
    assert result["complexity"] == "simple"
    assert result["single_agent_preferred"] is True


def test_auto_solve_complex_request() -> None:
    mode = AutoSolveMode()
    result = mode.enrich_prompt("请帮我重构多智能体调度系统并加入自动恢复能力")
    assert result["complexity"] == "complex"
    assert "AutoSolve 模式" in result["prompt"]
