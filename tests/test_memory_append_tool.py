"""Test memory_append tool dispatch.

Author: Damon Li
"""

import json

import pytest
from unittest.mock import MagicMock, patch
from pathlib import Path


@pytest.mark.asyncio
async def test_memory_append_daily_writes_to_daily_memory():
    from agenticx.runtime.meta_tools import dispatch_meta_tool_async

    team_manager = MagicMock()
    session = MagicMock()
    session.workspace_dir = "/tmp/test_workspace"

    with patch("agenticx.runtime.meta_tools.append_daily_memory") as mock_daily, \
         patch("agenticx.runtime.meta_tools.append_long_term_memory"), \
         patch("agenticx.runtime.meta_tools.resolve_workspace_dir", return_value=Path("/tmp/test_workspace")), \
         patch("agenticx.runtime.meta_tools.WorkspaceMemoryStore") as mock_store_cls:
        mock_store_instance = MagicMock()
        mock_store_cls.return_value = mock_store_instance

        result = await dispatch_meta_tool_async(
            "memory_append",
            {"target": "daily", "content": "火山方舟 Coding Plan 入口在开通管理 Tab"},
            team_manager=team_manager,
            session=session,
        )
        data = json.loads(result)
        assert data["ok"] is True
        assert data["target"] == "daily"
        mock_daily.assert_called_once()
        mock_store_instance.index_workspace_sync.assert_called_once()


@pytest.mark.asyncio
async def test_memory_append_long_term_writes_to_memory_md():
    from agenticx.runtime.meta_tools import dispatch_meta_tool_async

    team_manager = MagicMock()
    session = MagicMock()
    session.workspace_dir = "/tmp/test_workspace"

    with patch("agenticx.runtime.meta_tools.append_long_term_memory") as mock_lt, \
         patch("agenticx.runtime.meta_tools.append_daily_memory"), \
         patch("agenticx.runtime.meta_tools.resolve_workspace_dir", return_value=Path("/tmp/test_workspace")), \
         patch("agenticx.runtime.meta_tools.WorkspaceMemoryStore") as mock_store_cls:
        mock_store_instance = MagicMock()
        mock_store_cls.return_value = mock_store_instance

        result = await dispatch_meta_tool_async(
            "memory_append",
            {"target": "long_term", "content": "用户偏好: 回复简洁直接"},
            team_manager=team_manager,
            session=session,
        )
        data = json.loads(result)
        assert data["ok"] is True
        assert data["target"] == "long_term"
        mock_lt.assert_called_once()
        mock_store_instance.index_workspace_sync.assert_called_once()


@pytest.mark.asyncio
async def test_memory_append_missing_content_returns_error():
    from agenticx.runtime.meta_tools import dispatch_meta_tool_async

    team_manager = MagicMock()
    result = await dispatch_meta_tool_async(
        "memory_append",
        {"target": "daily", "content": ""},
        team_manager=team_manager,
        session=None,
    )
    data = json.loads(result)
    assert data["ok"] is False
    assert "content" in data.get("error", "").lower() or "missing" in data.get("error", "").lower()
