#!/usr/bin/env python3
"""HTTP routes for composer commands and session performance.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from agenticx.runtime.replay_ledger.contracts import validate_ledger_id
from agenticx.runtime.session_perf import summarize_session_perf
from agenticx.studio.command_resolve import resolve_visible
from agenticx.studio.command_store import (
    CommandNameExists,
    CommandNameReserved,
    CommandNotFound,
    CommandStore,
    CommandStoreError,
    CommandValidationError,
)


class CommandCreateRequest(BaseModel):
    scope: str
    subject_id: str = ""
    name: str
    description: str = ""
    instructions: str


class CommandPinRequest(BaseModel):
    scope: str
    subject_id: str = ""
    name: str = Field(min_length=1)


def register_command_routes(
    app: FastAPI,
    check_token: Callable[[Optional[str]], None],
    *,
    commands_root: Path | None = None,
    sessions_root: Path | None = None,
) -> None:
    """Attach command CRUD and session perf routes."""
    if getattr(app.state, "_command_routes_registered", False):
        return
    app.state._command_routes_registered = True
    root = commands_root or (Path.home() / ".agenticx" / "commands")
    sessions = sessions_root or (Path.home() / ".agenticx" / "sessions")
    store = CommandStore(root, sessions)

    def _auth(token: Optional[str]) -> None:
        check_token(token)

    def _http(exc: CommandStoreError) -> HTTPException:
        if isinstance(exc, CommandNameExists):
            return HTTPException(status_code=409, detail=exc.detail)
        if isinstance(exc, CommandNotFound):
            return HTTPException(status_code=404, detail=exc.detail)
        if isinstance(exc, CommandNameReserved):
            return HTTPException(status_code=400, detail=exc.detail)
        if isinstance(exc, CommandValidationError):
            return HTTPException(status_code=400, detail=exc.detail)
        return HTTPException(status_code=400, detail=str(exc))

    @app.get("/api/commands/visible")
    async def commands_visible(
        context: str = Query("meta"),
        subject_id: str = Query(""),
        session_id: str = Query(""),
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict:
        _auth(x_agx_desktop_token)
        try:
            items = resolve_visible(
                store,
                context=context,
                subject_id=subject_id,
                session_id=session_id,
                sessions_root=sessions,
            )
        except CommandStoreError as exc:
            raise _http(exc) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"items": items}

    @app.get("/api/commands")
    async def commands_list(
        scope: str = Query("global"),
        subject_id: str = Query(""),
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict:
        _auth(x_agx_desktop_token)
        try:
            rows = store.list_commands(scope, "" if scope == "global" else subject_id)
        except CommandStoreError as exc:
            raise _http(exc) from exc
        return {"commands": rows}

    @app.post("/api/commands", status_code=201)
    async def commands_create(
        body: CommandCreateRequest,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict:
        _auth(x_agx_desktop_token)
        try:
            return store.add_command(
                scope=body.scope,
                subject_id="" if body.scope == "global" else body.subject_id,
                name=body.name,
                description=body.description,
                instructions=body.instructions,
            )
        except CommandStoreError as exc:
            raise _http(exc) from exc

    @app.delete("/api/commands/{command_id}", status_code=204)
    async def commands_delete(
        command_id: str,
        scope: str = Query("global"),
        subject_id: str = Query(""),
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> Response:
        _auth(x_agx_desktop_token)
        try:
            store.delete_command(command_id, scope=scope, subject_id="" if scope == "global" else subject_id)
        except CommandStoreError as exc:
            raise _http(exc) from exc
        return Response(status_code=204)

    @app.post("/api/sessions/{session_id}/commands/pin", status_code=201)
    async def commands_pin(
        session_id: str,
        body: CommandPinRequest,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict:
        _auth(x_agx_desktop_token)
        try:
            validate_ledger_id(session_id, "session_id")
            return store.pin_command(
                session_id,
                scope=body.scope,
                subject_id="" if body.scope == "global" else body.subject_id,
                name=body.name,
            )
        except CommandStoreError as exc:
            raise _http(exc) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/sessions/{session_id}/commands/{name}", status_code=204)
    async def commands_unpin(
        session_id: str,
        name: str,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> Response:
        _auth(x_agx_desktop_token)
        try:
            store.delete_session_pin(session_id, name)
        except CommandStoreError as exc:
            raise _http(exc) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return Response(status_code=204)

    @app.get("/api/sessions/{session_id}/perf")
    async def session_perf(
        session_id: str,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict:
        _auth(x_agx_desktop_token)
        try:
            return summarize_session_perf(sessions, session_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
