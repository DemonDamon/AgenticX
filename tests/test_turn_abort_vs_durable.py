#!/usr/bin/env python3
"""Turn abort vs durable job cancel — two independent cancel scopes.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, List, Optional
from unittest.mock import MagicMock

import pytest

from agenticx.cli.agent_tools import META_TOOL_NAMES, STUDIO_TOOLS
from agenticx.runtime.durable_jobs.access import (
    get_durable_job_store,
    reset_durable_job_store,
    set_durable_job_store,
)
from agenticx.runtime.durable_jobs.models import JobStatus
from agenticx.runtime.durable_jobs.store import DurableJobStore
from agenticx.runtime.turn_abort import (
    TurnAbortHandle,
    abort_chat_turn,
    cancel_durable_job,
    cancel_turn_scoped_dispatch,
    create_durable_job,
)


@pytest.fixture()
def store(tmp_path: Path) -> DurableJobStore:
    s = DurableJobStore(db_path=tmp_path / "durable_jobs.sqlite")
    set_durable_job_store(s)
    yield s
    reset_durable_job_store()


class _SpyStore(DurableJobStore):
    """DurableJobStore that records control(cancel) calls."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.cancel_calls: List[str] = []

    def control(self, job_id: str, *, action: str) -> bool:
        if action.lower().strip() == "cancel":
            self.cancel_calls.append(job_id)
        return super().control(job_id, action=action)


@pytest.fixture()
def spy_store(tmp_path: Path) -> _SpyStore:
    s = _SpyStore(db_path=tmp_path / "spy_durable.sqlite")
    set_durable_job_store(s)
    yield s
    reset_durable_job_store()


def _tool_schema(name: str) -> Optional[dict]:
    for tool in STUDIO_TOOLS:
        fn = tool.get("function") if isinstance(tool, dict) else None
        if isinstance(fn, dict) and fn.get("name") == name:
            return fn
    return None


@pytest.mark.asyncio
async def test_turn_abort_cancels_turn_scoped_tool() -> None:
    """FR-1: turn abort cancels in-flight turn-scoped tool waits."""
    handle = TurnAbortHandle()
    started = asyncio.Event()
    cancelled = False

    async def mock_tool() -> str:
        nonlocal cancelled
        started.set()
        try:
            await asyncio.sleep(60)
            return "done"
        except asyncio.CancelledError:
            cancelled = True
            raise

    task = asyncio.create_task(mock_tool())
    await started.wait()

    handle.abort()
    assert handle.is_aborted()

    # Mirror agent_runtime tool wait: on turn abort, cancel dispatch task only.
    if handle.is_aborted():
        await cancel_turn_scoped_dispatch(task)

    assert cancelled is True
    assert task.cancelled() or task.done()


def test_turn_abort_leaves_durable_job(spy_store: _SpyStore) -> None:
    """FR-2: chat/turn abort must not call DurableJobStore.control(..., cancel)."""
    job = create_durable_job(
        owner="meta",
        kind="demo",
        payload={"note": "survive-stop"},
        store=spy_store,
    )
    assert job.status == JobStatus.QUEUED

    manager = MagicMock()
    manager.request_interrupt = MagicMock(return_value=True)

    result = abort_chat_turn(
        manager,
        "sess_turn_1",
        durable_store=spy_store,  # even if passed, must be ignored
    )

    assert result["ok"] is True
    assert result["scope"] == "turn"
    assert result["durable_jobs_cancelled"] is False
    manager.request_interrupt.assert_called_once_with("sess_turn_1")
    assert spy_store.cancel_calls == []

    loaded = spy_store.get(job.id)
    assert loaded is not None
    assert loaded.status == JobStatus.QUEUED


def test_explicit_cancel_durable_job(store: DurableJobStore) -> None:
    """FR-3: only explicit cancel_durable_job / control(cancel) cancels durable work."""
    job = create_durable_job(
        owner="meta",
        kind="demo",
        payload={},
        store=store,
    )
    claimed = store.claim(job.id, worker_id="w1", lease_seconds=30.0)
    assert claimed is not None
    assert claimed.status == JobStatus.RUNNING

    result = cancel_durable_job(job.id, store=store)
    assert result["ok"] is True
    assert result["job_id"] == job.id
    assert result["status"] == JobStatus.CANCELLED.value

    loaded = store.get(job.id)
    assert loaded is not None
    assert loaded.status == JobStatus.CANCELLED


def test_durable_tools_not_exposed_to_llm() -> None:
    """No worker consumes durable jobs yet; keep create/cancel off the LLM tool surface."""
    assert "create_durable_job" not in META_TOOL_NAMES
    assert "cancel_durable_job" not in META_TOOL_NAMES
    assert _tool_schema("create_durable_job") is None
    assert _tool_schema("cancel_durable_job") is None


def test_default_store_accessor_roundtrip(tmp_path: Path) -> None:
    reset_durable_job_store()
    s = DurableJobStore(db_path=tmp_path / "default.sqlite")
    set_durable_job_store(s)
    assert get_durable_job_store() is s
    reset_durable_job_store()
