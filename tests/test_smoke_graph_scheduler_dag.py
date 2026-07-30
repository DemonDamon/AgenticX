#!/usr/bin/env python3
"""Smoke tests for Graph DAG scheduler: deps block + parallel ready set.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, AsyncIterator, List

import pytest

from agenticx.runtime.graph.compiler import compile_workforce_run
from agenticx.runtime.graph.models import GraphNode, NodeStatus
from agenticx.runtime.graph.scheduler import execute_group_run
from agenticx.runtime.graph.store import GraphRunStore


@pytest.mark.asyncio
async def test_dependency_blocks_until_done(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = compile_workforce_run(
        session_id="s",
        group_id="g",
        subtasks=[
            {"id": "t1", "description": "first", "dependencies": []},
            {"id": "t2", "description": "second", "dependencies": ["t1"]},
        ],
        assignment_map={"t1": "a", "t2": "b"},
        run_id="gr_dep",
    )
    order: List[str] = []
    running_while_t1: List[str] = []

    async def runner(node: GraphNode) -> AsyncIterator[str]:
        order.append(f"start:{node.id}")
        if node.id == "t1":
            # t2 must not be RUNNING while t1 runs
            for n in run.nodes.values():
                if n.id != "t1":
                    running_while_t1.append(f"{n.id}:{n.status.value}")
            await asyncio.sleep(0.05)
        order.append(f"end:{node.id}")
        yield node.id

    events: List[str] = []

    def on_event(etype: str, data: dict) -> None:
        events.append(etype)

    out: List[Any] = []
    async for item in execute_group_run(
        run,
        runner=runner,
        on_event=on_event,
        store=store,
        max_parallel=4,
    ):
        out.append(item)

    assert out == ["t1", "t2"]
    assert order == ["start:t1", "end:t1", "start:t2", "end:t2"]
    assert all(not s.startswith("t2:running") for s in running_while_t1)
    assert run.nodes["t1"].status == NodeStatus.DONE
    assert run.nodes["t2"].status == NodeStatus.DONE
    assert "graph.run_created" in events
    assert "graph.node_updated" in events


@pytest.mark.asyncio
async def test_independent_nodes_run_in_parallel(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = compile_workforce_run(
        session_id="s",
        group_id="g",
        subtasks=[
            {"id": "t1", "description": "a", "dependencies": []},
            {"id": "t2", "description": "b", "dependencies": []},
        ],
        assignment_map={"t1": "a", "t2": "b"},
        run_id="gr_par",
    )
    started = asyncio.Event()
    both_running = asyncio.Event()
    gate = asyncio.Event()
    seen_running: set[str] = set()

    async def runner(node: GraphNode) -> AsyncIterator[str]:
        seen_running.add(node.id)
        if len(seen_running) >= 2:
            both_running.set()
        started.set()
        await gate.wait()
        yield node.id

    async def release() -> None:
        await started.wait()
        await asyncio.sleep(0.02)
        # If sequential, both_running would never set before gate
        assert both_running.is_set(), "expected overlapping RUNNING nodes"
        gate.set()

    releaser = asyncio.create_task(release())
    out: List[str] = []
    async for item in execute_group_run(
        run,
        runner=runner,
        store=store,
        max_parallel=4,
    ):
        out.append(str(item))
    await releaser
    assert set(out) == {"t1", "t2"}
    assert run.nodes["t1"].status == NodeStatus.DONE
    assert run.nodes["t2"].status == NodeStatus.DONE


@pytest.mark.asyncio
async def test_single_node_lifecycle(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = compile_workforce_run(
        session_id="s",
        group_id=None,
        subtasks=[{"id": "t1", "description": "solo"}],
        assignment_map={"t1": "x"},
        run_id="gr_one",
    )
    statuses: List[str] = []

    def on_event(etype: str, data: dict) -> None:
        if etype == "graph.node_updated":
            statuses.append(str(data["node"]["status"]))

    async def runner(node: GraphNode) -> AsyncIterator[str]:
        yield "ok"

    async for _ in execute_group_run(run, runner=runner, on_event=on_event, store=store):
        pass
    assert "running" in statuses
    assert statuses[-1] == "done"
    assert run.status == "closed"
