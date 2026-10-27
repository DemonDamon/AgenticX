#!/usr/bin/env python3
"""Work-queue HTTP routes for desktop workers.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from agenticx.managed.errors import (
    AGENT_VERSION_NOT_FOUND,
    ENVIRONMENT_NOT_FOUND,
    INVALID_REQUEST,
    MAError,
    SESSION_NOT_FOUND,
    UNAUTHORIZED,
    WORK_LEASE_LOST,
)
from agenticx.managed.host.auth import bearer_token, require_scope
from agenticx.managed.host.config import Principal
from agenticx.managed.host.ingest import complete_work, fail_work, ingest_worker_events
from agenticx.managed.host.work_queue import LEASED_STATUSES, SqliteWorkQueue, WorkItemRow
from agenticx.managed.ids import utc_now_iso
from agenticx.managed.protocol import CLIENT_EVENT_TYPES
from agenticx.managed.sse import PING_FRAME, format_sse

DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def _check_device(value: str) -> str:
    if DEVICE_ID_RE.fullmatch(value) is None:
        raise ValueError("invalid device_id")
    return value


class _DeviceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str

    @field_validator("device_id")
    @classmethod
    def _device(cls, value: str) -> str:
        return _check_device(value)


class PollRequest(_DeviceBody):
    max_wait_seconds: int = Field(default=25, ge=0, le=25)


class CompleteRequest(_DeviceBody):
    consumed_through_seq: int = Field(ge=0)


class FailRequest(_DeviceBody):
    error: str = Field(min_length=1, max_length=2000)


class IngestRequest(_DeviceBody):
    work_id: str = Field(min_length=1)
    events: list[dict[str, Any]] = Field(min_length=1, max_length=100)


def _work_body(row: WorkItemRow) -> dict[str, Any]:
    return {"work": row.to_record().model_dump(mode="json")}


def build_worker_router(state: Any, work_queue: SqliteWorkQueue) -> APIRouter:
    """Build ``/ma/v1`` worker routes. ``state`` is an ``MAHostState``."""
    router = APIRouter(prefix="/ma/v1")

    async def principal_for(request: Request) -> Principal:
        token = bearer_token(request.headers.get("authorization"))
        if token is None:
            raise MAError(UNAUTHORIZED, "missing or invalid bearer token")
        principal = await state.authenticator.authenticate(token)
        if principal is None:
            raise MAError(UNAUTHORIZED, "missing or invalid bearer token")
        return principal

    def _require_worker(principal: Principal) -> None:
        require_scope(principal, "ma:worker")

    @router.post("/environments/{environment_id}/work/poll")
    async def poll_work(
        environment_id: str,
        request: Request,
        body: PollRequest,
    ) -> dict[str, Any]:
        principal = await principal_for(request)
        _require_worker(principal)
        tenant = principal.tenant_id
        environment = await state.registry.get_environment(tenant, environment_id)
        if environment is None:
            raise MAError(ENVIRONMENT_NOT_FOUND, "environment not found")
        if environment.type != "desktop_worker":
            raise MAError(INVALID_REQUEST, "environment is not a desktop worker")
        deadline = time.monotonic() + body.max_wait_seconds
        while True:
            row = work_queue.claim_next(tenant, environment_id, body.device_id)
            if row is not None:
                return await _assignment(state, row)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return {"work": None}
            await work_queue.wait_for_work(environment_id, remaining)

    @router.post("/work/{work_id}/ack")
    async def ack_work(
        work_id: str,
        request: Request,
        body: _DeviceBody,
    ) -> dict[str, Any]:
        principal = await principal_for(request)
        _require_worker(principal)
        row = work_queue.ack(principal.tenant_id, work_id, body.device_id)
        return _work_body(row)

    @router.post("/work/{work_id}/heartbeat")
    async def heartbeat_work(
        work_id: str,
        request: Request,
        body: _DeviceBody,
    ) -> dict[str, Any]:
        principal = await principal_for(request)
        _require_worker(principal)
        row = work_queue.heartbeat(principal.tenant_id, work_id, body.device_id)
        return _work_body(row)

    @router.post("/work/{work_id}/complete")
    async def complete_item(
        work_id: str,
        request: Request,
        body: CompleteRequest,
    ) -> dict[str, Any]:
        principal = await principal_for(request)
        _require_worker(principal)
        row = work_queue.get(principal.tenant_id, work_id)
        if row is None:
            raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
        actor = await state.service.actor_for(principal.tenant_id, row.session_id)
        finished = await complete_work(
            actor,
            work_queue,
            work_id=work_id,
            device_id=body.device_id,
            consumed_through_seq=body.consumed_through_seq,
        )
        return _work_body(finished)

    @router.post("/work/{work_id}/fail")
    async def fail_item(
        work_id: str,
        request: Request,
        body: FailRequest,
    ) -> dict[str, Any]:
        principal = await principal_for(request)
        _require_worker(principal)
        row = work_queue.get(principal.tenant_id, work_id)
        if row is None:
            raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
        actor = await state.service.actor_for(principal.tenant_id, row.session_id)
        finished = await fail_work(
            actor,
            work_queue,
            work_id=work_id,
            device_id=body.device_id,
            error=body.error,
        )
        return _work_body(finished)

    @router.post("/sessions/{session_id}/events:ingest")
    async def ingest_events(
        session_id: str,
        request: Request,
        body: IngestRequest,
    ) -> dict[str, Any]:
        principal = await principal_for(request)
        _require_worker(principal)
        actor = await state.service.actor_for(principal.tenant_id, session_id)
        stored = await ingest_worker_events(
            actor,
            work_queue,
            work_id=body.work_id,
            device_id=body.device_id,
            raw_events=body.events,
        )
        return {"events": [item.to_wire() for item in stored]}

    @router.get("/sessions/{session_id}/inbox/stream")
    async def inbox_stream(
        session_id: str,
        request: Request,
        work_id: str = Query(min_length=1),
        device_id: str = Query(min_length=1),
        after_seq: int | None = Query(default=None, ge=0),
    ) -> StreamingResponse:
        principal = await principal_for(request)
        _require_worker(principal)
        if DEVICE_ID_RE.fullmatch(device_id) is None:
            raise MAError(INVALID_REQUEST, "invalid device_id")
        tenant = principal.tenant_id
        item = work_queue.require_lease(
            tenant,
            work_id,
            device_id,
            statuses=LEASED_STATUSES,
        )
        if item.session_id != session_id:
            raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
        cursor = max(after_seq or 0, item.inbox_after_seq)
        subscription = state.event_log.broadcaster.subscribe(session_id)

        async def generate() -> AsyncIterator[str]:
            replay_cursor = cursor
            try:
                while True:
                    rows = await state.store.list_events(
                        tenant,
                        session_id,
                        after_seq=replay_cursor,
                        limit=500,
                        types=list(CLIENT_EVENT_TYPES),
                    )
                    for row in rows:
                        await state.store.mark_processed(
                            tenant,
                            session_id,
                            [row.id],
                            utc_now_iso(),
                        )
                        yield format_sse(id=row.seq, event=row.type, data=row.to_wire())
                        replay_cursor = row.seq
                    if len(rows) < 500:
                        break
                while True:
                    if subscription.overflowed or await request.is_disconnected():
                        return
                    try:
                        queued = await asyncio.wait_for(
                            subscription.queue.get(),
                            timeout=state.config.sse_ping_seconds,
                        )
                    except TimeoutError:
                        if subscription.overflowed or await request.is_disconnected():
                            return
                        current = work_queue.get(tenant, work_id)
                        if current is None or current.status not in LEASED_STATUSES:
                            return
                        yield PING_FRAME
                        continue
                    if subscription.overflowed or await request.is_disconnected():
                        return
                    if queued.kind == "close":
                        return
                    if queued.kind != "event" or queued.event is None:
                        continue
                    if queued.event.type not in CLIENT_EVENT_TYPES:
                        continue
                    if queued.event.seq <= replay_cursor:
                        continue
                    await state.store.mark_processed(
                        tenant,
                        session_id,
                        [queued.event.id],
                        utc_now_iso(),
                    )
                    yield format_sse(
                        id=queued.event.seq,
                        event=queued.event.type,
                        data=queued.event.to_wire(),
                    )
                    replay_cursor = queued.event.seq
            finally:
                subscription.close()

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache"},
        )

    return router


async def _assignment(state: Any, row: WorkItemRow) -> dict[str, Any]:
    session = await state.store.get_session(row.tenant_id, row.session_id)
    if session is None:
        raise MAError(SESSION_NOT_FOUND, "session not found")
    version = await state.registry.get_version(
        row.tenant_id,
        session.agent_id,
        session.agent_version,
    )
    if version is None:
        raise MAError(AGENT_VERSION_NOT_FOUND, "agent version not found")
    return {
        "work": row.to_record().model_dump(mode="json"),
        "session": session.model_dump(mode="json"),
        "agent": {
            "agent_id": session.agent_id,
            "version": version.version,
            "manifest": version.manifest,
        },
        "inbox_after_seq": row.inbox_after_seq,
    }


__all__ = [
    "DEVICE_ID_RE",
    "build_worker_router",
]
