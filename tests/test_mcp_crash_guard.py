"""Tests for mcp_crash_guard asyncio exception handler."""

from __future__ import annotations

import asyncio
import logging

import pytest

from agenticx.runtime.mcp_crash_guard import install_mcp_crash_guard


def test_swallows_broken_pipe(monkeypatch, caplog):
    monkeypatch.delenv("AGX_MCP_CRASH_GUARD", raising=False)

    async def _run() -> None:
        loop = asyncio.get_running_loop()
        install_mcp_crash_guard(loop)
        handler = loop.get_exception_handler()
        assert handler is not None
        with caplog.at_level(logging.WARNING, logger="agenticx.runtime.mcp_crash_guard"):
            handler(loop, {"message": "pipe broke", "exception": BrokenPipeError()})
        assert "swallowed MCP transport error" in caplog.text

    asyncio.run(_run())


def test_forwards_other_exceptions(monkeypatch):
    monkeypatch.delenv("AGX_MCP_CRASH_GUARD", raising=False)
    forwarded: list[dict] = []

    async def _run() -> None:
        loop = asyncio.get_running_loop()

        def _prev(lp: asyncio.AbstractEventLoop, context: dict) -> None:
            forwarded.append(context)

        loop.set_exception_handler(_prev)
        install_mcp_crash_guard(loop)
        handler = loop.get_exception_handler()
        assert handler is not None
        handler(loop, {"message": "bad value", "exception": ValueError("nope")})

    asyncio.run(_run())
    assert len(forwarded) == 1
    assert isinstance(forwarded[0].get("exception"), ValueError)


def test_disabled_via_env(monkeypatch):
    monkeypatch.setenv("AGX_MCP_CRASH_GUARD", "0")

    async def _run() -> None:
        loop = asyncio.get_running_loop()
        install_mcp_crash_guard(loop)
        assert not getattr(loop, "_agx_mcp_guard_installed", False)

    asyncio.run(_run())


def test_idempotent_install(monkeypatch):
    monkeypatch.delenv("AGX_MCP_CRASH_GUARD", raising=False)

    async def _run() -> None:
        loop = asyncio.get_running_loop()
        install_mcp_crash_guard(loop)
        first = loop.get_exception_handler()
        install_mcp_crash_guard(loop)
        assert loop.get_exception_handler() is first

    asyncio.run(_run())
