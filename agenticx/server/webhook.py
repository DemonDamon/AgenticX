"""Webhook routes for external triggers.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Optional

from fastapi import HTTPException, Request  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from agenticx.hooks import HookEvent, trigger_hook_event

WakeHandler = Callable[[Dict[str, Any]], Awaitable[None]]
AgentHandler = Callable[[Dict[str, Any]], Awaitable[None]]


def _extract_token(request: Request, body: Dict[str, Any]) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    if request.headers.get("x-agenticx-token"):
        return request.headers["x-agenticx-token"].strip()
    if isinstance(body.get("token"), str):
        return body["token"].strip()
    return None


def register_webhook_routes(
    app: Any,
    token: str,
    path_prefix: str = "/hooks",
    wake_handler: Optional[WakeHandler] = None,
    agent_handler: Optional[AgentHandler] = None,
) -> None:
    """Register `/wake` and `/agent` webhook endpoints."""

    async def _default_wake_handler(payload: Dict[str, Any]) -> None:
        await trigger_hook_event(
            HookEvent(
                type="command",
                action="wake",
                agent_id=str(payload.get("agent_id", "webhook")),
                session_key=str(payload.get("sessionKey", "")),
                context=payload,
            )
        )

    async def _default_agent_handler(payload: Dict[str, Any]) -> None:
        await trigger_hook_event(
            HookEvent(
                type="command",
                action="agent",
                agent_id=str(payload.get("agent_id", "webhook")),
                session_key=str(payload.get("sessionKey", "")),
                context=payload,
            )
        )

    wake_cb = wake_handler or _default_wake_handler
    agent_cb = agent_handler or _default_agent_handler
    base = path_prefix.rstrip("/")

    @app.post(f"{base}/wake")
    async def webhook_wake(request: Request) -> JSONResponse:
        body = await request.json()
        provided = _extract_token(request, body)
        if provided != token:
            raise HTTPException(status_code=401, detail="Invalid webhook token")
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(status_code=400, detail="`text` is required")
        await wake_cb(body)
        return JSONResponse(status_code=200, content={"ok": True})

    @app.post(f"{base}/agent")
    async def webhook_agent(request: Request) -> JSONResponse:
        body = await request.json()
        provided = _extract_token(request, body)
        if provided != token:
            raise HTTPException(status_code=401, detail="Invalid webhook token")
        message = body.get("message")
        if not isinstance(message, str) or not message.strip():
            raise HTTPException(status_code=400, detail="`message` is required")
        await agent_cb(body)
        return JSONResponse(status_code=200, content={"ok": True, "status": "completed"})

