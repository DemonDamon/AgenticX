#!/usr/bin/env python3
"""Tests for the server-side automation scheduler and leader election (Plan D).

Covers:
- AC-1: tick decision parity with the Desktop TypeScript scheduler branches
  (disabled / date range / daily / interval / once / same-minute dedup);
- AC-2: leader election — single firer, takeover after the leader dies;
- tick leader gating (non-leader fires nothing).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import pytest

from agenticx.runtime.coordination.factory import (
    get_coordination_bus,
    reset_coordination_bus_for_testing,
)
from agenticx.runtime.coordination.leader import LeaderGate
from agenticx.runtime.coordination.redis_bus import RedisBus
from agenticx.studio.automation_scheduler import (
    ServerAutomationScheduler,
    _is_within_date_range,
    _minute_key,
    _should_run,
)


def _task(
    task_id: str,
    *,
    enabled: bool = True,
    frequency: Dict[str, Any] | None = None,
    date_range: Dict[str, str] | None = None,
    last_run_at: str = "",
) -> Dict[str, Any]:
    task: Dict[str, Any] = {
        "id": task_id,
        "name": task_id,
        "enabled": enabled,
        "frequency": frequency or {"type": "daily", "time": "09:30", "days": [1, 2, 3, 4, 5]},
        "prompt": "run",
    }
    if date_range is not None:
        task["effectiveDateRange"] = date_range
    if last_run_at:
        task["lastRunAt"] = last_run_at
    return task


# Frozen moment: 2026-08-05 is a Wednesday (isoweekday 3).
NOW = datetime(2026, 8, 5, 9, 30, 0)  # 09:30 local


# ── AC-1: decision parity ──


def test_should_run_daily_match_and_mismatch() -> None:
    daily = {"type": "daily", "time": "09:30", "days": [3]}
    assert _should_run(_task("a", frequency=daily), "09:30", "2026-08-05", 3, 9) is True
    # wrong minute
    assert _should_run(_task("b", frequency=daily), "09:31", "2026-08-05", 3, 9) is False
    # wrong day
    assert _should_run(_task("c", frequency=daily), "09:30", "2026-08-05", 4, 9) is False


def test_should_run_interval_rules() -> None:
    interval = {"type": "interval", "hours": 2, "days": [3]}
    assert _should_run(_task("a", frequency=interval), "10:00", "2026-08-05", 3, 10) is True
    # odd hour
    assert _should_run(_task("b", frequency=interval), "09:00", "2026-08-05", 3, 9) is False
    # not on the hour
    assert _should_run(_task("c", frequency=interval), "10:30", "2026-08-05", 3, 10) is False
    # missing/invalid hours never runs (JS NaN === 0 is false)
    bad = {"type": "interval", "hours": 0, "days": [3]}
    assert _should_run(_task("d", frequency=bad), "10:00", "2026-08-05", 3, 10) is False


def test_should_run_once() -> None:
    once = {"type": "once", "date": "2026-08-05", "time": "09:30"}
    assert _should_run(_task("a", frequency=once), "09:30", "2026-08-05", 3, 9) is True
    assert _should_run(_task("b", frequency=once), "09:30", "2026-08-06", 4, 9) is False


def test_date_range_bounds() -> None:
    assert _is_within_date_range(_task("a"), "2026-08-05") is True
    bounded = _task("b", date_range={"start": "2026-08-01", "end": "2026-08-31"})
    assert _is_within_date_range(bounded, "2026-08-05") is True
    assert _is_within_date_range(bounded, "2026-07-31") is False
    assert _is_within_date_range(bounded, "2026-09-01") is False


def test_minute_key_format() -> None:
    assert _minute_key(NOW) == "2026-08-05T09:30"


async def test_tick_fires_only_due_tasks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: tmp_path / "sessions")
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    monkeypatch.delenv("AGX_STORAGE_BACKEND", raising=False)
    storage_factory.reset_storage_backend_for_testing()

    from agenticx.runtime._automation_tasks_io import save_automation_tasks

    tasks = [
        _task("due-daily", frequency={"type": "daily", "time": "09:30", "days": [3]}),
        _task("disabled", enabled=False),
        _task("out-of-range", date_range={"start": "2026-08-10"}),
        _task("wrong-time", frequency={"type": "daily", "time": "10:00", "days": [3]}),
        _task(
            "ran-this-minute",
            frequency={"type": "daily", "time": "09:30", "days": [3]},
            last_run_at="2026-08-05T09:30:00.000Z",  # UTC-ISO prefix match (UTC tz semantics)
        ),
    ]
    save_automation_tasks(tasks)

    fired_exec: List[str] = []

    class _AlwaysLeader:
        async def am_i_leader(self) -> bool:
            return True

        async def start(self) -> None: ...
        async def stop(self) -> None: ...

    scheduler = ServerAutomationScheduler(
        _AlwaysLeader(), base_url="http://127.0.0.1:1", tick_interval=999
    )
    monkeypatch.setattr(
        scheduler,
        "_execute_task",
        lambda task: _record_exec(fired_exec, task),
    )

    fired = await scheduler.tick(now=NOW)
    assert fired == ["due-daily"]
    # Same minute: no refire.
    assert await scheduler.tick(now=NOW) == []

    # Execution tasks were scheduled for the fired task only.
    await asyncio.sleep(0.05)
    assert fired_exec == ["due-daily"]

    # lastRunAt persisted via the storage backend.
    from agenticx.runtime._automation_tasks_io import load_automation_tasks

    stored = {t["id"]: t for t in load_automation_tasks()}
    assert stored["due-daily"]["lastRunAt"]
    assert "lastRunAt" not in stored["wrong-time"]


def _record_exec(fired: List[str], task: Dict[str, Any]):
    fired.append(str(task.get("id") or ""))
    # Return a completed coroutine-compatible placeholder for create_task.
    async def _noop() -> None:
        return None

    return _noop()


async def test_tick_non_leader_fires_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: tmp_path / "sessions")
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    monkeypatch.delenv("AGX_STORAGE_BACKEND", raising=False)
    storage_factory.reset_storage_backend_for_testing()

    from agenticx.runtime._automation_tasks_io import save_automation_tasks

    save_automation_tasks([_task("due", frequency={"type": "daily", "time": "09:30", "days": [3]})])

    class _NeverLeader:
        async def am_i_leader(self) -> bool:
            return False

        async def start(self) -> None: ...
        async def stop(self) -> None: ...

    scheduler = ServerAutomationScheduler(
        _NeverLeader(), base_url="http://127.0.0.1:1", tick_interval=999
    )
    assert await scheduler.tick(now=NOW) == []


# ── AC-2: leader election ──


def _make_redis_bus() -> RedisBus:
    fakeredis = pytest.importorskip("fakeredis.aioredis")
    from agenticx.server.redis_backend import RedisBackend

    if not hasattr(_make_redis_bus, "_server"):
        _make_redis_bus._server = fakeredis.FakeServer()  # type: ignore[attr-defined]
    rb = RedisBackend(url="redis://test/0")
    rb._client = fakeredis.FakeRedis(server=_make_redis_bus._server, decode_responses=True)  # type: ignore[attr-defined]
    rb._connected = True
    return RedisBus(redis_backend=rb)


async def test_leader_election_single_firer_and_takeover() -> None:
    bus_a = _make_redis_bus()
    bus_b = _make_redis_bus()
    gate_a = LeaderGate(bus_a, name="automation", instance_id="aaaa", ttl_ms=600, campaign_interval=0.1, jitter_max=0)
    gate_b = LeaderGate(bus_b, name="automation", instance_id="bbbb", ttl_ms=600, campaign_interval=0.1, jitter_max=0)
    try:
        await gate_a.start()
        await gate_b.start()
        await asyncio.sleep(0.5)
        leaders = [await gate_a.am_i_leader(), await gate_b.am_i_leader()]
        assert leaders.count(True) == 1

        # Kill the leader (stop renewing + release campaign loop without releasing
        # the lock, simulating a crash) and wait for the lease to expire.
        if await gate_a.am_i_leader():
            dead, survivor = gate_a, gate_b
        else:
            dead, survivor = gate_b, gate_a
        if dead._lock is not None and dead._lock._heartbeat_task is not None:
            dead._lock._heartbeat_task.cancel()
        dead._campaign_task.cancel()
        dead._lock = None  # crashed: lock key remains until TTL expiry

        deadline = asyncio.get_running_loop().time() + 5.0
        while asyncio.get_running_loop().time() < deadline:
            if await survivor.am_i_leader():
                break
            await asyncio.sleep(0.1)
        assert await survivor.am_i_leader() is True
    finally:
        await gate_a.stop()
        await gate_b.stop()
        await bus_a.close()
        await bus_b.close()


async def test_leader_gate_inprocess_always_leader() -> None:
    from agenticx.runtime.coordination.in_process import InProcessBus

    gate = LeaderGate(InProcessBus(), name="automation", jitter_max=0, campaign_interval=0.05)
    try:
        await gate.start()
        await asyncio.sleep(0.1)
        assert await gate.am_i_leader() is True
    finally:
        await gate.stop()
