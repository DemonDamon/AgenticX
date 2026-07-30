#!/usr/bin/env python3
"""Smoke tests for GraphRunStore persistence.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.runtime.graph.compiler import compile_workforce_run
from agenticx.runtime.graph.models import EdgeKind, NodeKind, NodeStatus
from agenticx.runtime.graph.store import GraphRunStore


def test_save_load_roundtrip(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = compile_workforce_run(
        session_id="sess-1",
        group_id="g1",
        subtasks=[
            {"id": "t1", "description": "research", "dependencies": []},
            {"id": "t2", "description": "implement", "depends_on": ["t1"]},
        ],
        assignment_map={"t1": "a1", "t2": "a2"},
        run_id="gr_test_store",
    )
    assert run.nodes["t1"].status == NodeStatus.READY
    assert run.nodes["t2"].status == NodeStatus.PENDING
    assert any(e.kind == EdgeKind.DEPENDS for e in run.edges)

    store.save(run)
    assert run.version >= 1
    loaded = store.load("gr_test_store")
    assert loaded is not None
    assert loaded.session_id == "sess-1"
    assert loaded.nodes["t1"].kind == NodeKind.TASK
    assert loaded.nodes["t1"].agent_id == "a1"
    assert loaded.nodes["t2"].status == NodeStatus.PENDING
    assert len(loaded.edges) == 1
    assert loaded.edges[0].source == "t1"
    assert loaded.edges[0].target == "t2"


def test_list_by_session(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    r1 = compile_workforce_run(
        session_id="s-a",
        group_id=None,
        subtasks=[{"id": "t1", "description": "only"}],
        assignment_map={"t1": "x"},
        run_id="gr_a",
    )
    r2 = compile_workforce_run(
        session_id="s-b",
        group_id=None,
        subtasks=[{"id": "t1", "description": "other"}],
        assignment_map={"t1": "y"},
        run_id="gr_b",
    )
    store.save(r1)
    store.save(r2)
    listed = store.list_by_session("s-a")
    assert len(listed) == 1
    assert listed[0].run_id == "gr_a"


def test_single_node_ready(tmp_path: Path) -> None:
    run = compile_workforce_run(
        session_id="s",
        group_id="g",
        subtasks=[{"id": "t1", "description": "solo"}],
        assignment_map={"t1": "meta"},
    )
    assert list(run.nodes.keys()) == ["t1"]
    assert run.nodes["t1"].status == NodeStatus.READY
    assert run.edges == []
