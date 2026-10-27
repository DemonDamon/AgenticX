#!/usr/bin/env python3
"""Session state machine tests.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.managed.errors import MAError
from agenticx.managed.events.state_machine import (
    InterruptTurn,
    PendingAction,
    ResolveActions,
    SessionStateMachine,
    SubmitMessage,
)
from agenticx.managed.protocol import (
    StopReason,
    UserCustomToolResult,
    UserInterrupt,
    UserMessage,
    UserToolConfirmation,
)


def _message() -> UserMessage:
    return UserMessage(type="user.message", content=[{"type": "text", "text": "hi"}])


def _confirm(event_id: str) -> UserToolConfirmation:
    return UserToolConfirmation(
        type="user.tool_confirmation",
        tool_use_id=event_id,
        result="allow",
    )


def _custom(event_id: str) -> UserCustomToolResult:
    return UserCustomToolResult(
        type="user.custom_tool_result",
        custom_tool_use_id=event_id,
        content=[{"type": "text", "text": "ok"}],
    )


def _running_with(*actions: PendingAction) -> SessionStateMachine:
    machine = SessionStateMachine()
    machine.turn_started()
    if actions:
        machine.action_required(actions)
    return machine


def test_message_rejected_in_requires_action() -> None:
    action_id = "X"
    machine = _running_with(PendingAction(action_id, "tool_confirmation"))
    with pytest.raises(MAError) as caught:
        machine.plan_client_events([_message()], {})
    err = caught.value
    assert err.code == "session_requires_action"
    assert err.http_status == 409
    assert err.details["event_ids"] == [action_id]


def test_resolution_errors() -> None:
    missing = SessionStateMachine()
    with pytest.raises(MAError) as not_found:
        missing.plan_client_events([_confirm("missing")], {})
    assert not_found.value.code == "resolution_not_found"
    assert not_found.value.http_status == 404

    mismatched = _running_with(PendingAction("A", "tool_confirmation"))
    with pytest.raises(MAError) as bad_kind:
        mismatched.plan_client_events([_custom("A")], {"A": "agent.tool_use"})
    assert bad_kind.value.code == "invalid_request"
    assert bad_kind.value.http_status == 400

    idle = SessionStateMachine(status="idle", stop_reason=StopReason(type="end_turn"))
    with pytest.raises(MAError) as conflict:
        idle.plan_client_events([_confirm("A")], {"A": "agent.tool_use"})
    assert conflict.value.code == "resolution_conflict"
    assert conflict.value.http_status == 409

    partial = _running_with(
        PendingAction("A", "tool_confirmation"),
        PendingAction("B", "tool_confirmation"),
    )
    known = {"A": "agent.tool_use", "B": "agent.tool_use"}
    partial.commit(partial.plan_client_events([_confirm("A")], known))
    with pytest.raises(MAError) as again:
        partial.plan_client_events([_confirm("A")], known)
    assert again.value.code == "resolution_conflict"
    assert again.value.http_status == 409


def test_batch_resolution_resumes_only_when_complete() -> None:
    machine = _running_with(
        PendingAction("A", "tool_confirmation"),
        PendingAction("B", "tool_confirmation"),
    )
    known = {"A": "agent.tool_use", "B": "agent.tool_use"}
    first_confirm = _confirm("A")
    first = machine.plan_client_events([first_confirm], known)
    assert first.effects == ()
    assert machine.commit(first) == []
    assert machine.requires_action is True

    second = machine.plan_client_events([_confirm("B")], known)
    assert len(second.effects) == 1
    effect = second.effects[0]
    assert isinstance(effect, ResolveActions)
    assert set(effect.resolutions) == {"A", "B"}
    assert effect.resolutions["A"] is first_confirm
    emitted = machine.commit(second)
    assert len(emitted) == 1
    assert emitted[0]["type"] == "session.status_running"
    assert machine.status == "running"


def test_resolution_then_message_same_batch() -> None:
    machine = _running_with(PendingAction("A", "tool_confirmation"))
    plan = machine.plan_client_events(
        [_confirm("A"), _message()],
        {"A": "agent.tool_use"},
    )
    assert len(plan.effects) == 2
    assert isinstance(plan.effects[0], ResolveActions)
    assert plan.effects[1] == SubmitMessage(1)


def test_interrupt_in_requires_action() -> None:
    machine = _running_with(PendingAction("A", "tool_confirmation"))
    plan = machine.plan_client_events(
        [UserInterrupt(type="user.interrupt")],
        {"A": "agent.tool_use"},
    )
    assert plan.effects == (InterruptTurn(("A",)),)
    assert machine.commit(plan) == []
    assert machine.status == "running"
    assert machine.requires_action is False
    finished = machine.turn_finished("end_turn")
    assert len(finished) == 1
    assert finished[0]["type"] == "session.status_idle"
    assert finished[0]["stop_reason"]["type"] == "end_turn"


def test_plan_is_pure_and_atomic() -> None:
    machine = _running_with(
        PendingAction("A", "tool_confirmation"),
        PendingAction("B", "tool_confirmation"),
    )
    before = machine.snapshot()
    with pytest.raises(MAError) as caught:
        machine.plan_client_events(
            [_confirm("A"), _confirm("Z")],
            {"A": "agent.tool_use"},
        )
    assert caught.value.code == "resolution_not_found"
    assert caught.value.http_status == 404
    assert machine.snapshot() == before


def test_terminated_and_archived_reject_all() -> None:
    for status in ("terminated", "archived"):
        machine = SessionStateMachine(status=status)
        with pytest.raises(MAError) as caught:
            machine.plan_client_events([_message()], {})
        assert caught.value.code == "session_terminated"
        assert caught.value.http_status == 409
        with pytest.raises(MAError) as interrupt:
            machine.plan_client_events([UserInterrupt(type="user.interrupt")], {})
        assert interrupt.value.code == "session_terminated"


def test_illegal_transitions_raise() -> None:
    idle = SessionStateMachine()
    with pytest.raises(RuntimeError):
        idle.turn_finished("end_turn")
    running = SessionStateMachine()
    running.turn_started()
    with pytest.raises(RuntimeError):
        running.turn_started()
    with pytest.raises(MAError) as caught:
        running.archive()
    assert caught.value.code == "invalid_request"


def test_recover_after_restart() -> None:
    running = SessionStateMachine(status="running")
    events = running.recover_after_restart()
    assert len(events) == 2
    assert events[0]["type"] == "session.error"
    assert events[0]["error"]["type"] == "host_restarted"
    assert events[0]["error"]["retry_status"]["type"] == "exhausted"
    assert events[1]["type"] == "session.status_idle"
    assert events[1]["stop_reason"]["type"] == "retries_exhausted"

    idle = SessionStateMachine(status="idle", stop_reason=StopReason(type="end_turn"))
    assert idle.recover_after_restart() == []


def test_apply_ingested_status() -> None:
    machine = SessionStateMachine()
    machine.apply_ingested_status({"type": "session.status_running"}, {})
    assert machine.status == "running"
    machine.apply_ingested_status(
        {
            "type": "session.status_idle",
            "stop_reason": {"type": "requires_action", "event_ids": ["A"]},
        },
        {"A": "tool_confirmation"},
    )
    assert machine.pending == (PendingAction("A", "tool_confirmation"),)

    other = SessionStateMachine(status="running")
    with pytest.raises(MAError) as unknown:
        other.apply_ingested_status(
            {
                "type": "session.status_idle",
                "stop_reason": {"type": "requires_action", "event_ids": ["Z"]},
            },
            {},
        )
    assert unknown.value.code == "invalid_event_batch"
    with pytest.raises(MAError) as terminated:
        other.apply_ingested_status({"type": "session.status_terminated"}, {})
    assert terminated.value.code == "invalid_event_batch"


def test_targeted_interrupt_effect_keeps_state() -> None:
    running = SessionStateMachine(status="running")
    running_plan = running.plan_client_events(
        [UserInterrupt(type="user.interrupt", thread_id="T")],
        {},
    )
    assert running_plan.effects == (InterruptTurn((), thread_id="T"),)
    assert running_plan.final.status == "running"
    assert running_plan.final.pending == ()

    waiting = SessionStateMachine(
        status="idle",
        stop_reason=StopReason(type="requires_action", event_ids=["A"]),
        pending=[PendingAction("A", "tool_confirmation")],
    )
    before_pending = waiting.pending
    waiting_plan = waiting.plan_client_events(
        [UserInterrupt(type="user.interrupt", thread_id="T")],
        {"A": "agent.tool_use"},
    )
    assert waiting_plan.effects == (InterruptTurn((), thread_id="T"),)
    assert waiting_plan.final.status == "idle"
    assert waiting_plan.final.pending == before_pending
    assert waiting.status == "idle"
    assert waiting.pending == before_pending
