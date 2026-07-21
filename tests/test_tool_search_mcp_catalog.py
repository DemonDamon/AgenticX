"""SP3: MCP catalog adapter + deferred MCP system-prompt context."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from agenticx.cli.studio_mcp import build_mcp_tools_context
from agenticx.runtime.mcp_tool_catalog import (
    resolve_mcp_execution_name,
    snapshots_to_descriptors,
)
from agenticx.tools.mcp_hub import MCPHub, MCPToolSnapshot
from agenticx.tools.remote_v2 import MCPToolInfo


class _FakeClient:
    def __init__(self, name: str) -> None:
        self.server_config = SimpleNamespace(name=name, timeout=30.0)


def _hub_with_tools(entries: List[tuple[str, str, str, dict]]) -> MCPHub:
    """entries: (server, original, routed, schema)."""
    hub = MCPHub(clients=[])
    routing = {}
    merged = []
    for server, original, routed, schema in entries:
        info = MCPToolInfo(
            name=routed,
            description=f"{server}.{original}",
            inputSchema=schema,
        )
        routing[routed] = SimpleNamespace(
            client=_FakeClient(server),
            original_name=original,
            tool_info=MCPToolInfo(
                name=original,
                description=f"{server}.{original}",
                inputSchema=schema,
            ),
        )
        # discover_all_tools stores tool_info with routed name in merged;
        # list_tool_snapshots uses route.tool_info + routed key.
        routing[routed].tool_info = MCPToolInfo(
            name=original,
            description=f"{server}.{original}",
            inputSchema=schema,
        )
        merged.append(info)
        hub._tool_routing = routing  # type: ignore[attr-defined]
        hub._merged_tools = merged  # type: ignore[attr-defined]
    return hub


def test_list_tool_snapshots_public_api(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {},
    )
    schema = {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]}
    hub = _hub_with_tools([("photos", "search", "search", schema)])
    snaps = hub.list_tool_snapshots()
    assert len(snaps) == 1
    assert isinstance(snaps[0], MCPToolSnapshot)
    assert snaps[0].server_name == "photos"
    assert snaps[0].original_name == "search"
    assert snaps[0].routed_name == "search"
    assert snaps[0].input_schema == schema
    assert snaps[0].enabled is True
    # Mutating returned schema must not affect hub
    snaps[0].input_schema["hack"] = True
    again = hub.list_tool_snapshots()[0]
    assert "hack" not in again.input_schema


def test_schema_passthrough(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {},
    )
    schema = {
        "type": "object",
        "properties": {"title": {"type": "string"}, "limit": {"type": "integer"}},
        "required": ["title"],
    }
    hub = _hub_with_tools([("photos", "create_album", "create_album", schema)])
    descs = snapshots_to_descriptors(hub.list_tool_snapshots(), mcp_call_allowed=True)
    assert len(descs) == 1
    assert descs[0].input_schema == schema
    assert descs[0].name.startswith("mcp__photos__")
    assert descs[0].original_mcp_name == "create_album"


def test_cross_server_isolation(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {},
    )
    schema = {"type": "object", "properties": {}}
    hub = _hub_with_tools(
        [
            ("photos", "search", "search", schema),
            ("files", "search", "files__search", schema),
        ]
    )
    descs = snapshots_to_descriptors(hub.list_tool_snapshots(), mcp_call_allowed=True)
    names = {d.name for d in descs}
    assert len(names) == 2
    by_server = {d.server_slug: d for d in descs}
    assert by_server["photos"].original_mcp_name == "search"
    assert by_server["files"].original_mcp_name == "files__search"
    assert resolve_mcp_execution_name(by_server["photos"].name, descs) == "search"
    assert resolve_mcp_execution_name("files__search", descs) == "files__search"


def test_disconnect_reconnect(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {},
    )
    schema = {"type": "object", "properties": {"q": {"type": "string"}}}
    hub = _hub_with_tools([("photos", "search", "search", schema)])
    d1 = snapshots_to_descriptors(hub.list_tool_snapshots(), mcp_call_allowed=True)
    assert d1[0].stable_id == "mcp:photos:search"
    hub._tool_routing = {}
    hub._merged_tools = []
    assert hub.list_tool_snapshots() == []
    hub = _hub_with_tools([("photos", "search", "search", schema)])
    d2 = snapshots_to_descriptors(hub.list_tool_snapshots(), mcp_call_allowed=True)
    assert d2[0].stable_id == d1[0].stable_id


def test_parent_gate_mcp_call(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {},
    )
    hub = _hub_with_tools(
        [("photos", "search", "search", {"type": "object", "properties": {}})]
    )
    assert snapshots_to_descriptors(hub.list_tool_snapshots(), mcp_call_allowed=False) == []


def test_disabled_tool_skipped(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {"photos": ["search"]},
    )
    hub = _hub_with_tools(
        [("photos", "search", "search", {"type": "object", "properties": {}})]
    )
    snaps = hub.list_tool_snapshots()
    assert snaps[0].enabled is False
    assert snapshots_to_descriptors(snaps, mcp_call_allowed=True) == []


def test_build_mcp_tools_context_deferred(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {},
    )
    schema = {
        "type": "object",
        "properties": {"secret_field": {"type": "string"}},
        "required": ["secret_field"],
    }
    hub = _hub_with_tools([("photos", "search", "search", schema)])
    text = build_mcp_tools_context(hub, defer_schemas=True)
    assert "tool_search" in text
    assert "输入Schema" not in text
    assert "secret_field" not in text
    assert "search" in text


def test_build_mcp_tools_context_legacy(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {},
    )
    schema = {
        "type": "object",
        "properties": {"secret_field": {"type": "string"}},
    }
    hub = _hub_with_tools([("photos", "search", "search", schema)])
    text = build_mcp_tools_context(hub, defer_schemas=False)
    assert "输入Schema" in text
    assert "secret_field" in text
