#!/usr/bin/env python3
"""Internal routes for resource webhook events and delivery records.

Author: Damon Li
"""

from __future__ import annotations

import hmac
from datetime import datetime, timezone
from typing import Any, Mapping

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from agenticx.managed.ids import ULID_RE

from ma_agent_runtime.config import Settings
from ma_agent_runtime.tables import ma_webhook_deliveries
from ma_agent_runtime.webhooks import RESOURCE_EVENT_TYPES, WebhookOutbox

_BODY_KEYS = frozenset(
    {
        "id",
        "tenant_id",
        "type",
        "resource_type",
        "resource_id",
        "agent_id",
        "vault_id",
        "version",
        "occurred_at",
    }
)


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


def _expected_resource_type(event_type: str) -> str:
    if event_type.startswith("vault_credential."):
        return "vault_credential"
    return event_type.split(".", 1)[0]


def _parse_occurred(value: str) -> datetime | None:
    if not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _validate(body: Mapping[str, Any]) -> str | None:
    for key in body:
        if key not in _BODY_KEYS:
            return f"{key}: unknown field"
    event_id = body.get("id")
    if not isinstance(event_id, str) or ULID_RE.fullmatch(event_id) is None:
        return "id: must be a ULID"
    tenant_id = body.get("tenant_id")
    if not isinstance(tenant_id, str) or tenant_id == "":
        return "tenant_id: is required"
    event_type = body.get("type")
    if not isinstance(event_type, str) or event_type not in RESOURCE_EVENT_TYPES:
        return "type: is not a resource event"
    resource_id = body.get("resource_id")
    if not isinstance(resource_id, str) or resource_id == "":
        return "resource_id: is required"
    if "resource_type" in body and body["resource_type"] is not None:
        resource_type = body["resource_type"]
        if not isinstance(resource_type, str) or resource_type != _expected_resource_type(event_type):
            return "resource_type: does not match type"
    for key in ("agent_id", "vault_id"):
        if key not in body or body[key] is None:
            continue
        if not isinstance(body[key], str) or body[key] == "":
            return f"{key}: must be a string"
    if "version" in body and body["version"] is not None:
        version = body["version"]
        if isinstance(version, bool) or not isinstance(version, int):
            return "version: must be an integer"
    if "occurred_at" in body and body["occurred_at"] is not None:
        occurred = body["occurred_at"]
        if not isinstance(occurred, str) or _parse_occurred(occurred) is None:
            return "occurred_at: must be an ISO-8601 timestamp"
    return None


_DELIVERY_FIELDS = (
    "id",
    "webhook_id",
    "event_id",
    "event_type",
    "status",
    "attempts",
    "next_attempt_at",
    "last_status_code",
    "last_error",
    "delivered_at",
    "created_at",
)
_DELIVERY_TIME_FIELDS = frozenset({"next_attempt_at", "delivered_at", "created_at"})


def _iso(value: object) -> str | None:
    if value is None:
        return None
    current: datetime | None
    if isinstance(value, datetime):
        current = value
    elif isinstance(value, str):
        current = _parse_occurred(value)
    else:
        current = None
    if current is None:
        return None
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_limit(raw: str | None) -> int | None:
    if raw is None or raw == "":
        return 50
    if not raw.isdigit():
        return None
    value = int(raw)
    if value < 1 or value > 200:
        return None
    return value


def _delivery_record(row: Mapping[str, Any]) -> dict[str, Any]:
    record: dict[str, Any] = {}
    for key in _DELIVERY_FIELDS:
        value = row[key]
        record[key] = _iso(value) if key in _DELIVERY_TIME_FIELDS else value
    return record


def build_internal_router(settings: Settings, outbox: WebhookOutbox, engine: AsyncEngine) -> APIRouter:
    """Bearer routes for resource events and delivery reads under ``/internal/ma``."""
    router = APIRouter(prefix="/internal/ma")

    @router.post("/webhook-events")
    async def webhook_events(request: Request) -> JSONResponse:
        if not _authorized(request.headers.get("authorization"), settings.internal_token):
            return _error(401, "unauthorized", "invalid internal token")
        try:
            body = await request.json()
        except Exception:
            return _error(400, "invalid_request", "body: must be a JSON object")
        if not isinstance(body, dict):
            return _error(400, "invalid_request", "body: must be a JSON object")
        message = _validate(body)
        if message:
            return _error(400, "invalid_request", message)
        enqueued = await outbox.enqueue_resource_event(body)
        return JSONResponse({"data": {"enqueued": enqueued}})

    @router.get("/webhooks/{webhook_id}/deliveries")
    async def list_deliveries(webhook_id: str, request: Request) -> JSONResponse:
        if not _authorized(request.headers.get("authorization"), settings.internal_token):
            return _error(401, "unauthorized", "invalid internal token")
        tenant_id = request.query_params.get("tenant_id")
        if tenant_id is None or tenant_id.strip() == "":
            return _error(400, "invalid_request", "tenant_id: is required")
        limit = _parse_limit(request.query_params.get("limit"))
        if limit is None:
            return _error(400, "invalid_request", "limit: must be an integer from 1 to 200")
        stmt = (
            select(
                ma_webhook_deliveries.c.id,
                ma_webhook_deliveries.c.webhook_id,
                ma_webhook_deliveries.c.event_id,
                ma_webhook_deliveries.c.event_type,
                ma_webhook_deliveries.c.status,
                ma_webhook_deliveries.c.attempts,
                ma_webhook_deliveries.c.next_attempt_at,
                ma_webhook_deliveries.c.last_status_code,
                ma_webhook_deliveries.c.last_error,
                ma_webhook_deliveries.c.delivered_at,
                ma_webhook_deliveries.c.created_at,
            )
            .where(
                ma_webhook_deliveries.c.tenant_id == tenant_id,
                ma_webhook_deliveries.c.webhook_id == webhook_id,
            )
            .order_by(ma_webhook_deliveries.c.created_at.desc())
            .limit(limit)
        )
        async with engine.connect() as conn:
            found = (await conn.execute(stmt)).mappings().all()
        return JSONResponse({"data": [_delivery_record(row) for row in found]})

    return router


__all__ = ["build_internal_router"]
