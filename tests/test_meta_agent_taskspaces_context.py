#!/usr/bin/env python3
"""Tests for taskspace block injected into agent system prompts.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

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
    assert "禁止" in block and "$HOME" in block
    assert "默认工作区" in block
    assert "一次 list_files" in block


def test_build_taskspaces_context_includes_reference_mounts(tmp_path: Path) -> None:
    default = tmp_path / "default"
    default.mkdir()
    (default / ".agx-mounts.json").write_text(
        json.dumps(
            {
                "version": 1,
                "mounts": [
                    {
                        "name": "调研报告",
                        "mode": "reference",
                        "source_path": "/Users/demo/Downloads/调研报告",
                        "linked_at": 1.0,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    block = _build_taskspaces_context(
        [{"id": "default", "label": "默认工作区", "path": str(default)}]
    )
    assert "调研报告" in block
    assert "/Users/demo/Downloads/调研报告" in block
    assert "list_files(\".\") 即列此目录" in block
    assert "禁止拼" in block


def test_build_taskspaces_context_empty() -> None:
    assert _build_taskspaces_context([]) == ""
    assert _build_taskspaces_context(None) == ""
