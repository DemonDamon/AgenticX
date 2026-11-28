"""Closed-loop tests for dispatch wake-ups across a backend restart.

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
from agenticx.runtime.team_manager import AgentTeamManager

OWNER = "sess-dispatch-wake"
MAIL = "continue: write the second note"


class _FakeResponse:
    def __init__(self, content: str, tool_calls: List[Any]) -> None:
        self.content = content
        self.tool_calls = tool_calls


class _RecordingLLM:
    """Fake LLM that counts invocations and keeps what the model was shown."""

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls = 0
        self.seen: List[str] = []

    def invoke(self, *args: Any, **kwargs: Any) -> _FakeResponse:
        self.calls += 1
        self.seen.append(json.dumps([args, kwargs], ensure_ascii=False, default=str))
        return _FakeResponse(self.reply, [])

    def stream(self, *args: Any, **kwargs: Any):
        self.calls += 1
        self.seen.append(json.dumps([args, kwargs], ensure_ascii=False, default=str))
        yield self.reply


async def _wait_until(predicate, timeout: float = 5.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


def _new_manager(llm: Any) -> AgentTeamManager:
    """A fresh manager for the same owner session, i.e. a backend restart."""
    return AgentTeamManager(
        llm_factory=lambda: llm,
        base_session=StudioSession(),
        owner_session_id=OWNER,
    )


def _dispatch(run_id: str) -> dict:
    record = SubAgentRunStore(OWNER).get_run(run_id)
    assert record is not None
    return dispatch_store.dispatch_of(record)


def _snapshot(run_id: str):
    return dispatch_store.read_context_snapshot(SubAgentRunStore(OWNER), run_id)


async def _spawn_and_settle(manager: AgentTeamManager, name: str = "worker-a") -> str:
    spawned = await manager.spawn_subagent(name=name, role="worker", task="write a short note")
    assert spawned["ok"] is True
    run_id = spawned["agent_id"]
    await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)
    return run_id


def test_waiting_worker_is_woken_once_after_restart_with_context(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        llm = _RecordingLLM("first-answer")
        run_id = await _spawn_and_settle(_new_manager(llm))
        first_snapshot = _snapshot(run_id)
        assert first_snapshot is not None
        dispatch_id = _dispatch(run_id)["dispatch_id"]
        calls_before = llm.calls

        # Backend restart: a fresh manager whose in-memory maps are empty.
        second = _new_manager(llm)
        woken = await second.send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert woken["ok"] is True
        assert woken.get("restored") is True
        assert woken["dispatch_id"] == dispatch_id
        assert woken["message_id"] == "mail-1"
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)

        calls_after_wake = llm.calls
        assert calls_after_wake > calls_before
        assert any("first-answer" in seen for seen in llm.seen[calls_before:])

        second_snapshot = _snapshot(run_id)
        assert second_snapshot is not None
        rows = second_snapshot["agent_messages"]
        assert any(row.get("role") == "user" and MAIL in str(row.get("content")) for row in rows)
        assert "first-answer" in json.dumps(rows, ensure_ascii=False)
        assert len(rows) > len(first_snapshot["agent_messages"])

        # The same mail again, in-process and after another restart, is a no-op.
        duplicate = await second.send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert duplicate["ok"] is True
        assert duplicate.get("duplicate") is True
        third = _new_manager(llm)
        duplicate_again = await third.send_message_to_subagent(run_id, MAIL, message_id="mail-1")
        assert duplicate_again["ok"] is True
        assert duplicate_again.get("duplicate") is True
        await asyncio.sleep(0.2)
        assert llm.calls == calls_after_wake

        mails = dispatch_store.read_mailbox(SubAgentRunStore(OWNER), run_id)
        assert [item["message_id"] for item in mails] == ["mail-1"]
        assert mails[0]["consumed_by"] == "wake_turn"

        # A different mail is a new wake-up.
        again = await third.send_message_to_subagent(run_id, "third note", message_id="mail-2")
        assert again["ok"] is True
        assert "duplicate" not in again
        await _wait_until(
            lambda: len(dispatch_store.read_mailbox(SubAgentRunStore(OWNER), run_id)) == 2
            and _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING
        )
        assert llm.calls > calls_after_wake

    asyncio.run(_run())


def test_addressing_by_dispatch_id_and_name_after_restart(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        llm = _RecordingLLM("ok")
        run_id = await _spawn_and_settle(_new_manager(llm), name="scout")
        dispatch_id = _dispatch(run_id)["dispatch_id"]

        second = _new_manager(llm)
        by_dispatch = await second.send_message_to_subagent(dispatch_id, "by dispatch", message_id="m-dispatch")
        assert by_dispatch["ok"] is True
        assert by_dispatch["agent_id"] == run_id
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)

        third = _new_manager(llm)
        by_name = await third.send_message_to_subagent("scout", "by name", message_id="m-name")
        assert by_name["ok"] is True
        assert by_name["agent_id"] == run_id
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)

        unknown = await third.send_message_to_subagent("dsp-does-not-exist", "x")
        assert unknown == {"ok": False, "error": "not_found", "message": "未找到子智能体: dsp-does-not-exist"}

    asyncio.run(_run())


def test_cancelled_worker_is_closed_after_restart(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        llm = _RecordingLLM("ok")
        first = _new_manager(llm)
        run_id = await _spawn_and_settle(first)
        assert (await first.cancel_subagent(run_id))["ok"] is True
        calls_before = llm.calls

        refused = await _new_manager(llm).send_message_to_subagent(run_id, MAIL)
        assert refused["ok"] is False
        assert refused["error"] == "dispatch_closed"
        await asyncio.sleep(0.1)
        assert llm.calls == calls_before

    asyncio.run(_run())


def test_stale_running_record_without_snapshot_is_refused(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    # A worker that crashed mid-turn: still "running", never reached "waiting".
    SubAgentRunStore(OWNER).open_run(
        run_id="sa-stale00000",
        kind="spawn",
        name="crashed",
        role="worker",
        task="crashed mid-turn",
        status="running",
        started_at=1.0,
        detail_refs={
            "dispatch": {"dispatch_id": "dsp-stale000001", "task_id": "sa-stale00000", "state": "running"}
        },
    )

    async def _run() -> None:
        llm = _RecordingLLM("should-not-run")
        refused = await _new_manager(llm).send_message_to_subagent("sa-stale00000", MAIL)
        assert refused["ok"] is False
        assert refused["error"] == "context_unavailable"
        await asyncio.sleep(0.1)
        assert llm.calls == 0

    asyncio.run(_run())


def test_legacy_record_without_dispatch_is_refused(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    # A run record written before dispatches existed: no dispatch, no snapshot.
    SubAgentRunStore(OWNER).open_run(
        run_id="sa-legacy00001",
        kind="spawn",
        name="old",
        role="worker",
        task="old task",
        status="completed",
        started_at=1.0,
    )

    async def _run() -> None:
        llm = _RecordingLLM("should-not-run")
        refused = await _new_manager(llm).send_message_to_subagent("sa-legacy00001", MAIL)
        assert refused["ok"] is False
        assert refused["error"] == "dispatch_not_registered"
        await asyncio.sleep(0.1)
        assert llm.calls == 0

    asyncio.run(_run())


def test_send_message_tool_derives_message_id_from_the_tool_call(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    async def _run() -> None:
        llm = _RecordingLLM("ok")
        run_id = await _spawn_and_settle(_new_manager(llm))
        dispatch_id = _dispatch(run_id)["dispatch_id"]
        second = _new_manager(llm)
        arguments = {"agent_id": dispatch_id, "message": MAIL, "__tool_call_id": "call-77"}

        first_raw = await meta_tools.dispatch_meta_tool_async(
            "send_message_to_agent", dict(arguments), team_manager=second
        )
        assert json.loads(first_raw)["ok"] is True
        await _wait_until(lambda: _dispatch(run_id).get("state") == dispatch_store.DISPATCH_STATE_WAITING)
        calls_after = llm.calls

        # The same tool call re-dispatched is the same mail.
        second_raw = await meta_tools.dispatch_meta_tool_async(
            "send_message_to_agent", dict(arguments), team_manager=second
        )
        assert json.loads(second_raw)["duplicate"] is True
        await asyncio.sleep(0.2)
        assert llm.calls == calls_after

        mails = dispatch_store.read_mailbox(SubAgentRunStore(OWNER), run_id)
        assert [item["message_id"] for item in mails] == ["call:call-77"]

    asyncio.run(_run())
