#!/usr/bin/env python3
"""Smoke tests for SessionEventHub: pub-sub, replay, done sentinel, backpressure.

Author: Damon Li
"""

from __future__ import annotations

import asyncio

from agenticx.runtime.events import RuntimeEvent
from agenticx.studio.session_event_hub import (
    MAX_SUBSCRIBERS,
    SessionEventHub,
)


def _evt(text: str) -> RuntimeEvent:
    return RuntimeEvent(type="token", data={"text": text}, agent_id="meta")


def test_publish_assigns_monotonic_seq() -> None:
    async def _run() -> None:
        hub = SessionEventHub("s1")
        s1 = await hub.publish(_evt("a"))
        s2 = await hub.publish(_evt("b"))
        assert s1 == 1
        assert s2 == 2
        assert hub.current_seq == 2

    asyncio.run(_run())


def test_subscriber_receives_live_events() -> None:
    async def _run() -> None:
        hub = SessionEventHub("s1")
        sub_id, q, seq = hub.subscribe()
        assert seq == 0
        await hub.publish(_evt("hello"))
        buffered = await asyncio.wait_for(q.get(), timeout=1.0)
        assert buffered.seq == 1
        assert buffered.event is not None
        assert buffered.event.data["text"] == "hello"
        hub.unsubscribe(sub_id)

    asyncio.run(_run())


def test_replay_since_returns_strictly_newer() -> None:
    async def _run() -> None:
        hub = SessionEventHub("s1")
        await hub.publish(_evt("a"))  # seq 1
        await hub.publish(_evt("b"))  # seq 2
        await hub.publish(_evt("c"))  # seq 3
        replayed = hub.replay_since(1)
        assert [b.seq for b in replayed] == [2, 3]
        assert hub.replay_since(0) and len(hub.replay_since(0)) == 3
        assert hub.replay_since(3) == []

    asyncio.run(_run())


def test_publish_done_sentinel_and_runtime_done() -> None:
    async def _run() -> None:
        hub = SessionEventHub("s1")
        sub_id, q, _ = hub.subscribe()
        await hub.publish(_evt("a"))
        done_seq = await hub.publish_done()
        assert hub.is_runtime_done is True
        assert done_seq == 2
        first = await asyncio.wait_for(q.get(), timeout=1.0)
        second = await asyncio.wait_for(q.get(), timeout=1.0)
        assert first.event is not None
        assert second.event is None  # sentinel
        # Publishing after done is a no-op (seq unchanged).
        assert await hub.publish(_evt("late")) == done_seq
        hub.unsubscribe(sub_id)

    asyncio.run(_run())


def test_late_subscriber_replays_then_lives() -> None:
    """Reattach pattern: subscribe first, replay (since, sub_seq], live after."""

    async def _run() -> None:
        hub = SessionEventHub("s1")
        await hub.publish(_evt("a"))  # seq 1
        await hub.publish(_evt("b"))  # seq 2
        # New reattach client subscribes; sub_seq snapshots current 2.
        sub_id, q, sub_seq = hub.subscribe()
        assert sub_seq == 2
        # Replay covers (since=0, sub_seq=2].
        replayed = [b for b in hub.replay_since(0) if b.seq <= sub_seq]
        assert [b.seq for b in replayed] == [1, 2]
        # New live event lands in the queue, seq > sub_seq.
        await hub.publish(_evt("c"))  # seq 3
        live = await asyncio.wait_for(q.get(), timeout=1.0)
        assert live.seq == 3
        hub.unsubscribe(sub_id)

    asyncio.run(_run())


def test_slow_subscriber_dropped_on_queue_full() -> None:
    async def _run() -> None:
        hub = SessionEventHub("s1", subscriber_queue_maxsize=8)
        sub_id, _q, _ = hub.subscribe()
        # Never drain the queue; overflow should evict the slow subscriber.
        for i in range(64):
            await hub.publish(_evt(f"e{i}"))
        # A fresh subscriber still works after the slow one was dropped.
        new_id, nq, _ = hub.subscribe()
        await hub.publish(_evt("after"))
        got = await asyncio.wait_for(nq.get(), timeout=1.0)
        assert got.event is not None
        hub.unsubscribe(new_id)
        hub.unsubscribe(sub_id)

    asyncio.run(_run())


def test_max_subscribers_enforced() -> None:
    async def _run() -> None:
        hub = SessionEventHub("s1")
        ids = [hub.subscribe()[0] for _ in range(MAX_SUBSCRIBERS)]
        raised = False
        try:
            hub.subscribe()
        except RuntimeError:
            raised = True
        assert raised is True
        for sid in ids:
            hub.unsubscribe(sid)

    asyncio.run(_run())


def test_close_clears_state_and_blocks_subscribe() -> None:
    async def _run() -> None:
        hub = SessionEventHub("s1")
        await hub.publish(_evt("a"))
        hub.close()
        assert hub.is_closed is True
        assert hub.replay_since(0) == []
        raised = False
        try:
            hub.subscribe()
        except RuntimeError:
            raised = True
        assert raised is True

    asyncio.run(_run())
