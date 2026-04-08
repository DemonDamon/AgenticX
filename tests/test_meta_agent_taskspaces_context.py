#!/usr/bin/env python3
"""Tests for taskspace block injected into agent system prompts.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.prompts.meta_agent import _build_taskspaces_context


def test_build_taskspaces_context_includes_paths_and_labels() -> None:
    block = _build_taskspaces_context(
        [
            {"id": "default", "label": "默认工作区", "path": "/Users/demo/avatar-ws"},
            {"id": "ts-abc12345", "label": "我的项目", "path": "/Users/demo/myproject"},
        ]
    )
    assert "当前会话工作区" in block
    assert "/Users/demo/avatar-ws" in block
    assert "/Users/demo/myproject" in block
    assert "我的项目" in block


def test_build_taskspaces_context_empty() -> None:
    assert _build_taskspaces_context([]) == ""
    assert _build_taskspaces_context(None) == ""
