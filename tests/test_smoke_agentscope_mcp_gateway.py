#!/usr/bin/env python3
"""Smoke tests for the in-workspace MCP gateway (AgentScope 2.0 P0-1).

Drives the container-side FastAPI gateway and the host-side ``GatewayClient``
over an in-process ASGI transport, so no Docker / real MCP server is required.

Covers:
- Health probe.
- Register server -> list tools -> call tool (happy path).
- Bearer auth rejection (401) with a wrong token.
- Unknown tool -> surfaced as an error chunk, not a crash.

Run:
    pytest -q tests/test_smoke_agentscope_mcp_gateway.py
    pytest -q -k "smoke_agentscope"

Author: Damon Li
"""

import asyncio

import httpx
import pytest

from agenticx.sandbox.mcp_gateway import (
    GatewayClient,
    GatewayState,
    InMemoryMCPBackend,
    build_gateway_app,
)


def _make_client(token: str = "", client_token: str | None = None):
    backend = InMemoryMCPBackend()
    backend.register_server(
        "fs",
        tools={
            "read": lambda args: f"contents-of:{args.get('path', '')}",
            "echo": lambda args: args.get("text", ""),
        },
        schemas={
            "read": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
            }
        },
    )
    state = GatewayState(backend=backend, token=token)
    app = build_gateway_app(state)
    transport = httpx.ASGITransport(app=app)
    http = httpx.AsyncClient(transport=transport, base_url="http://gateway")
    gw = GatewayClient(
        base_url="http://gateway",
        token=client_token if client_token is not None else token,
        http=http,
    )
    return gw, http


def test_gateway_health_and_call_happy_path():
    async def _run():
        gw, http = _make_client()
        try:
            assert await gw.health() is True

            servers = await gw.list_mcps()
            assert {s["name"] for s in servers} == {"fs"}

            tools = await gw.list_tools("fs")
            names = {t["name"] for t in tools}
            assert {"read", "echo"} <= names

            chunk = await gw.call_tool("fs", "read", {"path": "/etc/hosts"})
            assert chunk["state"] == "success"
            assert chunk["content"][0]["text"] == "contents-of:/etc/hosts"
        finally:
            await http.aclose()

    asyncio.run(_run())


def test_gateway_add_and_remove_server():
    async def _run():
        gw, http = _make_client()
        try:
            await gw.add_mcp({"name": "fetch"})
            servers = {s["name"] for s in await gw.list_mcps()}
            assert "fetch" in servers

            await gw.remove_mcp("fetch")
            servers = {s["name"] for s in await gw.list_mcps()}
            assert "fetch" not in servers
        finally:
            await http.aclose()

    asyncio.run(_run())


def test_gateway_auth_rejects_wrong_token():
    async def _run():
        # Gateway configured with a token, client sends the wrong one.
        gw, http = _make_client(token="secret", client_token="wrong")
        try:
            # /health is unauthenticated and still works.
            assert await gw.health() is True
            # Authed endpoints must reject.
            with pytest.raises(httpx.HTTPStatusError):
                await gw.list_mcps()
        finally:
            await http.aclose()

    asyncio.run(_run())


def test_gateway_unknown_tool_returns_error_chunk():
    async def _run():
        gw, http = _make_client()
        try:
            chunk = await gw.call_tool("fs", "does_not_exist", {})
            assert chunk["state"] == "error"
            assert "does_not_exist" in chunk["content"][0]["text"]
        finally:
            await http.aclose()

    asyncio.run(_run())


def test_gateway_unknown_server_tools_404():
    async def _run():
        gw, http = _make_client()
        try:
            with pytest.raises(httpx.HTTPStatusError):
                await gw.list_tools("nope")
        finally:
            await http.aclose()

    asyncio.run(_run())
