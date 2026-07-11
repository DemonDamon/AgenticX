#!/usr/bin/env python3
"""Tests for native connector prompt context.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.runtime.prompts.meta_agent import _build_native_connectors_context


def test_native_tencent_meeting_connection_is_not_treated_as_mcp(tmp_path: Path) -> None:
    status_path = tmp_path / "native-status.json"
    status_path.write_text(
        json.dumps(
            {
                "version": 1,
                "connectors": {
                    "tencent-meeting": {
                        "connected": True,
                        "updated_at": "2026-07-11T00:00:00.000Z",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    context = _build_native_connectors_context(status_path)

    assert "腾讯会议 [已连接]" in context
    assert "Skill `tencent-meeting`" in context
    assert "不是 MCP" in context
    assert "tencent-meeting-mcp" in context


def test_missing_native_connector_status_returns_empty_context(tmp_path: Path) -> None:
    context = _build_native_connectors_context(tmp_path / "missing.json")

    assert context == ""
