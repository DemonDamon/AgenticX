"""
SlaveParallelExecutor - 简化版“子执行器并行”实现

目标：
- 以最小可验证机制提供任务级并发执行（参考 JoyAgent PlanSolveHandler 的并行子执行器思想）
- 不依赖外部 LLM/网络，只接受一个 worker 函数
- 支持最大并发、fail_fast 选项
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import time
from typing import Any, Callable, List, Optional


@dataclass
class ParallelTaskResult:
    task: str
    success: bool
    result: Any = None
    error: Optional[str] = None
    duration_ms: float = 0.0


class SlaveParallelExecutor:
    def __init__(self, max_concurrency: Optional[int] = None, fail_fast: bool = False):
        self.max_concurrency = max_concurrency
        self.fail_fast = fail_fast

    async def run_tasks(
        self,
        tasks: List[str],
        worker: Callable[[str], Any],
    ) -> List[ParallelTaskResult]:
        if not tasks:
            return []

        semaphore = asyncio.Semaphore(self.max_concurrency) if self.max_concurrency else None
        results: List[ParallelTaskResult] = []

        async def run_single(task: str) -> ParallelTaskResult:
            if semaphore:
                async with semaphore:
                    return await self._run_worker(task, worker)
            return await self._run_worker(task, worker)

        coros = [run_single(t) for t in tasks]

        if self.fail_fast:
            gathered = []
            try:
                for coro in asyncio.as_completed(coros):
                    res = await coro
                    if not res.success:
                        raise RuntimeError(res.error or "task failed")
                    gathered.append(res)
                results = gathered
            except Exception as e:
                # 尽量返回已完成的结果
                results = gathered + [
                    ParallelTaskResult(task="__failed__", success=False, error=str(e))
                ]
        else:
            results = await asyncio.gather(*coros)

        return results

    async def _run_worker(self, task: str, worker: Callable[[str], Any]) -> ParallelTaskResult:
        try:
            start = time.perf_counter()
            maybe = worker(task)
            if asyncio.iscoroutine(maybe):
                result = await maybe
            else:
                result = maybe
            return ParallelTaskResult(
                task=task, success=True, result=result, duration_ms=(time.perf_counter() - start) * 1000
            )
        except Exception as e:
            return ParallelTaskResult(
                task=task, success=False, error=str(e), duration_ms=0.0
            )


__all__ = ["SlaveParallelExecutor", "ParallelTaskResult"]

