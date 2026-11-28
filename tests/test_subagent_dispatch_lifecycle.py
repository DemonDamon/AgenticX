"""Lifecycle tests for persisted dispatch records of spawned sub-agents.

Plan-Id: 2026-11-27-runtime-invariants-03-dispatch-mailbox

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import meta_tools
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.subagent_runs import dispatch as dispatch_store
from agenticx.runtime.subagent_runs.resolver import list_resolved_runs
from agenticx.runtime.team_manager import AgentTeamManager

OWNER = "sess-dispatch-lifecycle"


class _FakeResponse:
    def __init__(self, content: str, tool_calls: List[Any]) -> None:
        self.content = content
        self.tool_calls = tool_calls


class _QuickTextLLM:
    def __init__(self, reply: str = "done") -> None:
        self.reply = reply

    def invoke(self, *_args: Any, **_kwargs: Any) -> _FakeResponse:
        return _FakeResponse(self.reply, [])

    def stream(self, *_args: Any, **_kwargs: Any):
        yield self.reply


async def _wait_until(predicate, timeout: float = 5.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


def _record(run_id: str):
    record = SubAgentRunStore(OWNER).get_run(run_id)
    assert record is not None
    return record


def _dispatch(run_id: str) -> dict:
    return dispatch_store.dispatch_of(_record(run_id))


async def _spawn_and_settle(manager: AgentTeamManager, name: str = "worker-a") -> str:
    spawned = await manager.spawn_subagent(name=name, role="worker", task="write a short note")
    assert spawned["ok"] is True
    run_id = spawned["agent_id"]
    await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)
    return run_id


def test_turn_end_persists_waiting_state_and_context_snapshot(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM("first-answer"),
            base_session=StudioSession(),
            owner_session_id=OWNER,
        )
        spawned = await manager.spawn_subagent(name="worker-a", role="worker", task="write a short note")
        assert spawned["ok"] is True
        assert "dispatch_id" not in spawned
        run_id = spawned["agent_id"]
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)

        record = _record(run_id)
        assert record.status == "completed"
        dispatch = dispatch_store.dispatch_of(record)
        assert dispatch["dispatch_id"].startswith("dsp-")
        assert dispatch["task_id"] == run_id
        assert dispatch["parent_agent_id"] == "meta"
        assert dispatch["work_unit"] == "write a short note"
        assert dispatch["mode"] == "run"
        assert dispatch["cleanup"] == "keep"
        assert dispatch["depth"] == 1
        assert dispatch["state"] == "waiting"

        snapshot = dispatch_store.read_context_snapshot(SubAgentRunStore(OWNER), run_id)
        assert snapshot is not None
        assert any(
            row.get("role") == "user" and "write a short note" in str(row.get("content"))
            for row in snapshot["agent_messages"]
        )
        assert "first-answer" in json.dumps(snapshot["agent_messages"], ensure_ascii=False)
        assert snapshot["allowed_tool_names"]
        assert not (SubAgentRunStore(OWNER).root / f"{run_id}.mailbox.json").exists()

    asyncio.run(_run())


def test_dispatch_is_visible_in_resolved_rows_and_status_tool(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id=OWNER,
        )
        run_id = await _spawn_and_settle(manager)
        dispatch_id = _dispatch(run_id)["dispatch_id"]

        rows = list_resolved_runs(OWNER, team_manager=manager)
        row = next(item for item in rows if item["agent_id"] == run_id)
        assert row["detail_refs"]["dispatch"]["dispatch_id"] == dispatch_id
        assert row["detail_refs"]["dispatch"]["state"] == "waiting"

        raw = await meta_tools.dispatch_meta_tool_async(
            "query_subagent_status", {"agent_id": run_id}, team_manager=manager
        )
        assert dispatch_id in raw

    asyncio.run(_run())


def test_cancelled_worker_closes_its_dispatch(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id=OWNER,
        )
        run_id = await _spawn_and_settle(manager)

        cancelled = await manager.cancel_subagent(run_id)
        assert cancelled["ok"] is True
        assert _record(run_id).status == "cancelled"
        assert _dispatch(run_id)["state"] == dispatch_store.DISPATCH_STATE_CLOSED

    asyncio.run(_run())


def test_switch_off_keeps_the_legacy_record_shape(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_DISPATCH_MAILBOX", "0")
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id=OWNER,
        )
        spawned = await manager.spawn_subagent(name="worker-a", role="worker", task="write a short note")
        run_id = spawned["agent_id"]
        await _wait_until(lambda: _record(run_id).status == "completed")

        assert dispatch_store.dispatch_of(_record(run_id)) == {}
        assert _record(run_id).detail_refs["scratchpad_key"] == f"subagent_result::{run_id}"
        assert dispatch_store.read_context_snapshot(SubAgentRunStore(OWNER), run_id) is None
        assert not (SubAgentRunStore(OWNER).root / f"{run_id}.context.json").exists()

    asyncio.run(_run())
