#!/usr/bin/env python3
"""Memory dream jobs. agent-runtime owns the job row; admin-console owns memory rows.

This is not a managed session and not a system agent. The model call goes through
the host LLM factory, which in production is the enterprise gateway.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
import os
import re
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import httpx
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.engine import Connection, Engine

from agenticx.managed.errors import UNAUTHORIZED, MAError
from agenticx.managed.events.store import EventStore
from agenticx.managed.host.app import MAHostState
from agenticx.managed.host.auth import bearer_token, require_scope
from agenticx.managed.ids import ULID_RE, new_ulid, utc_now_iso
from agenticx.managed.llm import LLMCallContext, LLMFactory
from agenticx.managed.memory_dream import (
    DreamError,
    DreamMemory,
    consolidate,
    transcript_from_events,
)
from agenticx.managed.spec import split_model_ref

from ma_agent_runtime.config import Settings
from ma_agent_runtime.tables import ma_memory_dreams

logger = logging.getLogger(__name__)

DREAM_STATUSES = ("pending", "running", "completed", "failed", "cancelled")
HEARTBEAT_SECONDS = 15
STALE_SECONDS = 120
CLAIM_INTERVAL_SECONDS = 2.0
_MODEL_RE = re.compile(r"^[^/\s]+/\S+$")
_CREATE_KEYS = {
    "input_memory_store_id",
    "session_ids",
    "instructions",
    "model",
    "output_memory_store_name",
    "output_memory_store_description",
}
_INTERNAL_CREATE_KEYS = _CREATE_KEYS | {"tenant_id", "created_by_user_id"}
_WIRE_KEYS = (
    "id",
    "tenant_id",
    "status",
    "input_memory_store_id",
    "output_memory_store_id",
    "session_ids",
    "model",
    "instructions",
    "report",
    "error",
    "created_by",
    "started_at",
    "finished_at",
    "created_at",
)
_MESSAGE_TYPES = ["user.message", "agent.message"]


class ControlPlaneError(Exception):
    """admin-console rejected or failed a dream memory call. The message never includes the token."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return utc_now_iso(value)
    return str(value)


def _json(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


def _row(mapping: Mapping[str, Any]) -> dict[str, Any]:
    data = dict(mapping)
    data["session_ids"] = _json(data.get("session_ids"), [])
    data["report"] = _json(data.get("report"), {})
    data["error"] = _json(data.get("error"), None)
    data["cancel_requested"] = bool(data.get("cancel_requested"))
    for key in ("heartbeat_at", "started_at", "finished_at", "created_at", "updated_at"):
        if key in data:
            data[key] = _iso(data[key])
    return data


def _wire(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: row.get(key) for key in _WIRE_KEYS}


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def _authorized(header: str | None, token: str) -> bool:
    if not header or not token:
        return False
    if not header.lower().startswith("bearer "):
        return False
    provided = header[7:].strip()
    if len(provided) != len(token):
        return False
    return hmac.compare_digest(provided, token)


def _unknown(body: Mapping[str, Any], allowed: set[str]) -> str | None:
    for key in body:
        if key not in allowed:
            return f"{key}: unknown field"
    return None


def _unique_ids(value: Any) -> list[str] | None:
    if not isinstance(value, list):
        return None
    seen: list[str] = []
    found: set[str] = set()
    for item in value:
        if not isinstance(item, str) or item == "":
            return None
        if item in found:
            continue
        found.add(item)
        seen.append(item)
    if not 1 <= len(seen) <= 100:
        return None
    return seen


def _validate_fields(body: Mapping[str, Any]) -> str | None:
    store_id = body.get("input_memory_store_id")
    if not isinstance(store_id, str) or ULID_RE.fullmatch(store_id) is None:
        return "input_memory_store_id: must be a ULID"
    if _unique_ids(body.get("session_ids")) is None:
        return "session_ids: must contain 1-100 unique ids"
    instructions = body.get("instructions")
    if not isinstance(instructions, str) or not 1 <= len(instructions) <= 8000:
        return "instructions: must be 1-8000 characters"
    model = body.get("model")
    if not isinstance(model, str) or _MODEL_RE.fullmatch(model) is None:
        return 'model: must be "<providerId>/<modelName>"'
    name = body.get("output_memory_store_name")
    if not isinstance(name, str) or not 1 <= len(name) <= 255:
        return "output_memory_store_name: must be 1-255 characters"
    if "output_memory_store_description" in body:
        description = body.get("output_memory_store_description")
        if not isinstance(description, str) or len(description) > 1024:
            return "output_memory_store_description: must be at most 1024 characters"
    return None


def _empty_report(session_ids: Sequence[str]) -> dict[str, Any]:
    return {
        "input_memories": 0,
        "sessions_requested": len(session_ids),
        "sessions_used": 0,
        "sessions_missing": [],
        "sessions_empty": [],
        "batches": 0,
        "output_memories": 0,
        "rejected": [],
        "notes": "",
    }


class DreamStore:
    """Sync SQLAlchemy over ma_memory_dreams. Call through asyncio.to_thread."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def _load(self, conn: Connection, dream_id: str, tenant_id: str | None = None) -> dict[str, Any] | None:
        stmt = select(ma_memory_dreams).where(ma_memory_dreams.c.id == dream_id)
        if tenant_id is not None:
            stmt = stmt.where(ma_memory_dreams.c.tenant_id == tenant_id)
        row = conn.execute(stmt).mappings().first()
        if row is None:
            return None
        return _row(row)

    def create(self, row: Mapping[str, Any]) -> dict[str, Any]:
        now = _now()
        values = {
            "id": row.get("id") or new_ulid(),
            "tenant_id": row["tenant_id"],
            "status": row.get("status") or "pending",
            "input_memory_store_id": row["input_memory_store_id"],
            "output_memory_store_id": row["output_memory_store_id"],
            "session_ids": list(row["session_ids"]),
            "instructions": row["instructions"],
            "model": row["model"],
            "report": dict(row.get("report") or {}),
            "error": row.get("error"),
            "cancel_requested": bool(row.get("cancel_requested") or False),
            "created_by": row.get("created_by"),
            "claimed_by": row.get("claimed_by"),
            "heartbeat_at": row.get("heartbeat_at"),
            "started_at": row.get("started_at"),
            "finished_at": row.get("finished_at"),
            "created_at": row.get("created_at") or now,
            "updated_at": row.get("updated_at") or now,
        }
        with self._engine.begin() as conn:
            conn.execute(ma_memory_dreams.insert().values(**values))
            loaded = self._load(conn, str(values["id"]))
        if loaded is None:
            raise RuntimeError("memory dream insert failed")
        return loaded

    def get(self, tenant_id: str, dream_id: str) -> dict[str, Any] | None:
        with self._engine.begin() as conn:
            return self._load(conn, dream_id, tenant_id)

    def list(
        self,
        tenant_id: str,
        *,
        input_memory_store_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        stmt = select(ma_memory_dreams).where(ma_memory_dreams.c.tenant_id == tenant_id)
        if input_memory_store_id:
            stmt = stmt.where(ma_memory_dreams.c.input_memory_store_id == input_memory_store_id)
        stmt = stmt.order_by(ma_memory_dreams.c.created_at.desc(), ma_memory_dreams.c.id.desc()).limit(limit)
        with self._engine.begin() as conn:
            return [_row(row) for row in conn.execute(stmt).mappings()]

    def claim_next(self, worker_id: str) -> dict[str, Any] | None:
        now = _now()
        with self._engine.begin() as conn:
            stmt = (
                select(ma_memory_dreams)
                .where(ma_memory_dreams.c.status == "pending")
                .order_by(ma_memory_dreams.c.created_at, ma_memory_dreams.c.id)
                .limit(1)
            )
            if conn.dialect.name == "postgresql":
                stmt = stmt.with_for_update(skip_locked=True)
            selected = conn.execute(stmt).mappings().first()
            if selected is None:
                return None
            dream_id = str(selected["id"])
            started = selected["started_at"] or now
            updated = conn.execute(
                update(ma_memory_dreams)
                .where(ma_memory_dreams.c.id == dream_id, ma_memory_dreams.c.status == "pending")
                .values(
                    status="running",
                    claimed_by=worker_id,
                    heartbeat_at=now,
                    started_at=started,
                    updated_at=now,
                )
            )
            if updated.rowcount != 1:
                return None
            return self._load(conn, dream_id)

    def requeue_stale(self) -> int:
        cutoff = _now() - timedelta(seconds=STALE_SECONDS)
        with self._engine.begin() as conn:
            updated = conn.execute(
                update(ma_memory_dreams)
                .where(
                    ma_memory_dreams.c.status == "running",
                    ma_memory_dreams.c.heartbeat_at.is_not(None),
                    ma_memory_dreams.c.heartbeat_at < cutoff,
                )
                .values(status="pending", claimed_by=None, updated_at=_now())
            )
        return int(updated.rowcount or 0)

    def heartbeat(self, dream_id: str, worker_id: str) -> bool:
        with self._engine.begin() as conn:
            updated = conn.execute(
                update(ma_memory_dreams)
                .where(
                    ma_memory_dreams.c.id == dream_id,
                    ma_memory_dreams.c.claimed_by == worker_id,
                    ma_memory_dreams.c.status == "running",
                )
                .values(heartbeat_at=_now(), updated_at=_now())
            )
        return updated.rowcount == 1

    def request_cancel(self, tenant_id: str, dream_id: str) -> dict[str, Any] | None:
        now = _now()
        with self._engine.begin() as conn:
            current = self._load(conn, dream_id, tenant_id)
            if current is None:
                return None
            status = current["status"]
            if status == "pending":
                conn.execute(
                    update(ma_memory_dreams)
                    .where(
                        ma_memory_dreams.c.id == dream_id,
                        ma_memory_dreams.c.tenant_id == tenant_id,
                        ma_memory_dreams.c.status == "pending",
                    )
                    .values(status="cancelled", finished_at=now, updated_at=now)
                )
                loaded = self._load(conn, dream_id, tenant_id)
                if loaded is None:
                    return None
                loaded["cancel_transition"] = "pending"
                return loaded
            if status == "running":
                conn.execute(
                    update(ma_memory_dreams)
                    .where(
                        ma_memory_dreams.c.id == dream_id,
                        ma_memory_dreams.c.tenant_id == tenant_id,
                        ma_memory_dreams.c.status == "running",
                    )
                    .values(cancel_requested=True, updated_at=now)
                )
                loaded = self._load(conn, dream_id, tenant_id)
                if loaded is None:
                    return None
                loaded["cancel_transition"] = "running"
                return loaded
            return current

    def is_cancel_requested(self, dream_id: str) -> bool:
        with self._engine.begin() as conn:
            row = conn.execute(
                select(ma_memory_dreams.c.cancel_requested).where(ma_memory_dreams.c.id == dream_id)
            ).first()
        if row is None:
            return False
        return bool(row[0])

    def finish(
        self,
        dream_id: str,
        worker_id: str,
        *,
        status: str,
        report: Mapping[str, Any],
        error: Mapping[str, Any] | None,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                update(ma_memory_dreams)
                .where(
                    ma_memory_dreams.c.id == dream_id,
                    ma_memory_dreams.c.claimed_by == worker_id,
                    ma_memory_dreams.c.status == "running",
                )
                .values(
                    status=status,
                    report=dict(report),
                    error=dict(error) if error is not None else None,
                    finished_at=_now(),
                    updated_at=_now(),
                )
            )


class DreamControlPlaneClient:
    """admin-console internal memory endpoints. The bearer token is never logged."""

    def __init__(
        self,
        base_url: str,
        internal_token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = internal_token
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=30.0,
            trust_env=False,
            transport=transport,
            headers={"Authorization": f"Bearer {internal_token}"},
        )

    def __repr__(self) -> str:
        return f"DreamControlPlaneClient(base_url={self._base_url!r})"

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, str] | None = None,
        json_body: Mapping[str, Any] | None = None,
    ) -> Any:
        try:
            response = await self._http.request(method, path, params=params, json=json_body)
        except httpx.HTTPError:
            raise ControlPlaneError(0, "internal_error", "memory control plane request failed") from None
        if response.status_code >= 400:
            code = "internal_error"
            message = "memory control plane request failed"
            try:
                payload = response.json()
            except Exception:
                payload = None
            if isinstance(payload, dict):
                error = payload.get("error")
                if isinstance(error, dict):
                    if isinstance(error.get("code"), str):
                        code = error["code"]
                    if isinstance(error.get("message"), str):
                        message = error["message"]
            raise ControlPlaneError(response.status_code, code, message)
        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except Exception:
            raise ControlPlaneError(response.status_code, "internal_error", "memory control plane request failed") from None

    async def export_store(self, tenant_id: str, store_id: str) -> list[DreamMemory]:
        body = await self._request(
            "GET",
            f"/api/internal/ma/memory-stores/{store_id}/export",
            params={"tenant_id": tenant_id},
        )
        memories = body.get("memories") if isinstance(body, dict) else None
        if not isinstance(memories, list):
            raise ControlPlaneError(200, "internal_error", "memory control plane request failed")
        out: list[DreamMemory] = []
        for item in memories:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str) or not isinstance(item.get("content"), str):
                raise ControlPlaneError(200, "internal_error", "memory control plane request failed")
            out.append(DreamMemory(path=item["path"], content=item["content"]))
        return out

    async def create_output_store(
        self,
        tenant_id: str,
        *,
        input_memory_store_id: str,
        name: str,
        description: str | None,
        dream_id: str,
        created_by_user_id: str | None,
    ) -> str:
        payload: dict[str, Any] = {
            "tenant_id": tenant_id,
            "input_memory_store_id": input_memory_store_id,
            "name": name,
            "dream_id": dream_id,
        }
        if description is not None:
            payload["description"] = description
        if created_by_user_id is not None:
            payload["created_by_user_id"] = created_by_user_id
        body = await self._request("POST", "/api/internal/ma/memory-stores/dream-output", json_body=payload)
        store = body.get("memory_store") if isinstance(body, dict) else None
        store_id = store.get("id") if isinstance(store, dict) else None
        if not isinstance(store_id, str) or store_id == "":
            raise ControlPlaneError(200, "internal_error", "memory control plane request failed")
        return store_id

    async def finish_output_store(
        self,
        tenant_id: str,
        store_id: str,
        *,
        dream_id: str,
        outcome: Literal["completed", "failed", "cancelled"],
        memories: Sequence[DreamMemory],
        actor_user_id: str | None,
    ) -> None:
        payload: dict[str, Any] = {
            "tenant_id": tenant_id,
            "dream_id": dream_id,
            "outcome": outcome,
            "memories": [{"path": item.path, "content": item.content} for item in memories],
            "actor_user_id": actor_user_id,
        }
        await self._request(
            "POST",
            f"/api/internal/ma/memory-stores/{store_id}/dream-finish",
            json_body=payload,
        )


class DreamService:
    """Create, list, and cancel dreams. Public and internal routes share this."""

    def __init__(self, store: DreamStore, client: DreamControlPlaneClient) -> None:
        self._store = store
        self._client = client

    async def create(self, tenant_id: str, created_by_user_id: str | None, body: Mapping[str, Any]) -> JSONResponse:
        message = _validate_fields(body)
        if message:
            return _error(400, "invalid_request", message)
        session_ids = _unique_ids(body["session_ids"])
        if session_ids is None:
            return _error(400, "invalid_request", "session_ids: must contain 1-100 unique ids")
        description = body.get("output_memory_store_description")
        dream_id = new_ulid()
        try:
            output_id = await self._client.create_output_store(
                tenant_id,
                input_memory_store_id=str(body["input_memory_store_id"]),
                name=str(body["output_memory_store_name"]),
                description=description if isinstance(description, str) else None,
                dream_id=dream_id,
                created_by_user_id=created_by_user_id,
            )
        except ControlPlaneError as exc:
            safe = exc.message if "bearer " not in exc.message.lower() else "memory control plane request failed"
            status = exc.status if 400 <= exc.status <= 599 else 502
            return _error(status, exc.code or "internal_error", safe)
        try:
            row = await asyncio.to_thread(
                self._store.create,
                {
                    "id": dream_id,
                    "tenant_id": tenant_id,
                    "status": "pending",
                    "input_memory_store_id": body["input_memory_store_id"],
                    "output_memory_store_id": output_id,
                    "session_ids": session_ids,
                    "instructions": body["instructions"],
                    "model": body["model"],
                    "created_by": created_by_user_id,
                },
            )
        except Exception:
            logger.exception("memory dream insert failed")
            try:
                await self._client.finish_output_store(
                    tenant_id,
                    output_id,
                    dream_id=dream_id,
                    outcome="failed",
                    memories=[],
                    actor_user_id=created_by_user_id,
                )
            except Exception:
                logger.exception("memory dream output cleanup failed")
            return _error(500, "internal_error", "internal error")
        return JSONResponse(status_code=201, content={"memory_dream": _wire(row)})

    async def get(self, tenant_id: str, dream_id: str) -> JSONResponse:
        row = await asyncio.to_thread(self._store.get, tenant_id, dream_id)
        if row is None:
            return _error(404, "memory_dream_not_found", "memory dream not found")
        return JSONResponse({"memory_dream": _wire(row)})

    async def list(self, tenant_id: str, memory_store_id: str | None, limit: int) -> JSONResponse:
        rows = await asyncio.to_thread(
            self._store.list,
            tenant_id,
            input_memory_store_id=memory_store_id,
            limit=limit,
        )
        return JSONResponse({"data": [_wire(row) for row in rows]})

    async def cancel(self, tenant_id: str, dream_id: str) -> JSONResponse:
        row = await asyncio.to_thread(self._store.request_cancel, tenant_id, dream_id)
        if row is None:
            return _error(404, "memory_dream_not_found", "memory dream not found")
        transition = row.pop("cancel_transition", None)
        if transition == "pending":
            try:
                await self._client.finish_output_store(
                    tenant_id,
                    str(row["output_memory_store_id"]),
                    dream_id=dream_id,
                    outcome="cancelled",
                    memories=[],
                    actor_user_id=row.get("created_by") if isinstance(row.get("created_by"), str) else None,
                )
            except Exception:
                logger.exception("memory dream cancel archive failed")
        return JSONResponse({"memory_dream": _wire(row)})


class DreamRunner:
    """Claim pending dreams, consolidate them, and write one terminal status."""

    def __init__(
        self,
        *,
        store: DreamStore,
        events: EventStore,
        client: DreamControlPlaneClient,
        llm_factory: LLMFactory,
        timeout_seconds: float,
        worker_id: str,
        max_concurrent: int = 1,
        claim_interval_seconds: float = CLAIM_INTERVAL_SECONDS,
    ) -> None:
        self._store = store
        self._events = events
        self._client = client
        self._llm_factory = llm_factory
        self._timeout = timeout_seconds
        self._worker_id = worker_id[:64]
        self._max_concurrent = max(1, max_concurrent)
        self._claim_interval = claim_interval_seconds
        self._stopped = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stopped.clear()
        self._task = asyncio.create_task(self._loop(), name="memory-dream-runner")

    async def stop(self) -> None:
        self._stopped.set()
        task = self._task
        self._task = None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def _loop(self) -> None:
        inflight: set[asyncio.Task[None]] = set()
        while not self._stopped.is_set():
            try:
                await asyncio.to_thread(self._store.requeue_stale)
            except Exception:
                logger.exception("memory dream requeue failed")
            while len(inflight) < self._max_concurrent and not self._stopped.is_set():
                try:
                    dream = await asyncio.to_thread(self._store.claim_next, self._worker_id)
                except Exception:
                    logger.exception("memory dream claim failed")
                    dream = None
                if dream is None:
                    break
                inflight.add(asyncio.create_task(self._run(dream), name=f"memory-dream-{dream['id']}"))
            if not inflight:
                try:
                    await asyncio.wait_for(self._stopped.wait(), timeout=self._claim_interval)
                except asyncio.TimeoutError:
                    pass
                continue
            done, inflight = await asyncio.wait(
                inflight,
                timeout=self._claim_interval,
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in done:
                with contextlib.suppress(asyncio.CancelledError):
                    exc = task.exception()
                    if exc is not None:
                        logger.error("memory dream task failed: %s", type(exc).__name__)

    async def _run(self, dream: dict[str, Any]) -> None:
        dream_id = str(dream["id"])
        work = asyncio.create_task(self._execute(dream), name=f"memory-dream-exec-{dream_id}")
        beats = asyncio.create_task(self._beats(dream_id, work), name=f"memory-dream-beat-{dream_id}")
        await asyncio.wait({work, beats}, return_when=asyncio.FIRST_COMPLETED)
        if not work.done():
            work.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await work
            beats.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beats
            return
        beats.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await beats
        with contextlib.suppress(asyncio.CancelledError):
            exc = work.exception()
            if exc is not None:
                logger.error("memory dream execution failed: %s", type(exc).__name__)

    async def _beats(self, dream_id: str, work: asyncio.Task[None]) -> None:
        while not work.done():
            try:
                await asyncio.wait_for(asyncio.shield(work), timeout=HEARTBEAT_SECONDS)
                return
            except asyncio.TimeoutError:
                ok = await asyncio.to_thread(self._store.heartbeat, dream_id, self._worker_id)
                if not ok:
                    return

    async def _execute(self, dream: dict[str, Any]) -> None:
        tenant = str(dream["tenant_id"])
        dream_id = str(dream["id"])
        session_ids = [str(item) for item in dream.get("session_ids") or []]
        report = _empty_report(session_ids)
        actor = dream.get("created_by") if isinstance(dream.get("created_by"), str) else None
        try:
            try:
                memories = await self._client.export_store(tenant, str(dream["input_memory_store_id"]))
            except ControlPlaneError as exc:
                if exc.status in (413, 409) and exc.code == "memory_store_limit":
                    raise DreamError(
                        "input_too_large",
                        "input memory store exceeds the dream limit (300 memories / 200 KiB)",
                    ) from None
                raise
            report["input_memories"] = len(memories)
            transcripts = []
            missing: list[str] = []
            empty: list[str] = []
            for session_id in session_ids:
                record = await self._events.get_session(tenant, session_id)
                if record is None:
                    missing.append(session_id)
                    continue
                rows = await self._message_events(tenant, session_id)
                transcript = transcript_from_events(
                    session_id,
                    record.title,
                    [event.to_wire() for event in rows],
                )
                if transcript is None:
                    empty.append(session_id)
                    continue
                transcripts.append(transcript)
            report["sessions_missing"] = missing
            report["sessions_empty"] = empty
            report["sessions_used"] = len(transcripts)
            provider, model_name = split_model_ref(str(dream["model"]))
            llm = self._llm_factory.create(
                provider=provider,
                model=model_name,
                context=LLMCallContext(
                    tenant_id=tenant,
                    session_id=dream_id,
                    agent_id="ma.memory_dream",
                    agent_version=1,
                    user_id=actor,
                ),
            )

            async def invoke(messages: list[dict[str, str]]) -> str:
                def call() -> str:
                    response = llm.invoke(messages)
                    content = getattr(response, "content", None)
                    return str(content or "")

                return await asyncio.to_thread(call)

            try:
                outcome = await asyncio.wait_for(
                    consolidate(
                        memories=memories,
                        transcripts=transcripts,
                        instructions=str(dream["instructions"]),
                        invoke=invoke,
                        should_stop=lambda: self._store.is_cancel_requested(dream_id),
                    ),
                    timeout=self._timeout,
                )
            except asyncio.TimeoutError:
                raise DreamError("timeout", "dream exceeded the time limit") from None
            report["batches"] = outcome.batches
            report["output_memories"] = len(outcome.memories)
            report["rejected"] = list(outcome.rejected[:100])
            report["notes"] = outcome.notes
            await self._close_output(dream, "completed", outcome.memories)
            await self._finish(dream_id, "completed", report, None)
        except asyncio.CancelledError:
            raise
        except DreamError as exc:
            outcome_name: Literal["cancelled", "failed"] = "cancelled" if exc.error_type == "cancelled" else "failed"
            await self._close_output(dream, outcome_name, [])
            await self._finish(dream_id, outcome_name, report, {"type": exc.error_type, "message": exc.message})
        except Exception as exc:
            logger.exception("memory dream failed")
            await self._close_output(dream, "failed", [])
            await self._finish(
                dream_id,
                "failed",
                report,
                {"type": "internal_error", "message": type(exc).__name__},
            )

    async def _message_events(self, tenant_id: str, session_id: str) -> list[Any]:
        rows: list[Any] = []
        after = 0
        while True:
            page = await self._events.list_events(
                tenant_id,
                session_id,
                after_seq=after,
                limit=500,
                types=_MESSAGE_TYPES,
            )
            if not page:
                return rows
            rows.extend(page)
            after = int(page[-1].seq)
            if len(page) < 500:
                return rows

    async def _close_output(
        self,
        dream: Mapping[str, Any],
        outcome: Literal["completed", "failed", "cancelled"],
        memories: Sequence[DreamMemory],
    ) -> None:
        actor = dream.get("created_by") if isinstance(dream.get("created_by"), str) else None
        try:
            await self._client.finish_output_store(
                str(dream["tenant_id"]),
                str(dream["output_memory_store_id"]),
                dream_id=str(dream["id"]),
                outcome=outcome,
                memories=memories,
                actor_user_id=actor,
            )
        except Exception:
            logger.exception("memory dream output finish failed for %s", dream.get("id"))

    async def _finish(
        self,
        dream_id: str,
        status: str,
        report: Mapping[str, Any],
        error: Mapping[str, Any] | None,
    ) -> None:
        try:
            await asyncio.to_thread(
                self._store.finish,
                dream_id,
                self._worker_id,
                status=status,
                report=report,
                error=error,
            )
        except Exception:
            logger.exception("memory dream status write failed for %s", dream_id)


def _limit(raw: str | None) -> int | JSONResponse:
    if raw is None or raw == "":
        return 20
    if not raw.isdigit():
        return _error(400, "invalid_request", "limit must be between 1 and 100")
    value = int(raw)
    if not 1 <= value <= 100:
        return _error(400, "invalid_request", "limit must be between 1 and 100")
    return value


def build_public_router(*, state: MAHostState, service: DreamService) -> APIRouter:
    """PAT routes under /ma/v1. memory_dream_not_found stays out of ALL_ERROR_CODES."""
    router = APIRouter(prefix="/ma/v1")

    async def current_principal(request: Request) -> Any:
        token = bearer_token(request.headers.get("authorization"))
        if token is None:
            raise MAError(UNAUTHORIZED, "missing or invalid bearer token")
        principal = await state.authenticator.authenticate(token)
        if principal is None:
            raise MAError(UNAUTHORIZED, "missing or invalid bearer token")
        return principal

    @router.post("/memory_dreams")
    async def create_dream(request: Request) -> JSONResponse:
        principal = await current_principal(request)
        require_scope(principal, "ma:memory:write")
        require_scope(principal, "ma:sessions:read")
        try:
            body = await request.json()
        except Exception:
            return _error(400, "invalid_request", "body: must be a JSON object")
        if not isinstance(body, dict):
            return _error(400, "invalid_request", "body: must be a JSON object")
        unknown = _unknown(body, _CREATE_KEYS)
        if unknown:
            return _error(400, "invalid_request", unknown)
        return await service.create(principal.tenant_id, principal.user_id, body)

    @router.get("/memory_dreams")
    async def list_dreams(request: Request) -> JSONResponse:
        principal = await current_principal(request)
        require_scope(principal, "ma:memory:read")
        limit = _limit(request.query_params.get("limit"))
        if isinstance(limit, JSONResponse):
            return limit
        store_id = request.query_params.get("memory_store_id") or None
        return await service.list(principal.tenant_id, store_id, limit)

    @router.get("/memory_dreams/{dream_id}")
    async def get_dream(dream_id: str, request: Request) -> JSONResponse:
        principal = await current_principal(request)
        require_scope(principal, "ma:memory:read")
        return await service.get(principal.tenant_id, dream_id)

    @router.post("/memory_dreams/{dream_id}/cancel")
    async def cancel_dream(dream_id: str, request: Request) -> JSONResponse:
        principal = await current_principal(request)
        require_scope(principal, "ma:memory:write")
        return await service.cancel(principal.tenant_id, dream_id)

    return router


def build_internal_router(*, service: DreamService, internal_token: str) -> APIRouter:
    """Bearer routes under /internal/ma for the admin console."""
    router = APIRouter(prefix="/internal/ma")

    def unauthorized() -> JSONResponse:
        return _error(401, "unauthorized", "invalid internal token")

    @router.post("/memory-dreams")
    async def create_dream(request: Request) -> JSONResponse:
        if not _authorized(request.headers.get("authorization"), internal_token):
            return unauthorized()
        try:
            body = await request.json()
        except Exception:
            return _error(400, "invalid_request", "body: must be a JSON object")
        if not isinstance(body, dict):
            return _error(400, "invalid_request", "body: must be a JSON object")
        unknown = _unknown(body, _INTERNAL_CREATE_KEYS)
        if unknown:
            return _error(400, "invalid_request", unknown)
        tenant_id = body.get("tenant_id")
        if not isinstance(tenant_id, str) or tenant_id == "":
            return _error(400, "invalid_request", "tenant_id: is required")
        created_by = body.get("created_by_user_id")
        if created_by is not None and not isinstance(created_by, str):
            return _error(400, "invalid_request", "created_by_user_id: must be a string")
        return await service.create(tenant_id, created_by if isinstance(created_by, str) else None, body)

    @router.post("/memory-dreams/{dream_id}/cancel")
    async def cancel_dream(dream_id: str, request: Request) -> JSONResponse:
        if not _authorized(request.headers.get("authorization"), internal_token):
            return unauthorized()
        try:
            body = await request.json()
        except Exception:
            return _error(400, "invalid_request", "body: must be a JSON object")
        if not isinstance(body, dict):
            return _error(400, "invalid_request", "body: must be a JSON object")
        unknown = _unknown(body, {"tenant_id"})
        if unknown:
            return _error(400, "invalid_request", unknown)
        tenant_id = body.get("tenant_id")
        if not isinstance(tenant_id, str) or tenant_id == "":
            return _error(400, "invalid_request", "tenant_id: is required")
        return await service.cancel(tenant_id, dream_id)

    return router


def wire_dreams(
    app: FastAPI,
    *,
    sync_engine: Engine,
    llm_factory: LLMFactory,
    settings: Settings,
) -> None:
    """Mount dream routes and start the runner when dreams are enabled."""
    store = DreamStore(sync_engine)
    client = DreamControlPlaneClient(settings.admin_url, settings.internal_token)
    service = DreamService(store, client)
    runner = DreamRunner(
        store=store,
        events=app.state.ma.store,
        client=client,
        llm_factory=llm_factory,
        timeout_seconds=settings.dream_timeout_seconds,
        worker_id=f"dream-{os.getpid()}"[:64],
        max_concurrent=settings.dream_max_concurrent,
    )
    app.include_router(build_public_router(state=app.state.ma, service=service))
    app.include_router(build_internal_router(service=service, internal_token=settings.internal_token))

    async def _shutdown() -> None:
        await runner.stop()
        await client.aclose()

    app.state.ma.startup_hooks.append(runner.start)
    app.state.ma.shutdown_hooks.append(_shutdown)
    app.state.ma.extras["dream_runner"] = runner
    app.state.ma.extras["dream_store"] = store
    app.state.ma.extras["dream_service"] = service


__all__ = [
    "CLAIM_INTERVAL_SECONDS",
    "DREAM_STATUSES",
    "HEARTBEAT_SECONDS",
    "STALE_SECONDS",
    "ControlPlaneError",
    "DreamControlPlaneClient",
    "DreamRunner",
    "DreamService",
    "DreamStore",
    "build_internal_router",
    "build_public_router",
    "wire_dreams",
]

