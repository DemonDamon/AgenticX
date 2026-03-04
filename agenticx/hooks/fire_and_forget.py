"""Utilities for non-blocking hook execution.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from typing import Coroutine

logger = logging.getLogger(__name__)


def fire_and_forget(coro: Coroutine[object, object, object], label: str) -> None:
    """Schedule a coroutine without awaiting and report failures."""

    task = asyncio.create_task(coro)

    def _on_done(done_task: asyncio.Task[object]) -> None:
        try:
            done_task.result()
        except Exception as exc:  # pragma: no cover - defensive path
            logger.warning("%s: %s", label, exc)

    task.add_done_callback(_on_done)

