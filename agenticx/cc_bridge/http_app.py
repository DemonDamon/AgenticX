#!/usr/bin/env python3
"""FastAPI HTTP control plane for the local Claude Code bridge.

Author: Damon Li
"""

from __future__ import annotations

import os
import secrets
import uuid
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agenticx.cc_bridge.session_manager import BridgeSessionManager

_manager = BridgeSessionManager()


def _expected_token() -> str:
    return os.environ.get("CC_BRIDGE_TOKEN", "").strip()


def verify_token(request: Request) -> None:
    expected = _expected_token()
    if not expected:
        raise HTTPException(status_code=503, detail="CC_BRIDGE_TOKEN is not set")
    auth = request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing Bearer token")
    got = auth[7:].strip()
    if not secrets.compare_digest(got, expected):
        raise HTTPException(status_code=403, detail="invalid token")


app = FastAPI(title="AgenticX CC Bridge", version="0.1.0")


def _parse_session_id(session_id: str) -> str:
    try:
        return str(uuid.UUID(session_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="session_id must be a UUID") from exc


class SessionCreateBody(BaseModel):
    cwd: str = Field(..., description="Working directory for the child process")
    auto_allow_permissions: bool = Field(
        default=False,
        description="If true, bridge auto-answers can_use_tool with allow",
    )
    mode: str = Field(
        default="headless",
        description="headless (stream-json) or visible_tui (interactive PTY)",
    )


class SessionCreateResponse(BaseModel):
    session_id: str
    cwd: str
    pid: Optional[int]
    mode: str = "headless"


class MessageBody(BaseModel):
    text: str
    wait_seconds: float = Field(default=120.0, ge=1.0, le=3600.0)


class MessageResponse(BaseModel):
    ok: bool
    tail: str
    parsed_response: str = ""
    parse_confidence: float = 0.0
    mode: str = "headless"


class SessionDetailResponse(BaseModel):
    """Authoritative single-session view for routing (cc_bridge_send, Desktop)."""

    session_id: str
    cwd: str
    pid: Optional[int]
    poll: Optional[int] = None
    log_path: str = ""
    mode: str = "headless"
    state: str = "running"
    interactive_waiting: bool = False


class PermissionBody(BaseModel):
    request_id: str
    allow: bool
    deny_message: str = Field(default="Denied by operator")
    tool_use_id: Optional[str] = None
    tool_input: Optional[Dict[str, Any]] = None


class PtyWriteBody(BaseModel):
    data: str = Field(default="", description="Terminal input (UTF-8); may contain control characters")


class PtyResizeBody(BaseModel):
    cols: int = Field(..., ge=2, le=300)
    rows: int = Field(..., ge=2, le=200)


@app.post("/v1/sessions", response_model=SessionCreateResponse, dependencies=[Depends(verify_token)])
def create_session(body: SessionCreateBody) -> SessionCreateResponse:
    m = (body.mode or "headless").strip().lower()
    if m not in {"headless", "visible_tui"}:
        raise HTTPException(status_code=400, detail="mode must be headless or visible_tui") from None
    try:
        s = _manager.start_session(
            body.cwd,
            auto_allow_permissions=body.auto_allow_permissions,
            mode=m,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SessionCreateResponse(
        session_id=s.session_id,
        cwd=s.cwd,
        pid=s.proc.pid,
        mode=s.session_kind,
    )


@app.get("/v1/sessions", dependencies=[Depends(verify_token)])
def list_sessions() -> Dict[str, List[Dict[str, Any]]]:
    return {"sessions": _manager.list_sessions()}


@app.get(
    "/v1/sessions/{session_id}",
    response_model=SessionDetailResponse,
    dependencies=[Depends(verify_token)],
)
def get_session(session_id: str) -> SessionDetailResponse:
    """Return authoritative mode/cwd for one session (used by cc_bridge_send routing)."""
    session_id = _parse_session_id(session_id)
    row = _manager.describe_session(session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="session not found") from None
    return SessionDetailResponse(**row)


@app.post("/v1/sessions/{session_id}/message", response_model=MessageResponse, dependencies=[Depends(verify_token)])
def post_message(session_id: str, body: MessageBody) -> MessageResponse:
    session_id = _parse_session_id(session_id)
    sess = _manager.get(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found") from None
    try:
        _manager.send_user_message(session_id, body.text)
    except KeyError:
        raise HTTPException(status_code=404, detail="session not found") from None
    if sess.session_kind == "visible_tui":
        ok, parsed, conf, tail = _manager.wait_for_visible_tui_result(session_id, body.wait_seconds)
        return MessageResponse(
            ok=ok,
            tail=tail,
            parsed_response=parsed,
            parse_confidence=conf,
            mode="visible_tui",
        )
    ok, tail = _manager.wait_for_success_result(session_id, body.wait_seconds)
    return MessageResponse(
        ok=ok,
        tail=tail,
        parsed_response="",
        parse_confidence=0.0,
        mode="headless",
    )


@app.get("/v1/sessions/{session_id}/stream", dependencies=[Depends(verify_token)])
def get_pty_stream(session_id: str) -> StreamingResponse:
    """Raw PTY output for visible_tui (binary octet stream)."""
    session_id = _parse_session_id(session_id)
    sess = _manager.get(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found") from None
    if sess.session_kind != "visible_tui":
        raise HTTPException(
            status_code=400,
            detail="pty stream is only available for visible_tui sessions",
        ) from None
    return StreamingResponse(
        _manager.iter_pty_stream_chunks(session_id),
        media_type="application/octet-stream",
    )


@app.post("/v1/sessions/{session_id}/write", dependencies=[Depends(verify_token)])
def post_pty_write(session_id: str, body: PtyWriteBody) -> Dict[str, str]:
    session_id = _parse_session_id(session_id)
    sess = _manager.get(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found") from None
    if sess.session_kind != "visible_tui":
        raise HTTPException(status_code=400, detail="write is only for visible_tui sessions") from None
    try:
        _manager.write_pty_raw(session_id, body.data)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc) or "pty closed") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post("/v1/sessions/{session_id}/resize", dependencies=[Depends(verify_token)])
def post_pty_resize(session_id: str, body: PtyResizeBody) -> Dict[str, str]:
    session_id = _parse_session_id(session_id)
    sess = _manager.get(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found") from None
    if sess.session_kind != "visible_tui":
        raise HTTPException(status_code=400, detail="resize is only for visible_tui sessions") from None
    try:
        _manager.resize_pty_session(session_id, body.rows, body.cols)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc) or "pty closed") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post("/v1/sessions/{session_id}/permission", dependencies=[Depends(verify_token)])
def post_permission(session_id: str, body: PermissionBody) -> Dict[str, str]:
    session_id = _parse_session_id(session_id)
    sess = _manager.get(session_id)
    if sess is not None and sess.session_kind == "visible_tui":
        raise HTTPException(
            status_code=400,
            detail="visible_tui sessions use interactive permission in the terminal; HTTP permission API is not supported",
        ) from None
    try:
        _manager.respond_permission(
            session_id,
            body.request_id,
            body.allow,
            tool_input=body.tool_input,
            tool_use_id=body.tool_use_id,
            deny_message=body.deny_message,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="session not found") from None
    return {"status": "sent"}


@app.delete("/v1/sessions/{session_id}", dependencies=[Depends(verify_token)])
def delete_session(session_id: str) -> Dict[str, str]:
    session_id = _parse_session_id(session_id)
    if not _manager.stop_session(session_id):
        raise HTTPException(status_code=404, detail="session not found")
    return {"status": "stopped"}


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}
