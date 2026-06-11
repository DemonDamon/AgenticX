"""Smoke test: event loop survives swallowed MCP transport errors."""

from __future__ import annotations

import asyncio

from agenticx.runtime.mcp_crash_guard import install_mcp_crash_guard


def test_loop_continues_after_swallowed_broken_pipe():
    async def _run() -> str:
        loop = asyncio.get_running_loop()
        install_mcp_crash_guard(loop)
        handler = loop.get_exception_handler()
        assert handler is not None
        handler(loop, {"message": "write EPIPE", "exception": BrokenPipeError()})

        async def _after() -> str:
            return "still alive"

        return await _after()

    result = asyncio.run(_run())
    assert result == "still alive"


def test_loop_continues_after_transport_error_callback():
    async def _run() -> str:
        loop = asyncio.get_running_loop()
        install_mcp_crash_guard(loop)

        fut = loop.create_future()
        fut.set_exception(BrokenPipeError())
        handler = loop.get_exception_handler()
        assert handler is not None
        handler(loop, {"message": "Future exception was never retrieved", "exception": fut.exception()})

        return "ok"

    assert asyncio.run(_run()) == "ok"
