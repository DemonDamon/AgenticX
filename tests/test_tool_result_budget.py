#!/usr/bin/env python3
"""Smoke tests for tool_result_budget (M1).

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

import pytest

from agenticx.runtime.tool_result_budget import (
    ToolResultBudgetConfig,
    apply_tool_result_budget,
    archive_tool_result,
    get_result_class,
    record_tool_result_meta,
)


@dataclass
class MockSession:
    _session_id: str = "sess-budget-001"
    _tool_result_meta: Dict[str, Any] = field(default_factory=dict)
    _tool_result_tokens_session: int = 0


def test_get_result_class_defaults_medium() -> None:
    assert get_result_class("unknown_tool", "hi") == "medium"


def test_get_result_class_file_read_is_large() -> None:
    assert get_result_class("file_read", "x") == "large"


def test_archive_and_record_meta(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    cfg = ToolResultBudgetConfig(archive_subdir="tool_archives")
    big = "A" * 500
    path = archive_tool_result(
        session,
        round_idx=1,
        tool_call_id="call_abc",
        tool_name="file_read",
        content=big,
        cfg=cfg,
    )
    assert path is not None
    assert path.is_file()
    assert path.read_text(encoding="utf-8") == big
    record_tool_result_meta(
        session,
        round_idx=1,
        tool_call_id="call_abc",
        tool_name="file_read",
        content=big,
        archive_path=path,
    )
    assert session._tool_result_tokens_session > 0


def test_apply_budget_replaces_old_large_results(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    cfg = ToolResultBudgetConfig(enabled=True, keep_rounds=2, archive_subdir="tool_archives")
    content = "B" * 8000
    archive_path = archive_tool_result(
        session,
        round_idx=1,
        tool_call_id="c1",
        tool_name="file_read",
        content=content,
        cfg=cfg,
    )
    record_tool_result_meta(
        session,
        round_idx=1,
        tool_call_id="c1",
        tool_name="file_read",
        content=content,
        archive_path=archive_path,
    )
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": "sys"},
        {
            "role": "tool",
            "tool_call_id": "c1",
            "name": "file_read",
            "content": content[:4000],
        },
    ]
    out, stats = apply_tool_result_budget(
        messages,
        current_round=4,
        session=session,
        cfg=cfg,
    )
    assert stats.archived_replaced == 1
    tool_msg = [m for m in out if m.get("role") == "tool"][0]
    assert "[tool-result-archived]" in tool_msg["content"]
    assert str(archive_path) in tool_msg["content"]
