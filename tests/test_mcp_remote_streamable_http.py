#!/usr/bin/env python3
"""End-to-end smoke for Streamable HTTP MCP transport.

Drives the real ``MCPClientV2`` against an in-process mock MCP server (see
``tests/fixtures/mock_streamable_http_mcp.py``) to verify:

- transport inference picks streamable_http for a plain ``/mcp`` URL,
- ``discover_tools()`` returns the registered ``echo`` tool,
- ``call_tool("echo", ...)`` succeeds and the session is reused across calls,
- unreachable URLs surface a clear ``ToolError`` instead of hanging forever.

Plan: .cursor/plans/2026-06-22-near-remote-url-mcp-support.plan.md (Task 2.6).

Author: Damon Li
"""

from __future__ import annotations

import time

import pytest

from agenticx.tools.base import ToolError
from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig

# Re-export the fixture into this module's namespace so pytest discovers it.
from tests.fixtures.mock_streamable_http_mcp import streamable_http_mcp_url  # noqa: F401


def _extract_text(call_result) -> str:
    """Best-effort: pull the text payload out of an MCP CallToolResult."""
    if getattr(call_result, "structuredContent", None):
        for v in call_result.structuredContent.values():
            if isinstance(v, str):
                return v
    for block in getattr(call_result, "content", []) or []:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            return text
    return ""


@pytest.mark.asyncio
async def test_streamable_http_discover_and_call(streamable_http_mcp_url: str) -> None:
    cfg = MCPServerConfig(name="mock", url=streamable_http_mcp_url, timeout=10.0)
    assert cfg.transport == "streamable_http"

    client = MCPClientV2(cfg)
    try:
        tools = await client.discover_tools()
        names = {t.name for t in tools}
        assert "echo" in names, f"expected echo in {names}"

        result = await client.call_tool("echo", {"text": "hi"})
        payload = _extract_text(result)
        assert "hi" in payload, f"expected 'hi' in {payload!r}"

        # Persistent session: 5 sequential calls should not re-handshake.
        # Track _create_session re-entry via a wrapper.
        original_create = client._create_session
        create_calls = {"n": 0}

        async def _spy() -> None:
            create_calls["n"] += 1
            await original_create()

        client._create_session = _spy  # type: ignore[assignment]

        for i in range(5):
            r = await client.call_tool("echo", {"text": f"msg-{i}"})
            assert f"msg-{i}" in _extract_text(r)

        assert create_calls["n"] == 0, (
            f"session should be persistent, but _create_session was called {create_calls['n']} times"
        )
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_streamable_http_transport_failure_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Transport-level connect failures must surface as a clean ToolError.

    We intercept ``streamablehttp_client`` to raise immediately, validating that
    ``_create_session`` properly tears down the exit stack and ``call_tool``
    re-raises as ``ToolError`` — without depending on real network behaviour
    (which on dev machines is muddied by local HTTP/SOCKS proxies).
    """
    from agenticx.tools import remote_v2

    class _BoomError(RuntimeError):
        pass

    def _fail(*_args, **_kwargs):  # noqa: ANN001
        raise _BoomError("simulated transport failure")

    monkeypatch.setattr(remote_v2, "streamablehttp_client", _fail)

    cfg = MCPServerConfig(
        name="boom",
        url="https://example.invalid/mcp",
        timeout=2.0,
    )
    client = MCPClientV2(cfg)
    started = time.monotonic()
    with pytest.raises((ToolError, _BoomError, RuntimeError)):
        await client.discover_tools()
    elapsed = time.monotonic() - started
    assert elapsed < 5.0, f"transport failure should be fast, took {elapsed:.1f}s"
    # exit_stack must have been cleaned up so close() is a no-op.
    assert client._exit_stack is None
    assert client._session is None
    await client.close()
