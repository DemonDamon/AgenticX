"""Ledger tests for sub-agent wake-up turns.

Plan-Id: 2026-11-27-runtime-invariants-03-dispatch-mailbox

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, List

import pytest

import agenticx.runtime.replay_ledger.recorder as recorder_module
from agenticx.cli.studio import StudioSession
from agenticx.runtime.replay_ledger.resume_anchor import find_open_run
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.subagent_runs import dispatch as dispatch_store
from agenticx.runtime.team_manager import AgentTeamManager

OWNER = "sess-dispatch-ledger"
MAIL = "continue: write the second note"


class _FakeResponse:
    def __init__(self, content: str, tool_calls: List[Any]) -> None:
        self.content = content
        self.tool_calls = tool_calls


class _QuickTextLLM:
    def invoke(self, *_args: Any, **_kwargs: Any) -> _FakeResponse:
        return _FakeResponse("done", [])

    def stream(self, *_args: Any, **_kwargs: Any):
        yield "ok"


async def _wait_until(predicate, timeout: float = 5.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


def _new_manager() -> AgentTeamManager:
    """A fresh manager for the same owner session, i.e. a backend restart."""
    return AgentTeamManager(
        llm_factory=lambda: _QuickTextLLM(),
        base_session=StudioSession(),
        owner_session_id=OWNER,
    )


def _dispatch(run_id: str) -> dict:
    record = SubAgentRunStore(OWNER).get_run(run_id)
    assert record is not None
    return dispatch_store.dispatch_of(record)


def _waiting(run_id: str) -> bool:
    return _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING


async def _spawn_and_settle(manager: AgentTeamManager) -> str:
    spawned = await manager.spawn_subagent(name="worker-a", role="worker", task="write a short note")
    assert spawned["ok"] is True
    run_id = spawned["agent_id"]
    await _wait_until(lambda: _waiting(run_id))
    return run_id


def _ledger() -> ReplayLedgerStore:
    return ReplayLedgerStore(dispatch_store.ledger_root_for(SubAgentRunStore(OWNER)))


def test_wake_turn_is_recorded_in_an_isolated_ledger_namespace(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        run_id = await _spawn_and_settle(_new_manager())
        ledger = _ledger()
        namespace = dispatch_store.dispatch_ledger_session_id(OWNER, run_id)

        # The spawn turn is not recorded.
        assert ledger.list_runs(namespace) == []

        woken = await _new_manager().send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert woken["ok"] is True
        await _wait_until(lambda: _waiting(run_id))

        runs = ledger.list_runs(namespace)
        assert len(runs) == 1
        assert runs[0].agent_id == run_id
        assert runs[0].status == "completed"
        assert ledger.get_run(runs[0].run_id) is not None

        # The owner session's ledger is untouched: no pollution, no shadowing.
        assert ledger.list_runs(OWNER) == []
        assert find_open_run(ledger, OWNER) is None

        third = _new_manager()
        again = await third.send_message_to_subagent(run_id, "third note", message_id="mail-2")
        assert again["ok"] is True
        await _wait_until(lambda: len(ledger.list_runs(namespace)) == 2 and _waiting(run_id))

    asyncio.run(_run())


def test_wake_run_is_not_enqueued_for_enterprise_trace(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    enqueued: List[str] = []
    monkeypatch.setattr(
        recorder_module,
        "enqueue_completed_run",
        lambda store, run_id: enqueued.append(run_id),
    )

    async def _run() -> None:
        run_id = await _spawn_and_settle(_new_manager())
        woken = await _new_manager().send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert woken["ok"] is True
        namespace = dispatch_store.dispatch_ledger_session_id(OWNER, run_id)
        await _wait_until(lambda: len(_ledger().list_runs(namespace)) == 1 and _waiting(run_id))
        assert enqueued == []

    asyncio.run(_run())


def test_recorder_enterprise_trace_switch_controls_enqueue(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    enqueued: List[str] = []
    monkeypatch.setattr(
        recorder_module,
        "enqueue_completed_run",
        lambda store, run_id: enqueued.append(run_id),
    )
    store = ReplayLedgerStore(tmp_path)

    def _finish(enabled: bool) -> str:
        recorder = recorder_module.ReplayLedgerRecorder(
            store=store,
            session_id="sess-recorder",
            agent_id="meta",
            provider=None,
            model=None,
            enterprise_trace=enabled,
        )
        recorder.start_turn(turn_id="turn-1", user_input="hi", session=StudioSession())
        run_id = str(recorder.current_run_id)
        recorder.finish("completed")
        return run_id

    assert _finish(False) != ""
    assert enqueued == []
    assert _finish(True) != ""
    assert len(enqueued) == 1
