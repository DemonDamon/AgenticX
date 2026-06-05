"""Tests for async MCP tool invocation from Studio (no nested asyncio.run)."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Set, Tuple

import pytest

from agenticx.cli import studio_mcp as studio_mcp_module
from agenticx.cli.studio_mcp import auto_connect_servers_async, mcp_call_tool_async
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


@pytest.mark.asyncio
async def test_auto_connect_servers_async_runs_concurrently(monkeypatch) -> None:
    """Four slow connects should overlap (not sum to 4x delay)."""
    delay_s = 0.12

    async def _slow_connect(
        _hub: MCPHub,
        _configs: Dict[str, Any],
        connected: Set[str],
        name: str,
    ) -> Tuple[bool, str]:
        await asyncio.sleep(delay_s)
        connected.add(name)
        return True, ""

    monkeypatch.setattr(studio_mcp_module, "mcp_connect_async", _slow_connect)

    hub = MCPHub(clients=[])
    connected: Set[str] = set()
    configs = {f"s{i}": object() for i in range(4)}

    start = time.perf_counter()
    results = await auto_connect_servers_async(
        hub, configs, connected, ["s0", "s1", "s2", "s3"]
    )
    elapsed = time.perf_counter() - start

    assert results == {"s0": True, "s1": True, "s2": True, "s3": True}
    assert connected == {"s0", "s1", "s2", "s3"}
    # Serial would be ~0.48s; with concurrency 4, ~0.12s (+ slack).
    assert elapsed < delay_s * 2.5
