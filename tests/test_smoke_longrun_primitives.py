#!/usr/bin/env python3
"""Smoke tests for ``agenticx.longrun`` primitives.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.hooks import HookEvent, clear_hooks, register_hook
from agenticx.hooks.registry import dispatch_hook_event_sync
from agenticx.longrun.retry_policy import TaskRetryPolicy
from agenticx.longrun.stall_detector import TaskStallDetector
from agenticx.longrun.task_workspace import (
    TaskWorkspace,
    TaskWorkspaceConfig,
    TaskWorkspaceSecurityError,
)
from agenticx.longrun.token_accountant import TaskTokenAccountant


@pytest.fixture(autouse=True)
def _reset_hooks() -> None:
    clear_hooks()
    yield
    clear_hooks()


def test_dispatch_hook_event_sync_routes_payload() -> None:
    seen: list[str] = []

    async def _h(ev: HookEvent) -> bool:
        seen.append(f"{ev.type}:{ev.action}")
        return True

    register_hook("task_workspace:after_create", _h)
    dispatch_hook_event_sync(
        hook_type="task_workspace",
        action="after_create",
        context_payload={"cwd": "/tmp"},
        task_id="t1",
    )
    assert seen == ["task_workspace:after_create"]


@pytest.mark.skipif(
    __import__("os").name == "nt",
    reason="posix symlink escape semantics only",
)
def test_task_workspace_safety_outside_root(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    link = root / "escape"
    link.symlink_to(outside, target_is_directory=True)
    with pytest.raises(TaskWorkspaceSecurityError):
        TaskWorkspace(
            "escape",
            TaskWorkspaceConfig(root=root),
        )


def test_task_workspace_parent_escape(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    with pytest.raises(TaskWorkspaceSecurityError):
        TaskWorkspace("..", TaskWorkspaceConfig(root=root))


def test_task_workspace_hooks(tmp_path: Path) -> None:
    phases: list[str] = []

    async def capture(ev: HookEvent) -> bool:
        phases.append(str(ev.action))
        return True

    for ph in ("after_create", "before_run", "after_run", "before_remove"):
        register_hook(f"task_workspace:{ph}", capture)

    cfg = TaskWorkspaceConfig(root=tmp_path / "wsroot")
    ws = TaskWorkspace("job-a", cfg).create()
    ws.prepare_for_run()
    ws.cleanup_after_run()
    ws.remove()
    assert phases == ["after_create", "before_run", "after_run", "before_remove"]


def test_retry_continuation_and_failure_backoff() -> None:
    p = TaskRetryPolicy(
        continuation_delay_sec=1.0,
        failure_base_sec=10.0,
        failure_multiplier=2.0,
        max_backoff_sec=300.0,
        max_attempts=5,
    )
    assert p.compute_delay(kind="continuation", attempt=1) == 1.0
    assert p.compute_delay(kind="failure", attempt=1) == 10.0
    assert p.compute_delay(kind="failure", attempt=2) == 20.0
    assert p.compute_delay(kind="failure", attempt=11) == 300.0
    assert p.should_give_up(5) is False
    assert p.should_give_up(6) is True


@pytest.mark.asyncio
async def test_stall_detector_threshold() -> None:
    clock = {"t": 0.0}

    def mono() -> float:
        return clock["t"]

    det = TaskStallDetector(threshold_sec=5.0, _monotonic=mono)
    det.touch("a")
    clock["t"] = 2.0
    assert det.check("a").is_stalled is False
    clock["t"] = 10.0
    assert det.check("a").is_stalled is True
    det.forget("a")


def test_token_accountant_no_double_count() -> None:
    ac = TaskTokenAccountant()
    ac.absorb("x", input_tokens=10, output_tokens=5)
    ac.absorb("x", input_tokens=10, output_tokens=5)
    snap = ac.snapshot("x")
    assert snap.total_input == 10
    assert snap.total_output == 5
