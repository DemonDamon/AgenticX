#!/usr/bin/env python3
"""Install an asyncio exception handler that prevents a single MCP stdio child
crash (EPIPE / BrokenPipe / connection reset) from killing the agx serve loop.

Author: Damon Li
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

logger = logging.getLogger("agenticx.runtime.mcp_crash_guard")

# 文案/类型命中即视为「可吞掉的传输噪声」，仅记录不致命。
_SWALLOW_EXC_TYPES = (BrokenPipeError, ConnectionResetError)
_SWALLOW_TEXT_MARKERS = ("epipe", "broken pipe", "connection reset", "transport closed")


def _is_swallowable(exc: BaseException | None, message: str) -> bool:
    if isinstance(exc, _SWALLOW_EXC_TYPES):
        return True
    blob = f"{message} {exc!r}".lower()
    return any(marker in blob for marker in _SWALLOW_TEXT_MARKERS)


def install_mcp_crash_guard(loop: asyncio.AbstractEventLoop | None = None) -> None:
    """Install (idempotent) a loop exception handler that swallows MCP transport noise.

    Disabled only when AGX_MCP_CRASH_GUARD=0.
    """
    if os.getenv("AGX_MCP_CRASH_GUARD", "1").strip().lower() in {"0", "false", "off", "no"}:
        logger.info("mcp_crash_guard disabled via AGX_MCP_CRASH_GUARD=0")
        return
    try:
        loop = loop or asyncio.get_running_loop()
    except RuntimeError:
        logger.debug("install_mcp_crash_guard: no running loop, skip")
        return
    if getattr(loop, "_agx_mcp_guard_installed", False):
        return

    prev_handler = loop.get_exception_handler()

    def _handler(lp: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        exc = context.get("exception")
        message = str(context.get("message", ""))
        if _is_swallowable(exc, message):
            logger.warning("mcp_crash_guard swallowed MCP transport error: %s (%r)", message, exc)
            return
        if prev_handler is not None:
            prev_handler(lp, context)
        else:
            lp.default_exception_handler(context)

    loop.set_exception_handler(_handler)
    setattr(loop, "_agx_mcp_guard_installed", True)
    logger.info("mcp_crash_guard installed on event loop")
