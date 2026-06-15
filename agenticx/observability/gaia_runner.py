#!/usr/bin/env python3
"""GAIA-specific benchmark runner with real LLM execution.

Author: Damon Li
"""

from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Any, Callable

from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.observability.evaluation import BenchmarkRunner
from agenticx.observability.gaia_executor import execute_gaia_task


class CaptureBenchmarkRunner(BenchmarkRunner):
    """Benchmark runner that captures per-task raw outputs."""

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.last_task_results: list[dict[str, Any]] = []

    def _run_tasks(self, agent: Any, tasks: list[Any]) -> list[dict[str, Any]]:
        results = super()._run_tasks(agent, tasks)
        self.last_task_results = results
        return results

    def _run_tasks_with_timeout(self, agent: Any, tasks: list[Any], timeout: float) -> list[dict[str, Any]]:
        results = super()._run_tasks_with_timeout(agent, tasks, timeout)
        self.last_task_results = results
        return results


class GaiaBenchmarkRunner(CaptureBenchmarkRunner):
    """Benchmark runner that invokes configured LLM providers per GAIA task."""

    def __init__(
        self,
        *,
        model: str,
        provider: str | None = None,
        dry_run: bool = False,
        max_workers: int = 4,
    ) -> None:
        super().__init__(max_workers=max_workers)
        self.model = model
        self.provider = provider
        self.dry_run = dry_run

    def _run_tasks(self, agent: Agent, tasks: list[Task]) -> list[dict[str, Any]]:
        if self.dry_run:
            return super()._run_tasks(agent, tasks)
        results = run_gaia_tasks_sequential(
            tasks,
            model=self.model,
            provider=self.provider,
        )
        self.last_task_results = results
        return results


def _log_progress(message: str) -> None:
    print(message, flush=True)


def run_gaia_tasks_sequential(
    tasks: list[Task],
    *,
    model: str,
    provider: str | None,
    task_timeout: float = 120.0,
    on_task_done: Callable[[int, int, Task, dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """Execute GAIA tasks one-by-one with visible progress and per-task timeout."""
    total = len(tasks)
    results: list[dict[str, Any]] = []
    for index, task in enumerate(tasks, start=1):
        short_id = task.id[:8]
        _log_progress(f"[gaia] {index}/{total} start task={short_id} model={model}")
        pool = ThreadPoolExecutor(max_workers=1)
        future = pool.submit(
            execute_gaia_task,
            task,
            model=model,
            provider=provider,
            request_timeout=task_timeout,
        )
        try:
            raw = future.result(timeout=task_timeout + 5.0)
        except FuturesTimeoutError:
            raw = {
                "success": False,
                "result": "",
                "execution_time": task_timeout,
                "provider": provider or "",
                "model": model,
                "error": f"task timeout after {task_timeout:.0f}s",
            }
        finally:
            # Do not use `with ThreadPoolExecutor`: __exit__ calls shutdown(wait=True)
            # and would block forever if the LLM HTTP call is still in flight.
            pool.shutdown(wait=False, cancel_futures=True)

        results.append(raw)
        if raw.get("success"):
            preview = str(raw.get("result") or "")[:60].replace("\n", " ")
            _log_progress(
                f"[gaia] {index}/{total} ok task={short_id} "
                f"{float(raw.get('execution_time') or 0):.1f}s answer={preview!r}"
            )
        else:
            err = str(raw.get("error") or "unknown error")
            _log_progress(
                f"[gaia] {index}/{total} fail task={short_id} "
                f"{float(raw.get('execution_time') or 0):.1f}s error={err[:120]}"
            )
        if on_task_done is not None:
            on_task_done(index, total, task, raw)
    return results


def print_gaia_run_banner(
    *,
    model: str,
    provider: str,
    total_tasks: int,
    output_dir: str,
    task_timeout: float,
    dry_run: bool,
) -> None:
    """Print startup banner so long runs are visibly alive."""
    mode = "dry-run (no LLM)" if dry_run else "live LLM"
    _log_progress(
        f"[gaia] starting benchmark mode={mode} model={model} provider={provider} "
        f"tasks={total_tasks} timeout={task_timeout:.0f}s/out_dir={output_dir}"
    )
    if not dry_run:
        _log_progress("[gaia] progress logs appear per task; results.jsonl updates incrementally")
    sys.stdout.flush()
