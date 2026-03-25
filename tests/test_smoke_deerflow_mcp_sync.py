#!/usr/bin/env python3
"""Smoke tests for DeerFlow-inspired MCP sync wrapper (nested event loop safe).

Author: Damon Li
"""

from __future__ import annotations

import asyncio

import pytest

from agenticx.tools.remote import make_sync_mcp_wrapper


def test_sync_wrapper_no_running_loop() -> None:
    async def coro() -> int:
        return 42

    w = make_sync_mcp_wrapper(coro, "demo")
    assert w() == 42


@pytest.mark.asyncio
async def test_sync_wrapper_inside_running_loop() -> None:
    async def coro() -> str:
        return "ok"

    async def runner() -> str:
        w = make_sync_mcp_wrapper(coro, "demo2")
        return str(w())

    assert await runner() == "ok"


def test_sync_wrapper_reraises() -> None:
    async def boom() -> None:
        raise ValueError("expected")

    w = make_sync_mcp_wrapper(boom, "boom_tool")
    with pytest.raises(ValueError, match="expected"):
        w()
