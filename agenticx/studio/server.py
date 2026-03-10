#!/usr/bin/env python3
"""FastAPI server adapter for AgentRuntime."""

from __future__ import annotations

import json
import logging
import os
from typing import Any
from typing import AsyncGenerator

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio_mcp import auto_connect_servers, import_mcp_config, load_available_servers, mcp_connect
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.runtime import AgentRuntime
from agenticx.runtime.auto_solve import AutoSolveMode
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.loop_controller import LoopController
from agenticx.runtime.meta_tools import META_AGENT_TOOLS
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt
from agenticx.studio.protocols import ChatRequest, ConfirmResponse, SessionState, SseEvent
from agenticx.studio.session_manager import SessionManager
from agenticx.tools.mcp_hub import MCPHub
from agenticx.workspace.loader import ensure_workspace

logger = logging.getLogger(__name__)


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

    def _resolve_mcp_auto_connect_setting() -> list[str] | None:
        """Resolve mcp.auto_connect.

        Returns:
          - None: auto-connect all
          - []: disable auto-connect
          - [names...]: connect selected names
        """
        try:
            value: Any = ConfigManager.get_value("mcp.auto_connect")
        except Exception:
            value = None
        if value is None:
            return []
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"", "none", "off", "false", "0"}:
                return []
            if lowered == "all":
                return None
            return [value.strip()]
        if isinstance(value, list):
            names = [str(item).strip() for item in value if str(item).strip()]
            return names
        return []

    def _check_token(x_agx_desktop_token: str | None) -> None:
        if not desktop_token:
            return
        if x_agx_desktop_token != desktop_token:
            raise HTTPException(status_code=401, detail="invalid desktop token")

    def _check_mcp_admin_token(x_agx_desktop_token: str | None) -> None:
        if not desktop_token:
            raise HTTPException(status_code=403, detail="desktop token required for MCP admin APIs")
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
        try:
            ensure_workspace()
        except Exception as exc:
            logger.warning("Workspace bootstrap skipped: %s", exc)
        manager.cleanup_expired()
        managed = manager.get(session_id) if session_id else None
        if managed is None:
            managed = manager.create(provider=provider, model=model, session_id=session_id)
            managed.studio_session.workspace_dir = os.getenv("AGX_WORKSPACE_ROOT", "").strip() or os.getcwd()
            try:
                managed.studio_session.mcp_configs = load_available_servers()
            except Exception as exc:
                logger.warning("Failed to load MCP server configs: %s", exc)
                managed.studio_session.mcp_configs = {}
            auto_connect_names = _resolve_mcp_auto_connect_setting()
            if managed.studio_session.mcp_configs and auto_connect_names != []:
                managed.studio_session.mcp_hub = MCPHub(clients=[], auto_mode=False)
                try:
                    auto_connect_servers(
                        managed.studio_session.mcp_hub,
                        managed.studio_session.mcp_configs,
                        managed.studio_session.connected_servers,
                        auto_connect_names,
                    )
                except Exception as exc:
                    logger.warning("MCP auto-connect failed: %s", exc)
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
        mode = (payload.mode or "interactive").strip().lower()
        if mode not in {"interactive", "auto"}:
            mode = "interactive"
        if payload.provider:
            session.provider_name = payload.provider
        if payload.model:
            session.model_name = payload.model
        target_agent_id = (payload.agent_id or "meta").strip() or "meta"
        if target_agent_id != "meta":
            async def _subagent_message_stream() -> AsyncGenerator[str, None]:
                team_manager = managed.team_manager
                if team_manager is None:
                    err = SseEvent(
                        type="error",
                        data={"agent_id": target_agent_id, "text": "子智能体团队尚未初始化"},
                    )
                    yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                    yield 'data: {"type":"done","data":{}}\n\n'
                    return
                result = await team_manager.send_message_to_subagent(target_agent_id, payload.user_input)
                if not result.get("ok"):
                    err = SseEvent(
                        type="error",
                        data={
                            "agent_id": target_agent_id,
                            "text": str(result.get("message") or "发送子智能体消息失败"),
                        },
                    )
                    yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                else:
                    ack = SseEvent(
                        type="subagent_progress",
                        data={
                            "agent_id": target_agent_id,
                            "text": "已将你的补充指令发送给子智能体",
                        },
                    )
                    yield f"data: {json.dumps(ack.model_dump(), ensure_ascii=False)}\n\n"
                yield 'data: {"type":"done","data":{}}\n\n'
            return StreamingResponse(_subagent_message_stream(), media_type="text/event-stream")

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
            # Use assistant note instead of raw tool role to avoid dangling tool messages
            # in later turns (some providers strictly validate tool message ordering).
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
                    auto = AutoSolveMode()
                    effective_input = payload.user_input
                    if mode == "auto":
                        enriched = auto.enrich_prompt(payload.user_input)
                        effective_input = (
                            f"{enriched['prompt']}\n\n"
                            f"请直接给出可执行方案并自动推进。\n"
                            f"原始请求：{payload.user_input}"
                        )
                    async for event in runtime.run_turn(
                        effective_input,
                        session,
                        should_stop=request.is_disconnected,
                        agent_id="meta",
                        tools=META_AGENT_TOOLS,
                        system_prompt=build_meta_agent_system_prompt(session, mode=mode),
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
                    # Do not block the main chat stream on background sub-agent execution.
                    # This keeps the main dialogue responsive; users can continue asking
                    # new questions while sub-agents keep running asynchronously.
                    if event_queue.empty():
                        break
            except Exception as exc:
                err = SseEvent(type="error", data={"text": f"Runtime error: {exc}"})
                yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
            finally:
                if runtime_task is not None and not runtime_task.done():
                    runtime_task.cancel()
            yield 'data: {"type":"done","data":{}}\n\n'

        return StreamingResponse(_event_stream(), media_type="text/event-stream")

    @app.post("/api/loop")
    async def run_loop(
        payload: dict,
        request: Request,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> StreamingResponse:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "")).strip()
        user_input = str(payload.get("user_input", "")).strip()
        if not session_id or not user_input:
            raise HTTPException(status_code=400, detail="session_id and user_input are required")
        managed = manager.get(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        try:
            max_iterations = int(payload.get("max_iterations", 8) or 8)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="max_iterations must be an integer")
        completion_promise = str(payload.get("completion_promise", "") or "").strip()

        session = managed.studio_session
        llm = ProviderResolver.resolve(provider_name=session.provider_name, model=session.model_name)
        runtime = AgentRuntime(llm, managed.get_confirm_gate("meta"))
        controller = LoopController(max_iterations=max_iterations, completion_promise=completion_promise)

        async def _loop_stream() -> AsyncGenerator[str, None]:
            try:
                async for event in controller.run_loop(
                    task=user_input,
                    runtime=runtime,
                    session=session,
                    agent_id="meta",
                    tools=META_AGENT_TOOLS,
                    system_prompt=build_meta_agent_system_prompt(session, mode="interactive"),
                ):
                    if await request.is_disconnected():
                        break
                    data = dict(event.data)
                    data.setdefault("agent_id", event.agent_id)
                    sse = SseEvent(type=event.type, data=data)
                    yield f"data: {json.dumps(sse.model_dump(), ensure_ascii=False)}\n\n"
            except Exception as exc:
                err = SseEvent(type="error", data={"text": f"Loop runtime error: {exc}"})
                yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
            yield 'data: {"type":"done","data":{}}\n\n'

        return StreamingResponse(_loop_stream(), media_type="text/event-stream")

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

    @app.get("/api/subagents/status")
    async def subagents_status(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        managed = manager.get(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        if managed.team_manager is None:
            return {"ok": True, "subagents": []}
        status_payload = managed.team_manager.get_status()
        return status_payload if isinstance(status_payload, dict) else {"ok": True, "subagents": []}

    @app.post("/api/subagent/retry")
    async def retry_subagent(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", ""))
        agent_id = str(payload.get("agent_id", ""))
        refined_task = payload.get("task")
        if not session_id or not agent_id:
            raise HTTPException(status_code=400, detail="session_id and agent_id are required")
        managed = manager.get(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        if managed.team_manager is None:
            raise HTTPException(status_code=404, detail="agent team not initialized")
        result = await managed.team_manager.retry_subagent(
            agent_id,
            str(refined_task) if isinstance(refined_task, str) and refined_task.strip() else None,
        )
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("message", "retry failed"))
        return result

    @app.get("/api/mcp/servers")
    async def list_mcp_servers(
        session_id: str = Query(...),
        reload: bool = Query(default=True),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        managed = manager.get(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        sess = managed.studio_session
        if reload:
            try:
                sess.mcp_configs = load_available_servers()
            except Exception as exc:
                logger.warning("Failed to reload MCP configs: %s", exc)
        configs = sess.mcp_configs if isinstance(sess.mcp_configs, dict) else {}
        connected = (
            sess.connected_servers
            if isinstance(sess.connected_servers, set)
            else set(sess.connected_servers or [])
        )
        servers = []
        for name, cfg in sorted(configs.items()):
            servers.append(
                {
                    "name": name,
                    "connected": name in connected,
                    "command": str(getattr(cfg, "command", "") or ""),
                }
            )
        return {
            "ok": True,
            "count": len(servers),
            "connected_count": sum(1 for item in servers if item.get("connected")),
            "servers": servers,
        }

    @app.post("/api/mcp/import")
    async def import_mcp_servers(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "")).strip()
        source_path = str(payload.get("source_path", "")).strip()
        if not session_id or not source_path:
            raise HTTPException(status_code=400, detail="session_id and source_path are required")
        managed = manager.get(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        result = import_mcp_config(source_path)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=str(result.get("error", "import failed")))
        try:
            managed.studio_session.mcp_configs = load_available_servers()
        except Exception:
            managed.studio_session.mcp_configs = {}
        return result

    @app.post("/api/mcp/connect")
    async def connect_mcp_server(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "")).strip()
        name = str(payload.get("name", "")).strip()
        if not session_id or not name:
            raise HTTPException(status_code=400, detail="session_id and name are required")
        managed = manager.get(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        sess = managed.studio_session
        if sess.mcp_hub is None:
            sess.mcp_hub = MCPHub(clients=[], auto_mode=False)
        ok = mcp_connect(sess.mcp_hub, sess.mcp_configs, sess.connected_servers, name)
        if not ok:
            raise HTTPException(status_code=400, detail=f"failed to connect MCP server: {name}")
        return {"ok": True, "name": name}

    return app
