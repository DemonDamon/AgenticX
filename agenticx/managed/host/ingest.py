#!/usr/bin/env python3
"""Ingest worker-produced server events and close work items.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

from agenticx.managed.errors import INVALID_EVENT_BATCH, MAError, WORK_LEASE_LOST
from agenticx.managed.events.state_machine import (
    KIND_BY_EVENT_TYPE,
    session_error_event,
)
from agenticx.managed.events.store import StoredEvent
from agenticx.managed.host.actor import SessionActor
from agenticx.managed.host.service import SessionService
from agenticx.managed.host.work_queue import LEASED_STATUSES, SqliteWorkQueue, WorkItemRow
from agenticx.managed.protocol import SERVER_EVENT_TYPES, Usage, parse_server_event
from agenticx.runtime.credential_store import redact_text

MAX_INGEST_EVENTS = 100
INGEST_STRIP_KEYS = ("session_id", "seq", "created_at", "processed_at")
_STORED_ERROR_LIMIT = 500


async def ingest_worker_events(
    actor: SessionActor,
    work_queue: SqliteWorkQueue,
    *,
    work_id: str,
    device_id: str,
    raw_events: Any,
) -> list[StoredEvent]:
    """Validate a worker batch, assign seq on append, and roll back on failure."""
    item = work_queue.require_lease(
        actor.tenant_id,
        work_id,
        device_id,
        statuses=("running",),
    )
    if item.session_id != actor.session_id:
        raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
    if not isinstance(raw_events, list) or not 1 <= len(raw_events) <= MAX_INGEST_EVENTS:
        raise MAError(INVALID_EVENT_BATCH, "events must contain 1-100 items")
    cleaned: list[dict[str, Any]] = []
    for index, event in enumerate(raw_events):
        if not isinstance(event, dict) or event.get("type") not in SERVER_EVENT_TYPES:
            raise MAError(
                INVALID_EVENT_BATCH,
                f"events[{index}]: workers may only ingest server events",
                details={"index": index},
            )
        body = {key: value for key, value in event.items() if key not in INGEST_STRIP_KEYS}
        try:
            parse_server_event(dict(body))
        except Exception:
            raise MAError(
                INVALID_EVENT_BATCH,
                f"events[{index}]: invalid",
                details={"index": index},
            ) from None
        cleaned.append(body)
    batch_types = {
        event["id"]: event["type"]
        for event in cleaned
        if isinstance(event.get("id"), str)
    }
    async with actor.lock:
        snap = actor.sm.snapshot()
        last_usage = None
        try:
            for event in cleaned:
                event_type = event["type"]
                if isinstance(event_type, str) and event_type.startswith("session.status_"):
                    actor.sm.apply_ingested_status(
                        event,
                        await _pending_kinds(actor, event, batch_types),
                    )
                elif event_type == "session.usage":
                    last_usage = Usage.model_validate(event["usage"])
            stored = await actor.append(cleaned)
        except BaseException:
            actor.sm.restore(snap)
            raise
        await actor.sync_record(usage=last_usage)
    return stored


async def _pending_kinds(
    actor: SessionActor,
    event: dict[str, Any],
    batch_types: dict[str, str],
) -> dict[str, Any]:
    """Map requires_action ids to action kinds. Other status events get {}."""
    if event.get("type") != "session.status_idle":
        return {}
    stop_reason = event.get("stop_reason") or {}
    if not isinstance(stop_reason, dict) or stop_reason.get("type") != "requires_action":
        return {}
    kinds: dict[str, Any] = {}
    for event_id in stop_reason.get("event_ids") or []:
        event_type = batch_types.get(event_id)
        if event_type is None:
            stored = await actor.service.store.get_event(
                actor.tenant_id,
                actor.session_id,
                event_id,
            )
            event_type = stored.type if stored is not None else None
        kind = KIND_BY_EVENT_TYPE.get(event_type or "")
        if kind is not None:
            kinds[event_id] = kind
    return kinds


async def complete_work(
    actor: SessionActor,
    work_queue: SqliteWorkQueue,
    *,
    work_id: str,
    device_id: str,
    consumed_through_seq: int,
) -> WorkItemRow:
    """Complete a running item and queue a follow-up when messages remain."""
    leased = work_queue.require_lease(
        actor.tenant_id,
        work_id,
        device_id,
        statuses=("running",),
    )
    if leased.session_id != actor.session_id:
        raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
    async with actor.lock:
        row = work_queue.complete(
            actor.tenant_id,
            work_id,
            device_id,
            consumed_through_seq,
        )
        if actor.sm.status == "running" or actor.sm.requires_action:
            await actor.append(
                [
                    session_error_event(
                        "worker_incomplete",
                        "worker completed the work item while the session was still active",
                        "exhausted",
                    )
                ]
            )
            await actor.append(actor.sm.turn_finished("retries_exhausted"))
            await actor.sync_record()
        pending = await actor.service.store.list_events(
            actor.tenant_id,
            actor.session_id,
            after_seq=consumed_through_seq,
            limit=1,
            types=["user.message"],
        )
        if pending:
            work_queue.create(
                tenant_id=actor.tenant_id,
                session_id=actor.session_id,
                environment_id=row.environment_id,
                inbox_after_seq=consumed_through_seq,
            )
            work_queue.notify(row.environment_id)
    return row


async def fail_work(
    actor: SessionActor,
    work_queue: SqliteWorkQueue,
    *,
    work_id: str,
    device_id: str,
    error: str,
) -> WorkItemRow:
    """Mark the item failed and settle the session when a turn is open."""
    leased = work_queue.require_lease(
        actor.tenant_id,
        work_id,
        device_id,
        statuses=LEASED_STATUSES,
    )
    if leased.session_id != actor.session_id:
        raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
    message = redact_text(error)[:_STORED_ERROR_LIMIT]
    async with actor.lock:
        consumed = await actor.service.store.last_seq(actor.tenant_id, actor.session_id)
        row = work_queue.finish(
            actor.tenant_id,
            work_id,
            status="failed",
            error=message,
            consumed_through_seq=consumed,
        )
        await actor.append([session_error_event("worker_failed", message, "exhausted")])
        if actor.sm.status == "running" or actor.sm.requires_action:
            await actor.append(actor.sm.turn_finished("retries_exhausted"))
        await actor.sync_record()
    return row


async def stop_expired_work(service: SessionService, work_queue: SqliteWorkQueue) -> int:
    """Stop items whose heartbeat grace has elapsed. Lost items are not requeued."""
    stopped = 0
    for item in work_queue.expired():
        try:
            actor = await service.actor_for(item.tenant_id, item.session_id)
        except MAError:
            consumed = await service.store.last_seq(item.tenant_id, item.session_id)
            work_queue.finish(
                item.tenant_id,
                item.id,
                status="stopped",
                error="worker heartbeat lost",
                consumed_through_seq=consumed,
            )
            stopped += 1
            continue
        async with actor.lock:
            consumed = await actor.service.store.last_seq(item.tenant_id, item.session_id)
            work_queue.finish(
                item.tenant_id,
                item.id,
                status="stopped",
                error="worker heartbeat lost",
                consumed_through_seq=consumed,
            )
            await actor.append(
                [
                    session_error_event(
                        "worker_lost",
                        "worker heartbeat lost; the work item was stopped",
                        "exhausted",
                    )
                ]
            )
            if actor.sm.status == "running" or actor.sm.requires_action:
                await actor.append(actor.sm.turn_finished("retries_exhausted"))
            await actor.sync_record()
        stopped += 1
    return stopped


__all__ = [
    "INGEST_STRIP_KEYS",
    "MAX_INGEST_EVENTS",
    "complete_work",
    "fail_work",
    "ingest_worker_events",
    "stop_expired_work",
]
