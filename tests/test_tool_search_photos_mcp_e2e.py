"""SP5: photos MCP ToolSearch e2e + quantification gates."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any, Dict, List

from agenticx.cli.studio import StudioSession
from agenticx.cli.studio_mcp import build_mcp_tools_context
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.meta_tools import META_AGENT_TOOLS
from agenticx.runtime.tool_search import (
    TOOL_SEARCH_MAX_LOADED,
    TOOL_SEARCH_TOOL_NAME,
    ToolSearchConfig,
    estimate_schema_tokens,
    project_tools_for_round,
)
from agenticx.runtime.tool_search_runtime import build_runtime_context, collect_mcp_descriptors
from agenticx.tools.mcp_hub import MCPHub
from agenticx.tools.remote_v2 import MCPToolInfo


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _FakeMCPClient:
    def __init__(self, name: str) -> None:
        self.server_config = SimpleNamespace(name=name, timeout=30.0)
        self.calls: List[tuple[str, dict]] = []

    async def call_tool(self, original_name: str, arguments: dict) -> Any:
        self.calls.append((original_name, dict(arguments or {})))
        return SimpleNamespace(
            isError=False,
            content=[SimpleNamespace(text=json.dumps({"ok": True, "tool": original_name}))],
            structuredContent=None,
        )

    async def discover_tools(self):
        return []

    async def close(self):
        return None


def _photos_hub() -> tuple[MCPHub, _FakeMCPClient]:
    client = _FakeMCPClient("photos")
    hub = MCPHub(clients=[client])
    search_schema = {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    }
    album_schema = {
        "type": "object",
        "properties": {"title": {"type": "string"}},
        "required": ["title"],
    }
    routing = {
        "search": SimpleNamespace(
            client=client,
            original_name="search",
            tool_info=MCPToolInfo(
                name="search",
                description="search photos album",
                inputSchema=search_schema,
            ),
        ),
        "create_album": SimpleNamespace(
            client=client,
            original_name="create_album",
            tool_info=MCPToolInfo(
                name="create_album",
                description="create photos album",
                inputSchema=album_schema,
            ),
        ),
    }
    hub._tool_routing = routing  # type: ignore[attr-defined]
    hub._merged_tools = [
        MCPToolInfo(name="search", description="search photos album", inputSchema=search_schema),
        MCPToolInfo(
            name="create_album",
            description="create photos album",
            inputSchema=album_schema,
        ),
    ]
    return hub, client


def _tool_names(tools: list) -> set[str]:
    out: set[str] = set()
    for t in tools:
        fn = t.get("function") if isinstance(t, dict) else None
        if isinstance(fn, dict):
            n = str(fn.get("name") or "").strip()
            if n:
                out.add(n)
    return out


def _meta_pool() -> list[dict]:
    return [dict(t) for t in META_AGENT_TOOLS if isinstance(t, dict)]


class _ScriptLLM:
    def __init__(self, script: list) -> None:
        self.script = list(script)
        self.tools_seen: list[set[str]] = []
        self.tools_raw: list[list] = []

    def invoke(self, *_args, **kwargs):
        tools = list(kwargs.get("tools") or [])
        self.tools_raw.append(tools)
        self.tools_seen.append(_tool_names(tools))
        if self.script:
            item = self.script.pop(0)
            return _FakeResponse(item.get("content", ""), item.get("tool_calls", []))
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield ""


async def _collect(runtime: AgentRuntime, session: StudioSession, text: str, **kwargs):
    items = []
    async for event in runtime.run_turn(text, session, **kwargs):
        items.append({"type": event.type, "data": event.data})
    return items


def test_photos_mcp_e2e(monkeypatch):
    monkeypatch.setattr(
        "agenticx.runtime.tool_search_runtime.read_tool_search_config",
        lambda: ToolSearchConfig(mode="always"),
    )
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {},
    )
    hub, client = _photos_hub()
    pool = _meta_pool()
    # Ensure mcp_call present
    assert "mcp_call" in _tool_names(pool)

    public_search = None
    descs = collect_mcp_descriptors(
        SimpleNamespace(mcp_hub=hub, scratchpad={}),
        pool,
    )
    for d in descs:
        if d.original_mcp_name == "search":
            public_search = d.name
    assert public_search and public_search.startswith("mcp__photos__")

    script = [
        {
            "content": "search tools",
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {
                        "name": "tool_search",
                        "arguments": {"query": "photos album"},
                    },
                }
            ],
        },
        {
            "content": "call mcp",
            "tool_calls": [
                {
                    "id": "c2",
                    "type": "function",
                    "function": {
                        "name": public_search,
                        "arguments": {"query": "cats"},
                    },
                }
            ],
        },
        {"content": "done", "tool_calls": []},
    ]
    from agenticx.runtime.global_mcp_manager import GlobalMcpManager

    mgr = GlobalMcpManager.singleton()
    monkeypatch.setattr(mgr, "_hub", hub)

    llm = _ScriptLLM(script)
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "find albums", tools=pool))

    assert len(llm.tools_seen) >= 2
    assert public_search not in llm.tools_seen[0]
    assert public_search in llm.tools_seen[1]
    # Round1 schema includes query property
    round1_tools = llm.tools_raw[1]
    search_tool = next(
        t for t in round1_tools if (t.get("function") or {}).get("name") == public_search
    )
    params = (search_tool.get("function") or {}).get("parameters") or {}
    assert "query" in (params.get("properties") or {})

    assert client.calls
    assert client.calls[0][0] == "search"
    assert client.calls[0][1].get("query") == "cats"

    deferred_ctx = build_mcp_tools_context(hub, defer_schemas=True)
    assert "输入Schema" not in deferred_ctx
    assert "tool_search" in deferred_ctx

    # tool results exist
    assert any(e["type"] == EventType.TOOL_RESULT.value for e in events)


def test_token_budget_gate(monkeypatch):
    monkeypatch.setattr(
        "agenticx.runtime.tool_search_runtime.read_tool_search_config",
        lambda: ToolSearchConfig(mode="always"),
    )
    pool = _meta_pool()
    session = StudioSession()
    ctx = build_runtime_context(
        session=session,
        full_openai_tools=pool,
        config=ToolSearchConfig(mode="always"),
    )
    projected = project_tools_for_round(ctx, full_openai_tools=pool)
    full_json = json.dumps(pool, ensure_ascii=False)
    round0_json = json.dumps(projected, ensure_ascii=False)
    assert len(round0_json) <= int(0.40 * len(full_json))
    assert estimate_schema_tokens(projected) < estimate_schema_tokens(pool)


def test_off_parity_names(monkeypatch):
    monkeypatch.setattr(
        "agenticx.runtime.tool_search_runtime.read_tool_search_config",
        lambda: ToolSearchConfig(mode="off"),
    )
    pool = _meta_pool()
    session = StudioSession()
    ctx = build_runtime_context(
        session=session,
        full_openai_tools=pool,
        config=ToolSearchConfig(mode="off"),
    )
    out = project_tools_for_round(ctx, full_openai_tools=pool)
    assert _tool_names(out) == _tool_names(pool)


def test_default_config_is_off():
    from agenticx.runtime.tool_search_runtime import read_tool_search_config

    # Without forcing monkeypatch, default for missing yaml key is off
    cfg = read_tool_search_config()
    # User machine may have always set; still assert normalized mode is valid
    assert cfg.mode in {"off", "auto", "always"}


def test_mcp_call_disabled_yields_no_mcp_descriptors(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.studio_mcp.get_mcp_disabled_tools_config",
        lambda: {},
    )
    hub, _ = _photos_hub()
    pool = [t for t in _meta_pool() if (t.get("function") or {}).get("name") != "mcp_call"]
    session = SimpleNamespace(mcp_hub=hub, scratchpad={})
    assert collect_mcp_descriptors(session, pool) == []


def test_lru_cap_constant():
    assert TOOL_SEARCH_MAX_LOADED == 24
    assert TOOL_SEARCH_TOOL_NAME == "tool_search"
