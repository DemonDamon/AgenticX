import asyncio

from agenticx.core.slave_parallel_executor import SlaveParallelExecutor


def test_slave_parallel_success():
    tasks = ["a", "b", "c"]

    async def run():
        executor = SlaveParallelExecutor(max_concurrency=2, fail_fast=False)

        async def worker(t: str):
            return f"done:{t}"

        results = await executor.run_tasks(tasks, worker)
        assert len(results) == 3
        assert all(r.success for r in results)
        assert set(r.result for r in results) == {f"done:{t}" for t in tasks}

    asyncio.run(run())


def test_slave_parallel_fail_fast():
    tasks = ["ok1", "bad", "ok2"]

    async def run():
        executor = SlaveParallelExecutor(max_concurrency=2, fail_fast=True)

        async def worker(t: str):
            if t == "bad":
                raise RuntimeError("boom")
            return f"ok:{t}"

        results = await executor.run_tasks(tasks, worker)
        # 至少包含一个失败
        assert any(not r.success for r in results)

    asyncio.run(run())

