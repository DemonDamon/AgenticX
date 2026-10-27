#!/usr/bin/env python3
"""TurnContinuation wake-up queue.

Author: Damon Li
"""

from __future__ import annotations

import asyncio

from agenticx.managed.events.store import StoredEvent
from agenticx.managed.host.continuation import TurnContinuation, WakeUp


def _event(event_id: str) -> StoredEvent:
    return StoredEvent(
        id=event_id,
        tenant_id="dev",
        session_id="sess",
        seq=1,
        type="session.task_completed",
        payload={"task_id": event_id},
        created_at="2026-10-25T00:00:00.000Z",
    )


async def test_wait_returns_none_without_pending() -> None:
    continuation = TurnContinuation()
    result = await asyncio.wait_for(continuation.wait(), 0.1)
    assert result is None


async def test_resolve_with_wake_delivers_in_order() -> None:
    continuation = TurnContinuation()
    first = _event("a")
    second = _event("b")
    continuation.register_pending("k1")
    continuation.register_pending("k2")
    continuation.resolve_pending("k1", WakeUp("task", first))
    continuation.resolve_pending("k2", WakeUp("task", second))
    assert (await continuation.wait()).event is first
    assert (await continuation.wait()).event is second


async def test_poke_returns_none() -> None:
    continuation = TurnContinuation()
    continuation.register_pending("k")

    async def _poke() -> None:
        await asyncio.sleep(0.01)
        continuation.poke()

    asyncio.create_task(_poke())
    result = await asyncio.wait_for(continuation.wait(), 1)
    assert result is None


async def test_close_drops_late_wakes() -> None:
    continuation = TurnContinuation()
    continuation.register_pending("k")
    continuation.close()
    continuation.resolve_pending("k", WakeUp("task", _event("late")))
    result = await asyncio.wait_for(continuation.wait(), 0.1)
    assert result is None
    assert continuation.has_pending is False
