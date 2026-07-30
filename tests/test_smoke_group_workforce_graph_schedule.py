#!/usr/bin/env python3
"""Smoke: group team turn uses Graph scheduler (non-serial when no deps).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any, AsyncIterator, List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agenticx.runtime.group_router import GroupChatRouter, GroupReply, META_LEADER_AGENT_ID
from agenticx.runtime.graph.compiler import compile_workforce_run
from agenticx.runtime.graph.models import GraphNode, NodeStatus
from agenticx.runtime.graph.scheduler import execute_group_run
from agenticx.runtime.graph.store import GraphRunStore


def test_compile_from_workforce_like_objects() -> None:
    st1 = SimpleNamespace(id="t1", description="A", dependencies=[])
    st2 = SimpleNamespace(id="t2", description="B", dependencies=[])
    run = compile_workforce_run(
        session_id="sess",
        group_id="g",
        subtasks=[st1, st2],
        assignment_map={"t1": "w1", "t2": "w2"},
    )
    assert run.nodes["t1"].status == NodeStatus.READY
    assert run.nodes["t2"].status == NodeStatus.READY
    assert run.edges == []


@pytest.mark.asyncio
async def test_scheduler_not_strictly_serialized_without_deps(tmp_path) -> None:
    """Ready nodes start overlapping — proves we left the linear for-loop model."""
    store = GraphRunStore(root=tmp_path)
    run = compile_workforce_run(
        session_id="s",
        group_id="g",
        subtasks=[
            SimpleNamespace(id="t1", description="A", dependencies=[]),
            SimpleNamespace(id="t2", description="B", dependencies=[]),
        ],
        assignment_map={"t1": "w1", "t2": "w2"},
        run_id="gr_team",
    )
    starts: List[float] = []
    loop = asyncio.get_event_loop()
    barrier = asyncio.Barrier(2)

    async def runner(node: GraphNode) -> AsyncIterator[str]:
        starts.append(loop.time())
        await barrier.wait()
        yield node.id

    out: List[str] = []
    async for item in execute_group_run(run, runner=runner, store=store, max_parallel=2):
        out.append(str(item))
    assert set(out) == {"t1", "t2"}
    assert len(starts) == 2
    assert abs(starts[0] - starts[1]) < 0.2


@pytest.mark.asyncio
async def test_run_team_turn_invokes_execute_group_run() -> None:
    """_run_team_turn must call execute_group_run (not only a sequential for)."""
    registry = MagicMock()
    registry.get_avatar = MagicMock(return_value=None)
    router = GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=3,
    )
    session = MagicMock()
    session.session_id = "sess-graph"
    session.provider_name = "openai"
    session.model_name = "gpt-4"
    session.scratchpad = {}
    session.workspace_dir = None
    session.context_files = {}
    session.taskspaces = []

    st1 = SimpleNamespace(id="t1", description="do A", dependencies=[])
    st2 = SimpleNamespace(id="t2", description="do B", dependencies=[])

    fake_pattern = MagicMock()
    fake_pattern.decompose_task = AsyncMock(return_value=[st1, st2])
    fake_pattern.worker_instances = [
        SimpleNamespace(id="avatar_a"),
        SimpleNamespace(id="avatar_b"),
    ]
    fake_pattern.coordinator = MagicMock()
    fake_pattern.coordinator.assign_tasks = AsyncMock(
        return_value={"t1": "avatar_a", "t2": "avatar_b"}
    )

    called = {"execute": False}

    async def _fake_execute(*_args: Any, **_kwargs: Any) -> AsyncIterator[Any]:
        called["execute"] = True
        if False:  # pragma: no cover
            yield None

    async def _empty_agen(*_a: Any, **_k: Any) -> AsyncIterator[Any]:
        if False:  # pragma: no cover
            yield None

    with patch(
        "agenticx.collaboration.workforce.workforce_pattern.WorkforcePattern",
        return_value=fake_pattern,
    ), patch(
        "agenticx.runtime.graph.scheduler.execute_group_run",
        _fake_execute,
    ), patch.object(
        router,
        "_run_meta_project_manager_reply",
        new=AsyncMock(
            return_value=GroupReply(
                agent_id=META_LEADER_AGENT_ID,
                avatar_name="Machi",
                avatar_url="",
                content="summary",
            )
        ),
    ), patch.object(
        router,
        "_run_one_target_stream",
        side_effect=_empty_agen,
    ):
        replies: List[GroupReply] = []
        async for reply in router._run_team_turn(
            base_session=session,
            context=MagicMock(),
            group_id="g1",
            group_name="Team",
            group_avatar_ids=["avatar_a", "avatar_b"],
            user_input="并行做两件事",
            quoted_content="",
            should_stop=lambda: False,
        ):
            replies.append(reply)

    assert called["execute"] is True
    assert session.scratchpad.get("graph_run_id")
