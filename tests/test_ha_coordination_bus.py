#!/usr/bin/env python3
"""Tests for the coordination bus (HA Plan C).

Covers:
- AC-1: bus contract over InProcessBus and RedisBus (fakeredis);
- AC-3: redis lock lease takeover after TTL expiry;
- AC-4: degradation when redis is unavailable;
- AC-5: cross-process interrupt via cancel broadcast;
- AC-6: session lock conflict -> None (busy elsewhere);
- AC-7: event replay log ordering/cursor + hub token aggregation;
- AC-8: factory resolution.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from agenticx.runtime.coordination.factory import (
    get_coordination_bus,
    reset_coordination_bus_for_testing,
)
from agenticx.runtime.coordination.in_process import InProcessBus
from agenticx.runtime.coordination.redis_bus import RedisBus
from agenticx.studio.session_event_hub import SessionEventHub
from agenticx.studio.session_manager import SessionManager


def _make_redis_pair() -> tuple[RedisBus, RedisBus]:
    """Two bus instances sharing one fake redis server (two 'processes')."""
    fakeredis = pytest.importorskip("fakeredis.aioredis")
    from agenticx.server.redis_backend import RedisBackend

    server = fakeredis.FakeServer()
    buses = []
    for _ in range(2):
        rb = RedisBackend(url="redis://test/0")
        rb._client = fakeredis.FakeRedis(server=server, decode_responses=True)
        rb._connected = True
        buses.append(RedisBus(redis_backend=rb))
    return buses[0], buses[1]


@pytest.fixture(params=["inprocess", "redis"])
async def bus(request: pytest.FixtureRequest):
    if request.param == "inprocess":
        yield InProcessBus()
    else:
        bus_a, _ = _make_redis_pair()
        yield bus_a
        await bus_a.close()


# ── AC-1: contract ──


async def test_bus_lock_mutual_exclusion_and_release(bus) -> None:
    if isinstance(bus, InProcessBus):
        pytest.skip("in-process bus always grants (single-replica semantics)")
    lock = await bus.acquire_session_lock("s1", owner="a")
    assert lock is not None
    assert await bus.acquire_session_lock("s1", owner="b") is None
    await lock.release()
    lock_b = await bus.acquire_session_lock("s1", owner="b")
    assert lock_b is not None
    await lock_b.release()


async def test_bus_lock_inprocess_always_grants() -> None:
    bus = InProcessBus()
    lock1 = await bus.acquire_session_lock("s1", owner="a")
    lock2 = await bus.acquire_session_lock("s1", owner="b")
    assert lock1 is not None and lock2 is not None


async def test_bus_cancel_broadcast(bus) -> None:
    received: list[str] = []

    async def _cb(sid: str) -> None:
        received.append(sid)

    await bus.subscribe_cancel(_cb)
    # Pub/sub is fire-and-forget: wait for the subscription to go live first.
    if isinstance(bus, RedisBus):
        assert await bus.wait_cancel_ready() is True
    await bus.publish_cancel("s1")
    # InProcess invokes inline; redis pub/sub needs a delivery cycle.
    for _ in range(50):
        if received:
            break
        await asyncio.sleep(0.02)
    assert received == ["s1"]


async def test_bus_event_log_append_read_trim(bus) -> None:
    for i in range(5):
        cursor = await bus.event_append("s1", {"type": "token", "data": {"text": f"t{i}"}})
    assert cursor
    all_rows = await bus.event_read("s1")
    assert len(all_rows) == 5
    assert [c for c, _ in all_rows] == sorted((c for c, _ in all_rows), key=int)
    since = all_rows[1][0]
    rows = await bus.event_read("s1", since=since)
    assert [e["data"]["text"] for _, e in rows] == ["t2", "t3", "t4"]
    await bus.event_trim("s1", max_len=2)
    rows = await bus.event_read("s1")
    assert len(rows) == 2
    assert [e["data"]["text"] for _, e in rows] == ["t3", "t4"]


async def test_bus_ping(bus) -> None:
    assert await bus.ping() is True


# ── AC-3: lease takeover ──


async def test_redis_lock_lease_takeover() -> None:
    bus_a, bus_b = _make_redis_pair()
    try:
        lock_a = await bus_a.acquire_session_lock("s1", owner="a", ttl_ms=400)
        assert lock_a is not None
        # Simulate owner crash: stop the heartbeat so the lease expires.
        if lock_a._heartbeat_task is not None:
            lock_a._heartbeat_task.cancel()
        assert await bus_b.acquire_session_lock("s1", owner="b", ttl_ms=400) is None
        await asyncio.sleep(0.6)
        lock_b = await bus_b.acquire_session_lock("s1", owner="b", ttl_ms=400)
        assert lock_b is not None
        await lock_b.release()
    finally:
        await bus_a.close()
        await bus_b.close()


async def test_redis_lock_reentrant_same_owner() -> None:
    bus_a, _ = _make_redis_pair()
    try:
        lock1 = await bus_a.acquire_session_lock("s1", owner="a")
        lock2 = await bus_a.acquire_session_lock("s1", owner="a")
        assert lock1 is not None and lock2 is not None
        await lock1.release()
    finally:
        await bus_a.close()


# ── AC-4: degradation ──


async def test_redis_bus_degrades_when_unavailable() -> None:
    from agenticx.server.redis_backend import RedisBackend

    rb = RedisBackend(url="redis://127.0.0.1:1/0")  # nothing listening
    bus = RedisBus(redis_backend=rb)
    try:
        assert await bus.ping() is False
        # Fail-open: degraded lock granted rather than blocking all chat.
        lock = await bus.acquire_session_lock("s1", owner="a")
        assert lock is not None
        assert await lock.renew() is True  # degraded locks report held
        await lock.release()
        assert await bus.event_read("s1") == []
    finally:
        await bus.close()


# ── AC-5/AC-6: SessionManager wiring ──


async def test_cross_process_interrupt() -> None:
    bus_a, bus_b = _make_redis_pair()
    manager_a = SessionManager()
    manager_b = SessionManager()
    manager_a._bus = bus_a
    manager_b._bus = bus_b
    manager_b._instance_id = "bbbbbbbb"
    try:
        managed = manager_a.create(session_id="shared-sess")
        assert managed is not None
        await manager_a.start_coordination()
        assert await bus_a.wait_cancel_ready() is True
        assert manager_b.request_interrupt("shared-sess") is True
        for _ in range(100):
            if manager_a.should_interrupt("shared-sess"):
                break
            await asyncio.sleep(0.02)
        assert manager_a.should_interrupt("shared-sess") is True
    finally:
        await bus_a.close()
        await bus_b.close()


async def test_session_lock_conflict_returns_none() -> None:
    bus_a, bus_b = _make_redis_pair()
    manager = SessionManager()
    manager._bus = bus_b
    manager._instance_id = "bbbbbbbb"
    try:
        held = await bus_a.acquire_session_lock("s-busy", owner="aaaaaaaa")
        assert held is not None
        assert await manager.acquire_session_run_lock("s-busy") is None
        await held.release()
        lock = await manager.acquire_session_run_lock("s-busy")
        assert lock is not None
        await lock.release()
    finally:
        await bus_a.close()
        await bus_b.close()


# ── AC-7: hub -> bus append with token aggregation ──


async def test_hub_appends_to_bus_with_token_aggregation() -> None:
    from agenticx.runtime.events import RuntimeEvent

    bus = InProcessBus()
    hub = SessionEventHub("s1", coordination_bus=bus)

    def _evt(type_: str, data: dict) -> RuntimeEvent:
        return RuntimeEvent(type=type_, data=data, agent_id="meta")

    for i in range(3):
        await hub.publish(_evt("token", {"text": f"t{i}"}))
    await hub.publish(_evt("final", {"text": "done"}))
    await hub.publish_done()

    rows = await bus.event_read("s1")
    # 3 tokens aggregated into 1 entry + final = 2 entries.
    assert [e["type"] for _, e in rows] == ["token", "final"]
    assert rows[0][1]["data"]["text"] == "t0t1t2"


async def test_hub_without_bus_unchanged() -> None:
    from agenticx.runtime.events import RuntimeEvent

    hub = SessionEventHub("s1")
    seq = await hub.publish(RuntimeEvent(type="token", data={"text": "x"}, agent_id="meta"))
    assert seq == 1
    assert hub.replay_since(0)[0].event.data["text"] == "x"


# ── AC-8: factory resolution ──


@pytest.fixture(autouse=True)
def _reset_bus_factory():
    reset_coordination_bus_for_testing()
    yield
    reset_coordination_bus_for_testing()


def test_bus_factory_defaults_inprocess(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_COORDINATION_BACKEND", raising=False)
    monkeypatch.delenv("AGX_HA_MODE", raising=False)
    monkeypatch.delenv("AGX_STORAGE_BACKEND", raising=False)
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(ConfigManager, "get_value", classmethod(lambda cls, key: None))
    assert isinstance(get_coordination_bus(), InProcessBus)


def test_bus_factory_env_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_COORDINATION_BACKEND", "redis")
    monkeypatch.setenv("AGX_REDIS_URL", "redis://127.0.0.1:6399/15")
    assert isinstance(get_coordination_bus(), RedisBus)


def test_bus_factory_follows_ha_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_COORDINATION_BACKEND", raising=False)
    monkeypatch.setenv("AGX_HA_MODE", "redis")
    monkeypatch.setenv("AGX_REDIS_URL", "redis://127.0.0.1:6399/15")
    assert isinstance(get_coordination_bus(), RedisBus)
