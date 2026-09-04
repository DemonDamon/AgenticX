#!/usr/bin/env python3
"""FastAPI HTTP control plane for the local CodeBuddy (WB) bridge.

Author: Damon Li
"""

from __future__ import annotations

import os
import secrets
import uuid
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from agenticx.wb_bridge import events as wb_events
from agenticx.wb_bridge.session_manager import WbBridgeSessionManager

_manager = WbBridgeSessionManager()

_UNATTENDED_MODES = frozenset({"acceptEdits", "dontAsk", "bypassPermissions", "auto"})

_UNATTENDED_HINT = (
    "permission_mode={mode} will pause on Write/Bash approval, and this bridge "
    "has no approval channel (CodeBuddy headless does not support "
    "--permission-prompt-tool, so cc_bridge_permission does NOT apply). For "
    "unattended work use acceptEdits (file edits) or dontAsk/bypassPermissions "
    "(edits + commands). plan mode only plans and never executes."
)

_NEXT_ACTION_BY_STATUS: Dict[str, str] = {
    "success": "done",
    "running": (
        "still running; poll wb_bridge_describe with this session_id; do NOT "
        "resend the same instruction (a resend while a turn is in flight is "
        "rejected with HTTP 409)"
    ),
    "blocked": (
        "blocked by a CodeBuddy permission prompt and this bridge has no "
        "approval channel; check observed_tools first because side effects "
        "before the block are already committed, then start a NEW session "
        "with permission_mode=acceptEdits (edits only) or "
        "dontAsk/bypassPermissions (edits + commands); do NOT resend into "
        "this session"
    ),
    "error": (
        "turn ended with an error; check observed_tools for side effects "
        "already committed, then read terminal_detail and tail before retrying"
    ),
    "exited": "child process exited; start a new session",
}


def _expected_token() -> str:
    return os.environ.get("WB_BRIDGE_TOKEN", "").strip()


def verify_token(request: Request) -> None:
    expected = _expected_token()
    if not expected:
        raise HTTPException(status_code=503, detail="WB_BRIDGE_TOKEN is not set")
    auth = request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing Bearer token")
    got = auth[7:].strip()
    if not secrets.compare_digest(got, expected):
        raise HTTPException(status_code=403, detail="invalid token")


app = FastAPI(title="AgenticX WB Bridge", version="0.1.0")


@app.get("/health")
def health() -> dict:
    """Unauthenticated liveness for settings / Studio status probes."""
    return {"ok": True, "service": "wb-bridge"}


def _parse_session_id(session_id: str) -> str:
    try:
        return str(uuid.UUID(session_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="session_id must be a UUID") from exc


def _extract_result_text(tail: str) -> str:
    """Best-effort result text from a stdout tail (legacy helper; post_message uses snapshot)."""
    for line in reversed((tail or "").splitlines()):
        if wb_events.line_is_turn_terminal(line):
            obj = wb_events.parse_stream_line(line)
            text = wb_events.extract_result_text(obj)
            if text:
                return text
    return ""


def _build_message_response(
    session_id: str,
    status: str,
    snap: Dict[str, Any],
    *,
    deduplicated: bool,
) -> "MessageResponse":
    """Map a wait_for_turn outcome onto the HTTP response shape."""
    result_text = ""
    if status == "success":
        result_text = str(snap.get("last_result_text", "") or "")
    return MessageResponse(
        ok=(status == "success"),
        tail=str(snap.get("tail", "") or ""),
        result_text=result_text,
        status=status,
        session_id=session_id,
        turn_seq=int(snap.get("turn_seq") or 0),
        stalled=bool(snap.get("stalled", False)),
        deduplicated=deduplicated,
        terminal_detail=str(snap.get("terminal_detail", "") or ""),
        observed_tools=list(snap.get("observed_tools") or []),
        usage_totals=dict(snap.get("usage_totals") or {}),
        last_activity=str(snap.get("last_activity", "") or ""),
        turns_completed=int(snap.get("turns_completed") or 0),
        first_activity_lag_sec=snap.get("first_activity_lag_sec"),
        next_action=_NEXT_ACTION_BY_STATUS.get(status, ""),
    )


class SessionCreateBody(BaseModel):
    cwd: str = Field(..., description="Working directory for the child process")
    permission_mode: str = Field(
        default="default",
        description="Session-level permission mode for codebuddy --permission-mode",
    )


class SessionCreateResponse(BaseModel):
    session_id: str
    cwd: str
    pid: Optional[int]
    permission_mode: str = "default"
    unattended_ok: bool = False
    hint: str = ""


class MessageBody(BaseModel):
    text: str
    wait_seconds: float = Field(default=180.0, ge=0.0, le=3600.0)
    idempotency_key: Optional[str] = Field(
        default=None,
        max_length=200,
        description="When equal to the key of the current or last turn, the "
        "text is NOT re-dispatched; the existing turn snapshot is returned.",
    )


class MessageResponse(BaseModel):
    ok: bool
    tail: str
    result_text: str = ""
    status: str = "running"
    session_id: str = ""
    turn_seq: int = 0
    stalled: bool = False
    deduplicated: bool = False
    terminal_detail: str = ""
    observed_tools: List[str] = Field(default_factory=list)
    usage_totals: Dict[str, int] = Field(default_factory=dict)
    last_activity: str = ""
    turns_completed: int = 0
    first_activity_lag_sec: Optional[float] = None
    next_action: str = ""


@app.post("/v1/sessions", response_model=SessionCreateResponse, dependencies=[Depends(verify_token)])
def create_session(body: SessionCreateBody) -> SessionCreateResponse:
    try:
        s = _manager.start_session(body.cwd, permission_mode=body.permission_mode)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    mode = getattr(s, "permission_mode", body.permission_mode)
    unattended_ok = mode in _UNATTENDED_MODES
    hint = "" if unattended_ok else _UNATTENDED_HINT.format(mode=mode)
    return SessionCreateResponse(
        session_id=s.session_id,
        cwd=s.cwd,
        pid=s.proc.pid,
        permission_mode=mode,
        unattended_ok=unattended_ok,
        hint=hint,
    )


@app.get("/v1/sessions", dependencies=[Depends(verify_token)])
def list_sessions() -> Dict[str, List[Dict[str, Any]]]:
    return {"sessions": _manager.list_sessions()}


@app.get("/v1/sessions/{session_id}", dependencies=[Depends(verify_token)])
def get_session(session_id: str) -> Dict[str, Any]:
    session_id = _parse_session_id(session_id)
    row = _manager.describe_session(session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="session not found") from None
    return row


@app.post(
    "/v1/sessions/{session_id}/message",
    response_model=MessageResponse,
    dependencies=[Depends(verify_token)],
)
def post_message(session_id: str, body: MessageBody) -> MessageResponse:
    session_id = _parse_session_id(session_id)
    sess = _manager.get(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found") from None

    key = (body.idempotency_key or "").strip()
    if key and _manager.turn_matches_idempotency_key(session_id, key):
        status, snap = _manager.wait_for_turn(session_id, body.wait_seconds)
        return _build_message_response(session_id, status, snap, deduplicated=True)

    snap0 = _manager.describe_session(session_id)
    if snap0 and snap0.get("turn_state") == "running":
        raise HTTPException(
            status_code=409,
            detail=(
                "a turn is already in flight for this session "
                f"(turn_seq={snap0.get('turn_seq')}, "
                f"elapsed={snap0.get('turn_elapsed_sec')}s, "
                f"last_activity={snap0.get('last_activity') or 'n/a'}); "
                "poll GET /v1/sessions/<session_id> instead of resending"
            ),
        )

    try:
        _manager.send_user_message(session_id, body.text, idempotency_key=key)
    except KeyError:
        raise HTTPException(status_code=404, detail="session not found") from None
    status, snap = _manager.wait_for_turn(session_id, body.wait_seconds)
    return _build_message_response(session_id, status, snap, deduplicated=False)


@app.delete("/v1/sessions/{session_id}", dependencies=[Depends(verify_token)])
def delete_session(session_id: str) -> Dict[str, str]:
    session_id = _parse_session_id(session_id)
    if not _manager.stop_session(session_id):
        raise HTTPException(status_code=404, detail="session not found")
    return {"status": "stopped"}
