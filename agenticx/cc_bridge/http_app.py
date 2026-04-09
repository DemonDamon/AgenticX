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


class SessionCreateResponse(BaseModel):
    session_id: str
    cwd: str
    pid: Optional[int]


class MessageBody(BaseModel):
    text: str
    wait_seconds: float = Field(default=120.0, ge=1.0, le=3600.0)


class MessageResponse(BaseModel):
    ok: bool
    tail: str


class PermissionBody(BaseModel):
    request_id: str
    allow: bool
    deny_message: str = Field(default="Denied by operator")
    tool_use_id: Optional[str] = None
    tool_input: Optional[Dict[str, Any]] = None


@app.post("/v1/sessions", response_model=SessionCreateResponse, dependencies=[Depends(verify_token)])
def create_session(body: SessionCreateBody) -> SessionCreateResponse:
    s = _manager.start_session(
        body.cwd,
        auto_allow_permissions=body.auto_allow_permissions,
    )
    return SessionCreateResponse(session_id=s.session_id, cwd=s.cwd, pid=s.proc.pid)


@app.get("/v1/sessions", dependencies=[Depends(verify_token)])
def list_sessions() -> Dict[str, List[Dict[str, Any]]]:
    return {"sessions": _manager.list_sessions()}


@app.post("/v1/sessions/{session_id}/message", response_model=MessageResponse, dependencies=[Depends(verify_token)])
def post_message(session_id: str, body: MessageBody) -> MessageResponse:
    session_id = _parse_session_id(session_id)
    try:
        _manager.send_user_message(session_id, body.text)
    except KeyError:
        raise HTTPException(status_code=404, detail="session not found") from None
    ok, tail = _manager.wait_for_success_result(session_id, body.wait_seconds)
    return MessageResponse(ok=ok, tail=tail)


@app.post("/v1/sessions/{session_id}/permission", dependencies=[Depends(verify_token)])
def post_permission(session_id: str, body: PermissionBody) -> Dict[str, str]:
    session_id = _parse_session_id(session_id)
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
