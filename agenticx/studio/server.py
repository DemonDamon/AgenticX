#!/usr/bin/env python3
"""FastAPI server adapter for AgentRuntime."""

from __future__ import annotations

import json
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse

from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.runtime import AgentRuntime
from agenticx.studio.protocols import ChatRequest, ConfirmResponse, SessionState, SseEvent
from agenticx.studio.session_manager import SessionManager


def create_studio_app() -> FastAPI:
    app = FastAPI(title="AgenticX Studio Service", version="0.1.0")
    manager = SessionManager()
    app.state.session_manager = manager

    @app.get("/api/session", response_model=SessionState)
    async def get_or_create_session(
        session_id: str | None = Query(default=None),
        provider: str | None = Query(default=None),
        model: str | None = Query(default=None),
    ) -> SessionState:
        manager.cleanup_expired()
        managed = manager.get(session_id) if session_id else None
        if managed is None:
            managed = manager.create(provider=provider, model=model)
        sess = managed.studio_session
        return SessionState(
            session_id=managed.session_id,
            provider=sess.provider_name,
            model=sess.model_name,
            artifact_paths=[str(p) for p in sess.artifacts.keys()],
            context_files=list(sess.context_files.keys()),
        )

    @app.get("/api/artifacts")
    async def list_artifacts(session_id: str = Query(...)) -> dict:
        managed = manager.get(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        return {
            "session_id": session_id,
            "artifacts": {str(path): code for path, code in managed.studio_session.artifacts.items()},
        }

    @app.delete("/api/session")
    async def delete_session(session_id: str = Query(...)) -> dict:
        ok = manager.delete(session_id)
        if not ok:
            raise HTTPException(status_code=404, detail="session not found")
        return {"ok": True}

    @app.post("/api/confirm")
    async def post_confirm(payload: ConfirmResponse) -> dict:
        managed = manager.get(payload.session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        ok = managed.confirm_gate.resolve(payload.request_id, payload.approved)
        if not ok:
            raise HTTPException(status_code=404, detail="confirm request not found")
        return {"ok": True}

    @app.post("/api/chat")
    async def chat(payload: ChatRequest) -> StreamingResponse:
        managed = manager.get(payload.session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")

        session = managed.studio_session
        if payload.provider:
            session.provider_name = payload.provider
        if payload.model:
            session.model_name = payload.model

        llm = ProviderResolver.resolve(
            provider_name=session.provider_name,
            model=session.model_name,
        )
        runtime = AgentRuntime(llm, managed.confirm_gate)

        async def _event_stream() -> AsyncGenerator[str, None]:
            async for event in runtime.run_turn(payload.user_input, session):
                sse = SseEvent(type=event.type, data=event.data)
                yield f"data: {json.dumps(sse.model_dump(), ensure_ascii=False)}\n\n"
            yield "data: {\"type\":\"done\",\"data\":{}}\n\n"

        return StreamingResponse(_event_stream(), media_type="text/event-stream")

    return app
