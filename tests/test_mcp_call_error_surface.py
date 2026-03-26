"""mcp_call_tool_async must return diagnostic ERROR: mcp_call: ... strings (never silent None)."""

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


class _FakeClientCallRaises(_FakeClient):
    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        raise RuntimeError("persistent_context not supported here")


class _FakeClientChainedError(_FakeClient):
    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        try:
            raise ValueError("socksio package is not installed")
        except ValueError as inner:
            raise RuntimeError("Tool call failed") from inner


def _tool(name: str, description: str = "") -> MCPToolInfo:
    return MCPToolInfo(name=name, description=description or name, inputSchema={"type": "object"})


@pytest.mark.asyncio
async def test_mcp_call_no_tools_connected_message() -> None:
    hub = MCPHub(clients=[], auto_mode=False)
    out = await mcp_call_tool_async(hub, "any", "{}", echo=False)
    assert out.startswith("ERROR: mcp_call:")
    assert "no MCP tools connected" in out


@pytest.mark.asyncio
async def test_mcp_call_unknown_tool_lists_available() -> None:
    client = _FakeClient("demo", [_tool("ping")])
    hub = MCPHub(clients=[client], auto_mode=False)
    await hub.discover_all_tools()

    out = await mcp_call_tool_async(hub, "missing_tool", "{}", echo=False)
    assert out.startswith("ERROR: mcp_call:")
    assert "not connected" in out
    assert "ping" in out


@pytest.mark.asyncio
async def test_mcp_call_list_tools_alias_returns_directory_not_error() -> None:
    client = _FakeClient(
        "browser-use",
        [_tool("browser_navigate"), _tool("browser_list_tabs")],
    )
    hub = MCPHub(clients=[client], auto_mode=False)
    await hub.discover_all_tools()

    out = await mcp_call_tool_async(hub, "list_tools", "{}", echo=False)
    assert not out.startswith("ERROR: mcp_call:")
    assert "browser_navigate" in out
    assert "browser_list_tabs" in out
    assert "browser-use" in out


@pytest.mark.asyncio
async def test_mcp_call_real_list_tools_routed_name_not_shadowed() -> None:
    client = _FakeClient("demo", [_tool("list_tools")])
    hub = MCPHub(clients=[client], auto_mode=False)
    await hub.discover_all_tools()

    out = await mcp_call_tool_async(hub, "list_tools", "{}", echo=False)
    assert "ERROR: mcp_call:" not in out
    assert "list_tools" in out


@pytest.mark.asyncio
async def test_mcp_call_invalid_json() -> None:
    client = _FakeClient("demo", [_tool("ping")])
    hub = MCPHub(clients=[client], auto_mode=False)
    await hub.discover_all_tools()

    out = await mcp_call_tool_async(hub, "ping", "not-json", echo=False)
    assert out.startswith("ERROR: mcp_call:")
    assert "invalid arguments JSON" in out


@pytest.mark.asyncio
async def test_mcp_call_surfaces_exception_cause_chain() -> None:
    client = _FakeClientChainedError("demo", [_tool("ping")])
    hub = MCPHub(clients=[client], auto_mode=False)
    await hub.discover_all_tools()

    out = await mcp_call_tool_async(hub, "ping", "{}", echo=False)
    assert out.startswith("ERROR: mcp_call:")
    assert "RuntimeError" in out
    assert "ValueError" in out
    assert "socksio" in out


@pytest.mark.asyncio
async def test_mcp_call_hub_exception_surfaces() -> None:
    client = _FakeClientCallRaises("demo", [_tool("ping")])
    hub = MCPHub(clients=[client], auto_mode=False)
    await hub.discover_all_tools()

    out = await mcp_call_tool_async(hub, "ping", "{}", echo=False)
    assert out.startswith("ERROR: mcp_call:")
    assert "RuntimeError" in out
    assert "persistent_context" in out
