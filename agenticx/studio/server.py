#!/usr/bin/env python3
"""FastAPI server adapter for AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import os
import re
import smtplib
from pathlib import Path
from typing import Any
from typing import AsyncGenerator
from email.message import EmailMessage

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agenticx.avatar.group_chat import GroupChatRegistry
from agenticx.avatar.registry import AvatarRegistry
from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio_mcp import auto_connect_servers, import_mcp_config, load_available_servers, mcp_connect
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.runtime import AgentRuntime
from agenticx.runtime.auto_solve import AutoSolveMode
from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.loop_controller import LoopController
from agenticx.runtime.meta_tools import META_AGENT_TOOLS
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt
from agenticx.runtime.team_manager import AgentTeamManager
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
    avatar_registry = AvatarRegistry()
    group_registry = GroupChatRegistry()
    app.state.session_manager = manager
    app.state.avatar_registry = avatar_registry
    app.state.group_registry = group_registry
    desktop_token = os.getenv("AGX_DESKTOP_TOKEN", "").strip()

    async def _shutdown_lsp_for_managed(managed: Any) -> None:
        if managed is None:
            return
        session_obj = getattr(managed, "studio_session", None)
        lsp_mgr = getattr(session_obj, "_lsp_manager", None) if session_obj is not None else None
        if lsp_mgr is None:
            return
        try:
            await lsp_mgr.shutdown_all()
        except Exception as exc:
            logger.debug("LSP shutdown skipped: %s", exc)

    def _resolve_max_tool_rounds() -> int:
        raw = str(os.getenv("AGX_MAX_TOOL_ROUNDS", "")).strip()
        if not raw:
            try:
                global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
                project_data = ConfigManager._load_yaml(ConfigManager.PROJECT_CONFIG_PATH)
                merged = ConfigManager._deep_merge(global_data, project_data)
                cfg_val: Any = ConfigManager._get_nested(merged, "runtime.max_tool_rounds")
            except Exception:
                cfg_val = None
            if cfg_val is not None:
                raw = str(cfg_val).strip()
        if not raw:
            raw = "30"
        try:
            value = int(raw)
        except ValueError:
            value = 30
        # Guardrail: too low hurts completion, too high risks runaway loops/costs.
        return max(10, min(120, value))

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

    def _flush_taskspace_hint(session_id: str, session_obj: Any) -> bool:
        scratchpad = getattr(session_obj, "scratchpad", None)
        if not isinstance(scratchpad, dict):
            return False
        taskspace_hint = str(scratchpad.pop("__taskspace_hint__", "") or "").strip()
        taskspace_label_hint = str(scratchpad.pop("__taskspace_label_hint__", "") or "").strip()
        if not taskspace_hint:
            return False
        hint_path = Path(taskspace_hint).expanduser().resolve(strict=False)
        target_dir = hint_path if hint_path.is_dir() else hint_path.parent
        try:
            manager.add_taskspace(
                session_id,
                path=str(target_dir),
                label=taskspace_label_hint or target_dir.name or "taskspace",
            )
            return True
        except Exception as exc:
            logger.debug("register taskspace hint skipped: %s", exc)
            return False

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

    def _normalize_email_config(payload: dict[str, Any]) -> dict[str, Any]:
        def _parse_bool(value: Any, *, field: str) -> bool:
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                lowered = value.strip().lower()
                if lowered in {"true", "1", "yes", "on"}:
                    return True
                if lowered in {"false", "0", "no", "off"}:
                    return False
            raise ValueError(f"{field} must be boolean")

        return {
            "enabled": _parse_bool(payload.get("enabled", True), field="enabled"),
            "smtp_host": str(payload.get("smtp_host", "")).strip(),
            "smtp_port": int(payload.get("smtp_port", 587) or 587),
            "smtp_username": str(payload.get("smtp_username", "")).strip(),
            "smtp_password": str(payload.get("smtp_password", "")),
            "smtp_use_tls": _parse_bool(payload.get("smtp_use_tls", True), field="smtp_use_tls"),
            "from_email": str(payload.get("from_email", "")).strip(),
            "default_to_email": str(payload.get("default_to_email", "bingzhenli@hotmail.com")).strip() or "bingzhenli@hotmail.com",
        }

    def _mask_secret(secret: str) -> str:
        text = str(secret or "")
        if not text:
            return ""
        if len(text) <= 4:
            return "*" * len(text)
        return f"{text[:2]}{'*' * (len(text) - 4)}{text[-2:]}"

    def _normalize_context_files(payload: Any) -> dict[str, str]:
        if not isinstance(payload, dict):
            return {}
        normalized: dict[str, str] = {}
        for raw_path, raw_content in payload.items():
            path = str(raw_path or "").strip()
            if not path:
                continue
            normalized[path] = str(raw_content or "")
        return normalized

    @app.get("/api/session", response_model=SessionState)
    async def get_or_create_session(
        session_id: str | None = Query(default=None),
        provider: str | None = Query(default=None),
        model: str | None = Query(default=None),
        avatar_id: str | None = Query(default=None),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> SessionState:
        _check_token(x_agx_desktop_token)
        try:
            ensure_workspace()
        except Exception as exc:
            logger.warning("Workspace bootstrap skipped: %s", exc)
        manager.cleanup_expired()
        managed = manager.get(session_id, touch=False) if session_id else None
        if managed is not None:
            logger.info("[session] reused existing sid=%s", managed.session_id)
        if managed is None:
            avatar_cfg = avatar_registry.get_avatar(avatar_id) if avatar_id else None
            effective_provider = (avatar_cfg.default_provider if avatar_cfg and avatar_cfg.default_provider else provider)
            effective_model = (avatar_cfg.default_model if avatar_cfg and avatar_cfg.default_model else model)
            managed = manager.create(provider=effective_provider, model=effective_model, session_id=session_id)
            logger.info("[session] CREATED new sid=%s (requested=%s)", managed.session_id, session_id)
            if avatar_cfg and avatar_cfg.workspace_dir:
                managed.studio_session.workspace_dir = avatar_cfg.workspace_dir
            else:
                managed.studio_session.workspace_dir = os.getenv("AGX_WORKSPACE_ROOT", "").strip() or os.getcwd()
            managed.avatar_id = avatar_id or None
            managed.avatar_name = avatar_cfg.name if avatar_cfg else None
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
            avatar_id=getattr(managed, "avatar_id", None),
            avatar_name=getattr(managed, "avatar_name", None),
        )

    @app.get("/api/artifacts")
    async def list_artifacts(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        return {
            "session_id": session_id,
            "artifacts": {str(path): code for path, code in managed.studio_session.artifacts.items()},
        }

    @app.get("/api/session/messages")
    async def get_session_messages(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        messages = manager.get_messages(session_id)
        return {"ok": True, "messages": messages}

    @app.post("/api/session/summary")
    async def get_session_summary(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "")).strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        managed = manager.get(session_id, touch=False)
        if managed is None:
            return {"ok": True, "summary": ""}
        summary = manager._build_session_summary(managed.studio_session)
        return {"ok": True, "summary": summary}

    @app.delete("/api/session")
    async def delete_session(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        managed = manager.get(session_id, touch=False)
        await _shutdown_lsp_for_managed(managed)
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
        managed = manager.get(payload.session_id, touch=False)
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
        managed = manager.get(payload.session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        setattr(managed.studio_session, "taskspaces", list(managed.taskspaces or []))
        manager.touch(payload.session_id)
        if not managed.session_name:
            manager.auto_title_session(payload.session_id, payload.user_input)

        session = managed.studio_session
        if payload.context_files:
            session.context_files.update(_normalize_context_files(payload.context_files))
        pending_subagent_summaries = session.scratchpad.pop("__pending_subagent_summaries__", [])
        if isinstance(pending_subagent_summaries, list):
            for entry in pending_subagent_summaries[:20]:
                text = str(entry).strip()
                if not text:
                    continue
                # Inject at turn boundary to avoid breaking assistant(tool_calls)->tool pairing.
                session.agent_messages.append({"role": "system", "content": text})
        mode = (payload.mode or "interactive").strip().lower()
        if mode not in {"interactive", "auto"}:
            mode = "interactive"
        if payload.provider:
            session.provider_name = payload.provider
        if payload.model:
            session.model_name = payload.model

        def _resolve_llm():
            return ProviderResolver.resolve(
                provider_name=session.provider_name,
                model=session.model_name,
            )

        target_agent_id = (payload.agent_id or "meta").strip() or "meta"
        if target_agent_id != "meta":
            import asyncio as _asyncio

            async def _subagent_message_stream() -> AsyncGenerator[str, None]:
                team_manager = managed.team_manager or getattr(session, "_team_manager", None)
                if team_manager is None:
                    try:
                        team_manager = managed.get_or_create_team(llm_factory=_resolve_llm)
                        setattr(session, "_team_manager", team_manager)
                    except Exception as exc:
                        err = SseEvent(type="error", data={"agent_id": target_agent_id, "text": f"子智能体团队尚未初始化: {exc}"})
                        yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                        yield 'data: {"type":"done","data":{}}\n\n'
                        return

                sub_queue: "_asyncio.Queue[RuntimeEvent | None]" = _asyncio.Queue()
                prev_emitter = team_manager.event_emitter

                async def _chained_emitter(event: RuntimeEvent) -> None:
                    if prev_emitter is not None:
                        try:
                            await prev_emitter(event)
                        except Exception:
                            pass
                    if getattr(event, "agent_id", None) == target_agent_id:
                        await sub_queue.put(event)

                team_manager.event_emitter = _chained_emitter

                try:
                    result = await team_manager.send_message_to_subagent(target_agent_id, payload.user_input)
                    if not result.get("ok"):
                        msg = str(result.get("message") or "发送子智能体消息失败")
                        err = SseEvent(type="error", data={"agent_id": target_agent_id, "text": msg})
                        yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                        yield 'data: {"type":"done","data":{}}\n\n'
                        return

                    ack = SseEvent(
                        type="subagent_progress",
                        data={"agent_id": target_agent_id, "text": "已将你的补充指令发送给子智能体"},
                    )
                    yield f"data: {json.dumps(ack.model_dump(), ensure_ascii=False)}\n\n"

                    terminal_types = {"subagent_completed", "subagent_error"}
                    while True:
                        if await request.is_disconnected():
                            break
                        try:
                            event = await _asyncio.wait_for(sub_queue.get(), timeout=0.2)
                        except _asyncio.TimeoutError:
                            ctx = team_manager._agents.get(target_agent_id)
                            if ctx and ctx.status.value not in ("running", "pending"):
                                break
                            continue
                        event_data = dict(event.data)
                        event_data.setdefault("agent_id", event.agent_id)
                        sse = SseEvent(type=event.type, data=event_data)
                        yield f"data: {json.dumps(sse.model_dump(), ensure_ascii=False)}\n\n"
                        if event.type in terminal_types:
                            break
                except Exception as exc:
                    err = SseEvent(type="error", data={"agent_id": target_agent_id, "text": f"子智能体通信异常: {exc}"})
                    yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                finally:
                    team_manager.event_emitter = prev_emitter

                yield 'data: {"type":"done","data":{}}\n\n'
            return StreamingResponse(_subagent_message_stream(), media_type="text/event-stream")

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
            agent_id = getattr(context, "agent_id", "unknown")
            agent_name = getattr(context, "name", agent_id)
            status_val = getattr(getattr(context, "status", None), "value", "unknown")
            pending_reports = session.scratchpad.get("__pending_subagent_summaries__", [])
            if not isinstance(pending_reports, list):
                pending_reports = []
            pending_reports.append(
                f"[subagent_summary] [{agent_name}] (ID: {agent_id}) 状态={status_val}\n{summary}"
            )
            session.scratchpad["__pending_subagent_summaries__"] = pending_reports[-50:]
            session.chat_history.append({
                "role": "assistant",
                "content": f"子智能体汇总:\n[{agent_name}] (ID: {agent_id}) 状态={status_val}\n{summary}",
            })
            session.scratchpad[f"subagent_result::{agent_id}"] = (
                f"[{agent_name}] 状态={status_val}, 摘要: {(summary or '(无)')[:500]}"
            )

        team_manager = managed.get_or_create_team(
            llm_factory=_resolve_llm,
            event_emitter=_on_team_event,
            summary_sink=_on_subagent_summary,
        )
        setattr(session, "_team_manager", team_manager)
        logger.debug(
            "[chat] sid=%s managed.tm=%s session._tm=%s tm._agents=%s",
            payload.session_id,
            id(managed.team_manager),
            id(getattr(session, "_team_manager", None)),
            list(team_manager._agents.keys()) if team_manager else [],
        )
        try:
            runtime = AgentRuntime(
                llm,
                managed.get_confirm_gate("meta"),
                team_manager=team_manager,
                max_tool_rounds=_resolve_max_tool_rounds(),
            )
        except TypeError:
            # Backward-compatible fallback for test doubles / legacy signatures.
            runtime = AgentRuntime(
                llm,
                managed.get_confirm_gate("meta"),
            )
        avatar_context: dict[str, str] | None = None
        active_avatar_id = str(getattr(managed, "avatar_id", "") or "").strip()
        if active_avatar_id and not active_avatar_id.startswith("group:"):
            avatar_cfg = avatar_registry.get_avatar(active_avatar_id)
            if avatar_cfg is not None:
                avatar_context = {
                    "name": avatar_cfg.name or active_avatar_id,
                    "role": avatar_cfg.role or "",
                    "system_prompt": avatar_cfg.system_prompt or "",
                }

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
                        system_prompt=build_meta_agent_system_prompt(
                            session,
                            mode=mode,
                            taskspaces=managed.taskspaces,
                            avatar_context=avatar_context,
                        ),
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
                        if event.agent_id == "meta" and event.type == EventType.TOOL_RESULT.value:
                            _flush_taskspace_hint(payload.session_id, session)
                        sse = SseEvent(type=event.type, data=event_data)
                        if event.type in ("subagent_started", "subagent_completed", "subagent_error"):
                            logger.info("[sse] yielding %s agent=%s", event.type, event.agent_id)
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
                _flush_taskspace_hint(payload.session_id, session)
                manager.persist(payload.session_id)
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
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        setattr(managed.studio_session, "taskspaces", list(managed.taskspaces or []))
        manager.touch(session_id)
        try:
            max_iterations = int(payload.get("max_iterations", 8) or 8)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="max_iterations must be an integer")
        completion_promise = str(payload.get("completion_promise", "") or "").strip()

        session = managed.studio_session
        llm = ProviderResolver.resolve(provider_name=session.provider_name, model=session.model_name)
        loop_tm = managed.team_manager
        try:
            runtime = AgentRuntime(
                llm,
                managed.get_confirm_gate("meta"),
                team_manager=loop_tm,
                max_tool_rounds=_resolve_max_tool_rounds(),
            )
        except TypeError:
            runtime = AgentRuntime(
                llm,
                managed.get_confirm_gate("meta"),
            )
        controller = LoopController(max_iterations=max_iterations, completion_promise=completion_promise)

        async def _loop_stream() -> AsyncGenerator[str, None]:
            try:
                async for event in controller.run_loop(
                    task=user_input,
                    runtime=runtime,
                    session=session,
                    agent_id="meta",
                    tools=META_AGENT_TOOLS,
                    system_prompt=build_meta_agent_system_prompt(session, mode="interactive", taskspaces=managed.taskspaces),
                ):
                    if await request.is_disconnected():
                        break
                    data = dict(event.data)
                    data.setdefault("agent_id", event.agent_id)
                    if event.agent_id == "meta" and event.type == EventType.TOOL_RESULT.value:
                        _flush_taskspace_hint(session_id, session)
                    sse = SseEvent(type=event.type, data=data)
                    yield f"data: {json.dumps(sse.model_dump(), ensure_ascii=False)}\n\n"
            except Exception as exc:
                err = SseEvent(type="error", data={"text": f"Loop runtime error: {exc}"})
                yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
            finally:
                _flush_taskspace_hint(session_id, session)
                manager.persist(session_id)
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
        managed = manager.get(session_id, touch=False)
        if managed is None:
            logger.warning("[cancel] session NOT FOUND sid=%s agent=%s", session_id, agent_id)
            raise HTTPException(status_code=404, detail="session not found")
        team_manager = managed.team_manager
        if team_manager is None:
            logger.warning("[cancel] sid=%s agent=%s tm=None, trying global lookup", session_id, agent_id)
            team_manager = AgentTeamManager.find_manager_for_agent(
                agent_id,
                include_archived=False,
                session_id=session_id,
            )
            if team_manager is None:
                logger.warning("[cancel] sid=%s agent=%s global lookup also failed", session_id, agent_id)
                raise HTTPException(status_code=404, detail="agent team not initialized")
        logger.info(
            "[cancel] sid=%s agent=%s tm=%s agents=%s",
            session_id, agent_id, id(team_manager), list(team_manager._agents.keys()),
        )
        result = await team_manager.cancel_subagent(agent_id)
        if not result.get("ok"):
            fallback_manager = AgentTeamManager.find_manager_for_agent(
                agent_id,
                include_archived=False,
                session_id=session_id,
            )
            if fallback_manager is not None and fallback_manager is not team_manager:
                result = await fallback_manager.cancel_subagent(agent_id)
            if not result.get("ok"):
                logger.warning("[cancel] FAILED sid=%s agent=%s result=%s", session_id, agent_id, result)
                raise HTTPException(status_code=404, detail=result.get("message", "subagent not found"))
        return result

    @app.get("/api/subagents/status")
    async def subagents_status(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        managed = manager.get(session_id, touch=False)
        if managed is None:
            all_sids = list(manager._sessions.keys())
            logger.warning(
                "[subagents/status] session NOT FOUND sid=%s known_sessions=%s",
                session_id,
                all_sids[:10],
            )
            raise HTTPException(status_code=404, detail="session not found")
        if managed.team_manager is None:
            registry_count = len(AgentTeamManager._registry)
            logger.warning(
                "[subagents/status] sid=%s tm=None registry_managers=%d",
                session_id,
                registry_count,
            )
            global_rows = AgentTeamManager.collect_global_statuses(session_id=session_id)
            if global_rows:
                logger.warning(
                    "[subagents/status] sid=%s tm=None fallback global=%d",
                    session_id,
                    len(global_rows),
                )
                return {"ok": True, "subagents": global_rows}
            return {"ok": True, "subagents": []}
        logger.info(
            "[subagents/status] sid=%s tm=%s agents=%s tasks=%s",
            session_id,
            id(managed.team_manager),
            list(managed.team_manager._agents.keys()),
            {k: (not v.done()) for k, v in managed.team_manager._tasks.items()},
        )
        status_payload = managed.team_manager.get_status_with_task_fallback()
        if (
            isinstance(status_payload, dict)
            and status_payload.get("ok")
            and not (status_payload.get("subagents") or [])
        ):
            global_rows = AgentTeamManager.collect_global_statuses(session_id=session_id)
            if global_rows:
                logger.warning(
                    "[subagents/status] sid=%s local empty, fallback global=%d",
                    session_id,
                    len(global_rows),
                )
                status_payload = {"ok": True, "subagents": global_rows}
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
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        team_manager = managed.team_manager
        if team_manager is None:
            team_manager = AgentTeamManager.find_manager_for_agent(
                agent_id,
                include_archived=True,
                session_id=session_id,
            )
            if team_manager is None:
                raise HTTPException(status_code=404, detail="agent team not initialized")
        result = await team_manager.retry_subagent(
            agent_id,
            str(refined_task) if isinstance(refined_task, str) and refined_task.strip() else None,
        )
        if not result.get("ok"):
            fallback_manager = AgentTeamManager.find_manager_for_agent(
                agent_id,
                include_archived=True,
                session_id=session_id,
            )
            if fallback_manager is not None and fallback_manager is not team_manager:
                result = await fallback_manager.retry_subagent(
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
        managed = manager.get(session_id, touch=False)
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
        managed = manager.get(session_id, touch=False)
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
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        sess = managed.studio_session
        if sess.mcp_hub is None:
            sess.mcp_hub = MCPHub(clients=[], auto_mode=False)
        ok = mcp_connect(sess.mcp_hub, sess.mcp_configs, sess.connected_servers, name)
        if not ok:
            raise HTTPException(status_code=400, detail=f"failed to connect MCP server: {name}")
        return {"ok": True, "name": name}

    @app.post("/api/test-email")
    async def test_email(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        config_raw = payload.get("config", {})
        if not isinstance(config_raw, dict):
            raise HTTPException(status_code=400, detail="config must be an object")
        allowlist = {
            "enabled",
            "smtp_host",
            "smtp_port",
            "smtp_username",
            "smtp_password",
            "smtp_use_tls",
            "from_email",
            "default_to_email",
        }
        for key in config_raw.keys():
            if key not in allowlist:
                raise HTTPException(status_code=400, detail=f"invalid config key: {key}")
        try:
            config = _normalize_email_config(config_raw)
        except Exception:
            raise HTTPException(status_code=400, detail="invalid email config payload")
        if not config["enabled"]:
            raise HTTPException(status_code=400, detail="email is disabled")
        missing = [
            key
            for key in ("smtp_host", "smtp_username", "smtp_password", "from_email")
            if not str(config.get(key, "")).strip()
        ]
        if missing:
            raise HTTPException(status_code=400, detail=f"missing required fields: {', '.join(missing)}")
        to_email = str(payload.get("to_email", config["default_to_email"])).strip() or config["default_to_email"]
        message = EmailMessage()
        message["Subject"] = "[AgenticX] SMTP Test"
        message["From"] = str(config["from_email"])
        message["To"] = to_email
        message.set_content(
            "This is a test email from AgenticX Desktop.\n"
            "If you received this email, SMTP configuration works correctly."
        )
        try:
            with smtplib.SMTP(str(config["smtp_host"]), int(config["smtp_port"]), timeout=20) as smtp:
                if bool(config["smtp_use_tls"]):
                    smtp.starttls()
                smtp.login(str(config["smtp_username"]), str(config["smtp_password"]))
                smtp.send_message(message)
        except Exception as exc:
            logger.warning("email test failed: %s", exc)
            raise HTTPException(status_code=400, detail="email test failed")
        masked = dict(config)
        masked["smtp_password"] = _mask_secret(str(masked.get("smtp_password", "")))
        return {"ok": True, "message": "测试邮件发送成功。", "to_email": to_email, "config": masked}

    # --- Avatar CRUD ---

    @app.get("/api/avatars")
    async def list_avatars(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        avatars = avatar_registry.list_avatars()
        return {
            "ok": True,
            "avatars": [a.to_dict() for a in avatars],
        }

    @app.post("/api/avatars")
    async def create_avatar(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        name = str(payload.get("name", "")).strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        config = avatar_registry.create_avatar(
            name=name,
            role=str(payload.get("role", "")).strip(),
            avatar_url=str(payload.get("avatar_url", "")).strip(),
            system_prompt=str(payload.get("system_prompt", "")).strip(),
            created_by=str(payload.get("created_by", "manual")).strip(),
            default_provider=str(payload.get("default_provider", "")).strip(),
            default_model=str(payload.get("default_model", "")).strip(),
        )
        return {"ok": True, "avatar": config.to_dict()}

    @app.put("/api/avatars/{avatar_id}")
    async def update_avatar(
        avatar_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        updated = avatar_registry.update_avatar(avatar_id, payload)
        if updated is None:
            raise HTTPException(status_code=404, detail="avatar not found")
        return {"ok": True, "avatar": updated.to_dict()}

    @app.delete("/api/avatars/{avatar_id}")
    async def delete_avatar(
        avatar_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        ok = avatar_registry.delete_avatar(avatar_id)
        if not ok:
            raise HTTPException(status_code=404, detail="avatar not found")
        return {"ok": True}

    # --- Multi-session management ---

    @app.get("/api/sessions")
    async def list_sessions(
        avatar_id: str | None = Query(default=None),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        sessions = manager.list_sessions(avatar_id=avatar_id)
        return {"ok": True, "sessions": sessions}

    @app.post("/api/sessions")
    async def create_session(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        avatar_id = str(payload.get("avatar_id", "")).strip() or None
        session_name = str(payload.get("name", "")).strip() or None
        inherit_from = str(payload.get("inherit_from_session_id", "")).strip() or None
        avatar_cfg = avatar_registry.get_avatar(avatar_id) if avatar_id else None
        provider = avatar_cfg.default_provider if avatar_cfg and avatar_cfg.default_provider else None
        model = avatar_cfg.default_model if avatar_cfg and avatar_cfg.default_model else None

        inherited_summary = ""
        inherited_context_files: dict = {}
        inherited_scratchpad: dict = {}
        if inherit_from:
            old_managed = manager.get(inherit_from, touch=False)
            if old_managed is not None:
                inherited_summary = manager._build_session_summary(old_managed.studio_session)
                inherited_context_files = dict(old_managed.studio_session.context_files)
                inherited_scratchpad = {
                    k: v for k, v in (old_managed.studio_session.scratchpad or {}).items()
                    if k.startswith("subagent_result::")
                }

        managed = manager.create(provider=provider, model=model)
        if avatar_cfg and avatar_cfg.workspace_dir:
            managed.studio_session.workspace_dir = avatar_cfg.workspace_dir
        else:
            managed.studio_session.workspace_dir = os.getenv("AGX_WORKSPACE_ROOT", "").strip() or os.getcwd()
        managed.avatar_id = avatar_id
        managed.avatar_name = avatar_cfg.name if avatar_cfg else None
        managed.session_name = session_name

        if inherited_summary:
            managed.studio_session.agent_messages.append({
                "role": "system",
                "content": f"[context_inherited] 以下是前一话题的上下文摘要，用于保持连续性：\n{inherited_summary}"
            })
        if inherited_context_files:
            managed.studio_session.context_files.update(inherited_context_files)
        if inherited_scratchpad:
            managed.studio_session.scratchpad.update(inherited_scratchpad)

        try:
            managed.studio_session.mcp_configs = load_available_servers()
        except Exception:
            managed.studio_session.mcp_configs = {}
        return {
            "ok": True,
            "session_id": managed.session_id,
            "avatar_id": avatar_id,
            "session_name": session_name,
            "created_at": managed.created_at,
            "inherited": bool(inherited_summary),
        }

    @app.put("/api/sessions/{session_id}")
    async def rename_session(
        session_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        name = str(payload.get("name", "")).strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")
        ok = manager.rename_session(session_id, name)
        if not ok:
            raise HTTPException(status_code=404, detail="session not found")
        return {"ok": True}

    @app.post("/api/sessions/{session_id}/pin")
    async def pin_session(
        session_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        pinned_raw = payload.get("pinned", True)
        if isinstance(pinned_raw, bool):
            pinned = pinned_raw
        elif isinstance(pinned_raw, str):
            lowered = pinned_raw.strip().lower()
            if lowered in {"true", "1", "yes", "on"}:
                pinned = True
            elif lowered in {"false", "0", "no", "off"}:
                pinned = False
            else:
                raise HTTPException(status_code=400, detail="pinned must be a boolean")
        else:
            raise HTTPException(status_code=400, detail="pinned must be a boolean")
        ok = manager.pin_session(session_id, pinned)
        if not ok:
            raise HTTPException(status_code=404, detail="session not found")
        return {"ok": True, "session_id": session_id, "pinned": pinned}

    @app.post("/api/sessions/{session_id}/fork")
    async def fork_session(
        session_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        managed = manager.fork_session(session_id)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        return {
            "ok": True,
            "session_id": managed.session_id,
            "avatar_id": managed.avatar_id,
            "session_name": managed.session_name,
        }

    @app.post("/api/sessions/archive-before")
    async def archive_sessions_before(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "")).strip()
        avatar_id_raw = payload.get("avatar_id")
        avatar_id = str(avatar_id_raw).strip() if isinstance(avatar_id_raw, str) else None
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        count = manager.archive_sessions_before(session_id, avatar_id=avatar_id)
        if count < 0:
            raise HTTPException(status_code=404, detail="session not found")
        return {"ok": True, "archived_count": count}

    @app.post("/api/sessions/batch-delete")
    async def batch_delete_sessions(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        raw_ids = payload.get("session_ids", [])
        if not isinstance(raw_ids, list):
            raise HTTPException(status_code=400, detail="session_ids must be a list")
        session_ids: list[str] = []
        seen: set[str] = set()
        for raw in raw_ids:
            sid = str(raw or "").strip()
            if not sid or sid in seen:
                continue
            session_ids.append(sid)
            seen.add(sid)
        if not session_ids:
            return {"ok": True, "deleted": [], "failed": []}
        deleted: list[str] = []
        failed: list[str] = []
        for sid in session_ids:
            try:
                managed = manager.get(sid, touch=False)
                await _shutdown_lsp_for_managed(managed)
                ok = manager.delete(sid)
            except Exception:
                ok = False
            if ok:
                deleted.append(sid)
            else:
                failed.append(sid)
        return {"ok": True, "deleted": deleted, "failed": failed}

    # --- Taskspace management ---

    @app.get("/api/taskspace/workspaces")
    async def list_taskspace_workspaces(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        return {"ok": True, "workspaces": manager.list_taskspaces(session_id)}

    @app.post("/api/taskspace/workspaces")
    async def add_taskspace_workspace(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "")).strip()
        path = str(payload.get("path", "")).strip() or None
        label = str(payload.get("label", "")).strip() or None
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        try:
            workspace = manager.add_taskspace(session_id, path=path, label=label)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except KeyError:
            raise HTTPException(status_code=404, detail="session not found")
        return {"ok": True, "workspace": workspace}

    @app.delete("/api/taskspace/workspaces")
    async def remove_taskspace_workspace(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "")).strip()
        taskspace_id = str(payload.get("taskspace_id", "")).strip()
        if not session_id or not taskspace_id:
            raise HTTPException(status_code=400, detail="session_id and taskspace_id are required")
        ok = manager.remove_taskspace(session_id, taskspace_id)
        if not ok:
            raise HTTPException(status_code=404, detail="taskspace not found")
        return {"ok": True}

    @app.get("/api/taskspace/files")
    async def list_taskspace_files(
        session_id: str = Query(...),
        taskspace_id: str = Query(...),
        path: str = Query(default="."),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        if not session_id or not taskspace_id:
            raise HTTPException(status_code=400, detail="session_id and taskspace_id are required")
        try:
            files = manager.list_taskspace_files(session_id, taskspace_id, rel_path=path)
        except KeyError as exc:
            detail = str(exc.args[0]) if getattr(exc, "args", None) else "session not found"
            raise HTTPException(status_code=404, detail=detail)
        except (ValueError, FileNotFoundError, NotADirectoryError) as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return {"ok": True, "files": files}

    @app.get("/api/taskspace/file")
    async def read_taskspace_file(
        session_id: str = Query(...),
        taskspace_id: str = Query(...),
        path: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        if not session_id or not taskspace_id or not path:
            raise HTTPException(status_code=400, detail="session_id, taskspace_id and path are required")
        try:
            file_payload = manager.read_taskspace_file(session_id, taskspace_id, rel_path=path)
        except KeyError as exc:
            detail = str(exc.args[0]) if getattr(exc, "args", None) else "session not found"
            raise HTTPException(status_code=404, detail=detail)
        except IsADirectoryError as exc:
            raise HTTPException(status_code=400, detail=f"path is a directory: {exc}")
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return {"ok": True, **file_payload}

    # --- Avatar fork & AI generate ---

    @app.post("/api/avatars/fork")
    async def fork_avatar(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "")).strip()
        name = str(payload.get("name", "")).strip()
        role = str(payload.get("role", "")).strip()
        if not session_id or not name:
            raise HTTPException(status_code=400, detail="session_id and name are required")
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        config = avatar_registry.create_avatar(
            name=name,
            role=role,
            created_by="session_fork",
        )
        sess = managed.studio_session
        ws = Path(config.workspace_dir)
        memory_content = "# MEMORY.md - Forked from session\n\n"
        for msg in (sess.chat_history or [])[-20:]:
            r = msg.get("role", "")
            c = str(msg.get("content", ""))[:200]
            memory_content += f"- [{r}] {c}\n"
        (ws / "MEMORY.md").write_text(memory_content, encoding="utf-8")
        return {"ok": True, "avatar": config.to_dict()}

    @app.post("/api/avatars/generate")
    async def generate_avatar(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        description = str(payload.get("description", "")).strip()
        if not description:
            raise HTTPException(status_code=400, detail="description is required")
        try:
            llm = ProviderResolver.resolve()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"LLM init failed: {exc}")
        prompt = (
            "Based on the following user description, generate a digital avatar configuration.\n"
            "Return ONLY valid JSON with these fields: name, role, system_prompt.\n"
            f"Description: {description}\n"
            "JSON:"
        )
        try:
            response = llm.invoke(
                [{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=512,
            )
            text = response.content.strip()
            json_match = re.search(r"\{.*\}", text, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group())
            else:
                parsed = json.loads(text)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"LLM generation failed: {exc}")
        config = avatar_registry.create_avatar(
            name=str(parsed.get("name", "Avatar")).strip(),
            role=str(parsed.get("role", "")).strip(),
            system_prompt=str(parsed.get("system_prompt", "")).strip(),
            created_by="ai",
        )
        return {"ok": True, "avatar": config.to_dict()}

    # --- Group Chat CRUD ---

    @app.get("/api/groups")
    async def list_groups(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        groups = group_registry.list_groups()
        return {"ok": True, "groups": [g.to_dict() for g in groups]}

    @app.post("/api/groups")
    async def create_group(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        name = str(payload.get("name", "")).strip()
        avatar_ids = payload.get("avatar_ids", [])
        routing = str(payload.get("routing", "user-directed")).strip()
        allowed_routing = {"user-directed", "meta-routed", "round-robin"}
        if not name or not avatar_ids:
            raise HTTPException(status_code=400, detail="name and avatar_ids are required")
        if not isinstance(avatar_ids, list):
            raise HTTPException(status_code=400, detail="avatar_ids must be a list")
        if routing not in allowed_routing:
            raise HTTPException(status_code=400, detail="invalid routing strategy")
        normalized_avatar_ids: list[str] = []
        for item in avatar_ids:
            avatar_id = str(item).strip()
            if not avatar_id:
                continue
            if avatar_registry.get_avatar(avatar_id) is None:
                raise HTTPException(status_code=400, detail=f"unknown avatar_id: {avatar_id}")
            if avatar_id not in normalized_avatar_ids:
                normalized_avatar_ids.append(avatar_id)
        if not normalized_avatar_ids:
            raise HTTPException(status_code=400, detail="avatar_ids must contain at least one valid avatar")
        config = group_registry.create_group(name=name, avatar_ids=normalized_avatar_ids, routing=routing)
        return {"ok": True, "group": config.to_dict()}

    @app.put("/api/groups/{group_id}")
    async def update_group(
        group_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        patch: dict[str, Any] = {}
        allowed_routing = {"user-directed", "meta-routed", "round-robin"}
        if "name" in payload:
            name = str(payload.get("name", "")).strip()
            if not name:
                raise HTTPException(status_code=400, detail="name cannot be empty")
            patch["name"] = name
        if "avatar_ids" in payload:
            avatar_ids = payload.get("avatar_ids", [])
            if not isinstance(avatar_ids, list) or not avatar_ids:
                raise HTTPException(status_code=400, detail="avatar_ids must be a non-empty list")
            normalized_avatar_ids: list[str] = []
            for item in avatar_ids:
                avatar_id = str(item).strip()
                if not avatar_id:
                    continue
                if avatar_registry.get_avatar(avatar_id) is None:
                    raise HTTPException(status_code=400, detail=f"unknown avatar_id: {avatar_id}")
                if avatar_id not in normalized_avatar_ids:
                    normalized_avatar_ids.append(avatar_id)
            if not normalized_avatar_ids:
                raise HTTPException(status_code=400, detail="avatar_ids must contain at least one valid avatar")
            patch["avatar_ids"] = normalized_avatar_ids
        if "routing" in payload:
            routing = str(payload.get("routing", "user-directed")).strip()
            if routing not in allowed_routing:
                raise HTTPException(status_code=400, detail="invalid routing strategy")
            patch["routing"] = routing
        if not patch:
            raise HTTPException(status_code=400, detail="no valid fields to update")
        config = group_registry.update_group(group_id, patch)
        if config is None:
            raise HTTPException(status_code=404, detail="group not found")
        return {"ok": True, "group": config.to_dict()}

    @app.delete("/api/groups/{group_id}")
    async def delete_group(
        group_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        ok = group_registry.delete_group(group_id)
        if not ok:
            raise HTTPException(status_code=404, detail="group not found")
        return {"ok": True}

    return app
