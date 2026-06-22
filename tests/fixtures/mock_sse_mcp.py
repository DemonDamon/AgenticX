#!/usr/bin/env python3
"""Mock SSE MCP server for E2E tests (Phase 3.1).

Exposes ``echo(text)`` over the legacy SSE transport at ``/sse``.

Plan: .cursor/plans/2026-06-22-near-remote-url-mcp-support.plan.md (Task 3.1).

Author: Damon Li
"""

from __future__ import annotations

import socket
import threading
import time
from contextlib import closing
from typing import Iterator

import pytest


def _pick_free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _build_mock_app(port: int):
    from mcp.server.fastmcp import FastMCP  # type: ignore

    mcp = FastMCP("mock-sse", host="127.0.0.1", port=port)

    @mcp.tool()
    def echo(text: str) -> str:
        """Echo back the provided text."""
        return text

    return mcp


def _wait_for_port(port: int, timeout: float = 8.0) -> None:
    deadline = time.time() + timeout
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with closing(socket.create_connection(("127.0.0.1", port), timeout=0.5)):
                return
        except OSError as err:
            last_err = err
            time.sleep(0.05)
    raise RuntimeError(f"mock SSE MCP did not start on :{port} in {timeout}s: {last_err}")


@pytest.fixture
def sse_mcp_url() -> Iterator[str]:
    """Run a mock SSE MCP server and yield its ``/sse`` URL."""
    import uvicorn  # type: ignore

    port = _pick_free_port()
    mcp_app = _build_mock_app(port)
    starlette_app = mcp_app.sse_app()

    config = uvicorn.Config(
        starlette_app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
        loop="asyncio",
    )
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True, name=f"mock-sse-mcp-{port}")
    thread.start()
    try:
        _wait_for_port(port)
        yield f"http://127.0.0.1:{port}/sse"
    finally:
        server.should_exit = True
        thread.join(timeout=3.0)
