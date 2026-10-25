#!/usr/bin/env python3
"""HTTP routes for the Managed Agents session API.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import StreamingResponse

from agenticx.managed.errors import FORBIDDEN_SCOPE, INVALID_REQUEST, MAError, UNAUTHORIZED
from agenticx.managed.events.store import ThreadFilter
from agenticx.managed.host.auth import bearer_token, require_scope
from agenticx.managed.host.config import Principal
from agenticx.managed.host.models import CreateSessionRequest, session_to_wire
from agenticx.managed.protocol import PROTOCOL_VERSION
from agenticx.managed.sse import PING_FRAME, format_sse

if TYPE_CHECKING:
    from agenticx.managed.host.app import MAHostState

_PREVIEW_DELTA_TYPES = frozenset({"agent.message"})


def _stream_cursor(after_seq: int | None, last_event_id: str | None) -> int:
    cursor = 0
    if after_seq is not None:
        cursor = max(cursor, after_seq)
    if last_event_id is not None and last_event_id.strip() != "":
        header = last_event_id.strip()
        if not header.isdigit():
            raise MAError(INVALID_REQUEST, "Last-Event-ID must be an integer seq")
        cursor = max(cursor, int(header))
    return cursor


async def _sse_stream(
    state: MAHostState,
    principal: Principal,
    session_id: str,
    *,
    cursor: int,
    want_previews: frozenset[str],
    thread_filter: ThreadFilter,
    archived: bool,
    request: Request,
    subscription: Any,
) -> AsyncIterator[str]:
    """Replay then live SSE. Non-matching live events advance the cursor only."""
    replay_cursor = cursor
    try:
        while True:
            rows = await state.store.list_events(
                principal.tenant_id,
                session_id,
                after_seq=replay_cursor,
                limit=500,
                thread_filter=thread_filter,
            )
            for row in rows:
                yield format_sse(id=row.seq, event=row.type, data=row.to_wire())
                replay_cursor = row.seq
            if len(rows) < 500:
                break
        if archived:
            return
        while True:
            if subscription.overflowed or await request.is_disconnected():
                return
            try:
                item = await asyncio.wait_for(
                    subscription.queue.get(),
                    timeout=state.config.sse_ping_seconds,
                )
            except TimeoutError:
                if subscription.overflowed or await request.is_disconnected():
                    return
                yield PING_FRAME
                continue
            if subscription.overflowed or await request.is_disconnected():
                return
            if item.kind == "close":
                return
            if item.kind == "preview":
                if not want_previews:
                    continue
                frame = item.frame or {}
                event_obj = frame.get("event")
                nested = event_obj.get("type") if isinstance(event_obj, dict) else None
                kind = frame.get("event_type") or nested
                if kind in want_previews and isinstance(frame.get("type"), str):
                    yield format_sse(event=str(frame["type"]), data=dict(frame))
                continue
            event = item.event
            if event is None or event.seq <= replay_cursor:
                continue
            if not thread_filter.matches(event):
                replay_cursor = max(replay_cursor, event.seq)
                continue
            if event.seq > replay_cursor + 1:
                gap = await state.store.list_events(
                    principal.tenant_id,
                    session_id,
                    after_seq=replay_cursor,
                    limit=500,
                    thread_filter=thread_filter,
                )
                for row in gap:
                    if row.seq >= event.seq:
                        break
                    yield format_sse(id=row.seq, event=row.type, data=row.to_wire())
                    replay_cursor = row.seq
            yield format_sse(id=event.seq, event=event.type, data=event.to_wire())
            replay_cursor = event.seq
    finally:
        subscription.close()


def build_session_router(state: MAHostState) -> APIRouter:
    """Build the ``/ma/v1`` router bound to ``state``."""
    router = APIRouter(prefix="/ma/v1")

    async def current_principal(request: Request) -> Principal:
        token = bearer_token(request.headers.get("authorization"))
        if token is None:
            raise MAError(UNAUTHORIZED, "missing or invalid bearer token")
        principal = await state.authenticator.authenticate(token)
        if principal is None:
            raise MAError(UNAUTHORIZED, "missing or invalid bearer token")
        return principal

    @router.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "protocol_version": PROTOCOL_VERSION,
            "dev": state.config.dev,
        }

    @router.post("/sessions", status_code=201)
    async def create_session(request: Request, body: CreateSessionRequest) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:write")
        record = await state.service.create_session(principal, body)
        return session_to_wire(record)

    @router.get("/sessions")
    async def list_sessions(
        request: Request,
        agent_id: str | None = None,
        limit: int = 20,
        scope: str = "mine",
    ) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        if scope not in ("mine", "tenant"):
            raise MAError(INVALID_REQUEST, "scope must be mine or tenant")
        if scope == "tenant" and "ma:admin" not in principal.scopes:
            raise MAError(
                FORBIDDEN_SCOPE,
                "scope=tenant requires ma:admin",
                details={"scope": "ma:admin"},
            )
        if limit < 1 or limit > 100:
            raise MAError(INVALID_REQUEST, "limit must be between 1 and 100")
        records = await state.service.list_sessions(
            principal,
            agent_id=agent_id or None,
            limit=limit,
            all_users=scope == "tenant",
        )
        return {"data": [session_to_wire(record) for record in records]}

    @router.get("/sessions/{session_id}")
    async def get_session(session_id: str, request: Request) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        record = await state.service.get_session(principal, session_id)
        return session_to_wire(record)

    @router.post("/sessions/{session_id}/events")
    async def post_events(
        session_id: str,
        request: Request,
        body: Any = Body(...),
    ) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:write")
        stored = await state.service.post_events(principal, session_id, body)
        return {"events": [item.to_wire() for item in stored]}

    @router.get("/sessions/{session_id}/events")
    async def list_events(
        session_id: str,
        request: Request,
        after_seq: int = Query(default=0, ge=0),
        limit: int = Query(default=100, ge=1, le=500),
        types: list[str] = Query(default_factory=list),
    ) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        rows, has_more = await state.service.list_events(
            principal,
            session_id,
            after_seq=after_seq,
            limit=limit,
            types=types,
        )
        next_after_seq = rows[-1].seq if rows else after_seq
        return {
            "data": [row.to_wire() for row in rows],
            "has_more": has_more,
            "next_after_seq": next_after_seq,
        }

    @router.get("/sessions/{session_id}/events/stream")
    async def stream_events(
        session_id: str,
        request: Request,
        after_seq: int | None = Query(default=None, ge=0),
        event_deltas: list[str] = Query(default_factory=list, alias="event_deltas[]"),
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    ) -> StreamingResponse:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        cursor = _stream_cursor(after_seq, last_event_id)
        want = _PREVIEW_DELTA_TYPES & set(event_deltas)
        record = await state.service.get_session(principal, session_id)
        subscription = state.event_log.broadcaster.subscribe(session_id)
        return StreamingResponse(
            _sse_stream(
                state,
                principal,
                session_id,
                cursor=cursor,
                want_previews=frozenset(want),
                thread_filter=ThreadFilter("session"),
                archived=record.status == "archived",
                request=request,
                subscription=subscription,
            ),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @router.get("/sessions/{session_id}/tasks")
    async def list_tasks(
        session_id: str,
        request: Request,
        task_state: str | None = Query(default=None, alias="state"),
        limit: int = Query(default=20, ge=1, le=100),
    ) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        records = await state.service.list_tasks(
            principal,
            session_id,
            state=task_state,
            limit=limit,
        )
        return {"data": [item.to_wire(include_output=False) for item in records]}

    @router.get("/sessions/{session_id}/tasks/{task_id}")
    async def get_task(session_id: str, task_id: str, request: Request) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        record = await state.service.get_task(principal, session_id, task_id)
        return {"task": record.to_wire(include_output=True)}

    @router.post("/sessions/{session_id}/tasks/{task_id}/cancel")
    async def cancel_task(session_id: str, task_id: str, request: Request) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:write")
        record = await state.service.cancel_task(principal, session_id, task_id)
        return {"task": record.to_wire(include_output=False)}

    @router.get("/sessions/{session_id}/threads")
    async def list_threads(
        session_id: str,
        request: Request,
        include_archived: bool = Query(default=False),
    ) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        rows = await state.service.list_threads(
            principal,
            session_id,
            include_archived=include_archived,
        )
        return {"data": rows}

    @router.get("/sessions/{session_id}/threads/{thread_id}")
    async def get_thread(session_id: str, thread_id: str, request: Request) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        thread = await state.service.get_thread(principal, session_id, thread_id)
        return {"thread": thread}

    @router.get("/sessions/{session_id}/threads/{thread_id}/events")
    async def list_thread_events(
        session_id: str,
        thread_id: str,
        request: Request,
        after_seq: int = Query(default=0, ge=0),
        limit: int = Query(default=100, ge=1, le=500),
        types: list[str] = Query(default_factory=list),
    ) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        rows, has_more = await state.service.list_thread_events(
            principal,
            session_id,
            thread_id,
            after_seq=after_seq,
            limit=limit,
            types=types,
        )
        next_after_seq = rows[-1].seq if rows else after_seq
        return {
            "data": [row.to_wire() for row in rows],
            "has_more": has_more,
            "next_after_seq": next_after_seq,
        }

    @router.get("/sessions/{session_id}/threads/{thread_id}/events/stream")
    async def stream_thread_events(
        session_id: str,
        thread_id: str,
        request: Request,
        after_seq: int | None = Query(default=None, ge=0),
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    ) -> StreamingResponse:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:read")
        cursor = _stream_cursor(after_seq, last_event_id)
        record = await state.service.get_session(principal, session_id)
        await state.service.get_thread(principal, session_id, thread_id)
        subscription = state.event_log.broadcaster.subscribe(session_id)
        thread_filter = ThreadFilter("thread", None if thread_id == session_id else thread_id)
        return StreamingResponse(
            _sse_stream(
                state,
                principal,
                session_id,
                cursor=cursor,
                want_previews=frozenset(),
                thread_filter=thread_filter,
                archived=record.status == "archived",
                request=request,
                subscription=subscription,
            ),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @router.post("/sessions/{session_id}/threads/{thread_id}/archive")
    async def archive_thread(session_id: str, thread_id: str, request: Request) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:write")
        thread = await state.service.archive_thread(principal, session_id, thread_id)
        return {"thread": thread}

    @router.post("/sessions/{session_id}/archive")
    async def archive_session(session_id: str, request: Request) -> dict[str, Any]:
        principal = await current_principal(request)
        require_scope(principal, "ma:sessions:write")
        record = await state.service.archive(principal, session_id)
        return session_to_wire(record)

    return router


__all__ = [
    "build_session_router",
]
