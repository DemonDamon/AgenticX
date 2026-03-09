#!/usr/bin/env python3
"""FastAPI server adapter for AgentRuntime."""

from __future__ import annotations

import json
import os
from typing import AsyncGenerator

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.runtime import AgentRuntime
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.meta_tools import META_AGENT_TOOLS
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt
from agenticx.studio.protocols import ChatRequest, ConfirmResponse, SessionState, SseEvent
from agenticx.studio.session_manager import SessionManager


def create_studio_app() -> FastAPI:
    app = FastAPI(title="AgenticX Studio Service", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "null"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    manager = SessionManager()
    app.state.session_manager = manager
    desktop_token = os.getenv("AGX_DESKTOP_TOKEN", "").strip()

    def _check_token(x_agx_desktop_token: str | None) -> None:
        if not desktop_token:
            return
        if x_agx_desktop_token != desktop_token:
            raise HTTPException(status_code=401, detail="invalid desktop token")

    @app.get("/api/session", response_model=SessionState)
    async def get_or_create_session(
        session_id: str | None = Query(default=None),
        provider: str | None = Query(default=None),
        model: str | None = Query(default=None),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> SessionState:
        _check_token(x_agx_desktop_token)
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
    async def list_artifacts(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        managed = manager.get(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        return {
            "session_id": session_id,
            "artifacts": {str(path): code for path, code in managed.studio_session.artifacts.items()},
        }

    @app.delete("/api/session")
    async def delete_session(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        ok = manager.delete(session_id)
        if not ok:
            raise HTTPException(status_code=404, detail="session not found")
        return {"ok": True}

    @app.post("/api/confirm")
    async def post_confirm(
        payload: ConfirmResponse,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        managed = manager.get(payload.session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        gate = managed.get_confirm_gate(payload.agent_id)
        if payload.agent_id != "meta" and managed.team_manager is not None:
            team_gate = managed.team_manager.get_confirm_gate(payload.agent_id)
            if team_gate is not None:
                gate = team_gate
        ok = gate.resolve(payload.request_id, payload.approved)
        if not ok:
            raise HTTPException(status_code=404, detail="confirm request not found")
        return {"ok": True}

    @app.post("/api/chat")
    async def chat(
        payload: ChatRequest,
        request: Request,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> StreamingResponse:
        _check_token(x_agx_desktop_token)
        managed = manager.get(payload.session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")

        session = managed.studio_session
        if payload.provider:
            session.provider_name = payload.provider
        if payload.model:
            session.model_name = payload.model

        def _resolve_llm():
            return ProviderResolver.resolve(
                provider_name=session.provider_name,
                model=session.model_name,
            )

        try:
            llm = _resolve_llm()
        except Exception as exc:
            async def _error_stream() -> AsyncGenerator[str, None]:
                err = SseEvent(type="error", data={"text": f"LLM init failed: {exc}"})
                yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                yield 'data: {"type":"done","data":{}}\n\n'
            return StreamingResponse(_error_stream(), media_type="text/event-stream")

        event_queue: "asyncio.Queue[RuntimeEvent | None]"
        import asyncio

        event_queue = asyncio.Queue()

        async def _on_team_event(event: RuntimeEvent) -> None:
            await event_queue.put(event)

        async def _on_subagent_summary(summary: str, context) -> None:
            # Inject summarized sub-agent result back to meta-agent context as tool result.
            tool_call_id = str(getattr(context, "source_tool_call_id", "") or "")
            if tool_call_id:
                session.agent_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": "spawn_subagent",
                        "content": summary,
                    }
                )
            else:
                # Fallback to assistant note when no valid tool_call_id is available.
                session.agent_messages.append({"role": "assistant", "content": f"子智能体汇总:\n{summary}"})
            session.chat_history.append({"role": "assistant", "content": f"子智能体汇总:\n{summary}"})

        team_manager = managed.get_or_create_team(
            llm_factory=_resolve_llm,
            event_emitter=_on_team_event,
            summary_sink=_on_subagent_summary,
        )
        setattr(session, "_team_manager", team_manager)
        runtime = AgentRuntime(llm, managed.get_confirm_gate("meta"))

        async def _event_stream() -> AsyncGenerator[str, None]:
            runtime_task: "asyncio.Task[None] | None" = None
            meta_done = False
            try:
                async def _produce_meta_events() -> None:
                    async for event in runtime.run_turn(
                        payload.user_input,
                        session,
                        should_stop=request.is_disconnected,
                        agent_id="meta",
                        tools=META_AGENT_TOOLS,
                        system_prompt=build_meta_agent_system_prompt(session),
                    ):
                        await event_queue.put(event)
                    await event_queue.put(None)

                runtime_task = asyncio.create_task(_produce_meta_events())

                while True:
                    if await request.is_disconnected():
                        break
                    timed_out = False
                    try:
                        event = await asyncio.wait_for(event_queue.get(), timeout=0.1)
                    except asyncio.TimeoutError:
                        timed_out = True
                        event = None
                    if timed_out:
                        pass
                    elif event is None:
                        meta_done = True
                    else:
                        event_data = dict(event.data)
                        event_data.setdefault("agent_id", event.agent_id)
                        sse = SseEvent(type=event.type, data=event_data)
                        yield f"data: {json.dumps(sse.model_dump(), ensure_ascii=False)}\n\n"
                    if not meta_done:
                        continue
                    status_payload = team_manager.get_status()
                    subagents = status_payload.get("subagents", []) if isinstance(status_payload, dict) else []
                    has_running = any(
                        item.get("status") in {"pending", "running"}
                        for item in subagents
                        if isinstance(item, dict)
                    )
                    if not has_running and event_queue.empty():
                        break
            except Exception as exc:
                err = SseEvent(type="error", data={"text": f"Runtime error: {exc}"})
                yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
            finally:
                if runtime_task is not None and not runtime_task.done():
                    runtime_task.cancel()
            yield 'data: {"type":"done","data":{}}\n\n'

        return StreamingResponse(_event_stream(), media_type="text/event-stream")

    @app.post("/api/subagent/cancel")
    async def cancel_subagent(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", ""))
        agent_id = str(payload.get("agent_id", ""))
        if not session_id or not agent_id:
            raise HTTPException(status_code=400, detail="session_id and agent_id are required")
        managed = manager.get(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        if managed.team_manager is None:
            raise HTTPException(status_code=404, detail="agent team not initialized")
        result = await managed.team_manager.cancel_subagent(agent_id)
        if not result.get("ok"):
            raise HTTPException(status_code=404, detail=result.get("message", "subagent not found"))
        return result

    return app
