"""Tests for async MCP tool invocation from Studio (no nested asyncio.run)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

import pytest

from agenticx.cli.studio_mcp import mcp_call_tool_async
from agenticx.tools.mcp_hub import MCPHub
from agenticx.tools.remote_v2 import MCPToolInfo


@dataclass
class _FakeServerConfig:
    name: str
    timeout: float = 10.0


class _FakeClient:
    def __init__(self, server_name: str, tools: List[MCPToolInfo]) -> None:
        self.server_config = _FakeServerConfig(name=server_name)
        self._tools = tools

    async def discover_tools(self) -> List[MCPToolInfo]:
        return self._tools

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        return {"ok": True, "tool": name, "arguments": arguments}

    async def close(self) -> None:
        return None


def _tool(name: str, description: str = "") -> MCPToolInfo:
    return MCPToolInfo(name=name, description=description or name, inputSchema={"type": "object"})


@pytest.mark.asyncio
async def test_mcp_call_tool_async_uses_await_not_blocking_loop() -> None:
    client = _FakeClient("demo", [_tool("ping")])
    hub = MCPHub(clients=[client], auto_mode=False)
    await hub.discover_all_tools()

    out = await mcp_call_tool_async(hub, "ping", '{"x": 1}', echo=False)

    assert out is not None
    assert "ping" in out


@pytest.mark.asyncio
async def test_dispatch_mcp_call_nested_asyncio() -> None:
    """Simulate AgentRuntime: running loop + dispatch_tool_async(mcp_call)."""
    from agenticx.cli.agent_tools import dispatch_tool_async
    from agenticx.cli.studio import StudioSession

    client = _FakeClient("demo", [_tool("ping")])
    hub = MCPHub(clients=[client], auto_mode=False)
    await hub.discover_all_tools()

    session = StudioSession()
    session.mcp_hub = hub
    session.mcp_configs = {}
    session.connected_servers = {"demo"}

    result = await dispatch_tool_async(
        "mcp_call",
        {"tool_name": "ping", "arguments": {"q": "hi"}},
        session,
    )
    assert "ERROR" not in result or "nested" not in result.lower()
    assert "ping" in result
