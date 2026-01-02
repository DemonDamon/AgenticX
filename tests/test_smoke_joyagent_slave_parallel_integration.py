import asyncio

import pytest

from agenticx.core.plan_notebook import PlanNotebook
from agenticx.agents.mining_planner_agent import MiningPlannerAgent
from agenticx.core.agent import AgentContext


def _build_plan_notebook():
    nb = PlanNotebook()
    asyncio.run(
        nb.create_plan(
            name="demo",
            description="demo plan",
            expected_outcome="finish all",
            subtasks=[
                {"name": "task1", "description": "do a", "expected_outcome": "ok"},
                {"name": "task2", "description": "do b", "expected_outcome": "ok"},
            ],
        )
    )
    return nb


def test_parallel_integration_success():
    nb = _build_plan_notebook()
    agent = MiningPlannerAgent(plan_notebook=nb, auto_accept=True)

    async def worker(task: str):
        return f"done:{task.split(':')[0]}"

    results = asyncio.run(
        agent.execute_plan_in_parallel(
            worker=worker,
            max_concurrency=2,
            fail_fast=False,
        )
    )
    assert len(results) == 2
    assert all(r.success for r in results)
    assert all(r.duration_ms >= 0 for r in results)
    assert nb.current_plan.subtasks[0].state == "done"
    assert nb.current_plan.subtasks[1].state == "done"


def test_parallel_integration_fail_fast():
    nb = _build_plan_notebook()
    agent = MiningPlannerAgent(plan_notebook=nb, auto_accept=True)

    async def worker(task: str):
        if "task2" in task:
            raise RuntimeError("boom")
        return "ok"

    results = asyncio.run(
        agent.execute_plan_in_parallel(
            worker=worker,
            max_concurrency=2,
            fail_fast=True,
        )
    )
    assert any(not r.success for r in results)
    # 至少有一个子任务被标记为 abandoned
    assert any(st.state == "abandoned" for st in nb.current_plan.subtasks)


def test_plan_run_parallel_and_summary():
    agent = MiningPlannerAgent(plan_notebook=PlanNotebook(), auto_accept=True)

    async def worker(task: str):
        return f"ok:{task}"

    asyncio.run(
        agent.plan(
            goal="并行执行测试",
            context=AgentContext(agent_id="p"),
            run_parallel=True,
            parallel_worker=worker,
            parallel_max_concurrency=2,
            parallel_fail_fast=False,
        )
    )

    # 并行执行后，当前计划的子任务应被标记完成或放弃
    assert agent.plan_notebook.current_plan is not None
    states = [st.state for st in agent.plan_notebook.current_plan.subtasks]
    assert all(s in ["done", "abandoned"] for s in states)

    summary = getattr(agent, "_last_parallel_summary", {})
    assert summary
    assert summary.get("total", 0) >= 1
    assert "duration_ms_total" in summary

