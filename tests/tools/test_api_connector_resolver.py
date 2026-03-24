#!/usr/bin/env python3
"""Tests for MCPConnectorResolver.

Author: Damon Li
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from agenticx.tools.resolvers.api_connector_resolver import MCPConnectorResolver


@pytest.fixture
def mock_mcp_hub():
    hub = MagicMock()
    hub.list_tools = AsyncMock(return_value=[
        {"name": "slack_send_message", "description": "Send Slack message"},
        {"name": "calendar_create_event", "description": "Create calendar event"},
    ])
    hub.call_tool = AsyncMock(return_value={"ok": True, "result": "Message sent"})
    return hub


@pytest.mark.asyncio
async def test_can_handle_known_tool(mock_mcp_hub):
    resolver = MCPConnectorResolver(mcp_hub=mock_mcp_hub)
    await resolver.refresh_tool_index()
    assert await resolver.can_handle("slack_send_message") is True


@pytest.mark.asyncio
async def test_cannot_handle_unknown_tool(mock_mcp_hub):
    resolver = MCPConnectorResolver(mcp_hub=mock_mcp_hub)
    await resolver.refresh_tool_index()
    assert await resolver.can_handle("unknown_tool") is False


@pytest.mark.asyncio
async def test_resolve_calls_mcp_hub(mock_mcp_hub):
    resolver = MCPConnectorResolver(mcp_hub=mock_mcp_hub)
    await resolver.refresh_tool_index()
    result = await resolver.resolve("slack_send_message", message="hello")
    mock_mcp_hub.call_tool.assert_called_once()
    assert "Message sent" in result
