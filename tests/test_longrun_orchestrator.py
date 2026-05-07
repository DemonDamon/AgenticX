#!/usr/bin/env python3
"""Tests for ``LongRunOrchestrator`` wiring.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest

from agenticx.longrun.orchestrator import LongRunOrchestrator, LongRunOrchestratorConfig, TaskEntry
from agenticx.longrun.sources import ComboTaskSource, CronSource, ManualSource
from agenticx.longrun.retry_policy import TaskRetryPolicy
from agenticx.longrun.task_workspace import TaskWorkspaceConfig


@pytest.mark.asyncio
async def test_longrun_state_machine_done(tmp_path: Path) -> None:
    manual = ManualSource()
    combo = ComboTaskSource(manual, CronSource(min_gap_sec=3600))
    calls = {"n": 0}

    async def submit(entry: TaskEntry) -> dict:
        calls["n"] += 1
        return {"ok": True, "wants_continuation": False}

    orch = LongRunOrchestrator(
        config=LongRunOrchestratorConfig(
            poll_interval_sec=0.05,
            workspace_config=TaskWorkspaceConfig(root=tmp_path / "lr"),
            retry_policy=TaskRetryPolicy(max_attempts=3),
        ),
        task_source=combo,
        submit_fn=submit,
    )
    await manual.enqueue({"id": "t-done", "task": "hello"})
    await orch._tick()
    await asyncio.sleep(0.35)
    await orch.stop()
    snap = orch.snapshot()
    assert calls["n"] >= 1
    assert snap["counts"]["done"] >= 1


@pytest.mark.asyncio
async def test_longrun_continuation_then_done(tmp_path: Path) -> None:
    manual = ManualSource()
    combo = ComboTaskSource(manual, CronSource(min_gap_sec=3600))
    calls = {"n": 0}

    async def submit(entry: TaskEntry) -> dict:
        calls["n"] += 1
        if calls["n"] == 1:
            return {"ok": True, "wants_continuation": True}
        return {"ok": True, "wants_continuation": False}

    orch = LongRunOrchestrator(
        config=LongRunOrchestratorConfig(
            poll_interval_sec=0.05,
            workspace_config=TaskWorkspaceConfig(root=tmp_path / "lr2"),
            retry_policy=TaskRetryPolicy(continuation_delay_sec=0.02, max_continuations=10),
        ),
        task_source=combo,
        submit_fn=submit,
    )
    await manual.enqueue({"id": "t-cont", "task": "hello"})
    await orch._tick()
    await asyncio.sleep(0.55)
    await orch.stop()
    assert calls["n"] >= 2


@pytest.mark.asyncio
async def test_longrun_failure_then_recover(tmp_path: Path) -> None:
    manual = ManualSource()
    combo = ComboTaskSource(manual, CronSource(min_gap_sec=3600))
    calls = {"n": 0}

    async def submit(entry: TaskEntry) -> dict:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        return {"ok": True, "wants_continuation": False}

    orch = LongRunOrchestrator(
        config=LongRunOrchestratorConfig(
            poll_interval_sec=0.05,
            workspace_config=TaskWorkspaceConfig(root=tmp_path / "lr3"),
            retry_policy=TaskRetryPolicy(failure_base_sec=0.02, failure_multiplier=2.0, max_attempts=5),
        ),
        task_source=combo,
        submit_fn=submit,
    )
    await manual.enqueue({"id": "t-fail", "task": "hello"})
    await orch._tick()
    await asyncio.sleep(0.55)
    await orch.stop()
    assert calls["n"] >= 2


@pytest.mark.asyncio
async def test_longrun_stall_triggers_restart(tmp_path: Path) -> None:
    manual = ManualSource()
    combo = ComboTaskSource(manual, CronSource(min_gap_sec=3600))
    calls = {"n": 0}

    async def submit(entry: TaskEntry) -> dict:
        calls["n"] += 1
        await asyncio.sleep(0.3)
        return {"ok": True, "wants_continuation": False}

    orch = LongRunOrchestrator(
        config=LongRunOrchestratorConfig(
            poll_interval_sec=0.05,
            workspace_config=TaskWorkspaceConfig(root=tmp_path / "lr4"),
            stall_threshold_sec=0.08,
            retry_policy=TaskRetryPolicy(failure_base_sec=0.02, max_attempts=5),
        ),
        task_source=combo,
        submit_fn=submit,
    )
    await manual.enqueue({"id": "t-stall", "task": "hello"})
    await orch._tick()
    await asyncio.sleep(0.12)
    await orch._reconcile_stalls()
    await asyncio.sleep(0.6)
    await orch.stop()
    assert calls["n"] >= 2


@pytest.mark.asyncio
async def test_longrun_no_regression_on_existing_paths() -> None:
    payload = [
        {
            "id": "at1",
            "enabled": True,
            "longrun_server_dispatch": False,
            "prompt": "x",
            "frequency": {"type": "interval", "hours": 1},
        }
    ]
    with patch("agenticx.longrun.sources.cron_source.load_automation_tasks", return_value=payload):
        cron = CronSource(min_gap_sec=0)
        assert await cron.fetch_pending_tasks() == []
