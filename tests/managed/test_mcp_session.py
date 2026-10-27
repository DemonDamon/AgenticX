#!/usr/bin/env python3
"""Per-session MCP pool: token injection, isolation, and failure events.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

from agenticx.managed.credentials import CredentialBundle, ResolvedCredential, normalize_mcp_url
from agenticx.managed.egress_policy import SessionEgressPolicy
from agenticx.managed.mcp_session import McpToolRouter, SessionMcpPool
from agenticx.managed.spec import compile_spec
from agenticx.runtime.global_mcp_manager import GlobalMcpManager
from agenticx.tools.remote_v2 import MCPToolInfo

_TOKEN_A = "tok-a-123456"
_TOKEN_OTHER = "tok-other-999999"
_LEAK = "tok-secret-value"


def _manifest(servers: list[dict[str, Any]], tools: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "test",
        "mcp_servers": servers,
        "tools": tools,
    }


def _server(name: str, url: str) -> dict[str, str]:
    return {"name": name, "url": url, "transport": "http"}


def _toolset(server: str, policy: str = "always_allow", configs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "type": "mcp",
        "server": server,
        "default_policy": policy,
    }
    if configs is not None:
        body["configs"] = configs
    return body


def _cred(url: str, secret: str, vault_index: int) -> ResolvedCredential:
    return ResolvedCredential(
        credential_id=f"c{vault_index}",
        vault_id=f"v{vault_index}",
        vault_index=vault_index,
        type="static_bearer",
        display_name=None,
        secret=secret,
        mcp_server_url=normalize_mcp_url(url),
    )


class _FakeClient:
    def __init__(self, config: Any, *, tools: list[MCPToolInfo] | None = None, boom: BaseException | None = None) -> None:
        self.config = config
        self.tools = tools if tools is not None else [
            MCPToolInfo(name="echo", description="echo", inputSchema={"type": "object", "properties": {}})
        ]
        self.boom = boom
        self.closed = False
        self.calls: list[dict[str, Any]] = []

    async def discover_tools(self) -> list[MCPToolInfo]:
        if self.boom is not None:
            raise self.boom
        return self.tools

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        self.calls.append({"name": name, "arguments": arguments, "authorization": dict(self.config.headers)})
        return type("Result", (), {"content": [], "isError": False})()

    async def close(self) -> None:
        self.closed = True


def _policy(domains: tuple[str, ...] = ()) -> SessionEgressPolicy:
    return SessionEgressPolicy(allow_domains=domains, bundle=CredentialBundle(), placeholders={})


async def test_pool_injects_matching_bearer() -> None:
    url_a = "https://a.example/mcp"
    url_b = "https://b.example/mcp"
    spec = compile_spec(
        "demo",
        1,
        _manifest(
            [_server("A", url_a), _server("B", url_b)],
            [_toolset("A"), _toolset("B")],
        ),
    )
    created: list[_FakeClient] = []

    def factory(config: Any) -> _FakeClient:
        client = _FakeClient(config)
        created.append(client)
        return client

    bundle = CredentialBundle(credentials=(_cred(url_a, _TOKEN_A, 0), _cred(url_a, _TOKEN_OTHER, 1)))
    pool = SessionMcpPool(spec, bundle, _policy(), McpToolRouter(), client_factory=factory)
    schemas, events = await pool.open()
    assert events == []
    assert {item["function"]["name"] for item in schemas} == {"mcp__A__echo", "mcp__B__echo"}
    by_name = {client.config.name: client.config.headers for client in created}
    assert by_name["A"] == {"Authorization": f"Bearer {_TOKEN_A}"}
    assert by_name["B"] == {}
    assert _TOKEN_OTHER not in str(by_name)
    await pool.close()


async def test_pool_isolated_per_session() -> None:
    GlobalMcpManager.reset_for_testing()
    url = "https://a.example/mcp"
    spec = compile_spec("demo", 1, _manifest([_server("A", url)], [_toolset("A")]))
    seen: list[str] = []

    def factory(config: Any) -> _FakeClient:
        seen.append(config.headers.get("Authorization", ""))
        return _FakeClient(config)

    first = SessionMcpPool(
        spec,
        CredentialBundle(credentials=(_cred(url, "token-session-one", 0),)),
        _policy(),
        McpToolRouter(),
        client_factory=factory,
    )
    second = SessionMcpPool(
        spec,
        CredentialBundle(credentials=(_cred(url, "token-session-two", 0),)),
        _policy(),
        McpToolRouter(),
        client_factory=factory,
    )
    await first.open()
    await second.open()
    assert seen == ["Bearer token-session-one", "Bearer token-session-two"]
    assert GlobalMcpManager._instance is None
    await first.close()
    await second.close()


async def test_tool_exposure_respects_toolset() -> None:
    url_a = "https://a.example/mcp"
    url_b = "https://b.example/mcp"
    spec = compile_spec(
        "demo",
        1,
        _manifest(
            [_server("A", url_a), _server("B", url_b)],
            [_toolset("A", configs=[{"name": "delete_repo", "enabled": False}])],
        ),
    )
    names: list[str] = []

    def factory(config: Any) -> _FakeClient:
        names.append(config.name)
        return _FakeClient(
            config,
            tools=[
                MCPToolInfo(name="echo", description="echo", inputSchema={"type": "object", "properties": {}}),
                MCPToolInfo(name="delete_repo", description="delete", inputSchema={"type": "object", "properties": {}}),
                MCPToolInfo(
                    name="bad",
                    description="bad",
                    inputSchema={"type": "object", "properties": {"task_intent": {"type": "string"}}},
                ),
            ],
        )

    pool = SessionMcpPool(spec, CredentialBundle(), _policy(), McpToolRouter(), client_factory=factory)
    schemas, events = await pool.open()
    assert events == []
    assert names == ["A"]
    assert [item["function"]["name"] for item in schemas] == ["mcp__A__echo"]
    await pool.close()


async def test_connect_failure_emits_session_error() -> None:
    url = "https://a.example/mcp"
    spec = compile_spec("demo", 1, _manifest([_server("A", url)], [_toolset("A")]))

    def factory(config: Any) -> _FakeClient:
        return _FakeClient(config, boom=RuntimeError(_LEAK))

    pool = SessionMcpPool(spec, CredentialBundle(), _policy(), McpToolRouter(), client_factory=factory)
    _schemas, events = await pool.open()
    assert len(events) == 1
    error = events[0]["error"]
    assert error["type"] == "mcp_connection_failed"
    assert error["mcp_server"] == "A"
    assert error["retry_status"]["type"] == "exhausted"
    rendered = str(events)
    assert _LEAK not in rendered
    assert "RuntimeError" in error["message"]
    await pool.close()


async def test_mcp_blocked_by_egress() -> None:
    url = "https://mcp.test/mcp"
    spec = compile_spec("demo", 1, _manifest([_server("A", url)], [_toolset("A")]))
    called = False

    def factory(config: Any) -> _FakeClient:
        nonlocal called
        called = True
        return _FakeClient(config)

    pool = SessionMcpPool(
        spec,
        CredentialBundle(),
        _policy(("other.com",)),
        McpToolRouter(),
        client_factory=factory,
    )
    _schemas, events = await pool.open()
    assert called is False
    assert events[0]["error"]["type"] == "egress_blocked"
    assert events[0]["error"]["mcp_server"] == "A"
    await pool.close()
