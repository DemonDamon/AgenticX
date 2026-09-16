"""Studio inbound route for normalized change-plane webhooks.

Author: Damon Li
"""

from __future__ import annotations

import hmac
import os
from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse

from agenticx.ops.changeplane.webhook import apply_webhook_payload

router = APIRouter()


def _webhook_secret() -> str:
    return str(os.environ.get("AGENTICX_CHANGEPLANE_WEBHOOK_SECRET") or "").strip()


def _presented_secret(request: Request) -> str:
    header = str(request.headers.get("X-AgenticX-Webhook-Secret") or "").strip()
    if header:
        return header
    auth = str(request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def _secrets_match(expected: str, presented: str) -> bool:
    if not expected or not presented:
        return False
    if len(expected) != len(presented):
        return False
    return hmac.compare_digest(expected, presented)


@router.post("/api/ops/changeplane/webhook")
async def changeplane_webhook(request: Request) -> JSONResponse:
    secret = _webhook_secret()
    if not secret:
        return JSONResponse(
            {"ok": False, "reason": "webhook_disabled", "items": []},
            status_code=403,
        )
    if not _secrets_match(secret, _presented_secret(request)):
        return JSONResponse(
            {"ok": False, "reason": "webhook_disabled", "items": []},
            status_code=403,
        )
    try:
        body: Any = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "reason": "invalid_body"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"ok": False, "reason": "invalid_body"}, status_code=400)
    event = apply_webhook_payload(body)
    if event is None:
        return JSONResponse({"ok": True, "reason": "ignored", "items": []})
    return JSONResponse(
        {"ok": True, "reason": "", "deployment_id": event.deployment_id}
    )


def mount_changeplane_routes(app: FastAPI) -> None:
    app.include_router(router)
