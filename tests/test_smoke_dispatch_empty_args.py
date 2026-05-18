#!/usr/bin/env python3
"""Smoke tests for `dispatch_tool_async` empty-arguments guidance (FR-B).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any, Dict

import pytest

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])

from agenticx.cli.agent_tools import dispatch_tool_async


class _StubSession:
    """Minimal session stub for dispatch_tool_async."""

    def __init__(self) -> None:
        self.scratchpad: Dict[str, Any] = {}
        self.artifacts: Dict[str, Any] = {}


def _run(name: str, arguments: Dict[str, Any]) -> str:
    return asyncio.run(dispatch_tool_async(name, arguments, _StubSession()))


def test_file_write_empty_args_returns_strong_guidance():
    text = _run("file_write", {})
    assert text.startswith("ERROR: file_write() called with empty arguments.")
    # 必须列出 path/content
    assert "path" in text and "content" in text
    # 必须强引导立即重试，而不是只说"please provide"
    assert "立即重新调用" in text
    # 字段释义必须出现
    assert "绝对路径" in text
    assert "不能是空字符串" in text
    # 必须告诉模型回头看 anchor 标签找路径
    assert "[user-pending-question]" in text or "[user-goal-anchor]" in text


def test_file_edit_empty_args_returns_strong_guidance():
    text = _run("file_edit", {})
    assert "ERROR: file_edit() called with empty arguments." in text
    assert "old_string" in text and "new_string" in text
    assert "立即重新调用" in text


def test_unknown_required_tool_falls_back_to_generic_hint():
    # schedule_task 是已知工具且 required 非空，应有定制提示
    text = _run("schedule_task", {})
    assert "schedule_task" in text
    assert "立即重新调用" in text
