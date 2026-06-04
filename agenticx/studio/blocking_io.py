#!/usr/bin/env python3
"""Dedicated thread pools for blocking Studio I/O (avoid starving the default pool).

Persist (SQLite + FTS) and settings scans (skills/hooks/tools status) compete for
the default asyncio executor when memory-graph ingest is active; separate pools
keep settings tabs responsive.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import functools
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, TypeVar

T = TypeVar("T")

_PERSIST_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="agx-persist")
_SETTINGS_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="agx-settings")


async def run_in_persist_pool(func: Callable[..., T], /, *args: Any, **kwargs: Any) -> T:
    """Run blocking session persist work off the main event loop."""
    loop = asyncio.get_running_loop()
    bound = functools.partial(func, *args, **kwargs)
    return await loop.run_in_executor(_PERSIST_EXECUTOR, bound)


async def run_in_settings_pool(func: Callable[..., T], /, *args: Any, **kwargs: Any) -> T:
    """Run blocking settings-tab scans (skills, hooks, tool probes) off the main loop."""
    loop = asyncio.get_running_loop()
    bound = functools.partial(func, *args, **kwargs)
    return await loop.run_in_executor(_SETTINGS_EXECUTOR, bound)
