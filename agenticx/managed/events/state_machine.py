#!/usr/bin/env python3
"""Pure session state machine for Managed Agents.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping, Sequence, Union

from pydantic import ValidationError

from agenticx.managed.errors import (
    INVALID_EVENT_BATCH,
    INVALID_REQUEST,
    MAError,
    RESOLUTION_CONFLICT,
    RESOLUTION_NOT_FOUND,
    SESSION_REQUIRES_ACTION,
    SESSION_TERMINATED,
)
from agenticx.managed.ids import new_ulid
from agenticx.managed.protocol import (
    ClientEvent,
    SessionStatus,
    StopReason,
    StopReasonType,
    UserCustomToolResult,
    UserInterrupt,
    UserMessage,
    UserToolConfirmation,
)

ActionKind = Literal["tool_confirmation", "custom_tool_result"]
KIND_BY_EVENT_TYPE: Mapping[str, ActionKind] = {
    "agent.tool_use": "tool_confirmation",
    "agent.mcp_tool_use": "tool_confirmation",
    "agent.custom_tool_use": "custom_tool_result",
}
KIND_BY_RESOLUTION_TYPE: Mapping[str, ActionKind] = {
    "user.tool_confirmation": "tool_confirmation",
    "user.custom_tool_result": "custom_tool_result",
}


@dataclass(frozen=True)
class PendingAction:
    """One tool use that is waiting for a matching user resolution."""

    event_id: str
    kind: ActionKind


@dataclass(frozen=True)
class SubmitMessage:
    """Index of a ``user.message`` inside the client batch."""

    index: int


@dataclass(frozen=True)
class ResolveActions:
    """Resolutions that completed the current requires_action batch.

    Values may come from this batch or from earlier partial commits.
    """

    resolutions: Mapping[str, ClientEvent]


@dataclass(frozen=True)
class InterruptTurn:
    """Pending tool-use ids voided by ``user.interrupt``. Empty when none.

    ``thread_id`` targets one member thread. None stops the primary turn.
    """

    dropped_pending: tuple[str, ...]
    thread_id: str | None = None


Effect = Union[SubmitMessage, ResolveActions, InterruptTurn]


@dataclass(frozen=True)
class StateSnapshot:
    """Restorable machine state. ``resolved`` holds a partial batch."""

    status: SessionStatus
    stop_reason: StopReason | None
    pending: tuple[PendingAction, ...]
    resolved: Mapping[str, ClientEvent]


@dataclass(frozen=True)
class ClientBatchPlan:
    """Result of a pure ``plan_client_events`` call. Apply it with ``commit``."""

    events: tuple[ClientEvent, ...]
    effects: tuple[Effect, ...]
    final: StateSnapshot


def status_running_event() -> dict[str, Any]:
    """Build a new ``session.status_running`` server event."""
    return {"id": new_ulid(), "type": "session.status_running"}


def status_idle_event(
    stop_type: StopReasonType,
    event_ids: Sequence[str] = (),
) -> dict[str, Any]:
    """Build a new ``session.status_idle`` server event."""
    return {
        "id": new_ulid(),
        "type": "session.status_idle",
        "stop_reason": {"type": stop_type, "event_ids": list(event_ids)},
    }


def session_error_event(
    error_type: str,
    message: str,
    retry: Literal["retrying", "exhausted", "terminal"],
) -> dict[str, Any]:
    """Build a new ``session.error`` server event."""
    return {
        "id": new_ulid(),
        "type": "session.error",
        "error": {
            "type": error_type,
            "message": message,
            "retry_status": {"type": retry},
        },
    }


def _requires_action(status: SessionStatus, stop_reason: StopReason | None) -> bool:
    return status == "idle" and stop_reason is not None and stop_reason.type == "requires_action"


class SessionStateMachine:
    """In-memory session status, pending actions, and partial resolutions.

    ``plan_client_events`` does not mutate ``self``. ``resolved`` is not stored
    in SQLite; the host must keep this object (or a ``StateSnapshot``) across
    batches. A restart calls ``recover_after_restart`` and drops partial work.
    """

    def __init__(
        self,
        status: SessionStatus = "idle",
        stop_reason: StopReason | None = None,
        pending: Sequence[PendingAction] = (),
    ) -> None:
        self._status: SessionStatus = status
        self._stop_reason = stop_reason
        self._pending = tuple(pending)
        self._resolved: dict[str, ClientEvent] = {}

    @property
    def status(self) -> SessionStatus:
        return self._status

    @property
    def stop_reason(self) -> StopReason | None:
        return self._stop_reason

    @property
    def pending(self) -> tuple[PendingAction, ...]:
        return self._pending

    @property
    def requires_action(self) -> bool:
        """True when status is idle and stop_reason.type is requires_action."""
        return _requires_action(self._status, self._stop_reason)

    def snapshot(self) -> StateSnapshot:
        return StateSnapshot(
            status=self._status,
            stop_reason=self._stop_reason,
            pending=self._pending,
            resolved=dict(self._resolved),
        )

    def restore(self, snap: StateSnapshot) -> None:
        self._status = snap.status
        self._stop_reason = snap.stop_reason
        self._pending = tuple(snap.pending)
        self._resolved = dict(snap.resolved)

    def plan_client_events(
        self,
        events: Sequence[ClientEvent],
        known_event_types: Mapping[str, str],
    ) -> ClientBatchPlan:
        """Plan a batch. Any error leaves this machine unchanged."""
        if self._status == "terminated":
            raise MAError(SESSION_TERMINATED, "session is terminated")
        if self._status == "archived":
            raise MAError(SESSION_TERMINATED, "session is archived")

        sim_status = self._status
        sim_stop = self._stop_reason
        sim_pending: dict[str, ActionKind] = {item.event_id: item.kind for item in self._pending}
        sim_resolved: dict[str, ClientEvent] = dict(self._resolved)
        effects: list[Effect] = []

        for index, event in enumerate(events):
            if isinstance(event, UserMessage):
                if _requires_action(sim_status, sim_stop):
                    raise MAError(
                        SESSION_REQUIRES_ACTION,
                        f"events[{index}]: session requires action",
                        details={"index": index, "event_ids": sorted(sim_pending)},
                    )
                effects.append(SubmitMessage(index))
                continue
            if isinstance(event, UserInterrupt):
                if event.thread_id is not None:
                    effects.append(InterruptTurn((), thread_id=event.thread_id))
                    continue
                if _requires_action(sim_status, sim_stop):
                    effects.append(InterruptTurn(tuple(sorted(sim_pending))))
                    sim_status = "running"
                    sim_stop = None
                    sim_pending.clear()
                    sim_resolved.clear()
                elif sim_status in {"running", "rescheduling"}:
                    effects.append(InterruptTurn(()))
                continue
            if isinstance(event, (UserToolConfirmation, UserCustomToolResult)):
                completed = _plan_resolution(
                    index,
                    event,
                    known_event_types,
                    sim_status,
                    sim_stop,
                    sim_pending,
                    sim_resolved,
                    effects,
                )
                if completed:
                    sim_status = "running"
                    sim_stop = None
                continue
            raise MAError(
                INVALID_EVENT_BATCH,
                f"events[{index}]: unknown event type",
                details={"index": index},
            )

        final = StateSnapshot(
            status=sim_status,
            stop_reason=sim_stop,
            pending=tuple(
                PendingAction(event_id, kind) for event_id, kind in sim_pending.items()
            ),
            resolved=dict(sim_resolved),
        )
        return ClientBatchPlan(events=tuple(events), effects=tuple(effects), final=final)

    def commit(self, plan: ClientBatchPlan) -> list[dict[str, Any]]:
        """Apply ``plan.final``. A completed resolution emits status_running."""
        self.restore(plan.final)
        if any(isinstance(effect, ResolveActions) for effect in plan.effects):
            return [status_running_event()]
        return []

    def turn_started(self) -> list[dict[str, Any]]:
        if self._status != "idle" or self.requires_action:
            raise RuntimeError(f"illegal transition from {self._status}")
        self._status = "running"
        self._stop_reason = None
        self._pending = ()
        self._resolved = {}
        return [status_running_event()]

    def action_required(self, actions: Sequence[PendingAction]) -> list[dict[str, Any]]:
        if self._status != "running" or len(tuple(actions)) == 0:
            raise RuntimeError(f"illegal transition from {self._status}")
        copied = tuple(actions)
        event_ids = [item.event_id for item in copied]
        self._status = "idle"
        self._stop_reason = StopReason(type="requires_action", event_ids=list(event_ids))
        self._pending = copied
        self._resolved = {}
        return [status_idle_event("requires_action", event_ids)]

    def turn_finished(self, stop_type: StopReasonType) -> list[dict[str, Any]]:
        if stop_type == "requires_action":
            raise RuntimeError(f"illegal transition from {self._status}")
        if self._status not in {"running", "rescheduling"} and not self.requires_action:
            raise RuntimeError(f"illegal transition from {self._status}")
        self._status = "idle"
        self._stop_reason = StopReason(type=stop_type)
        self._pending = ()
        self._resolved = {}
        return [status_idle_event(stop_type)]

    def apply_ingested_status(
        self,
        event: Mapping[str, Any],
        pending_kinds: Mapping[str, ActionKind],
    ) -> None:
        """Apply a worker-supplied status event. Does not emit a new event."""
        event_type = event.get("type")
        if event_type == "session.status_running":
            self._apply_running()
            return
        if event_type == "session.status_idle":
            self._apply_idle(event, pending_kinds)
            return
        if event_type == "session.status_terminated":
            raise MAError(INVALID_EVENT_BATCH, "workers cannot terminate sessions")

    def archive(self) -> None:
        if self._status != "idle" or self.requires_action:
            raise MAError(INVALID_REQUEST, "session must be idle to archive")
        self._status = "archived"

    def recover_after_restart(self) -> list[dict[str, Any]]:
        """Move an in-flight session to idle/retries_exhausted after host restart."""
        if self._status not in {"running", "rescheduling"} and not self.requires_action:
            return []
        self._status = "idle"
        self._stop_reason = StopReason(type="retries_exhausted")
        self._pending = ()
        self._resolved = {}
        return [
            session_error_event(
                "host_restarted",
                "session was interrupted by a host restart",
                "exhausted",
            ),
            status_idle_event("retries_exhausted"),
        ]

    def _apply_running(self) -> None:
        if self._status != "idle" or self.requires_action:
            raise MAError(
                INVALID_EVENT_BATCH,
                "invalid status transition: session.status_running",
            )
        self._status = "running"
        self._stop_reason = None
        self._pending = ()
        self._resolved = {}

    def _apply_idle(
        self,
        event: Mapping[str, Any],
        pending_kinds: Mapping[str, ActionKind],
    ) -> None:
        try:
            stop = StopReason.model_validate(event.get("stop_reason"))
        except ValidationError:
            raise MAError(
                INVALID_EVENT_BATCH,
                "invalid status transition: session.status_idle",
            ) from None
        if stop.type == "requires_action":
            if self._status != "running":
                raise MAError(
                    INVALID_EVENT_BATCH,
                    "invalid status transition: session.status_idle",
                )
            for event_id in stop.event_ids:
                if event_id not in pending_kinds:
                    raise MAError(
                        INVALID_EVENT_BATCH,
                        f"requires_action references unknown tool use {event_id}",
                    )
            self._status = "idle"
            self._stop_reason = stop
            self._pending = tuple(
                PendingAction(event_id, pending_kinds[event_id]) for event_id in stop.event_ids
            )
            self._resolved = {}
            return
        if self._status not in {"running", "rescheduling"} and not self.requires_action:
            raise MAError(
                INVALID_EVENT_BATCH,
                "invalid status transition: session.status_idle",
            )
        self._status = "idle"
        self._stop_reason = stop
        self._pending = ()
        self._resolved = {}


def _plan_resolution(
    index: int,
    event: UserToolConfirmation | UserCustomToolResult,
    known_event_types: Mapping[str, str],
    sim_status: SessionStatus,
    sim_stop: StopReason | None,
    sim_pending: dict[str, ActionKind],
    sim_resolved: dict[str, ClientEvent],
    effects: list[Effect],
) -> bool:
    """Validate one resolution. Return True when the pending batch completes."""
    if isinstance(event, UserToolConfirmation):
        ref_id = event.tool_use_id
    else:
        ref_id = event.custom_tool_use_id
    stored_type = known_event_types.get(ref_id)
    if stored_type is None:
        raise MAError(
            RESOLUTION_NOT_FOUND,
            f"events[{index}]: tool use {ref_id} not found",
            details={"index": index},
        )
    if KIND_BY_EVENT_TYPE.get(stored_type) != KIND_BY_RESOLUTION_TYPE[event.type]:
        raise MAError(
            INVALID_REQUEST,
            f"events[{index}]: {event.type} cannot resolve {stored_type}",
            details={"index": index},
        )
    awaiting = _requires_action(sim_status, sim_stop) and ref_id in sim_pending and ref_id not in sim_resolved
    if not awaiting:
        raise MAError(
            RESOLUTION_CONFLICT,
            f"events[{index}]: tool use {ref_id} is not awaiting resolution",
            details={"index": index},
        )
    sim_resolved[ref_id] = event
    if set(sim_resolved) == set(sim_pending):
        effects.append(ResolveActions(dict(sim_resolved)))
        sim_pending.clear()
        sim_resolved.clear()
        return True
    return False
