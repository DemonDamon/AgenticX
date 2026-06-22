#!/usr/bin/env python3
"""End-to-end smoke for SSE MCP transport (Phase 3.1).

Plan: .cursor/plans/2026-06-22-near-remote-url-mcp-support.plan.md

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig

from tests.fixtures.mock_sse_mcp import sse_mcp_url  # noqa: F401


def _extract_text(call_result) -> str:
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
async def test_sse_discover_and_call(sse_mcp_url: str) -> None:
    cfg = MCPServerConfig(name="mock-sse", url=sse_mcp_url, timeout=15.0)
    assert cfg.transport == "sse"

    client = MCPClientV2(cfg)
    try:
        tools = await client.discover_tools()
        names = {t.name for t in tools}
        assert "echo" in names, f"expected echo in {names}"

        result = await client.call_tool("echo", {"text": "sse-hi"})
        payload = _extract_text(result)
        assert "sse-hi" in payload, f"expected 'sse-hi' in {payload!r}"
    finally:
        await client.close()
