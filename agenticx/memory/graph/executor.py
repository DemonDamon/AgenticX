#!/usr/bin/env python3
"""Dedicated asyncio loop thread for Graphiti/Kuzu work.

Graphiti and Kuzu may run synchronous C extensions inside async methods; executing
them on the main agx serve event loop stalls /api/hooks, /api/usage/*, etc.
All Graphiti coroutines are scheduled on this background loop instead.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Coroutine, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

_loop: Optional[asyncio.AbstractEventLoop] = None
_thread: Optional[threading.Thread] = None
_ready = threading.Event()


def _thread_main() -> None:
    global _loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _loop = loop
    _ready.set()
    try:
        loop.run_forever()
    finally:
        loop.close()


def _ensure_graphiti_loop() -> asyncio.AbstractEventLoop:
    global _thread, _loop
    if _loop is not None and _loop.is_running():
        return _loop
    _ready.clear()
    _thread = threading.Thread(
        target=_thread_main,
        name="memory-graph-graphiti",
        daemon=True,
    )
    _thread.start()
    if not _ready.wait(timeout=60.0):
        raise RuntimeError("memory graph graphiti thread failed to start within 60s")
    if _loop is None:
        raise RuntimeError("memory graph graphiti loop is unavailable")
    return _loop


async def run_on_graphiti_loop(coro: Coroutine[Any, Any, T]) -> T:
    """Await a coroutine on the dedicated Graphiti event loop (off the main loop)."""
    loop = _ensure_graphiti_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    try:
        return await asyncio.wrap_future(future)
    except Exception:
        future.cancel()
        raise
