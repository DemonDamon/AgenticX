"""Smoke tests for Cherry Studio style MCPHub aggregation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

import pytest

from agenticx.tools.mcp_hub import MCPHub
from agenticx.tools.base import ToolError
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


class _FakeBlock:
    def __init__(self, text: str | None = None, blob: Any = None) -> None:
        self.text = text
        self.blob = blob


class _FakeCallToolResult:
    def __init__(self, *, is_error: bool, content: List[_FakeBlock] | None = None, structured: Any = None) -> None:
        self.isError = is_error
        self.content = content or []
        self.structuredContent = structured


def _tool(name: str, description: str = "") -> MCPToolInfo:
    return MCPToolInfo(name=name, description=description or name, inputSchema={"type": "object"})


@pytest.mark.asyncio
async def test_mcp_hub_merge_happy_path() -> None:
    c1 = _FakeClient("alpha", [_tool("search"), _tool("read")])
    c2 = _FakeClient("beta", [_tool("write"), _tool("exec")])
    hub = MCPHub(clients=[c1, c2], auto_mode=True)

    tools = await hub.discover_all_tools()
    names = {tool.name for tool in tools}

    assert len(tools) == 4
    assert names == {"search", "read", "write", "exec"}

    agent_tools = await hub.get_tools_for_agent()
    assert len(agent_tools) == 4


@pytest.mark.asyncio
async def test_mcp_hub_name_conflict_adds_prefix() -> None:
    c1 = _FakeClient("alpha", [_tool("search")])
    c2 = _FakeClient("beta", [_tool("search")])
    hub = MCPHub(clients=[c1, c2])

    tools = await hub.discover_all_tools()
    names = {tool.name for tool in tools}

    assert "search" in names
    assert "beta__search" in names


@pytest.mark.asyncio
async def test_mcp_hub_routes_call_to_correct_client() -> None:
    c1 = _FakeClient("alpha", [_tool("search")])
    c2 = _FakeClient("beta", [_tool("search")])
    hub = MCPHub(clients=[c1, c2], auto_mode=True)

    await hub.discover_all_tools()
    result = await hub.call_tool("beta__search", {"query": "hello"})

    assert result["client"] == "beta"
    assert result["name"] == "search"
    assert result["arguments"] == {"query": "hello"}
    assert len(c1.calls) == 0
    assert len(c2.calls) == 1


@pytest.mark.asyncio
async def test_mcp_hub_auto_mode_tool_executes() -> None:
    c1 = _FakeClient("alpha", [_tool("search")])
    hub = MCPHub(clients=[c1], auto_mode=True)

    tools = await hub.get_tools_for_agent()
    assert len(tools) == 1

    output = await tools[0]._arun(query="q")
    assert output["client"] == "alpha"
    assert output["name"] == "search"
    assert output["arguments"] == {"query": "q"}


@pytest.mark.asyncio
async def test_mcp_hub_tool_result_error_raises_tool_error() -> None:
    class _ErrorClient(_FakeClient):
        async def call_tool(self, name: str, arguments: Dict[str, Any]):
            return _FakeCallToolResult(is_error=True, content=[_FakeBlock(text="boom")])

    client = _ErrorClient("alpha", [_tool("search")])
    hub = MCPHub(clients=[client], auto_mode=True)
    tools = await hub.get_tools_for_agent()

    with pytest.raises(ToolError, match="boom"):
        await tools[0]._arun(query="x")


@pytest.mark.asyncio
async def test_mcp_hub_tool_result_structured_content() -> None:
    class _StructuredClient(_FakeClient):
        async def call_tool(self, name: str, arguments: Dict[str, Any]):
            return _FakeCallToolResult(is_error=False, structured={"ok": True})

    client = _StructuredClient("alpha", [_tool("search")])
    hub = MCPHub(clients=[client], auto_mode=True)
    tools = await hub.get_tools_for_agent()

    output = await tools[0]._arun(query="x")
    assert output == {"ok": True}


@pytest.mark.asyncio
async def test_discover_all_tools_continues_when_one_client_fails() -> None:
    class _FailingClient(_FakeClient):
        async def discover_tools(self) -> List[MCPToolInfo]:
            raise RuntimeError("discover failed")

    c1 = _FailingClient("alpha", [])
    c2 = _FakeClient("beta", [_tool("ok-tool")])
    hub = MCPHub(clients=[c1, c2])

    tools = await hub.discover_all_tools()
    assert [tool.name for tool in tools] == ["ok-tool"]
