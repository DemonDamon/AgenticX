#!/usr/bin/env python3
"""Smoke tests for Graph intervention API semantics (SP2).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import AsyncIterator, List

import pytest

from agenticx.runtime.graph.compiler import compile_workforce_run
from agenticx.runtime.graph.events import GRAPH_EVENT_TYPES, graph_event
from agenticx.runtime.graph.intervene import (
    CONVERGE_SCRATCH_KEY,
    InterveneError,
    apply_intervention,
    build_agent_projection,
    consume_graph_directives,
    effective_mention_hops,
    scratchpad_key_for_agent,
)
from agenticx.runtime.graph.models import GraphNode, NodeStatus
from agenticx.runtime.graph.scheduler import execute_group_run
from agenticx.runtime.graph.store import GraphRunStore


def _two_node_run(**kwargs):
    return compile_workforce_run(
        session_id="sess-i",
        group_id="g1",
        subtasks=[
            {"id": "t1", "description": "research", "dependencies": []},
            {"id": "t2", "description": "implement", "dependencies": ["t1"]},
        ],
        assignment_map={"t1": "alice", "t2": "bob"},
        run_id=kwargs.get("run_id", "gr_intervene"),
    )


def test_graph_event_type_stable() -> None:
    ev = graph_event("node_updated", run_id="gr_1", version=2, node={"id": "t1"})
    assert ev["type"] == "graph.node_updated"
    assert ev["run_id"] == "gr_1"
    assert ev["version"] == 2
    assert "graph.node_updated" in GRAPH_EVENT_TYPES


def test_inject_appends_directive_and_version_bump(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = _two_node_run()
    store.save(run)
    v0 = run.version
    result = apply_intervention(
        run,
        op="node_inject",
        version=v0,
        node_ids=["t2"],
        payload={"text": "增加验收清单：必须包含性能数字"},
    )
    assert "node_inject" in result.applied
    assert any("验收清单" in d for d in run.nodes["t2"].directives)
    assert "bob" in result.scratchpad_directives
    store.save(result.run)
    assert result.run.version == v0 + 1


def test_version_conflict() -> None:
    run = _two_node_run()
    run.version = 5
    with pytest.raises(InterveneError) as ei:
        apply_intervention(
            run,
            op="node_inject",
            version=4,
            node_ids=["t1"],
            payload={"text": "x"},
        )
    assert ei.value.status_code == 409
    assert ei.value.extra.get("error") == "version_conflict"


def test_reassign_pending_changes_agent() -> None:
    run = _two_node_run()
    edge_id = run.edges[0].id
    result = apply_intervention(
        run,
        op="edge_reassign",
        node_ids=[],
        edge_ids=[edge_id],
        payload={"edge_id": edge_id, "new_agent_id": "carol"},
    )
    assert "edge_reassign" in result.applied
    assert run.nodes["t2"].agent_id == "carol"


def test_reassign_running_without_force_warns() -> None:
    run = _two_node_run()
    run.nodes["t2"].status = NodeStatus.RUNNING
    edge_id = run.edges[0].id
    result = apply_intervention(
        run,
        op="edge_reassign",
        payload={"edge_id": edge_id, "new_agent_id": "carol"},
    )
    assert result.applied == []
    assert "target_running" in result.warnings
    assert run.nodes["t2"].agent_id == "bob"


def test_cancel_node_blocks_downstream() -> None:
    run = _two_node_run()
    result = apply_intervention(run, op="cancel_node", node_ids=["t1"])
    assert "cancel_node" in result.applied
    assert run.nodes["t1"].status == NodeStatus.CANCELLED
    assert run.nodes["t2"].status == NodeStatus.BLOCKED


def test_selection_rule_sets_converge_and_directives() -> None:
    run = _two_node_run()
    result = apply_intervention(
        run,
        op="selection_rule",
        node_ids=["t1", "t2"],
        payload={"text": "快速出结论，先做一版"},
    )
    assert "selection_rule" in result.applied
    assert result.converge_policy is not None
    assert result.converge_policy["max_mention_hops"] == 0
    assert run.meta.get("policies")


def test_consume_directives_and_effective_hops() -> None:
    pad: dict = {}
    pad[scratchpad_key_for_agent("alice")] = [
        {"ts": 1, "text": "加上 checklist", "op": "node_inject"}
    ]
    texts = consume_graph_directives(pad, "alice")
    assert texts == ["加上 checklist"]
    assert scratchpad_key_for_agent("alice") not in pad

    pad[CONVERGE_SCRATCH_KEY] = {"max_mention_hops": 0, "until_ts": 9e12}
    assert effective_mention_hops(pad, 2) == 0
    pad[CONVERGE_SCRATCH_KEY] = {"max_mention_hops": 0, "until_ts": 1}
    assert effective_mention_hops(pad, 2) == 2


def test_agent_projection() -> None:
    run = _two_node_run()
    proj = build_agent_projection(run)
    ids = {n["id"] for n in proj["agent_nodes"]}
    assert "agent:alice" in ids
    assert "agent:bob" in ids


@pytest.mark.asyncio
async def test_pause_prevents_new_starts(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = compile_workforce_run(
        session_id="s",
        group_id="g",
        subtasks=[
            {"id": "t1", "description": "a", "dependencies": []},
            {"id": "t2", "description": "b", "dependencies": ["t1"]},
        ],
        assignment_map={"t1": "a", "t2": "b"},
        run_id="gr_pause",
    )
    started: List[str] = []

    async def runner(node: GraphNode) -> AsyncIterator[str]:
        started.append(node.id)
        if node.id == "t1":
            # Pause whole run mid-flight after t1 starts
            apply_intervention(run, op="pause", payload={"scope": "run"})
            store.save(run, bump_version=False)
            await asyncio.sleep(0.15)
        yield node.id

    # Run with short timeout via should_stop after pause observed
    async def stopper():
        await asyncio.sleep(0.25)
        return True

    stop_flag = {"v": False}

    def should_stop():
        return stop_flag["v"]

    async def arm_stop():
        await asyncio.sleep(0.2)
        stop_flag["v"] = True

    arm = asyncio.create_task(arm_stop())
    async for _ in execute_group_run(
        run,
        runner=runner,
        store=store,
        should_stop=should_stop,
        pause_poll_seconds=0.02,
    ):
        pass
    await arm
    assert "t1" in started
    assert "t2" not in started


@pytest.mark.asyncio
async def test_resume_allows_continue(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = compile_workforce_run(
        session_id="s",
        group_id="g",
        subtasks=[{"id": "t1", "description": "solo"}],
        assignment_map={"t1": "a"},
        run_id="gr_resume",
    )
    run.status = "paused"
    store.save(run)

    async def runner(node: GraphNode) -> AsyncIterator[str]:
        yield "ok"

    async def resume_later():
        await asyncio.sleep(0.05)
        loaded = store.load(run.run_id)
        assert loaded is not None
        apply_intervention(loaded, op="resume", payload={"scope": "run"})
        store.save(loaded, bump_version=False)

    task = asyncio.create_task(resume_later())
    out: List[str] = []
    # mutate local run status to paused so scheduler waits then reloads
    run.status = "paused"
    async for item in execute_group_run(
        run,
        runner=runner,
        store=store,
        pause_poll_seconds=0.02,
    ):
        out.append(str(item))
    await task
    assert out == ["ok"]
