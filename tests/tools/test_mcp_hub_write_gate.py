"""MCPHub write-gate: require explicit enable for mutating tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

import pytest

from agenticx.managed.templates.data_suite.write_guards import (
    CODE_WRITE_TOOLS_DISABLED,
    tool_requires_write_enable,
)
from agenticx.tools.base import ToolError
from agenticx.tools.mcp_hub import MCPHub, MCPHubConfig
from agenticx.tools.remote_v2 import MCPToolInfo


@dataclass
class _FakeServerConfig:
    name: str
    timeout: float = 10.0


class _FakeClient:
    def __init__(self, server_name: str, tools: List[MCPToolInfo]) -> None:
        self.server_config = _FakeServerConfig(name=server_name)
        self._tools = tools
        self.calls: List[Dict[str, Any]] = []

    async def discover_tools(self) -> List[MCPToolInfo]:
        return self._tools

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        payload = {"client": self.server_config.name, "name": name, "arguments": arguments}
        self.calls.append(payload)
        return payload

    async def close(self) -> None:
        return None


def _tool(name: str, description: str = "") -> MCPToolInfo:
    return MCPToolInfo(name=name, description=description or name, inputSchema={"type": "object"})


def test_tool_requires_write_enable_heuristic():
    assert tool_requires_write_enable("search") is False
    assert tool_requires_write_enable("list_items") is False
    assert tool_requires_write_enable("write_file") is True
    assert tool_requires_write_enable("delete_row") is True
    assert tool_requires_write_enable("exec") is True


@pytest.mark.asyncio
async def test_mcp_hub_denies_write_tool_by_default() -> None:
    client = _FakeClient("demo", [_tool("search"), _tool("write_file")])
    hub = MCPHub(clients=[client], auto_mode=False)
    await hub.discover_all_tools()

    snaps = {s.routed_name: s for s in hub.list_tool_snapshots()}
    assert snaps["search"].requires_write_enable is False
    assert snaps["write_file"].requires_write_enable is True

    ok = await hub.call_tool("search", {"q": "x"})
    assert ok["name"] == "search"
    assert len(client.calls) == 1

    with pytest.raises(ToolError) as ei:
        await hub.call_tool("write_file", {"path": "/tmp/x"})
    assert ei.value.details.get("code") == CODE_WRITE_TOOLS_DISABLED
    assert CODE_WRITE_TOOLS_DISABLED in str(ei.value)
    assert len(client.calls) == 1  # write never reached client


@pytest.mark.asyncio
async def test_mcp_hub_allows_write_tool_when_explicitly_enabled() -> None:
    client = _FakeClient("demo", [_tool("write_file")])
    hub = MCPHub(clients=[client], auto_mode=False, write_tools_enabled=True)
    await hub.discover_all_tools()

    result = await hub.call_tool("write_file", {"path": "/tmp/x"})
    assert result["name"] == "write_file"
    assert len(client.calls) == 1


def test_mcp_hub_config_defaults_write_tools_off():
    cfg = MCPHubConfig()
    assert cfg.write_tools_enabled is False
    hub = MCPHub.from_config(cfg)
    assert hub.write_tools_enabled is False
