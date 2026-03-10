#!/usr/bin/env python3
"""Tests for TodoManager constraints and rendering.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.runtime.todo_manager import MAX_TODO_ITEMS, TodoManager


def test_todo_manager_update_and_render() -> None:
    manager = TodoManager()
    rendered = manager.update(
        [
            {"content": "分析需求", "status": "completed", "active_form": "完成分析"},
            {"content": "实现功能", "status": "in_progress", "active_form": "正在实现"},
            {"content": "补充测试", "status": "pending", "active_form": "等待开始"},
        ]
    )
    assert "[x] 分析需求" in rendered
    assert "[>] 实现功能 <- 正在实现" in rendered
    assert "[ ] 补充测试" in rendered
    assert "(1/3 completed)" in rendered


def test_todo_manager_rejects_multiple_in_progress() -> None:
    manager = TodoManager()
    with pytest.raises(ValueError, match="only one task can be in_progress"):
        manager.update(
            [
                {"content": "A", "status": "in_progress", "active_form": "doing A"},
                {"content": "B", "status": "in_progress", "active_form": "doing B"},
            ]
        )


def test_todo_manager_rejects_too_many_items() -> None:
    manager = TodoManager()
    items = []
    for idx in range(MAX_TODO_ITEMS + 1):
        items.append(
            {
                "content": f"task-{idx}",
                "status": "pending",
                "active_form": "queued",
            }
        )
    with pytest.raises(ValueError, match="max"):
        manager.update(items)
