#!/usr/bin/env python3
"""FastAPI HTTP control plane for the unified harness control surface.

One API over every registered HarnessAdapter (claude-code, codebuddy,
later codex / opencode / python-agent). Additive to the legacy cc/wb
bridge apps: those keep their own processes, routes and behavior
(master-plan discipline #2). This app is served by
``agx harness-surface serve``.

Author: Damon Li
"""

from __future__ import annotations

import os
import secrets
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.registry import default_registry
from agenticx.harness.settings import HARNESS_SURFACE_HEALTH_SCHEMA
from agenticx.harness.types import (
    CapabilityNotSupported,
    PermissionDecision,
    SessionNotFoundError,
    TurnInProgressError,
    TurnRequest,
    UnknownHarnessError,
)

_registry = default_registry()


def _expected_token() -> str:
    return os.environ.get("HARNESS_SURFACE_TOKEN", "").strip()


def verify_token(request: Request) -> None:
    expected = _expected_token()
    if not expected:
        raise HTTPException(
            status_code=503, detail="HARNESS_SURFACE_TOKEN is not set"
        )
    auth = request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing Bearer token")
    got = auth[7:].strip()
    if not secrets.compare_digest(got, expected):
        raise HTTPException(status_code=403, detail="invalid token")


app = FastAPI(title="AgenticX Harness Control Surface", version="0.1.0")


def _adapter(harness_id: str) -> HarnessAdapter:
    try:
        return _registry.require(harness_id)
    except UnknownHarnessError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _uuid_or_400(session_id: str) -> str:
    import uuid as _uuid

    try:
        return str(_uuid.UUID(session_id))
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="session_id must be a UUID"
        ) from exc


def _describe_or_404(adapter: HarnessAdapter, session_id: str) -> Dict[str, Any]:
    view = adapter.describe(session_id)
    if view is None:
        raise HTTPException(status_code=404, detail="session not found")
    return view


# ----------------------------------------------------------------------
# request / response models
# ----------------------------------------------------------------------
class SessionCreateBody(BaseModel):
    cwd: str = Field(..., description="Working directory for the harness session")
    options: Dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Harness-specific spawn options: claude-code "
            "{mode, auto_allow_permissions}; codebuddy {permission_mode}"
        ),
    )


class TurnBody(BaseModel):
    text: str = Field(..., min_length=1)
    wait_seconds: float = Field(default=180.0, ge=0.0, le=3600.0)
    idempotency_key: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Honored when the adapter declares capabilities.idempotency",
    )


class PermissionBody(BaseModel):
    request_id: str
    allow: bool
    deny_message: str = Field(default="Denied by operator")
    tool_input: Optional[Dict[str, Any]] = None
    tool_use_id: Optional[str] = None


class PtyWriteBody(BaseModel):
    data: str = Field(default="", description="Terminal input (UTF-8)")


class PtyResizeBody(BaseModel):
    cols: int = Field(..., ge=2, le=300)
    rows: int = Field(..., ge=2, le=200)


class TurnResponse(BaseModel):
    harness: str
    session_id: str
    status: str
    ok: bool
    result_text: str = ""
    tail: str = ""
    deduplicated: bool = False
    detail: Dict[str, Any] = Field(default_factory=dict)


# ----------------------------------------------------------------------
# meta
# ----------------------------------------------------------------------
@app.get("/health")
def health() -> Dict[str, str]:
    return {
        "status": "ok",
        "service": "harness-surface",
        "schema": HARNESS_SURFACE_HEALTH_SCHEMA,
    }


@app.get("/v1/harnesses", dependencies=[Depends(verify_token)])
def list_harnesses() -> Dict[str, List[Dict[str, Any]]]:
    out = []
    for d in _registry.descriptors():
        out.append(
            {
                "harness_id": d.harness_id,
                "display_name": d.display_name,
                "description": d.description,
                "available": d.available,
                "capabilities": d.capabilities.as_dict(),
            }
        )
    return {"harnesses": out}


# ----------------------------------------------------------------------
# session lifecycle
# ----------------------------------------------------------------------
@app.post(
    "/v1/harnesses/{harness_id}/sessions",
    dependencies=[Depends(verify_token)],
)
def create_session(harness_id: str, body: SessionCreateBody) -> Dict[str, Any]:
    adapter = _adapter(harness_id)
    try:
        return adapter.spawn(body.cwd, options=dict(body.options or {}))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"harness executable not found: {exc}",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get(
    "/v1/harnesses/{harness_id}/sessions",
    dependencies=[Depends(verify_token)],
)
def list_sessions(harness_id: str) -> Dict[str, List[Dict[str, Any]]]:
    adapter = _adapter(harness_id)
    return {"sessions": adapter.list_sessions()}


@app.get(
    "/v1/harnesses/{harness_id}/sessions/{session_id}",
    dependencies=[Depends(verify_token)],
)
def get_session(harness_id: str, session_id: str) -> Dict[str, Any]:
    adapter = _adapter(harness_id)
    session_id = _uuid_or_400(session_id)
    return _describe_or_404(adapter, session_id)


@app.delete(
    "/v1/harnesses/{harness_id}/sessions/{session_id}",
    dependencies=[Depends(verify_token)],
)
def delete_session(harness_id: str, session_id: str) -> Dict[str, str]:
    adapter = _adapter(harness_id)
    session_id = _uuid_or_400(session_id)
    if not adapter.stop(session_id):
        raise HTTPException(status_code=404, detail="session not found")
    return {"status": "stopped"}


# ----------------------------------------------------------------------
# turns
# ----------------------------------------------------------------------
@app.post(
    "/v1/harnesses/{harness_id}/sessions/{session_id}/turn",
    response_model=TurnResponse,
    dependencies=[Depends(verify_token)],
)
def post_turn(harness_id: str, session_id: str, body: TurnBody) -> TurnResponse:
    adapter = _adapter(harness_id)
    session_id = _uuid_or_400(session_id)
    _describe_or_404(adapter, session_id)
    request = TurnRequest(
        text=body.text,
        wait_seconds=body.wait_seconds,
        idempotency_key=(body.idempotency_key or "").strip(),
    )
    try:
        result = adapter.turn(session_id, request)
    except TurnInProgressError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc
    return TurnResponse(
        harness=result.harness,
        session_id=result.session_id,
        status=result.status,
        ok=result.ok,
        result_text=result.result_text,
        tail=result.tail,
        deduplicated=result.deduplicated,
        detail=dict(result.detail),
    )


# ----------------------------------------------------------------------
# permission (capability-gated)
# ----------------------------------------------------------------------
@app.post(
    "/v1/harnesses/{harness_id}/sessions/{session_id}/permission",
    dependencies=[Depends(verify_token)],
)
def post_permission(
    harness_id: str, session_id: str, body: PermissionBody
) -> Dict[str, str]:
    adapter = _adapter(harness_id)
    session_id = _uuid_or_400(session_id)
    _describe_or_404(adapter, session_id)
    decision = PermissionDecision(
        request_id=body.request_id,
        allow=body.allow,
        deny_message=body.deny_message,
        tool_input=body.tool_input,
        tool_use_id=body.tool_use_id,
    )
    try:
        adapter.permission(session_id, decision)
    except CapabilityNotSupported as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc) or "session closed") from exc
    return {"status": "sent"}


# ----------------------------------------------------------------------
# PTY passthrough (capability-gated)
# ----------------------------------------------------------------------
@app.get(
    "/v1/harnesses/{harness_id}/sessions/{session_id}/stream",
    dependencies=[Depends(verify_token)],
)
def get_stream(harness_id: str, session_id: str) -> StreamingResponse:
    adapter = _adapter(harness_id)
    session_id = _uuid_or_400(session_id)
    _describe_or_404(adapter, session_id)
    try:
        chunks = adapter.iter_stream_chunks(session_id)
    except CapabilityNotSupported as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc
    return StreamingResponse(chunks, media_type="application/octet-stream")


@app.post(
    "/v1/harnesses/{harness_id}/sessions/{session_id}/write",
    dependencies=[Depends(verify_token)],
)
def post_write(harness_id: str, session_id: str, body: PtyWriteBody) -> Dict[str, str]:
    adapter = _adapter(harness_id)
    session_id = _uuid_or_400(session_id)
    _describe_or_404(adapter, session_id)
    try:
        adapter.write_pty(session_id, body.data)
    except CapabilityNotSupported as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post(
    "/v1/harnesses/{harness_id}/sessions/{session_id}/resize",
    dependencies=[Depends(verify_token)],
)
def post_resize(harness_id: str, session_id: str, body: PtyResizeBody) -> Dict[str, str]:
    adapter = _adapter(harness_id)
    session_id = _uuid_or_400(session_id)
    _describe_or_404(adapter, session_id)
    try:
        adapter.resize_pty(session_id, body.rows, body.cols)
    except CapabilityNotSupported as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}
