#!/usr/bin/env python3
"""Mock Streamable HTTP MCP server for E2E tests.

Spins up a minimal ``FastMCP`` server on ``127.0.0.1`` with a random port and
exposes a single ``echo(text)`` tool over the streamable-http transport at
``/mcp``. Returns the public URL so a test client can connect.

Plan: .cursor/plans/2026-06-22-near-remote-url-mcp-support.plan.md (Task 2.5).

Author: Damon Li
"""

from __future__ import annotations

import socket
import threading
import time
from contextlib import closing
from typing import Iterator

import httpx
import pytest


def _pick_free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _build_mock_app(port: int):
    """Construct a FastMCP app with an `echo` tool, ready to serve over HTTP."""
    from mcp.server.fastmcp import FastMCP  # type: ignore

    mcp = FastMCP(
        "mock-streamable-http",
        host="127.0.0.1",
        port=port,
        # Streamable HTTP at /mcp (SDK default).
    )

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
    raise RuntimeError(f"mock streamable-http MCP did not start on :{port} in {timeout}s: {last_err}")


@pytest.fixture
def streamable_http_mcp_url() -> Iterator[str]:
    """Run a mock streamable-http MCP server and yield its `/mcp` URL.

    Uses a daemon thread + Uvicorn to spin up FastMCP's streamable_http_app,
    so the fixture exits cleanly when the test process tears down — even if the
    Uvicorn loop is still draining.
    """
    import uvicorn  # type: ignore

    port = _pick_free_port()
    mcp_app = _build_mock_app(port)
    starlette_app = mcp_app.streamable_http_app()

    config = uvicorn.Config(
        starlette_app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
        loop="asyncio",
    )
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True, name=f"mock-mcp-{port}")
    thread.start()
    try:
        _wait_for_port(port)
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        server.should_exit = True
        # Give Uvicorn up to 3s to exit gracefully; daemon thread will be reaped on process exit.
        thread.join(timeout=3.0)


def fixture_self_check() -> None:  # pragma: no cover - manual smoke
    """Sanity-check the fixture outside pytest. Run: ``python -m tests.fixtures.mock_streamable_http_mcp``."""
    port = _pick_free_port()
    mcp_app = _build_mock_app(port)
    starlette_app = mcp_app.streamable_http_app()
    import uvicorn  # type: ignore

    config = uvicorn.Config(starlette_app, host="127.0.0.1", port=port, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    _wait_for_port(port)
    resp = httpx.get(f"http://127.0.0.1:{port}/mcp", timeout=2.0)
    print("mock server up; GET /mcp status:", resp.status_code)
    server.should_exit = True


if __name__ == "__main__":  # pragma: no cover
    fixture_self_check()
