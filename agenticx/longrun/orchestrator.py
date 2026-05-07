#!/usr/bin/env python3
"""Symphony-style orchestration loop for isolated long-running tasks.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from agenticx.longrun.retry_policy import DelayKind, TaskRetryPolicy
from agenticx.longrun.sources import TaskSource
from agenticx.longrun.stall_detector import TaskStallDetector
from agenticx.longrun.task_workspace import TaskWorkspace, TaskWorkspaceConfig
from agenticx.longrun.token_accountant import TaskTokenAccountant

_log = logging.getLogger(__name__)

SubmitFn = Callable[["TaskEntry"], Awaitable[Dict[str, Any]]]


class TaskState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    RETRY_QUEUED = "retry_queued"
    DONE = "done"
    FAILED = "failed"


@dataclass
class TaskEntry:
    task_id: str
    payload: Dict[str, Any]
    state: TaskState
    workspace: TaskWorkspace
    failure_count: int = 0
    continuation_rounds: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    last_result: Dict[str, Any] = field(default_factory=dict)
    _runner: Optional[asyncio.Task[None]] = field(default=None, repr=False)
    _cancel_schedule_failure_on_exit: bool = field(default=False, repr=False)


@dataclass
class LongRunOrchestratorConfig:
    poll_interval_sec: float = 30.0
    retry_policy: TaskRetryPolicy = field(default_factory=TaskRetryPolicy)
    workspace_config: TaskWorkspaceConfig = field(default_factory=TaskWorkspaceConfig)
    stall_threshold_sec: float = 300.0


class LongRunOrchestrator:
    """Poll ``TaskSource``, execute work via ``submit_fn``, manage retries + stalls."""

    def __init__(
        self,
        *,
        config: LongRunOrchestratorConfig,
        task_source: TaskSource,
        submit_fn: SubmitFn,
    ) -> None:
        self.config = config
        self.task_source = task_source
        self.submit_fn = submit_fn
        self.stall = TaskStallDetector(threshold_sec=config.stall_threshold_sec)
        self.tokens = TaskTokenAccountant()
        self._entries: Dict[str, TaskEntry] = {}
        self._retry_tasks: Dict[str, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()
        self._stop = asyncio.Event()
        self._loop_task: Optional[asyncio.Task[None]] = None

    def record_token_usage(self, task_id: str, *, input_tokens: int, output_tokens: int) -> None:
        self.tokens.absorb(task_id, input_tokens=input_tokens, output_tokens=output_tokens)

    async def start_background(self) -> asyncio.Task[None]:
        if self._loop_task is not None and not self._loop_task.done():
            return self._loop_task
        self._stop.clear()
        self._loop_task = asyncio.create_task(self._run_loop(), name="longrun-orchestrator")
        return self._loop_task

    async def stop(self) -> None:
        self._stop.set()
        for t in list(self._retry_tasks.values()):
            if not t.done():
                t.cancel()
        self._retry_tasks.clear()
        if self._loop_task is not None:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
            self._loop_task = None

    async def _run_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self._tick()
            except asyncio.CancelledError:
                break
            except Exception:
                _log.exception(
                    "longrun.tick_failed",
                    extra={"component": "longrun", "state": "error"},
                )
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=float(self.config.poll_interval_sec))
            except asyncio.TimeoutError:
                continue

    async def _tick(self) -> None:
        await self._reconcile_stalls()
        pending = await self.task_source.fetch_pending_tasks()
        async with self._lock:
            for raw in pending:
                tid = str(raw.get("id", "") or "").strip()
                if not tid:
                    continue
                if tid in self._entries:
                    continue
                ws_cfg = TaskWorkspaceConfig(
                    root=Path(self.config.workspace_config.root),
                    hook_timeout_sec=self.config.workspace_config.hook_timeout_sec,
                    cleanup_on_remove=self.config.workspace_config.cleanup_on_remove,
                )
                workspace = TaskWorkspace(tid, ws_cfg).create()
                entry = TaskEntry(task_id=tid, payload=dict(raw), state=TaskState.PENDING, workspace=workspace)
                self._entries[tid] = entry
                asyncio.create_task(self._dispatch(entry), name=f"longrun-dispatch-{tid}")

    async def _reconcile_stalls(self) -> None:
        async with self._lock:
            snapshot = list(self._entries.items())
        for tid, entry in snapshot:
            if entry.state != TaskState.RUNNING:
                continue
            snap = self.stall.check(tid)
            if snap.is_stalled:
                _log.warning(
                    "longrun.task_stalled",
                    extra={
                        "component": "longrun",
                        "task_id": tid,
                        "elapsed_sec": round(snap.elapsed_sec, 3),
                        "action": "retry_failure",
                    },
                )
                runner = entry._runner
                entry._cancel_schedule_failure_on_exit = True
                if runner is not None and not runner.done():
                    runner.cancel()

    def snapshot(self) -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []
        retrying = 0
        running = 0
        done = 0
        failed = 0
        now = time.time()
        for tid, entry in self._entries.items():
            state = entry.state.value
            if entry.state == TaskState.RUNNING:
                running += 1
            elif entry.state == TaskState.RETRY_QUEUED:
                retrying += 1
            elif entry.state == TaskState.DONE:
                done += 1
            elif entry.state == TaskState.FAILED:
                failed += 1
            led = self.tokens.snapshot(tid)
            rows.append(
                {
                    "task_id": tid,
                    "state": state,
                    "attempt": entry.failure_count + entry.continuation_rounds + 1,
                    "attempt_failures": entry.failure_count,
                    "workspace_path": str(entry.workspace.path),
                    "tokens": {"input": led.total_input, "output": led.total_output},
                    "created_at": entry.created_at,
                    "updated_at": entry.updated_at,
                    "age_sec": round(now - entry.created_at, 3),
                }
            )
        return {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "counts": {
                "running": running,
                "retrying": retrying,
                "done": done,
                "failed": failed,
                "total": len(self._entries),
            },
            "tasks": rows,
        }

    async def _dispatch(self, entry: TaskEntry) -> None:
        async with self._lock:
            self._cancel_retry_locked(entry.task_id)
            entry.state = TaskState.RUNNING
            entry.updated_at = time.time()
        try:
            entry.workspace.prepare_for_run()
        except Exception as exc:
            _log.error("longrun.prepare_failed task=%s err=%s", entry.task_id, exc)
            await self._schedule_retry(entry, kind="failure")
            return

        self.stall.touch(entry.task_id)

        async def _run() -> None:
            try:
                result = await self.submit_fn(entry)
                entry.last_result = dict(result or {})
                entry.updated_at = time.time()
                wants = bool(result.get("wants_continuation"))
                if wants:
                    await self._schedule_retry(entry, kind="continuation")
                    return
                await self._finalize_success(entry)
            except asyncio.CancelledError:
                entry.updated_at = time.time()
                if self._stop.is_set():
                    return
                if entry._cancel_schedule_failure_on_exit:
                    entry._cancel_schedule_failure_on_exit = False
                    await self._schedule_retry(entry, kind="failure")
                else:
                    async with self._lock:
                        entry.state = TaskState.FAILED
                        self.stall.forget(entry.task_id)
            except Exception as exc:
                _log.warning(
                    "longrun.task_failed",
                    extra={
                        "component": "longrun",
                        "task_id": entry.task_id,
                        "error": str(exc),
                    },
                )
                entry.updated_at = time.time()
                await self._schedule_retry(entry, kind="failure")
            finally:
                try:
                    entry.workspace.cleanup_after_run()
                except Exception:
                    _log.debug("longrun.after_run_hook_failed task=%s", entry.task_id, exc_info=True)

        async with self._lock:
            entry._runner = asyncio.create_task(_run(), name=f"longrun-run-{entry.task_id}")

    async def _finalize_success(self, entry: TaskEntry) -> None:
        async with self._lock:
            entry.state = TaskState.DONE
            entry.updated_at = time.time()
            self.stall.forget(entry.task_id)
            self.tokens.forget(entry.task_id)
            try:
                entry.workspace.remove()
            except Exception:
                _log.debug("longrun.workspace_remove_failed task=%s", entry.task_id, exc_info=True)
        try:
            await self.task_source.mark_task_done(entry.task_id)
        except Exception:
            _log.warning("longrun.mark_done_failed task=%s", entry.task_id, exc_info=True)

    async def _schedule_retry(self, entry: TaskEntry, *, kind: DelayKind) -> None:
        policy = self.config.retry_policy
        if kind == "failure":
            entry.failure_count += 1
            if policy.should_give_up(entry.failure_count):
                async with self._lock:
                    entry.state = TaskState.FAILED
                    entry.updated_at = time.time()
                    self.stall.forget(entry.task_id)
                _log.error(
                    "longrun.task_failed_max_attempts",
                    extra={
                        "component": "longrun",
                        "task_id": entry.task_id,
                        "attempt": entry.failure_count,
                    },
                )
                return
            delay = policy.compute_delay(kind="failure", attempt=entry.failure_count)
        else:
            entry.continuation_rounds += 1
            if policy.should_stop_continuation(entry.continuation_rounds):
                await self._finalize_success(entry)
                return
            delay = policy.compute_delay(kind="continuation", attempt=1)

        _log.info(
            "longrun.retry_scheduled",
            extra={
                "component": "longrun",
                "task_id": entry.task_id,
                "kind": kind,
                "delay_sec": delay,
                "failure_count": entry.failure_count,
                "continuation_rounds": entry.continuation_rounds,
            },
        )

        async def _sleep_dispatch() -> None:
            await asyncio.sleep(float(delay))
            if self._stop.is_set():
                return
            async with self._lock:
                if entry.task_id not in self._entries:
                    return
                if entry.state != TaskState.RETRY_QUEUED:
                    return
            await self._dispatch(entry)

        async with self._lock:
            self._cancel_retry_locked(entry.task_id)
            entry.state = TaskState.RETRY_QUEUED
            entry.updated_at = time.time()
            self._retry_tasks[entry.task_id] = asyncio.create_task(
                _sleep_dispatch(), name=f"longrun-retry-{entry.task_id}"
            )

    def _cancel_retry_locked(self, task_id: str) -> None:
        old = self._retry_tasks.pop(task_id, None)
        if old is not None and not old.done():
            old.cancel()
