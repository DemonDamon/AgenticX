#!/usr/bin/env python3
"""FastAPI server adapter for AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import contextlib
import copy
import importlib.util
import json
import logging
import os
import re
import shutil
import smtplib
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from typing import AsyncGenerator
from typing import Dict
from email.message import EmailMessage

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from jsonschema import Draft202012Validator

from agenticx.avatar.group_chat import GroupChatRegistry
from agenticx.avatar.registry import AvatarRegistry
from agenticx.branding import DEFAULT_META_PRODUCT_LABEL
from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.mcp_discovery import detect_all
from agenticx.hooks import load_discovered_hooks
from agenticx.cli.studio_mcp import (
    agenticx_home_mcp_path,
    append_mcp_auto_connect_name,
    auto_connect_servers,
    auto_connect_servers_async,
    get_default_mcp_entry_names,
    get_mcp_disabled_tools_config,
    get_mcp_extra_search_paths_config,
    get_mcp_skip_default_names_config,
    import_mcp_config,
    load_available_servers,
    mcp_connect,
    mcp_connect_async,
    mcp_disconnect_async,
    remove_mcp_auto_connect_name,
    set_mcp_disabled_tools_config,
    set_mcp_extra_search_paths_config,
    set_mcp_skip_default_names_config,
)
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.runtime import AgentRuntime, AutoApproveConfirmGate, AutoSuspendClarifyGate
from agenticx.runtime.auto_solve import AutoSolveMode
from agenticx.runtime.events import EventType, RuntimeEvent, normalize_tool_sse_payload
from agenticx.runtime.loop_controller import LoopController
from agenticx.cli.agent_tools import (
    META_TOOL_NAMES,
    STUDIO_TOOLS,
    _code_search_tool_defs,
    merge_computer_use_tools_into,
)
from agenticx.runtime.meta_tools import META_AGENT_TOOLS, META_LEADER_LABEL_SCRATCH_KEY
from agenticx.runtime.prompts.meta_agent import _build_taskspaces_context, build_meta_agent_system_prompt
from agenticx.runtime.group_router import (
    META_LEADER_AGENT_ID,
    GroupChatRouter,
    expand_mentions_with_meta_leader,
)
from agenticx.runtime.team_manager import AgentTeamManager
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.studio.subagent_review import (
    collect_memory_status_map,
    list_subagent_clusters_payload,
    merge_run_record_with_memory,
    paginate_activity_entries,
    preview_artifact_file,
    resolve_artifact_path,
)
from agenticx.studio.protocols import (
    ChatRequest,
    ClarifyResponse,
    ConfirmResponse,
    ContinueRequest,
    SessionState,
    SseEvent,
)
from agenticx.studio.continuation import (
    ContinuationReason,
    ContinuationSource,
    live_reattach_enabled,
    prepare_continue,
)
from agenticx.studio.session_event_hub import BufferedEvent
from agenticx.studio.session_manager import (
    SessionManager,
    _messages_last_turn_promised_action_without_followthrough,
    _visible_assistant_body,
    managed_session_binding_matches_avatar_query,
)
from agenticx.tools.mcp_hub import MCPHub
from agenticx.studio.kb.routes import register_kb_routes
from agenticx.studio.code_index.routes import register_code_index_routes
from agenticx.brain.routes import register_brain_routes
from agenticx.studio.voice_endpoints import register_voice_endpoints
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.workspace.loader import (
    append_long_term_memory,
    delete_favorite,
    delete_memory_entry,
    delete_memory_entries_batch,
    ensure_workspace,
    load_favorites,
    read_memory_entries,
    remove_favorite_memory_note,
    resolve_subject_workspace_dir,
    resolve_workspace_dir,
    update_favorite_tags,
    update_memory_entry,
    upsert_favorite,
)

logger = logging.getLogger(__name__)

_MODELSCOPE_LIST_URL = "https://www.modelscope.cn/openapi/v1/mcp/servers"
_MODELSCOPE_DETAIL_URL_TMPL = "https://www.modelscope.cn/openapi/v1/mcp/servers/{server_id}"
_MCP_MARKETPLACE_CACHE_TTL_SECONDS = 1800.0
_MCP_MARKETPLACE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

_ERR_STALE_MCP = (
    "会话标记为已连接，但当前未注册任何 MCP 工具；子进程可能已退出或握手不完整。"
    "请先关闭开关再重新打开以重连。"
)


def _mcp_tool_counts_for_session(studio_session: Any) -> dict[str, int]:
    """Count routed MCP tools per configured server name."""
    hub = getattr(studio_session, "mcp_hub", None)
    routing = getattr(hub, "_tool_routing", None) if hub is not None else None
    if not routing:
        return {}
    counts: dict[str, int] = {}
    for _routed_name, route in routing.items():
        try:
            srv = route.client.server_config.name
        except Exception:
            continue
        key = str(srv)
        counts[key] = counts.get(key, 0) + 1
    return counts


def _mcp_tool_names_for_session(studio_session: Any) -> dict[str, list[str]]:
    """Return original tool names grouped by configured server name."""
    hub = getattr(studio_session, "mcp_hub", None)
    routing = getattr(hub, "_tool_routing", None) if hub is not None else None
    if not routing:
        return {}
    result: dict[str, list[str]] = {}
    for _routed_name, route in routing.items():
        try:
            srv = str(route.client.server_config.name)
            original = str(route.original_name)
        except Exception:
            continue
        result.setdefault(srv, [])
        if original not in result[srv]:
            result[srv].append(original)
    return result


def _get_mcp_server_ops(studio_session: Any) -> dict[str, dict[str, Any]]:
    """Get mutable per-server operation states for one studio session."""
    raw = getattr(studio_session, "mcp_server_ops", None)
    if isinstance(raw, dict):
        return raw
    setattr(studio_session, "mcp_server_ops", {})
    return getattr(studio_session, "mcp_server_ops")


def _set_mcp_server_op(
    studio_session: Any,
    name: str,
    *,
    phase: str,
    message: str,
    error: str = "",
) -> None:
    """Set latest concise operation status for one MCP server card."""
    key = str(name or "").strip()
    if not key:
        return
    ops = _get_mcp_server_ops(studio_session)
    ops[key] = {
        "phase": str(phase or "idle"),
        "message": str(message or "").strip(),
        "error": str(error or "").strip(),
        "updated_at": float(time.time()),
    }


def _get_mcp_connect_tasks(studio_session: Any) -> dict[str, asyncio.Task[Any]]:
    """Get in-flight MCP connect tasks for one studio session."""
    raw = getattr(studio_session, "mcp_connect_tasks", None)
    if isinstance(raw, dict):
        return raw
    setattr(studio_session, "mcp_connect_tasks", {})
    return getattr(studio_session, "mcp_connect_tasks")


def _get_mcp_connect_cancelled(studio_session: Any) -> set[str]:
    """Get server names whose in-flight connect has been cancelled by user."""
    raw = getattr(studio_session, "mcp_connect_cancelled", None)
    if isinstance(raw, set):
        return raw
    setattr(studio_session, "mcp_connect_cancelled", set())
    return getattr(studio_session, "mcp_connect_cancelled")


def _runtime_error_counts_as_failure(event: RuntimeEvent) -> bool:
    """Return True when a runtime ERROR should leave the session interrupted."""
    if event.type != EventType.ERROR.value:
        return False
    data = event.data if isinstance(event.data, dict) else {}
    text = str(data.get("text", "") or "")
    severity = str(data.get("severity", "") or "").strip().lower()
    detector = str(data.get("detector", "") or "").strip().lower()
    if severity == "warning":
        return False
    if "已达到最大工具调用轮数" in text:
        return False
    if detector in {"token_budget_compress", "compactor_circuit_breaker"}:
        return False
    return True


def _resolve_chat_end_execution_state(
    manager: SessionManager,
    session_id: str,
    *,
    saw_final: bool,
    had_runtime_failure: bool,
) -> str:
    """Pick idle vs interrupted when a chat SSE stream ends."""
    if manager.should_interrupt(session_id):
        return "interrupted"
    if had_runtime_failure and not saw_final:
        return "interrupted"
    return "idle"


def _flush_taskspace_hint(
    manager: SessionManager,
    session_id: str,
    session_obj: Any,
) -> bool:
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


def _runtime_event_to_sse_lines(event: RuntimeEvent) -> list[str]:
    """Serialize RuntimeEvent to SSE data line(s); emit token_usage after final when usage present."""
    event_data = dict(event.data)
    event_data.setdefault("agent_id", event.agent_id)
    if event.type in (
        EventType.TOOL_CALL.value,
        EventType.TOOL_RESULT.value,
        EventType.TOOL_PROGRESS.value,
    ):
        event_data = normalize_tool_sse_payload(event_data)
    usage_meta = None
    if event.type == EventType.FINAL.value:
        usage_meta = event_data.pop("usage_metadata", None)
    sse = SseEvent(type=event.type, data=event_data)
    lines = [f"data: {json.dumps(sse.model_dump(), ensure_ascii=False)}\n\n"]
    cc_status = _extract_cc_bridge_status_event(event.type, event_data)
    if cc_status is not None:
        cse = SseEvent(type="cc_bridge_status", data=cc_status)
        lines.append(f"data: {json.dumps(cse.model_dump(), ensure_ascii=False)}\n\n")
    if event.type == EventType.FINAL.value and usage_meta:
        tu = SseEvent(type="token_usage", data=usage_meta)
        lines.append(f"data: {json.dumps(tu.model_dump(), ensure_ascii=False)}\n\n")
    return lines


def _buffered_event_to_sse_lines(buffered: BufferedEvent) -> list[str]:
    """Serialize a hub-buffered event with monotonic SSE ``id:`` for reattach replay."""
    if buffered.event is None:
        return [
            f"id: {buffered.seq}\n",
            'data: {"type":"done","data":{}}\n\n',
        ]
    lines = [f"id: {buffered.seq}\n"]
    lines.extend(_runtime_event_to_sse_lines(buffered.event))
    return lines


def _persist_clarification_prompt(session: Any, data: Dict[str, Any], *, suspended: bool = False) -> None:
    """Append a UI-visible clarification prompt row to chat_history (NFR-2).

    Idempotent: skip if the last row already records the same request_id.
    The ``metadata.kind == "clarification"`` marker is filtered out of LLM
    context by the runtime sanitizer so it does not pollute the next turn;
    the user's actual answer arrives separately as a real tool result.
    """
    try:
        request_id = str(data.get("id", "") or "")
        if not request_id:
            return
        history = getattr(session, "chat_history", None)
        if history is None:
            return
        if history:
            tail = history[-1]
            if (
                isinstance(tail, dict)
                and tail.get("role") == "tool"
                and isinstance(tail.get("metadata"), dict)
                and tail["metadata"].get("kind") == "clarification"
                and str(tail["metadata"].get("request_id", "")) == request_id
            ):
                return
        prompt = str(data.get("prompt", "") or "")
        options = list(data.get("options", []) or [])
        decisions = list(data.get("decisions", []) or [])
        allow_free_text = bool(data.get("allow_free_text", True))
        row: Dict[str, Any] = {
            "role": "tool",
            "content": prompt,
            "metadata": {
                "kind": "clarification",
                "request_id": request_id,
                "prompt": prompt,
                "options": options,
                "allow_free_text": allow_free_text,
                "suspended": suspended,
            },
        }
        if decisions:
            row["metadata"]["decisions"] = decisions
        ctx = data.get("context")
        if isinstance(ctx, dict) and ctx:
            row["metadata"]["context"] = ctx
        history.append(row)
    except Exception:
        logger.exception("[clarify] failed to persist clarification prompt")


def _parse_sse_since_seq(
    last_event_id: str | None,
    since_query: str | None,
) -> int:
    for raw in (since_query, last_event_id):
        if raw is None:
            continue
        text = str(raw).strip()
        if not text:
            continue
        try:
            return max(0, int(text))
        except ValueError:
            continue
    return 0


def _accumulate_meta_partial_text(partial: str, event: RuntimeEvent) -> str:
    """Append meta TOKEN text for interrupted-turn partial finalize."""
    if event.agent_id != "meta" or event.type != EventType.TOKEN.value:
        return partial
    tok = str((event.data or {}).get("text", "") or "")
    if tok == "⏳":
        return partial
    return partial + tok


def _finalize_partial_assistant_if_needed(
    session: Any,
    partial_meta_text: str,
    *,
    saw_final: bool,
) -> bool:
    """Append interrupted partial assistant to chat_history when FINAL never arrived."""
    if saw_final:
        return False
    body = _visible_assistant_body(partial_meta_text)
    if not body:
        return False
    session.chat_history.append(
        {
            "role": "assistant",
            "content": partial_meta_text,
            "metadata": {"source": "interrupted-partial"},
        }
    )
    return True


async def _finalize_chat_runtime(
    manager: SessionManager,
    session_id: str,
    session: Any,
    *,
    saw_final: bool,
    had_runtime_failure: bool,
    interruption_cause: str | None = None,
) -> None:
    from agenticx.studio.turn_interruption import (
        append_turn_interruption_notice,
        resolve_turn_interruption_cause,
    )

    _flush_taskspace_hint(manager, session_id, session)
    history = getattr(session, "chat_history", None) or []
    deferred_action = saw_final and _messages_last_turn_promised_action_without_followthrough(
        [m for m in history if isinstance(m, dict)]
    )
    cause = interruption_cause
    if deferred_action:
        append_turn_interruption_notice(session, cause="deferred_action", saw_final=False)
    elif not saw_final and cause is None:
        cause = resolve_turn_interruption_cause(
            manager,
            session_id,
            saw_final=saw_final,
            had_runtime_failure=had_runtime_failure,
        )
        append_turn_interruption_notice(session, cause=cause, saw_final=saw_final)
    else:
        append_turn_interruption_notice(session, cause=cause, saw_final=saw_final)
    effective_saw_final = saw_final and not deferred_action
    end_state = _resolve_chat_end_execution_state(
        manager,
        session_id,
        saw_final=effective_saw_final,
        had_runtime_failure=had_runtime_failure,
    )
    manager.clear_interrupt(session_id)
    manager.set_execution_state(session_id, end_state)
    if not had_runtime_failure and end_state != "interrupted":
        try:
            from agenticx.runtime.todo_disk_reconcile import reconcile_todos_with_disk

            notice = reconcile_todos_with_disk(session)
            if notice:
                import uuid

                session.chat_history.append(
                    {
                        "id": uuid.uuid4().hex,
                        "role": "tool",
                        "content": notice,
                        "agent_id": "meta",
                        "metadata": {"kind": "todo_disk_reconcile", "source": "runtime"},
                    }
                )
        except Exception as exc:
            logger.debug("todo disk reconcile skipped session=%s: %s", session_id, exc)
    # Persist touches SQLite (session_summaries upsert + FTS reindex over a
    # potentially large sessions.sqlite). Run it off the event loop so a single
    # turn-end persist cannot stall concurrent /api/chat, /api/usage/* and
    # /api/memory/graph/* requests.
    await manager.persist_async(session_id)
    if not had_runtime_failure:
        try:
            from agenticx.memory.graph.writer import schedule_turn_ingest_from_session

            managed = manager.get(session_id, touch=False)
            avatar_id = getattr(managed, "avatar_id", None) if managed is not None else None
            schedule_turn_ingest_from_session(
                session_id,
                avatar_id=avatar_id,
                chat_history=getattr(session, "chat_history", None),
            )
        except Exception as exc:
            logger.warning("memory graph turn ingest schedule failed session=%s: %s", session_id, exc)


def _extract_cc_bridge_status_event(event_type: str, event_data: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize cc_bridge lifecycle into a stable SSE event for UI/adapters."""
    tool_name = str(event_data.get("name") or "").strip()
    if event_type == EventType.TOOL_CALL.value and tool_name in {
        "cc_bridge_start",
        "cc_bridge_send",
        "cc_bridge_stop",
    }:
        return {
            "tool": tool_name,
            "phase": "calling",
            "state": "in_progress",
            "agent_id": str(event_data.get("agent_id") or "meta"),
        }

    if event_type != EventType.TOOL_RESULT.value:
        return None
    if tool_name not in {"cc_bridge_start", "cc_bridge_send", "cc_bridge_stop"}:
        return None

    parsed: dict[str, Any] = {}
    raw_result = event_data.get("result")
    if isinstance(raw_result, str):
        try:
            obj = json.loads(raw_result)
            if isinstance(obj, dict):
                parsed = obj
        except Exception:
            parsed = {}

    payload: dict[str, Any] = {
        "tool": tool_name,
        "phase": "result",
        "agent_id": str(event_data.get("agent_id") or "meta"),
    }

    if tool_name == "cc_bridge_start":
        payload.update(
            {
                "state": "session_started",
                "session_id": str(parsed.get("session_id") or ""),
                "mode": str(parsed.get("mode") or ""),
                "interactive_waiting": str(parsed.get("mode") or "") == "visible_tui",
            }
        )
        return payload

    if tool_name == "cc_bridge_send":
        mode = str(parsed.get("mode") or "")
        interactive = bool(parsed.get("interactive", False))
        ok = bool(parsed.get("ok", False))
        if mode == "visible_tui" and interactive:
            payload.update(
                {
                    "state": "awaiting_user_terminal_input",
                    "mode": mode,
                    "interactive": True,
                    "final_available": bool(parsed.get("final_available", False)),
                    "must_not_summarize_as_complete": bool(
                        parsed.get("must_not_summarize_as_complete", True)
                    ),
                }
            )
        else:
            payload.update(
                {
                    "state": "completed" if ok else "failed",
                    "mode": mode or "headless",
                    "ok": ok,
                }
            )
        return payload

    # cc_bridge_stop
    status = str(parsed.get("status") or "").strip().lower()
    payload.update(
        {
            "state": "session_stopped" if status in {"stopped", "ok"} else "stop_failed",
            "status": status or "unknown",
        }
    )
    return payload


def _minimax_m2_family_no_vision(model_name: str) -> bool:
    """MiniMax M2 chat line does not accept image/audio input (vendor docs)."""
    from agenticx.llms.vision import _minimax_m2_family_no_vision as _impl

    return _impl(model_name)


def _zhipu_glm5_family_no_vision(model_name: str) -> bool:
    """GLM-5 chat SKUs on BigModel v4 reject multimodal message parts (image_url)."""
    from agenticx.llms.vision import _zhipu_glm5_family_no_vision as _impl

    return _impl(model_name)


async def _llm_suggest_session_title_job(manager: SessionManager, session_id: str) -> None:
    """Background: replace query-truncated title with a short LLM title (one-shot per session)."""
    sid = str(session_id or "").strip()
    if not sid:
        return
    try:
        managed = manager.get(sid, touch=False)
        if managed is None:
            return
        session = managed.studio_session
        override = (os.environ.get("AGX_SESSION_TITLE_MODEL") or "").strip()
        try:
            timeout_raw = os.environ.get("AGX_SESSION_TITLE_TIMEOUT_SECONDS", "28")
            title_timeout = float(str(timeout_raw).strip() or "28")
        except (TypeError, ValueError):
            title_timeout = 28.0
        if title_timeout <= 0:
            title_timeout = 28.0
        try:
            if override:
                llm = ProviderResolver.resolve(
                    provider_name=session.provider_name,
                    model=override,
                )
            else:
                llm = ProviderResolver.resolve(
                    provider_name=session.provider_name,
                    model=session.model_name,
                )
        except Exception as exc:
            logger.warning("[session_title] provider resolve failed session_id=%s: %s", sid, exc)
            manager.apply_llm_suggested_session_title(sid, None)
            return

        hist = session.chat_history or []
        first_user = ""
        first_asst = ""
        for item in hist:
            role = str(item.get("role") or "")
            text = SessionManager._text_from_chat_history_item(item)
            if not text:
                continue
            if role == "user" and not first_user:
                first_user = text
            elif role == "assistant" and not first_asst:
                first_asst = text
            if first_user and first_asst:
                break

        system = (
            "你是会话命名助手。根据用户首条问题与助手首条可见回复，输出一个简洁中文标题："
            "单行，不超过20个汉字；不要引号或书名号；不要以冒号、句号结尾；不要复述整句用户原文。"
        )
        user_block = f"用户：{first_user[:600]}\n\n助手：{first_asst[:1200]}"
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_block},
        ]
        resp = await asyncio.wait_for(llm.ainvoke(messages), timeout=title_timeout)
        raw = (resp.content or "").strip()
        manager.apply_llm_suggested_session_title(sid, raw)
    except Exception as exc:
        logger.warning("[session_title] llm suggest failed session_id=%s: %s", sid, exc)
        try:
            manager.apply_llm_suggested_session_title(sid, None)
        except Exception:
            pass


def _build_automation_runner_system_prompt(
    automation_avatar_id: str,
    taskspaces: list[Any] | None,
    session_workspace_dir: str,
) -> str:
    """System prompt for Desktop automation sessions (avatar_id automation:<task_id>)."""
    task_id = ""
    if automation_avatar_id.startswith("automation:"):
        task_id = automation_avatar_id.split(":", 1)[1].strip()
    default_dir = (
        str(Path.home() / ".agenticx" / "crontask" / task_id)
        if task_id
        else str(Path.home() / ".agenticx" / "crontask")
    )

    lines: list[str] = [
        "# 定时 / 自动化任务执行器",
        "你是 Near 的**定时任务执行器**。本轮用户输入即任务说明（含输出格式、数据来源与失败处理等硬性要求）。",
        "- **当前是执行阶段，不是建任务阶段**：禁止询问执行频率、日期、时间等调度参数；这些参数已由调度器确定。",
        "## 任务根目录（与 Desktop 配置一致）",
        "- **定义**：用户在自动化设置里填写的 **工作区**；若留空，则为 `~/.agenticx/crontask/<task_id>`（每个定时任务独占一个子目录，与对话一一对应）。",
        "- **Python 虚拟环境**：必须在**任务根目录**下维护，标准路径为 **`<任务根>/.venv`**。安装依赖用 `<任务根>/.venv/bin/pip install …`，执行脚本用 `<任务根>/.venv/bin/python …`（不要在未约定的仓库 `.venv`、全局 python 里装定时任务专属依赖，除非用户显式把该路径设为工作区）。",
        "- **脚本与产物**：与本任务相关的脚本、数据、日志、临时文件、辅助工具**一律**放在任务根目录或其子目录内；不要将定时任务专属文件散落到仓库根、`~/.agenticx/scripts` 等路径（除非该路径就是用户指定的任务根目录）。",
        "## 必须遵守",
        "- **先执行再输出**：需要数据或脚本时，必须调用 `bash_exec`、`file_write` 等工具真实执行；禁止只给出示例代码或操作步骤而不实际跑通。",
        "- **禁止伪执行**：若本轮没有产生真实工具结果（`tool_result`），禁止输出“已抓取/已生成/已保存/已完成”等完成态结论。",
        "- **禁止方案确认追问**：不得输出“是否按此方案执行/是否继续”等询问句，必须直接执行并交付结果。",
        "- **最终回复只面向用户**：严格按任务正文要求的版式与字段输出；**禁止**在最终回复里粘贴工具调用的原始 JSON、`schedule_task` 返回体或冗长教程。",
        "- **禁止**在正文中手写 `{\"command\": \"...\"}`、`{\"name\":\"bash_exec\",...}` 等**伪工具调用**；真实命令只能通过 `bash_exec` 发起，执行结果由界面上的工具卡片展示，你只需用自然语言概括 `exit_code` / `stderr` 要点（勿重复整段 stdout）。",
        "- **失败时**：只说明具体错误（接口 / 库 / 网络 / 权限），**不超过 5 行**，不要反问；若已调用 `bash_exec`，必须依据工具返回的 `stderr` 原文措辞，**禁止**把 `path escapes workspace`、`CANCELLED`、超时等概括成「虚拟环境损坏」。",
        "- **落盘真实性**：只有在 `file_write` 成功，或 `bash_exec` 的落盘命令返回 `exit_code=0` 后，才允许声明“已保存到 <路径>”；否则只能报告“未保存”。",
        "- **落盘路径展示**：若正文需告知保存位置，请单独一行输出反引号包裹的绝对路径（如 `` `/Users/.../report.md` ``），或使用「报告已保存至: `/path`」；避免仅用 HTML 注释隐藏路径（界面需可点击打开预览）。",
        "- **联网真实性**：涉及网页巡检/新闻抓取任务时，若未调用 `mcp_call`（或明确联网工具）取得结果，禁止生成“今日巡检结果”。",
        "- **约束冲突处理**：当任务文本内出现时间窗口冲突（如“过去一周”与“24小时内”并存），禁止自行拍脑袋改写；必须按用户最后一次明确口径执行，并在输出首行注明采用的口径。",
        "- **依赖**：若缺 Python 包，在 **`<任务根>/.venv`** 下用 `pip install` 后重试。",
        "## 工作目录（taskspace 挂载，应与任务根一致）",
    ]
    paths: list[str] = []
    for item in taskspaces or []:
        if isinstance(item, dict):
            p = str(item.get("path") or "").strip()
            if p:
                paths.append(p)
    if paths:
        for p in paths:
            lines.append(f"- {p}")
    else:
        lines.append(f"- （本会话尚未附加 taskspace；请直接使用）{default_dir}")
    sw = str(session_workspace_dir or "").strip()
    if sw and sw not in paths:
        lines.append(f"- 会话 workspace_dir：{sw}")
    lines.append(
        f"- 若列表与任务根不一致，以**已附加的 taskspace** 为当前 shell/文件工具的 cwd 基准；默认任务根为：`{default_dir}`"
    )
    lines.extend(
        [
            "## Skill 落盘规范（封装可复用经验时必须遵守）",
            "- 把成功方法封装成 skill 时，**优先**调用 `skill_manage(action='create', name=..., content=...)`，不要用 `file_write` 直写 `~/.agenticx/skills/`。",
            "- SKILL.md 内容**必须**以 YAML frontmatter 开头：`---\\nname: <与目录同名>\\ndescription: <一句话描述>\\n---`，后接正文；缺 `name` 的 skill 不会被 Skills 系统收录。",
            "- 若确需用 `file_write` 写 `skills/<名称>/SKILL.md`，工具会自动校验可发现性：**仅当返回包含「已可在设置 → Skills 检索」时**，才允许声称「skill 已落盘且可检索」；若返回 `ERROR: skill 不会被收录`，必须按提示修正 frontmatter 后重写，禁止声称已成功。",
            "## 其他",
            "- 不要调用 `delegate_to_avatar`。",
            "- 禁止调用 `schedule_task` / `list_scheduled_tasks` / `cancel_scheduled_task`（防止递归建任务）。",
        ]
    )
    return "\n".join(lines)


def _studio_cors_origins() -> list[str]:
    """Allowed browser origins for Desktop dev (Vite) and packaged file loads."""
    origins: list[str] = [
        "null",
        "app://.",
        "file://",
    ]
    dev_ports: set[str] = {"5173", "5713"}
    env_port = os.getenv("AGX_DEV_PORT", "").strip()
    if env_port:
        for part in env_port.split(","):
            port = part.strip()
            if port.isdigit():
                dev_ports.add(port)
    for port in sorted(dev_ports, key=int):
        origins.extend(
            [
                f"http://localhost:{port}",
                f"http://127.0.0.1:{port}",
            ]
        )
    extra = os.getenv("AGX_CORS_ORIGINS", "").strip()
    if extra:
        for origin in extra.split(","):
            origin = origin.strip()
            if origin and origin not in origins:
                origins.append(origin)
    return origins


def create_studio_app() -> FastAPI:
    _pending_mcp_autoconnect_tasks: set[asyncio.Task[Any]] = set()

    @contextlib.asynccontextmanager
    async def _studio_lifespan(app: FastAPI):
        # FR-1: 先装崩溃隔离，确保后续任何 MCP 子进程坏管道都不致命。
        try:
            from agenticx.runtime.mcp_crash_guard import install_mcp_crash_guard

            install_mcp_crash_guard()
        except Exception as exc:
            logger.debug("install_mcp_crash_guard failed (non-fatal): %s", exc)

        # Initialise process-level MCP hub and kick off background restore.
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager as _GmcpM

        _gmcp = _GmcpM.load_or_init()
        _gmcp.schedule_restore()

        gw_task: asyncio.Task | None = None
        try:
            from agenticx.gateway.client import GatewayClient, load_gateway_client_settings

            settings = load_gateway_client_settings()
            if settings is not None:
                gc = GatewayClient(settings)
                app.state.gateway_client = gc
                gw_task = asyncio.create_task(gc.run_forever())
                app.state.gateway_client_task = gw_task
        except Exception as exc:
            logger.warning("Gateway client not started: %s", exc)

        # WeChat iLink adapter (always attempt startup; sidecar may come up later)
        wechat_adapter = None
        try:
            from agenticx.gateway.adapters.wechat_ilink import WeChatILinkAdapter
            wechat_adapter = WeChatILinkAdapter()
            await wechat_adapter.start()
            app.state.wechat_ilink_adapter = wechat_adapter
            logger.info("WeChatILinkAdapter started in studio lifespan")
        except Exception as exc:
            logger.debug("WeChat adapter not started: %s", exc)

        longrun_bg: asyncio.Task[None] | None = None
        try:
            from agenticx.longrun.bootstrap import maybe_start_longrun

            longrun_bg = await maybe_start_longrun(app)
            app.state.longrun_background_task = longrun_bg
        except Exception as exc:
            logger.debug("LongRun orchestrator not started: %s", exc)

        def _preload_code_index_model() -> None:
            try:
                from agenticx.code_index.config import load_code_index_config
                from agenticx.code_index.manager import CodeIndexManager

                cfg = load_code_index_config()
                if cfg.enabled or cfg.preload_model:
                    CodeIndexManager.instance().preload_model()
            except ImportError:
                logger.debug("code_index optional deps not installed; skip preload")
            except Exception as exc:
                logger.warning("code_index model preload failed: %s", exc)

        try:
            from agenticx.code_index.config import load_code_index_config

            if load_code_index_config().preload_model:
                loop = asyncio.get_running_loop()
                loop.run_in_executor(None, _preload_code_index_model)
        except ImportError:
            pass

        try:
            from agenticx.memory.graph.config import load_memory_graph_config
            from agenticx.memory.graph.deps import ensure_graphiti_if_enabled

            if load_memory_graph_config().enabled:
                asyncio.create_task(
                    ensure_graphiti_if_enabled(),
                    name="memory-graph-graphiti-bootstrap",
                )
                from agenticx.memory.graph.writer import MemoryGraphWriter

                MemoryGraphWriter.singleton()._ensure_worker()
        except ImportError:
            pass
        except Exception as exc:
            logger.warning("memory graph graphiti bootstrap failed: %s", exc)

        async def _internal_continue(
            session_id: str,
            *,
            reason: str,
            source: str,
            skip_dedupe: bool = False,
        ) -> bool:
            sid = str(session_id or "").strip()
            if not sid:
                return False
            managed = manager.get(sid, touch=False)
            if managed is None:
                return False
            exec_state = str(getattr(managed, "execution_state", "idle") or "idle")
            if source == "supervisor" and exec_state == "running":
                from agenticx.studio.continuation import interrupt_running_for_continue

                exec_state = await interrupt_running_for_continue(manager, sid)
            ok, prompt, _round_n, _notice = prepare_continue(
                managed,
                reason=reason,  # type: ignore[arg-type]
                source=source,  # type: ignore[arg-type]
                execution_state=exec_state,
                skip_dedupe=skip_dedupe,
            )
            if not ok:
                return False
            await manager.persist_async(sid)
            chat_payload = ChatRequest(
                session_id=sid,
                user_input=prompt,
                skip_user_history=True,
                provider=managed.studio_session.provider_name,
                model=managed.studio_session.model_name,
            )

            class _SupervisorRequest:
                async def is_disconnected(self) -> bool:
                    return False

            stream_resp = await chat(
                chat_payload,
                _SupervisorRequest(),  # type: ignore[arg-type]
                desktop_token,
            )
            if stream_resp.body_iterator is not None:
                async for _chunk in stream_resp.body_iterator:
                    pass
            return True

        try:
            from agenticx.studio.supervisor import maybe_start_supervisor

            await maybe_start_supervisor(app, manager, _internal_continue)
        except Exception as exc:
            logger.debug("Session supervisor not started: %s", exc)

        yield

        if longrun_bg is not None:
            longrun_bg.cancel()
            try:
                await longrun_bg
            except asyncio.CancelledError:
                pass
        sup = getattr(app.state, "session_supervisor", None)
        if sup is not None:
            try:
                await sup.stop()
            except Exception as exc:
                logger.debug("Session supervisor stop error: %s", exc)

        orch = getattr(app.state, "longrun_orchestrator", None)
        if orch is not None:
            try:
                await orch.stop()
            except Exception as exc:
                logger.debug("LongRun orchestrator stop error: %s", exc)

        # Shutdown: close all MCP child processes via the global hub.
        try:
            await _GmcpM.singleton().close_all()
        except Exception as exc:
            logger.warning("GlobalMcpManager.close_all error on shutdown: %s", exc)

        if wechat_adapter is not None:
            try:
                await wechat_adapter.stop()
                logger.info("WeChatILinkAdapter stopped")
            except Exception as exc:
                logger.debug("WeChat adapter stop error: %s", exc)

        if gw_task is not None and not gw_task.done():
            gc = getattr(app.state, "gateway_client", None)
            if gc is not None:
                gc.request_stop()
            gw_task.cancel()
            try:
                await gw_task
            except asyncio.CancelledError:
                pass
        for task in list(_pending_mcp_autoconnect_tasks):
            task.cancel()
        for task in list(_pending_mcp_autoconnect_tasks):
            with contextlib.suppress(asyncio.CancelledError, TimeoutError, Exception):
                await asyncio.wait_for(task, timeout=1.0)

    app = FastAPI(title="AgenticX Studio Service", version="0.1.0", lifespan=_studio_lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_studio_cors_origins(),
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
    app.state.interrupted_sessions = manager.scan_interrupted_sessions()
    desktop_token = os.getenv("AGX_DESKTOP_TOKEN", "").strip()

    def _meta_group_chat_payload(
        managed: Any,
        requested_group_id: str | None = None,
    ) -> dict[str, Any] | None:
        """When session avatar_id is group:<id>, narrow Meta-Agent avatar list to group members."""
        gid = str(requested_group_id or "").strip()
        aid = str(getattr(managed, "avatar_id", "") or "").strip()
        if not gid:
            if not aid.startswith("group:"):
                return None
            gid = aid.split(":", 1)[1].strip()
        if not gid:
            return None
        gcfg = group_registry.get_group(gid) if gid else None
        if gcfg is None:
            return None
        expected_avatar_id = f"group:{gid}"
        if aid != expected_avatar_id:
            managed.avatar_id = expected_avatar_id
            if not getattr(managed, "avatar_name", None):
                managed.avatar_name = gcfg.name or gid
        display_name = (
            (gcfg.name if gcfg else "")
            or str(getattr(managed, "session_name", "") or "").strip()
            or gid
            or "群聊"
        )
        avatar_ids = list(gcfg.avatar_ids) if gcfg else []
        routing = str(getattr(gcfg, "routing", "intelligent") or "intelligent").strip()
        return {"id": gid, "name": display_name, "avatar_ids": avatar_ids, "routing": routing}

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

    def _global_auto_confirm_enabled() -> bool:
        """Whether global settings require bypassing confirm_required.

        Keep compatibility with both:
        - Desktop `confirm_strategy: auto`
        - Legacy permissions mode values (`auto` / `full_auto`)
        """
        try:
            strategy = str(ConfigManager.get_value("confirm_strategy") or "").strip().lower()
        except Exception:
            strategy = ""
        if strategy == "auto":
            return True
        try:
            mode = str(ConfigManager.get_value("permissions.mode") or "").strip().lower()
        except Exception:
            mode = ""
        return mode in {"auto", "full_auto"}

    def _resolve_confirm_gate(managed: Any, agent_id: str = "meta") -> Any:
        if _global_auto_confirm_enabled():
            return AutoApproveConfirmGate()
        return managed.get_confirm_gate(agent_id)

    def _resolve_clarify_gate(managed: Any, agent_id: str = "meta", *, is_automation: bool = False) -> Any:
        # Clarification must NEVER be auto-approved (that would drop the user's
        # actual answer). Automation sessions get AutoSuspendClarifyGate which
        # returns a suspended sentinel immediately so the agent wraps up.
        if is_automation:
            return AutoSuspendClarifyGate()
        return managed.get_clarify_gate(agent_id)

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
            # Default to local web extraction path when user has not configured policy.
            return ["firecrawl"]
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

    def _effective_auto_connect_names_for_session(
        auto_connect_names: list[str] | None,
        *,
        mcp_configs: dict[str, Any],
    ) -> list[str] | None:
        """Scope auto-connect list by session type.

        To avoid spawning many browser-use processes (one per session/pane),
        never auto-connect browser-use by default.
        Sessions can still connect browser-use manually when needed.
        """
        if auto_connect_names is None:
            return [name for name in mcp_configs.keys() if name != "browser-use"]
        return [name for name in auto_connect_names if name != "browser-use"]

    def _schedule_mcp_autoconnect_for_new_session(
        managed: Any,
        scoped_auto_connect_names: list[str] | None,
    ) -> None:
        """Start MCP auto-connect in background so session creation returns quickly."""
        if not managed.studio_session.mcp_configs or scoped_auto_connect_names == []:
            return

        managed.studio_session.mcp_hub = MCPHub(clients=[], auto_mode=False)

        async def _run_autoconnect() -> None:
            try:
                await auto_connect_servers_async(
                    managed.studio_session.mcp_hub,
                    managed.studio_session.mcp_configs,
                    managed.studio_session.connected_servers,
                    scoped_auto_connect_names,
                )
            except Exception as exc:
                logger.warning(
                    "MCP auto-connect failed for new session %s: %s",
                    managed.session_id,
                    exc,
                )

        task = asyncio.create_task(_run_autoconnect())
        _pending_mcp_autoconnect_tasks.add(task)

        def _cleanup(done: asyncio.Task[Any]) -> None:
            _pending_mcp_autoconnect_tasks.discard(done)

        task.add_done_callback(_cleanup)

    def _check_token(x_agx_desktop_token: str | None) -> None:
        if not desktop_token:
            return
        if x_agx_desktop_token != desktop_token:
            raise HTTPException(status_code=401, detail="invalid desktop token")

    _verify_desktop_token = _check_token

    register_voice_endpoints(app, manager=manager, check_token=_check_token)

    from agenticx.memory.graph.routes import register_memory_graph_routes

    register_memory_graph_routes(app, check_token=_check_token)

    from agenticx.studio.data_sources_routes import register_data_sources_routes

    register_data_sources_routes(app, check_token=_check_token)

    def _check_mcp_admin_token(x_agx_desktop_token: str | None) -> None:
        if not desktop_token:
            raise HTTPException(status_code=403, detail="desktop token required for MCP admin APIs")
        if x_agx_desktop_token != desktop_token:
            raise HTTPException(status_code=401, detail="invalid desktop token")

    def _detect_mcp_file_format(path: Path) -> str:
        suffix = path.suffix.lower()
        if suffix in {".json"}:
            return "json"
        if suffix in {".json5"}:
            return "json5"
        if suffix in {".yaml", ".yml"}:
            return "yaml"
        if suffix in {".toml"}:
            return "toml"
        return "unknown"

    def _allowed_mcp_edit_paths() -> set[str]:
        allowed: set[str] = set()
        home = agenticx_home_mcp_path().expanduser().resolve(strict=False)
        allowed.add(str(home))
        for raw in get_mcp_extra_search_paths_config():
            try:
                resolved = Path(raw).expanduser().resolve(strict=False)
            except Exception:
                continue
            allowed.add(str(resolved))
        return allowed

    def _normalize_mcp_path_for_edit(path_text: str | None) -> Path:
        candidate = str(path_text or "").strip()
        path = agenticx_home_mcp_path() if not candidate else Path(candidate)
        resolved = path.expanduser().resolve(strict=False)
        if str(resolved) not in _allowed_mcp_edit_paths():
            raise HTTPException(status_code=400, detail=f"path not allowed: {resolved}")
        return resolved

    def _parse_by_format(text: str, fmt: str) -> Any:
        if fmt == "json":
            return json.loads(text)
        if fmt == "json5":
            import json5

            return json5.loads(text)
        if fmt == "yaml":
            import yaml

            return yaml.safe_load(text) or {}
        if fmt == "toml":
            try:
                import tomllib
            except Exception:
                import tomli as tomllib  # type: ignore
            return tomllib.loads(text)
        raise HTTPException(status_code=400, detail=f"unsupported mcp format: {fmt}")

    def _mcp_schema_validator() -> Draft202012Validator:
        schema_path = Path(__file__).resolve().parents[1] / "cli" / "mcp_schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        return Draft202012Validator(schema)

    def _validate_json_mcp_payload(payload: Any) -> list[str]:
        validator = _mcp_schema_validator()
        errors = sorted(validator.iter_errors(payload), key=lambda e: list(e.path))
        msgs: list[str] = []
        for err in errors:
            ptr = ".".join([str(x) for x in err.path]) or "$"
            msgs.append(f"{ptr}: {err.message}")
        return msgs

    def _marketplace_cache_get(key: str) -> dict[str, Any] | None:
        item = _MCP_MARKETPLACE_CACHE.get(key)
        if not item:
            return None
        expires_at, payload = item
        if time.time() > expires_at:
            _MCP_MARKETPLACE_CACHE.pop(key, None)
            return None
        return payload

    def _marketplace_cache_set(key: str, payload: dict[str, Any]) -> None:
        _MCP_MARKETPLACE_CACHE[key] = (time.time() + _MCP_MARKETPLACE_CACHE_TTL_SECONDS, payload)

    def _modelscope_headers() -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "AgenticX/0.4.2",
        }
        token = str(os.getenv("MODELSCOPE_API_TOKEN", "")).strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _load_non_high_risk_auto_install() -> bool:
        """Read skills.non_high_risk_auto_install from global config (default True)."""
        try:
            raw = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH) or {}
            skills_block = raw.get("skills") or {}
            if isinstance(skills_block, dict):
                v = skills_block.get("non_high_risk_auto_install")
                if isinstance(v, bool):
                    return v
                if isinstance(v, str):
                    return v.strip().lower() in ("true", "1", "yes", "on")
            return True
        except Exception:
            return True

    def _tool_install_hint(tool_id: str) -> str:
        platform = os.uname().sysname.lower() if hasattr(os, "uname") else ""
        if tool_id == "libreoffice":
            if "darwin" in platform:
                return "brew install --cask libreoffice"
            if "linux" in platform:
                return "sudo apt install -y libreoffice"
            if "windows" in platform:
                return "choco install libreoffice-fresh"
            return "Please install LibreOffice from official website."
        if tool_id == "imagemagick":
            if "darwin" in platform:
                return "brew install imagemagick"
            if "linux" in platform:
                return "sudo apt install -y imagemagick"
            if "windows" in platform:
                return "choco install imagemagick"
            return "Please install ImageMagick from official website."
        return ""

    def _extract_semver(text: str) -> str:
        match = re.search(r"(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)", text)
        return match.group(1) if match else ""

    def _get_command_version(command: str, args: list[str] | None = None) -> str:
        executable = shutil.which(command)
        if not executable:
            return ""
        try:
            result = subprocess.run(
                [executable, *(args or ["--version"])],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
            text = "\n".join([result.stdout or "", result.stderr or ""]).strip()
            return _extract_semver(text)
        except Exception:
            return ""

    def _liteparse_command() -> str:
        return "liteparse.cmd" if os.name == "nt" else "liteparse"

    def _tool_status(tool_id: str) -> dict[str, Any]:
        if tool_id == "liteparse":
            cmd = _liteparse_command()
            installed = shutil.which(cmd) is not None
            return {
                "id": "liteparse",
                "name": "LiteParse",
                "description": "轻量 PDF/Office 文档解析",
                "installed": installed,
                "version": _get_command_version(cmd) if installed else "",
                "install_command": "npm i -g @llamaindex/liteparse",
                "auto_installable": True,
            }
        if tool_id == "mineru":
            installed = importlib.util.find_spec("magic_pdf") is not None
            return {
                "id": "mineru",
                "name": "MinerU",
                "description": "深度文档解析",
                "installed": installed,
                "version": "",
                "install_command": "pip install magic-pdf",
                "auto_installable": False,
            }
        if tool_id == "libreoffice":
            installed = shutil.which("soffice") is not None
            return {
                "id": "libreoffice",
                "name": "LibreOffice",
                "description": "Office 格式转换依赖",
                "installed": installed,
                "version": _get_command_version("soffice") if installed else "",
                "install_command": _tool_install_hint("libreoffice"),
                "auto_installable": False,
            }
        if tool_id == "imagemagick":
            installed = shutil.which("magick") is not None or shutil.which("convert") is not None
            version = _get_command_version("magick") if shutil.which("magick") else _get_command_version("convert")
            return {
                "id": "imagemagick",
                "name": "ImageMagick",
                "description": "图像转换依赖",
                "installed": installed,
                "version": version if installed else "",
                "install_command": _tool_install_hint("imagemagick"),
                "auto_installable": False,
            }
        raise ValueError(f"unsupported tool id: {tool_id}")

    def _sanitize_tools_enabled(raw: Any) -> dict[str, bool]:
        if not isinstance(raw, dict):
            return {}
        return {
            str(key): bool(value)
            for key, value in raw.items()
            if str(key).strip()
        }

    def _sanitize_avatar_skills_enabled(raw: Any) -> dict[str, bool] | None:
        if raw is None:
            return None
        if not isinstance(raw, dict):
            return None
        out = {
            str(k): bool(v)
            for k, v in raw.items()
            if str(k).strip()
        }
        return out or None

    def _sanitize_avatar_brains_enabled(raw: Any) -> Any:
        if raw is None:
            return None
        if raw == "*":
            return "*"
        if isinstance(raw, list):
            ids = [str(x).strip() for x in raw if str(x).strip()]
            return ids or None
        return None

    def _load_global_tools_policy() -> dict[str, bool]:
        try:
            raw = ConfigManager.get_value("tools_enabled")
        except Exception:
            raw = {}
        return _sanitize_tools_enabled(raw)

    def _save_global_tools_policy(tools_enabled: dict[str, bool]) -> None:
        ConfigManager.set_value("tools_enabled", _sanitize_tools_enabled(tools_enabled), scope="global")

    def _sanitize_tools_options(raw: Any) -> dict[str, Any]:
        """Whitelist tool runtime options; unknown keys dropped."""
        if not isinstance(raw, dict):
            return {}
        out: dict[str, Any] = {}
        bash_raw = raw.get("bash_exec")
        if isinstance(bash_raw, dict):
            dts = bash_raw.get("default_timeout_sec")
            if dts is not None:
                try:
                    v = int(dts)
                except (TypeError, ValueError):
                    v = None
                if v is not None:
                    v = max(30, min(3600, v))
                    out["bash_exec"] = {"default_timeout_sec": v}
        return out

    def _load_global_tools_options() -> dict[str, Any]:
        try:
            raw = ConfigManager.get_value("tools_options")
        except Exception:
            raw = {}
        return _sanitize_tools_options(raw)

    def _save_global_tools_options(tools_options: dict[str, Any]) -> None:
        ConfigManager.set_value(
            "tools_options",
            _sanitize_tools_options(tools_options),
            scope="global",
        )

    def _filter_tools_by_policy(
        tools: list[dict[str, Any]],
        *,
        avatar_tools_enabled: dict[str, bool] | None = None,
        global_tools_enabled: dict[str, bool] | None = None,
    ) -> list[dict[str, Any]]:
        avatar_policy = avatar_tools_enabled or {}
        global_policy = global_tools_enabled or {}
        filtered: list[dict[str, Any]] = []
        for tool in tools:
            tool_name = str(tool.get("function", {}).get("name", "")).strip()
            if not tool_name:
                continue
            if tool_name in avatar_policy:
                allowed = bool(avatar_policy[tool_name])
            elif tool_name in global_policy:
                allowed = bool(global_policy[tool_name])
            else:
                allowed = True
            if allowed:
                filtered.append(tool)
        return filtered

    def _strip_disabled_web_search_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        try:
            raw = ConfigManager.get_value("web_search") or {}
            if not isinstance(raw, dict):
                return tools
            en = raw.get("enabled", True)
            if isinstance(en, str):
                en = en.strip().lower() in ("1", "true", "yes", "on")
            if bool(en):
                return tools
        except Exception:
            return tools
        return [t for t in tools if str((t.get("function") or {}).get("name", "")).strip() != "web_search"]

    def _maybe_inject_code_search_tools(
        sess: Any,
        tools: list[dict[str, Any]],
        *,
        avatar_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Inject code_search when the session has mounted code brains (avatar/Meta)."""
        try:
            from agenticx.brain.mount import session_has_mounted_code_brains

            if not session_has_mounted_code_brains(sess, avatar_id=avatar_id):
                return tools
            extra = _code_search_tool_defs()
            if not extra:
                return tools
            existing_names = {
                str((t.get("function") or {}).get("name", "")).strip()
                for t in tools
                if isinstance(t, dict)
            }
            merged = list(tools)
            for spec in extra:
                name = str((spec.get("function") or {}).get("name", "")).strip()
                if name and name not in existing_names:
                    merged.append(spec)
                    existing_names.add(name)
            return merged
        except Exception:
            return tools

    def _sse_event(event: str, data: dict[str, Any]) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

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

    def _normalize_image_inputs(payload: Any) -> list[dict[str, Any]]:
        max_images = 4
        max_data_url_chars = 8_000_000
        if not isinstance(payload, list):
            return []
        normalized: list[dict[str, Any]] = []
        for raw in payload:
            if hasattr(raw, "model_dump"):
                item = raw.model_dump()  # pydantic model
            elif isinstance(raw, dict):
                item = raw
            else:
                continue
            data_url = str(item.get("data_url", "")).strip()
            if not data_url.startswith("data:image/"):
                continue
            if len(data_url) > max_data_url_chars:
                continue
            size_raw = item.get("size", 0)
            try:
                size_value = int(size_raw or 0)
            except (TypeError, ValueError):
                size_value = 0
            normalized.append(
                {
                    "name": str(item.get("name", "")).strip(),
                    "data_url": data_url,
                    "mime_type": str(item.get("mime_type", "")).strip(),
                    "size": size_value,
                }
            )
            if len(normalized) >= max_images:
                break
        return normalized

    def _history_attachments_from_image_inputs(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Persist image rows for chat_history / messages.json so Desktop can reload thumbnails."""
        out: list[dict[str, Any]] = []
        for im in items:
            data_url = str(im.get("data_url", "")).strip()
            if not data_url.startswith("data:image/"):
                continue
            mime = str(im.get("mime_type", "") or "").strip()
            if not mime and data_url.startswith("data:"):
                semi = data_url.find(";")
                if semi > 5:
                    mime = data_url[5:semi]
            if not mime:
                mime = "image/png"
            name = str(im.get("name", "") or "").strip() or "image"
            try:
                size_val = int(im.get("size", 0) or 0)
            except (TypeError, ValueError):
                size_val = 0
            out.append(
                {
                    "name": name,
                    "mime_type": mime,
                    "size": size_val,
                    "data_url": data_url,
                }
            )
        return out

    def _looks_like_filesystem_path(key: str) -> bool:
        text = str(key or "").strip()
        if not text:
            return False
        if text.startswith("file:"):
            return True
        if "/" in text or "\\" in text:
            return True
        if len(text) > 2 and text[1] == ":" and text[2] in {"/", "\\"}:
            return True
        return False

    def _guess_mime_from_filename(name: str) -> str:
        lower = str(name or "").lower()
        if lower.endswith(".py"):
            return "text/x-python"
        if lower.endswith(".ts") or lower.endswith(".tsx"):
            return "text/typescript"
        if lower.endswith(".js") or lower.endswith(".jsx"):
            return "text/javascript"
        if lower.endswith(".md"):
            return "text/markdown"
        if lower.endswith(".json"):
            return "application/json"
        if lower.endswith(".yaml") or lower.endswith(".yml"):
            return "text/yaml"
        if lower.endswith(".txt"):
            return "text/plain"
        return "application/octet-stream"

    def _history_attachments_from_context_files(context_files: dict[str, str]) -> list[dict[str, Any]]:
        """Metadata-only rows so Desktop can replay file cards after session reload (no file body)."""
        out: list[dict[str, Any]] = []
        if not context_files:
            return out
        seen: set[str] = set()
        for raw_key, raw_body in context_files.items():
            key = str(raw_key or "").strip()
            if not key:
                continue
            body = str(raw_body or "")
            if body.strip() == "[图片文件]" or body.startswith("[图片:"):
                continue
            parts = key.split(":")
            display_name = key
            size_val = len(body.encode("utf-8")) if body else 0
            reference_token = False
            source_path = ""
            composer_ref_label = ""
            line_start: int | None = None
            line_end: int | None = None
            if key.startswith("@dir:"):
                dir_parts = key.split(":", 2)
                if len(dir_parts) == 3:
                    display_name = key
                    source_path = dir_parts[2]
                    composer_ref_label = dir_parts[1]
                    reference_token = True
            elif len(parts) >= 3 and parts[-1].isdigit() and parts[-2].isdigit():
                source_path = str(parts[0] or "").strip()
                display_name = os.path.basename(str(source_path).replace("\\", "/")) or source_path
                try:
                    line_start = int(parts[-2])
                    line_end = int(parts[-1])
                    size_val = len(body.encode("utf-8")) if body else 0
                    composer_ref_label = f"{display_name} ({line_start}-{line_end})"
                    reference_token = True
                except ValueError:
                    display_name = str(parts[0] or "").strip() or key
                    try:
                        size_val = int(parts[-2])
                    except ValueError:
                        size_val = len(body.encode("utf-8")) if body else 0
                    line_start = None
                    line_end = None
            elif _looks_like_filesystem_path(key):
                display_name = os.path.basename(str(key).replace("\\", "/")) or key
                source_path = key
                reference_token = True
                composer_ref_label = display_name
                size_val = len(body.encode("utf-8")) if body else 0
            else:
                display_name = os.path.basename(str(key).replace("\\", "/")) or key
                source_path = key if _looks_like_filesystem_path(key) else ""
                if source_path:
                    reference_token = True
                    composer_ref_label = display_name

            dedupe_key = key.casefold()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            mime = _guess_mime_from_filename(display_name)
            att_row: dict[str, Any] = {
                "name": display_name,
                "mime_type": mime,
                "size": int(max(0, size_val)),
                "source_path": str(source_path or "").strip(),
                "reference_token": bool(reference_token),
                "composer_ref_label": composer_ref_label,
                "kind": "context_file",
            }
            if isinstance(line_start, int) and isinstance(line_end, int):
                att_row["line_start"] = line_start
                att_row["line_end"] = line_end
            out.append(att_row)
        return out

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
        requested_sid = (session_id or "").strip() or None
        managed = manager.get(requested_sid, touch=False) if requested_sid else None
        if managed is not None and not managed_session_binding_matches_avatar_query(
            managed,
            query_avatar_id=avatar_id,
        ):
            logger.warning(
                "[session] avatar binding mismatch sid=%s query_avatar=%r stored_avatar=%r; creating new session",
                requested_sid,
                avatar_id,
                getattr(managed, "avatar_id", None),
            )
            managed = None
            requested_sid = None
        if managed is not None:
            logger.info("[session] reused existing sid=%s", managed.session_id)
            manager.align_meta_session_workspace(managed)
        if managed is None:
            avatar_cfg = avatar_registry.get_avatar(avatar_id) if avatar_id else None
            effective_provider = (avatar_cfg.default_provider if avatar_cfg and avatar_cfg.default_provider else provider)
            effective_model = (avatar_cfg.default_model if avatar_cfg and avatar_cfg.default_model else model)
            managed = manager.create(
                provider=effective_provider,
                model=effective_model,
                session_id=requested_sid,
            )
            logger.info(
                "[session] CREATED new sid=%s (requested=%s)",
                managed.session_id,
                requested_sid,
            )
            if avatar_cfg and avatar_cfg.workspace_dir:
                manager.apply_session_workspace_dir(
                    managed,
                    avatar_workspace_dir=avatar_cfg.workspace_dir,
                )
            else:
                manager.apply_session_workspace_dir(managed)
            manager.apply_avatar_binding(
                managed,
                avatar_id=avatar_id or None,
                avatar_name=avatar_cfg.name if avatar_cfg else None,
            )
            # MCP state is now process-level; no per-session auto-connect.
            # The global hub is already live (or being restored in background).
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
        tail_rounds: int | None = Query(default=None, ge=1, le=100),
        tail_limit: int | None = Query(default=None, ge=1, le=100),
        before_index: int | None = Query(default=None, ge=0),
        limit: int = Query(default=20, ge=1, le=100),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        if tail_rounds is None and before_index is None:
            messages = manager.get_messages(session_id)
            return {"ok": True, "messages": messages}
        page = manager.get_messages_page(
            session_id,
            tail_rounds=tail_rounds,
            before_index=before_index,
            limit=limit,
            tail_limit=tail_limit,
        )
        return {"ok": True, **page}

    # -------------------------------------------------------------------
    # Project state harness — read-only views over .agx/project/
    # -------------------------------------------------------------------
    @app.get("/api/projects")
    async def list_projects(
        session_id: str | None = Query(default=None),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        from pathlib import Path as _Path

        from agenticx.project_state.store import (
            ProjectStateError as _PSError,
            ProjectStore as _Store,
            locate_project_root as _locate,
        )

        candidate_roots: list[_Path] = []
        if session_id:
            managed = manager.get(session_id, touch=False)
            if managed is not None:
                taskspaces = getattr(managed.studio_session, "taskspaces", None) or []
                for ts in taskspaces:
                    if isinstance(ts, dict):
                        path = str(ts.get("path", "") or "").strip()
                        if path:
                            candidate_roots.append(_Path(path).expanduser())
                wd = str(getattr(managed.studio_session, "workspace_dir", "") or "").strip()
                if wd:
                    candidate_roots.append(_Path(wd).expanduser())
        if not candidate_roots:
            candidate_roots.append(_Path.cwd())

        seen: set[str] = set()
        projects: list[dict] = []
        for root in candidate_roots:
            try:
                resolved = root.resolve(strict=False)
            except OSError:
                continue
            if str(resolved) in seen or not resolved.is_dir():
                continue
            seen.add(str(resolved))
            try:
                project_root = _locate(resolved, use_fallback=False, create=False)
            except _PSError:
                continue
            try:
                store = _Store(project_root)
                status = store.load_status()
                feature_list = store.load_feature_list()
            except _PSError as exc:
                projects.append({"workspace_root": str(resolved), "error": str(exc)})
                continue
            projects.append(
                {
                    "workspace_root": str(resolved),
                    "project_root": str(store.root),
                    "project_id": status.project_id,
                    "phase": status.phase,
                    "feature_count": len(feature_list.features),
                }
            )
        return {"ok": True, "projects": projects}

    @app.get("/api/projects/status")
    async def get_project_status(
        workspace_root: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        from pathlib import Path as _Path

        from agenticx.project_state.feature_list import summarize as _summarize
        from agenticx.project_state.store import (
            ProjectStateError as _PSError,
            ProjectStore as _Store,
        )

        try:
            store = _Store.open(_Path(workspace_root).expanduser())
            status = store.load_status()
            feature_list = store.load_feature_list()
        except _PSError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        return {
            "ok": True,
            "project_root": str(store.root),
            "status": status.to_dict(),
            "feature_list": feature_list.to_dict(),
            "counts": _summarize(feature_list),
        }

    @app.get("/api/projects/progress")
    async def get_project_progress(
        workspace_root: str = Query(...),
        tail: int = Query(default=100, ge=0, le=500),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        from pathlib import Path as _Path

        from agenticx.project_state.store import (
            ProjectStateError as _PSError,
            ProjectStore as _Store,
        )

        try:
            store = _Store.open(_Path(workspace_root).expanduser())
        except _PSError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        return {
            "ok": True,
            "project_root": str(store.root),
            "progress_tail": store.read_progress_tail(int(tail)),
        }

    @app.post("/api/session/messages/delete")
    async def delete_session_messages(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "") or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        items = payload.get("messages")
        if not isinstance(items, list) or not items:
            raise HTTPException(status_code=400, detail="messages must be a non-empty list")

        targets: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role", "") or "").strip()
            content = str(item.get("content", "") or "")
            if not role or not content:
                continue
            timestamp_raw = item.get("timestamp")
            timestamp: int | None
            try:
                timestamp = int(timestamp_raw) if timestamp_raw is not None else None
            except (TypeError, ValueError):
                timestamp = None
            targets.append(
                {
                    "role": role,
                    "content": content,
                    "timestamp": timestamp,
                    "agent_id": str(item.get("agent_id", "") or "").strip(),
                }
            )
        if not targets:
            raise HTTPException(status_code=400, detail="no valid messages to delete")

        def _match_row(row: dict[str, Any], target: dict[str, Any]) -> bool:
            if str(row.get("role", "") or "").strip() != target["role"]:
                return False
            if str(row.get("content", "") or "") != target["content"]:
                return False
            expected_ts = target.get("timestamp")
            if expected_ts is not None:
                try:
                    row_ts = int(row.get("timestamp")) if row.get("timestamp") is not None else None
                except (TypeError, ValueError):
                    row_ts = None
                if row_ts != expected_ts:
                    return False
            expected_agent = str(target.get("agent_id", "") or "").strip()
            if expected_agent:
                row_agent = str(row.get("agent_id", "") or "").strip()
                if row_agent and row_agent != expected_agent:
                    return False
            return True

        def _remove_once(rows: list[dict[str, Any]], targets_to_remove: list[dict[str, Any]]) -> int:
            removed_local = 0
            for target in targets_to_remove:
                for idx, row in enumerate(rows):
                    if _match_row(row, target):
                        rows.pop(idx)
                        removed_local += 1
                        break
            return removed_local

        session = managed.studio_session
        removed = 0
        if isinstance(session.chat_history, list):
            removed += _remove_once(session.chat_history, targets)
        if isinstance(session.agent_messages, list):
            _remove_once(session.agent_messages, targets)
        await manager.persist_async(session_id)
        return {"ok": True, "removed": removed, "requested": len(targets)}

    @app.post("/api/session/messages/truncate")
    async def truncate_session_messages(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Truncate session history at a user message boundary.

        Used by retry / edit so the model context (agent_messages) is reliably
        cut at the targeted user turn, instead of relying on per-row signature
        matching that breaks on timestamp drift and the [compacted] block.
        """
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "") or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        user_content = str(payload.get("user_content", "") or "")
        if not user_content:
            raise HTTPException(status_code=400, detail="user_content is required")
        mode = str(payload.get("mode", "after") or "after").strip().lower()
        if mode not in {"after", "including"}:
            raise HTTPException(status_code=400, detail="mode must be 'after' or 'including'")
        try:
            user_occurrence = int(payload.get("user_occurrence", 0) or 0)
        except (TypeError, ValueError):
            user_occurrence = 0
        if user_occurrence < 0:
            user_occurrence = 0

        def _user_content_matches(row_content: str, target: str) -> bool:
            if row_content == target:
                return True
            # Server may persist quoted_content / attachment hints after the visible text.
            if row_content.startswith(target + "\n"):
                return True
            return False

        def _nth_user_index(rows: list[dict[str, Any]], *, from_end: bool) -> int:
            if user_occurrence > 0:
                seen = 0
                indices: list[int] = []
                for idx, row in enumerate(rows):
                    if not isinstance(row, dict):
                        continue
                    if str(row.get("role", "") or "").strip() != "user":
                        continue
                    if not _user_content_matches(str(row.get("content", "") or ""), user_content):
                        continue
                    seen += 1
                    indices.append(idx)
                if seen >= user_occurrence:
                    return indices[user_occurrence - 1]
                return -1
            if from_end:
                for idx in range(len(rows) - 1, -1, -1):
                    row = rows[idx]
                    if not isinstance(row, dict):
                        continue
                    if str(row.get("role", "") or "").strip() != "user":
                        continue
                    if _user_content_matches(str(row.get("content", "") or ""), user_content):
                        return idx
                return -1
            return -1

        def _truncate(rows: list[dict[str, Any]], *, from_end: bool) -> tuple[int, bool]:
            idx = _nth_user_index(rows, from_end=from_end)
            if idx < 0:
                return 0, False
            if mode == "after":
                cut_start = idx + 1
                removed_local = len(rows) - cut_start
                if removed_local <= 0:
                    return 0, True
                del rows[cut_start:]
                return removed_local, True
            cut = idx
            removed_local = len(rows) - cut
            if removed_local <= 0:
                return 0, True
            del rows[cut:]
            return removed_local, True

        def _strip_compacted_blocks(rows: list[dict[str, Any]]) -> int:
            removed_local = 0
            i = 0
            while i < len(rows):
                row = rows[i]
                if not isinstance(row, dict):
                    i += 1
                    continue
                if str(row.get("role", "") or "").strip() != "system":
                    i += 1
                    continue
                content = str(row.get("content", "") or "")
                if "[compacted]" not in content:
                    i += 1
                    continue
                rows.pop(i)
                removed_local += 1
            return removed_local

        def _sync_agent_cut_from_chat(
            chat_rows: list[dict[str, Any]], agent_rows: list[dict[str, Any]]
        ) -> int:
            user_count = sum(
                1
                for row in chat_rows
                if isinstance(row, dict) and str(row.get("role", "") or "").strip() == "user"
            )
            if user_count <= 0:
                return 0
            seen = 0
            cut_idx = -1
            for idx, row in enumerate(agent_rows):
                if not isinstance(row, dict):
                    continue
                if str(row.get("role", "") or "").strip() != "user":
                    continue
                seen += 1
                if seen == user_count:
                    cut_idx = idx
                    break
            if cut_idx < 0:
                return 0
            tail = len(agent_rows) - (cut_idx + 1)
            if tail <= 0:
                return 0
            del agent_rows[cut_idx + 1 :]
            return tail

        session = managed.studio_session
        removed_chat = 0
        removed_agent = 0
        matched_chat = False
        matched_agent = False
        if isinstance(session.chat_history, list):
            removed_chat, matched_chat = _truncate(session.chat_history, from_end=user_occurrence <= 0)
        if isinstance(session.agent_messages, list):
            removed_agent, matched_agent = _truncate(session.agent_messages, from_end=user_occurrence <= 0)
            if mode == "after" and removed_chat > 0 and removed_agent == 0:
                removed_agent = _sync_agent_cut_from_chat(
                    session.chat_history or [], session.agent_messages
                )
                matched_agent = matched_agent or removed_agent > 0
            if mode == "after" and (matched_chat or matched_agent):
                removed_agent += _strip_compacted_blocks(session.agent_messages)
        if matched_chat or matched_agent:
            from agenticx.runtime.session_summary_store import delete_session_summary

            delete_session_summary(session_id)
        await manager.persist_async(session_id)
        return {
            "ok": True,
            "removed_chat": removed_chat,
            "removed_agent": removed_agent,
            "matched_chat": matched_chat,
            "matched_agent": matched_agent,
        }

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

    @app.post("/api/session/interrupt")
    async def interrupt_session(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "") or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        manager.request_interrupt(session_id)
        manager.set_execution_state(session_id, "interrupted")
        await manager.persist_async(session_id)
        return {"ok": True, "session_id": session_id}

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

    @app.post("/api/clarify")
    async def post_clarify(
        payload: ClarifyResponse,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        managed = manager.get(payload.session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        gate = managed.get_clarify_gate(payload.agent_id)
        if payload.agent_id != "meta" and managed.team_manager is not None:
            team_gate = managed.team_manager.get_clarify_gate(payload.agent_id)
            if team_gate is not None:
                gate = team_gate
        answer = {
            "answer_text": payload.answer_text or "",
            "selected_options": list(payload.selected_options or []),
        }
        ok = gate.resolve(payload.request_id, answer)
        if not ok:
            raise HTTPException(status_code=404, detail="clarification request not found")
        # Persist the answer onto the clarification prompt row so the inline card
        # survives a reload / session switch without resurrecting the question
        # (NFR-2: the "answered" state must be visible, not just the prompt).
        try:
            hist = getattr(managed.session, "chat_history", None)
            if isinstance(hist, list):
                for row in reversed(hist):
                    meta = row.get("metadata") if isinstance(row, dict) else None
                    if (
                        isinstance(meta, dict)
                        and meta.get("kind") == "clarification"
                        and str(meta.get("request_id") or meta.get("id") or "") == payload.request_id
                    ):
                        meta["clarification_answered"] = True
                        meta["clarification_answer"] = answer
                        break
                managed.session.persist_async()
        except Exception:
            logger.exception("[clarify] failed to persist clarification answer")
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
        manager.align_meta_session_workspace(managed)
        # Idempotency guard: dedupe a duplicate POST (double-click / chip burst /
        # retry race) so the backend never persists a second identical user turn.
        # Keyed by client_turn_id on the managed session (bounded recent set).
        _ctid = str(getattr(payload, "client_turn_id", "") or "").strip()
        if _ctid:
            _seen = getattr(managed, "_recent_client_turn_ids", None)
            if _seen is None:
                from collections import deque

                _seen = deque(maxlen=64)
                setattr(managed, "_recent_client_turn_ids", _seen)
            if _ctid in _seen:
                async def _dup_noop_stream():
                    yield 'data: {"type":"done","data":{"duplicate":true}}\n\n'

                return StreamingResponse(_dup_noop_stream(), media_type="text/event-stream")
            _seen.append(_ctid)
        setattr(managed.studio_session, "taskspaces", list(managed.taskspaces or []))
        active_ts = str(payload.active_taskspace_id or "").strip() or None
        setattr(managed.studio_session, "active_taskspace_id", active_ts)
        manager.touch(payload.session_id)
        if manager.session_title_needs_auto_fill(managed.session_name):
            manager.auto_title_session(payload.session_id, payload.user_input)

        session = managed.studio_session
        try:
            from agenticx.runtime.prompts.code_mode import ensure_code_dev_workflow_skill

            ensure_code_dev_workflow_skill(session)
        except Exception:
            pass
        if payload.context_files:
            session.context_files.update(_normalize_context_files(payload.context_files))
        if payload.skill_slugs:
            try:
                from agenticx.tools.skill_bundle import SkillBundleLoader

                _skill_loader = SkillBundleLoader()
                _skill_loader.scan()
                for _slug in payload.skill_slugs:
                    _slug = str(_slug).strip()
                    if not _slug:
                        continue
                    _skill_key = f"skill:{_slug}"
                    if _skill_key in session.context_files:
                        continue
                    _skill_content = _skill_loader.get_skill_content(_slug)
                    if _skill_content:
                        session.context_files[_skill_key] = _skill_content
            except Exception as _skill_exc:
                logger.warning("skill_slugs inject error: %s", _skill_exc)
        image_inputs = _normalize_image_inputs(payload.image_inputs)
        vision_budget_stats: dict[str, Any] = {}
        try:
            from agenticx.runtime.vision_history_budget import (
                apply_turn_image_budget,
                load_vision_history_config,
                maybe_batch_compact_session_images,
                should_emit_budget_notice,
            )

            _vh_cfg = load_vision_history_config()
            image_inputs, vision_budget_stats = apply_turn_image_budget(
                image_inputs,
                cfg=_vh_cfg,
                user_input=str(payload.user_input or ""),
            )
            _did_batch, _replaced = maybe_batch_compact_session_images(
                session,
                cfg=_vh_cfg,
                new_image_count=len(image_inputs),
            )
            if (_did_batch or bool(vision_budget_stats.get("omitted_for_budget"))) and should_emit_budget_notice(session):
                if isinstance(session.scratchpad, dict):
                    session.scratchpad["vision_budget_notice"] = (
                        "已对历史图片进行预算化精简，保留最近高相关内容。"
                    )
                    session.scratchpad["vision_budget_replaced"] = int(_replaced)
                    session.scratchpad["vision_budget_dropped"] = int(
                        vision_budget_stats.get("dropped_count", 0) or 0
                    )
        except Exception:
            pass
        # Always derive history attachments from the client's original image uploads.
        # We may strip image_inputs below for a non-vision model on *this* turn,
        # but the persisted user message (chat_history / agent_messages) must carry
        # the data:image payloads so that a later switch to a vision model can promote
        # them into real multimodal content without the user re-uploading.
        history_image_attachments = _history_attachments_from_image_inputs(image_inputs)
        try:
            from agenticx.studio.chat_attachments import materialize_session_image_uploads

            history_image_attachments = materialize_session_image_uploads(
                payload.session_id, history_image_attachments
            )
        except Exception:
            pass
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

        from agenticx.llms.vision import is_vision_capable

        if not is_vision_capable(
            str(session.provider_name or ""),
            str(session.model_name or ""),
        ):
            image_inputs = []

        def _resolve_llm():
            try:
                return ProviderResolver.resolve(
                    provider_name=session.provider_name,
                    model=session.model_name,
                )
            except ValueError as exc:
                # 自愈：历史会话可能绑定了 custom_openai_* 且未保存 model。
                # 这类会触发 "missing model configuration"，若直接抛错会让 SSE
                # 在某些 Python 版本下进入异常断流路径，前端只能看到 network error。
                if "missing model configuration" not in str(exc):
                    raise
                cfg = ConfigManager.load()
                preferred = str(cfg.default_provider or "").strip().lower()
                fallback_candidates: list[str] = []
                if preferred:
                    fallback_candidates.append(preferred)
                fallback_candidates.extend(
                    [
                        "openai",
                        "anthropic",
                        "zhipu",
                        "volcengine",
                        "bailian",
                        "qianfan",
                        "kimi",
                        "minimax",
                        "ollama",
                    ]
                )
                seen: set[str] = set()
                for provider_name in fallback_candidates:
                    key = str(provider_name or "").strip().lower()
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    provider_cfg = cfg.get_provider(key)
                    fallback_model = str(provider_cfg.model or "").strip()
                    if not fallback_model:
                        continue
                    try:
                        llm = ProviderResolver.resolve(
                            provider_name=key,
                            model=fallback_model,
                        )
                    except Exception:
                        continue
                    # 回写当前会话，避免后续每轮都走降级逻辑。
                    session.provider_name = key
                    session.model_name = fallback_model
                    logger.warning(
                        "[chat] auto-fallback model due to missing session model: sid=%s provider=%s model=%s",
                        payload.session_id,
                        key,
                        fallback_model,
                    )
                    return llm
                raise

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
                        for line in _runtime_event_to_sse_lines(event):
                            yield line
                        if event.type in terminal_types:
                            break
                except Exception as exc:
                    err = SseEvent(type="error", data={"agent_id": target_agent_id, "text": f"子智能体通信异常: {exc}"})
                    yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                finally:
                    team_manager.event_emitter = prev_emitter

                yield 'data: {"type":"done","data":{}}\n\n'
            return StreamingResponse(_subagent_message_stream(), media_type="text/event-stream")

        requested_group_id = str(payload.group_id or "").strip()
        group_payload = _meta_group_chat_payload(
            managed,
            requested_group_id=requested_group_id or None,
        )
        is_group_session = group_payload is not None
        if is_group_session:
            from agenticx.studio.turn_interruption import clear_stale_unattended_failure

            clear_stale_unattended_failure(session)
            manager.clear_interrupt(payload.session_id)
            manager.set_execution_state(payload.session_id, "running")
            setattr(session, "_usage_owner_session_id", payload.session_id)
            async def _group_chat_stream() -> AsyncGenerator[str, None]:
                try:
                    llm_factory = lambda provider, model: ProviderResolver.resolve(
                        provider_name=provider or session.provider_name,
                        model=model or session.model_name,
                    )
                    meta_leader_label = str(getattr(payload, "meta_leader_display_name", None) or "").strip() or DEFAULT_META_PRODUCT_LABEL
                    if isinstance(session.scratchpad, dict):
                        session.scratchpad[META_LEADER_LABEL_SCRATCH_KEY] = meta_leader_label
                    router = GroupChatRouter(
                        avatar_registry=avatar_registry,
                        llm_factory=llm_factory,
                        max_tool_rounds=_resolve_max_tool_rounds(),
                        meta_leader_display_name=meta_leader_label,
                        confirm_gate_factory=lambda agent_id: _resolve_confirm_gate(managed, agent_id),
                        clarify_gate_factory=lambda agent_id: _resolve_clarify_gate(managed, agent_id),
                    )
                    quoted_content = str(payload.quoted_content or "")
                    quoted_message_id = str(payload.quoted_message_id or "")
                    group_id = str(group_payload.get("id", "") or "")
                    group_name = str(group_payload.get("name", "") or "群聊")
                    group_members = list(group_payload.get("avatar_ids") or [])
                    group_routing = str(group_payload.get("routing", "intelligent") or "intelligent")
                    mentioned_ids = expand_mentions_with_meta_leader(
                        str(payload.user_input or ""),
                        list(payload.mentioned_avatar_ids or []),
                        meta_leader_label,
                    )
                    for tid in router._plain_targets_in_text(
                        str(payload.user_input or ""),
                        group_avatar_ids=group_members,
                    ):
                        if tid not in mentioned_ids:
                            mentioned_ids.append(tid)

                    targets = router.pick_targets(
                        group_id=group_id,
                        group_avatar_ids=group_members,
                        routing=group_routing,
                        mentioned_avatar_ids=mentioned_ids,
                        scratchpad=session.scratchpad if isinstance(session.scratchpad, dict) else {},
                    )
                    mentioned_set = set(mentioned_ids) & set(group_members)
                    if META_LEADER_AGENT_ID in targets:
                        typing_evt = SseEvent(
                            type="group_typing",
                            data={
                                "agent_id": META_LEADER_AGENT_ID,
                                "avatar_name": meta_leader_label,
                            },
                        )
                        yield f"data: {json.dumps(typing_evt.model_dump(), ensure_ascii=False)}\n\n"
                    for aid in mentioned_set:
                        avatar_cfg = avatar_registry.get_avatar(aid)
                        typing_evt = SseEvent(
                            type="group_typing",
                            data={
                                "agent_id": aid,
                                "avatar_name": (avatar_cfg.name if avatar_cfg else aid),
                            },
                        )
                        yield f"data: {json.dumps(typing_evt.model_dump(), ensure_ascii=False)}\n\n"

                    u_display = str(getattr(payload, "user_display_name", None) or "").strip() or None
                    async for reply in router.run_group_turn(
                        base_session=session,
                        group_id=group_id,
                        group_name=group_name,
                        routing=group_routing,
                        group_avatar_ids=group_members,
                        mentioned_avatar_ids=mentioned_ids,
                        user_input=payload.user_input,
                        quoted_content=quoted_content,
                        quoted_message_id=quoted_message_id,
                        should_stop=request.is_disconnected,
                        user_display_name=u_display,
                    ):
                        if await request.is_disconnected():
                            break
                        evt_type = str(getattr(reply, "event_type", "") or "")
                        if not evt_type:
                            evt_type = "group_skipped" if reply.skipped else "group_reply"
                        evt = SseEvent(
                            type=evt_type,
                            data={
                                "agent_id": reply.agent_id,
                                "avatar_name": reply.avatar_name,
                                "avatar_url": reply.avatar_url,
                                "content": reply.content,
                                "skipped": reply.skipped,
                                "error": reply.error,
                                "confirm_request_id": str(getattr(reply, "confirm_request_id", "") or ""),
                            },
                        )
                        yield f"data: {json.dumps(evt.model_dump(), ensure_ascii=False)}\n\n"
                except Exception as exc:
                    err = SseEvent(type="error", data={"text": f"Group runtime error: {exc}"})
                    yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                finally:
                    manager.clear_interrupt(payload.session_id)
                    manager.set_execution_state(payload.session_id, "idle")
                    await manager.persist_async(payload.session_id)
                yield 'data: {"type":"done","data":{}}\n\n'

            return StreamingResponse(_group_chat_stream(), media_type="text/event-stream")

        try:
            llm = _resolve_llm()
        except Exception as exc:
            llm_init_err_text = f"LLM init failed: {exc}"
            async def _error_stream() -> AsyncGenerator[str, None]:
                # Python 3.13 no longer allows closing over `exc` from except scope.
                # Copy the message into a normal local before defining the generator.
                err = SseEvent(type="error", data={"text": llm_init_err_text})
                yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                yield 'data: {"type":"done","data":{}}\n\n'
            return StreamingResponse(_error_stream(), media_type="text/event-stream")

        event_queue: "asyncio.Queue[RuntimeEvent | None]"
        import asyncio

        use_event_hub = live_reattach_enabled()
        event_hub = manager.ensure_event_hub(payload.session_id) if use_event_hub else None
        event_queue = asyncio.Queue()

        async def _on_team_event(event: RuntimeEvent) -> None:
            if event_hub is not None:
                await event_hub.publish(event)
            else:
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
        setattr(session, "_session_manager", manager)
        logger.debug(
            "[chat] sid=%s managed.tm=%s session._tm=%s tm._agents=%s",
            payload.session_id,
            id(managed.team_manager),
            id(getattr(session, "_team_manager", None)),
            list(team_manager._agents.keys()) if team_manager else [],
        )
        setattr(session, "_session_id", payload.session_id)
        active_avatar_id = str(getattr(managed, "avatar_id", "") or "").strip()
        is_automation_session = active_avatar_id.startswith("automation:")
        try:
            load_discovered_hooks()
        except Exception as exc:
            logger.debug("Skipping discovered hooks loading for chat: %s", exc)
        # Desktop 定时/立即执行由主进程拉 SSE，无法像 ChatPane 那样响应 confirm_required；
        # 无人值守会话必须自动放行 bash_exec 等工具确认，否则会永久卡住。
        meta_confirm_gate = (
            AutoApproveConfirmGate() if is_automation_session else _resolve_confirm_gate(managed, "meta")
        )
        meta_clarify_gate = _resolve_clarify_gate(managed, "meta", is_automation=is_automation_session)
        from agenticx.studio.turn_interruption import clear_stale_unattended_failure

        clear_stale_unattended_failure(session)
        manager.clear_interrupt(payload.session_id)
        manager.set_execution_state(payload.session_id, "running")

        def _mid_turn_persist_cb() -> None:
            try:
                manager.incremental_persist(payload.session_id)
            except Exception:
                pass

        try:
            runtime = AgentRuntime(
                llm,
                meta_confirm_gate,
                team_manager=team_manager,
                max_tool_rounds=_resolve_max_tool_rounds(),
                mid_turn_persist=_mid_turn_persist_cb,
                clarify_gate=meta_clarify_gate,
                is_unattended=is_automation_session,
            )
        except TypeError:
            runtime = AgentRuntime(
                llm,
                meta_confirm_gate,
            )
        avatar_context: dict[str, str] | None = None
        avatar_tools_enabled: dict[str, bool] = {}
        global_tools_enabled = _load_global_tools_policy()
        is_avatar_session = bool(active_avatar_id and not active_avatar_id.startswith("group:"))
        if is_avatar_session:
            avatar_cfg = avatar_registry.get_avatar(active_avatar_id)
            if avatar_cfg is not None:
                avatar_context = {
                    "name": avatar_cfg.name or active_avatar_id,
                    "role": avatar_cfg.role or "",
                    "system_prompt": avatar_cfg.system_prompt or "",
                }
                avatar_tools_enabled = _sanitize_tools_enabled(avatar_cfg.tools_enabled)

        def _build_avatar_direct_prompt() -> str:
            if avatar_context is None:
                return ""
            name = avatar_context.get("name", "")
            role = avatar_context.get("role", "")
            sys_prompt = avatar_context.get("system_prompt", "")
            ws = str(getattr(session, "workspace_dir", "") or "").strip()
            prompt = (
                f"你是 AgenticX 分身 **{name}**。\n"
                f"角色: {role or 'General Assistant'}\n"
            )
            if sys_prompt:
                prompt += f"分身自定义指令: {sys_prompt}\n"
            prompt += (
                "\n## 核心规则\n"
                "- 你是一个执行型 agent，优先亲自动手完成任务。\n"
                "- 如果任务复杂需要拆分，可以使用 `spawn_subagent` 创建临时子智能体帮忙。\n"
                f"- **严禁创建与自己同名（{name}）的子智能体**。子智能体必须用不同的名字（如 '{name}-researcher'、'{name}-coder' 等）。\n"
                "- 禁止调用 `delegate_to_avatar`（那是 Meta-Agent 专属工具）。\n"
                "- 可以用 `query_subagent_status` 查询自己创建的子智能体进度。\n"
                "- 回复使用中文，简洁务实。\n"
                "- 优先动手执行，不要反复确认。\n"
                "- 边做边汇报，每完成一步简要说明。\n"
                "- 连续 2 次工具调用失败或返回相同结果后，必须切换策略，禁止重复同一操作。\n"
                "- **流程/链路/架构**：先写 1–3 句可见衔接语，再 `show_widget` 出 SVG 图，后分节解读；"
                "禁止在 ```text``` 或正文里用 `A->B->C`、`↓` 文字链代替可视化。\n"
            )
            prompt += (
                "\n## 浏览器操作指南（browser-use MCP）\n"
                "操作网页时严格遵循以下流程，每步都必须调用工具，禁止空转：\n"
                "1. **导航**：`mcp_call(tool_name='browser_navigate', arguments={url:'...'})` — 每个 URL 只导航一次。\n"
                "2. **感知页面**：导航后立即调用 `mcp_call(tool_name='browser_get_state', arguments={})` 获取可交互元素列表。"
                "结果包含 `interactive_elements` 数组，每个元素有 `index`（用于点击）、`tag`、`text`、`href`。\n"
                "3. **点击元素**：找到目标元素的 `index`，调用 `mcp_call(tool_name='browser_click', arguments={index: N})`。\n"
                "4. **提取内容**：需要读取页面文字时用 `mcp_call(tool_name='browser_extract_content', arguments={query:'要找的内容'})`。\n"
                "5. **输入文字**：用 `mcp_call(tool_name='browser_type', arguments={index: N, text:'...'})`。\n"
                "6. **循环**：点击/输入后，重新调用 `browser_get_state` 感知新页面状态，再决定下一步。\n\n"
                "**关键禁忌**：\n"
                "- 禁止对同一 URL 重复调用 `browser_navigate`。\n"
                "- 禁止连续多次调用 `browser_screenshot`（非视觉模型看不到图片）。\n"
                "- 导航后必须调用 `browser_get_state`，不要凭猜测操作。\n"
                "- 每一步都要推进任务：导航→感知→点击→感知→点击…直到完成。\n"
            )
            if ws:
                prompt += f"\n## 工作目录\n- {ws}\n"
            try:
                from agenticx.runtime.prompts.meta_agent import (
                    _build_followup_questions_block,
                    _build_web_search_capability_block,
                    _build_widget_capability_block,
                )
                from agenticx.runtime.prompts.skill_authoring import (
                    build_skill_authoring_prompt_block,
                )

                prompt += "\n" + _build_web_search_capability_block()
                prompt += _build_widget_capability_block()
                prompt += _build_followup_questions_block()
                prompt += build_skill_authoring_prompt_block()
            except Exception:
                pass
            return prompt

        if is_automation_session:
            # Automation avatar is an execution worker, not a scheduler author.
            # Keep runtime/file/mcp tools, but block task-management meta tools to
            # prevent recursive "create another schedule_task" behavior.
            _blocked = {"schedule_task", "list_scheduled_tasks", "cancel_scheduled_task", "delegate_to_avatar"}
            effective_tools_source: list = [
                t
                for t in META_AGENT_TOOLS
                if t.get("function", {}).get("name") not in _blocked
            ]
        elif is_avatar_session:
            effective_tools_source = [
                t for t in META_AGENT_TOOLS if t.get("function", {}).get("name") != "delegate_to_avatar"
            ]
        else:
            effective_tools_source = list(META_AGENT_TOOLS)
        effective_tools_source = merge_computer_use_tools_into(effective_tools_source)
        effective_tools_source = _strip_disabled_web_search_tools(effective_tools_source)
        effective_tools_source = _maybe_inject_code_search_tools(
            session,
            effective_tools_source,
            avatar_id=active_avatar_id if is_avatar_session else None,
        )
        effective_tools: list = _filter_tools_by_policy(
            effective_tools_source,
            avatar_tools_enabled=avatar_tools_enabled,
            global_tools_enabled=global_tools_enabled,
        )

        async def _event_stream() -> AsyncGenerator[str, None]:
            runtime_task: "asyncio.Task[None] | None" = None
            meta_done = False
            saw_final = False
            had_runtime_failure = False
            partial_meta_text = ""
            keep_runtime_after_disconnect = bool(
                getattr(payload, "keep_runtime_after_disconnect", False)
            )
            if event_hub is not None:
                keep_runtime_after_disconnect = True
            client_disconnected = False
            hub_sub_id: int | None = None
            hub_sub_q: asyncio.Queue[BufferedEvent] | None = None

            async def _track_runtime_event(event: RuntimeEvent) -> None:
                nonlocal saw_final, had_runtime_failure, partial_meta_text
                partial_meta_text = _accumulate_meta_partial_text(partial_meta_text, event)
                if event.agent_id == "meta" and event.type == EventType.TOOL_RESULT.value:
                    _flush_taskspace_hint(manager, payload.session_id, session)
                if event.type in ("subagent_started", "subagent_completed", "subagent_error"):
                    logger.info("[sse] yielding %s agent=%s", event.type, event.agent_id)
                if event.type == EventType.FINAL.value and event.agent_id == "meta":
                    saw_final = True
                    snap = str(getattr(managed, "session_name", None) or "").strip()
                    if manager.claim_llm_title_slot(payload.session_id, snap):
                        asyncio.create_task(
                            _llm_suggest_session_title_job(manager, payload.session_id)
                        )
                elif _runtime_error_counts_as_failure(event):
                    had_runtime_failure = True
                # Persist clarification_required as a visible tool message so the
                # prompt card survives session switch / refresh (NFR-2). The
                # agent_runtime context sanitizer filters it out of LLM context
                # to avoid duplicating the user's answer (which arrives as a
                # real tool result).
                if (
                    event.agent_id == "meta"
                    and event.type == EventType.CLARIFICATION_REQUIRED.value
                ):
                    _persist_clarification_prompt(session, event.data)
                elif (
                    event.agent_id == "meta"
                    and event.type == EventType.CLARIFICATION_SUSPENDED.value
                ):
                    _persist_clarification_prompt(session, event.data, suspended=True)

            try:
                async def _produce_meta_events() -> None:
                    nonlocal saw_final, had_runtime_failure
                    try:
                        setattr(
                            session,
                            "bound_avatar_id",
                            active_avatar_id if is_avatar_session else None,
                        )
                        _meta_label = str(getattr(payload, "meta_leader_display_name", None) or "").strip() or DEFAULT_META_PRODUCT_LABEL
                        if isinstance(session.scratchpad, dict):
                            session.scratchpad[META_LEADER_LABEL_SCRATCH_KEY] = _meta_label
                        auto = AutoSolveMode()
                        effective_input = payload.user_input
                        quoted_content = str(payload.quoted_content or "").strip()
                        if quoted_content:
                            effective_input = f"{effective_input}\n\n[用户引用内容]\n{quoted_content}"
                        # Per-session KB retrieval mode: bind the desktop's choice to
                        # this in-memory session so continue/loop prompt builds honor
                        # it too (the global retrieval.mode is only the default).
                        _kb_mode_req = str(getattr(payload, "retrieval_mode", None) or "").strip().lower()
                        if _kb_mode_req in {"auto", "always"}:
                            try:
                                setattr(session, "kb_retrieval_mode", _kb_mode_req)
                            except Exception:
                                pass
                        if mode == "auto":
                            enriched = auto.enrich_prompt(payload.user_input)
                            effective_input = (
                                f"{enriched['prompt']}\n\n"
                                f"请直接给出可执行方案并自动推进。\n"
                                f"原始请求：{payload.user_input}"
                            )
                        if is_avatar_session:
                            if is_automation_session:
                                sys_prompt = _build_automation_runner_system_prompt(
                                    active_avatar_id,
                                    getattr(managed, "taskspaces", None) or [],
                                    str(getattr(session, "workspace_dir", "") or ""),
                                )
                            else:
                                sys_prompt = _build_avatar_direct_prompt()
                                try:
                                    from agenticx.runtime.prompts.meta_agent import (
                                        _build_computer_use_capabilities_block,
                                    )

                                    _cu_ctx = _build_computer_use_capabilities_block()
                                    if _cu_ctx:
                                        sys_prompt += "\n\n" + _cu_ctx
                                except Exception:
                                    pass
                                _ts_ctx = _build_taskspaces_context(
                                    list(getattr(managed, "taskspaces", None) or [])
                                )
                                if _ts_ctx:
                                    sys_prompt += "\n\n" + _ts_ctx
                                try:
                                    from agenticx.cli.studio_skill import get_all_skill_summaries
                                    from agenticx.runtime.prompts.meta_agent import _build_skills_context

                                    _av_skill_summaries = get_all_skill_summaries(
                                        bound_avatar_id=active_avatar_id,
                                    )
                                    sys_prompt += "\n\n" + _build_skills_context(_av_skill_summaries)
                                except Exception:
                                    pass
                        else:
                            _u_nickname = str(getattr(payload, "user_nickname", None) or "").strip()
                            _u_preference = str(getattr(payload, "user_preference", None) or "").strip()
                            sys_prompt = build_meta_agent_system_prompt(
                                session,
                                mode=mode,
                                taskspaces=managed.taskspaces,
                                avatar_context=avatar_context,
                                group_chat=_meta_group_chat_payload(managed),
                                user_nickname=_u_nickname,
                                user_preference=_u_preference,
                                kb_retrieval_mode_override=_kb_mode_req or None,
                            )
                        user_message_content: Any | None = None
                        history_user_attachments: list[dict[str, Any]] | None = None

                        async def _runtime_should_stop() -> bool:
                            if manager.should_interrupt(payload.session_id):
                                return True
                            if keep_runtime_after_disconnect:
                                return False
                            return await request.is_disconnected()

                        if image_inputs:
                            content_blocks: list[dict[str, Any]] = [{"type": "text", "text": effective_input}]
                            for image in image_inputs:
                                content_blocks.append(
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": image["data_url"]},
                                    }
                                )
                            user_message_content = content_blocks
                        # Persist image attachments for the user turn in history (messages.json)
                        # using the original client uploads (even if we cleared image_inputs for a
                        # non-vision model on this specific turn). This enables later promotion
                        # when the session model is switched to a vision-capable one.
                        if history_image_attachments:
                            if history_user_attachments is None:
                                history_user_attachments = []
                            # prepend images before any context-file attachments for this turn
                            history_user_attachments = list(history_image_attachments) + history_user_attachments
                        _turn_cf = (
                            _normalize_context_files(payload.context_files)
                            if getattr(payload, "context_files", None)
                            else {}
                        )
                        _cf_hist = _history_attachments_from_context_files(_turn_cf)
                        if _cf_hist:
                            if history_user_attachments is None:
                                history_user_attachments = []
                            history_user_attachments.extend(_cf_hist)
                        async for event in runtime.run_turn(
                            effective_input,
                            session,
                            should_stop=_runtime_should_stop,
                            agent_id="meta",
                            tools=effective_tools,
                            system_prompt=sys_prompt,
                            user_message_content=user_message_content,
                            history_user_attachments=history_user_attachments,
                            persist_user_message=not bool(getattr(payload, "skip_user_history", False)),
                            usage_session_id=payload.session_id,
                            usage_avatar_id=str(getattr(managed, "avatar_id", "") or ""),
                        ):
                            if event_hub is not None:
                                await _track_runtime_event(event)
                                await event_hub.publish(event)
                            else:
                                await event_queue.put(event)
                    except Exception as exc:
                        had_runtime_failure = True
                        if event_hub is not None:
                            err_evt = RuntimeEvent(
                                type=EventType.ERROR.value,
                                data={"text": f"Runtime error: {exc}"},
                                agent_id="meta",
                            )
                            await event_hub.publish(err_evt)
                        else:
                            raise
                    finally:
                        if event_hub is not None:
                            await event_hub.publish_done()
                            _finalize_partial_assistant_if_needed(
                                session,
                                partial_meta_text,
                                saw_final=saw_final,
                            )
                            from agenticx.studio.turn_interruption import resolve_turn_interruption_cause

                            hub_cause = resolve_turn_interruption_cause(
                                manager,
                                payload.session_id,
                                saw_final=saw_final,
                                had_runtime_failure=had_runtime_failure,
                            )
                            await _finalize_chat_runtime(
                                manager,
                                payload.session_id,
                                session,
                                saw_final=saw_final,
                                had_runtime_failure=had_runtime_failure,
                                interruption_cause=hub_cause,
                            )
                        else:
                            await event_queue.put(None)

                runtime_task = asyncio.create_task(_produce_meta_events())

                if event_hub is not None:
                    hub_sub_id, hub_sub_q, _ = event_hub.subscribe()
                    while True:
                        if await request.is_disconnected():
                            client_disconnected = True
                            break
                        try:
                            buffered = await asyncio.wait_for(hub_sub_q.get(), timeout=0.1)
                        except asyncio.TimeoutError:
                            if event_hub.is_runtime_done and hub_sub_q.empty():
                                yield 'data: {"type":"done","data":{}}\n\n'
                                break
                            continue
                        if buffered.event is None:
                            yield 'data: {"type":"done","data":{}}\n\n'
                            break
                        for line in _buffered_event_to_sse_lines(buffered):
                            yield line
                else:
                    while True:
                        if await request.is_disconnected():
                            if not keep_runtime_after_disconnect:
                                break
                            client_disconnected = True
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
                            partial_meta_text = _accumulate_meta_partial_text(
                                partial_meta_text, event
                            )
                            if event.agent_id == "meta" and event.type == EventType.TOOL_RESULT.value:
                                _flush_taskspace_hint(manager, payload.session_id, session)
                            if event.type in ("subagent_started", "subagent_completed", "subagent_error"):
                                logger.info("[sse] yielding %s agent=%s", event.type, event.agent_id)
                            if not client_disconnected:
                                for line in _runtime_event_to_sse_lines(event):
                                    yield line
                            if event.type == EventType.FINAL.value and event.agent_id == "meta":
                                saw_final = True
                                snap = str(getattr(managed, "session_name", None) or "").strip()
                                if manager.claim_llm_title_slot(payload.session_id, snap):
                                    asyncio.create_task(
                                        _llm_suggest_session_title_job(manager, payload.session_id)
                                    )
                            elif _runtime_error_counts_as_failure(event):
                                had_runtime_failure = True
                        if not meta_done:
                            continue
                        if event_queue.empty():
                            break
            except Exception as exc:
                had_runtime_failure = True
                err = SseEvent(type="error", data={"text": f"Runtime error: {exc}"})
                if not client_disconnected:
                    yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
            finally:
                runtime_was_cancelled = False
                if hub_sub_id is not None and event_hub is not None:
                    event_hub.unsubscribe(hub_sub_id)
                if runtime_task is not None and not runtime_task.done():
                    if event_hub is not None and client_disconnected:
                        logger.info(
                            "[chat] client disconnected, runtime continues (hub) session=%s",
                            payload.session_id,
                        )
                    elif keep_runtime_after_disconnect and client_disconnected:
                        with contextlib.suppress(Exception):
                            await asyncio.wait_for(runtime_task, timeout=1.0)
                    if runtime_task is not None and not runtime_task.done():
                        if event_hub is None or not client_disconnected:
                            runtime_was_cancelled = True
                            runtime_task.cancel()
                    else:
                        logger.info(
                            "[chat] runtime finished after disconnect session=%s",
                            payload.session_id,
                        )
                elif runtime_task is not None and runtime_task.done():
                    task_exc = runtime_task.exception()
                    if task_exc is not None and event_hub is None:
                        had_runtime_failure = True
                if event_hub is None:
                    from agenticx.studio.turn_interruption import resolve_turn_interruption_cause

                    legacy_cause = resolve_turn_interruption_cause(
                        manager,
                        payload.session_id,
                        saw_final=saw_final,
                        had_runtime_failure=had_runtime_failure,
                        client_disconnected=client_disconnected,
                        runtime_cancelled=runtime_was_cancelled,
                    )
                    _finalize_partial_assistant_if_needed(
                        session,
                        partial_meta_text,
                        saw_final=saw_final,
                    )
                    await _finalize_chat_runtime(
                        manager,
                        payload.session_id,
                        session,
                        saw_final=saw_final,
                        had_runtime_failure=had_runtime_failure,
                        interruption_cause=legacy_cause,
                    )
            if not client_disconnected and event_hub is None:
                yield 'data: {"type":"done","data":{}}\n\n'

        return StreamingResponse(_event_stream(), media_type="text/event-stream")

    @app.post("/api/sessions/{session_id}/continue")
    async def continue_session(
        session_id: str,
        payload: ContinueRequest,
        request: Request,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> StreamingResponse:
        _check_token(x_agx_desktop_token)
        sid = str(session_id or "").strip()
        if not sid:
            raise HTTPException(status_code=400, detail="session_id is required")
        managed = manager.get(sid, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")

        reason = str(payload.reason or "manual").strip().lower()
        if reason not in {"stall", "interrupted", "exhausted", "rate_limit", "manual"}:
            reason = "manual"
        source = str(payload.source or "desktop_manual").strip().lower()
        if source not in {"desktop_manual", "desktop_auto_nudge", "supervisor"}:
            source = "desktop_manual"

        exec_state = str(getattr(managed, "execution_state", "idle") or "idle")
        if source in {"desktop_manual", "supervisor"} and exec_state == "running":
            from agenticx.studio.continuation import interrupt_running_for_continue

            exec_state = await interrupt_running_for_continue(manager, sid)

        max_nudge = int(
            __import__("agenticx.studio.continuation", fromlist=["get_runtime_value"]).get_runtime_value(
                "runtime.stall_auto_nudge_max_per_session", 2
            )
            or 2
        )
        ok, prompt, round_n, notice = prepare_continue(
            managed,
            reason=reason,  # type: ignore[arg-type]
            source=source,  # type: ignore[arg-type]
            execution_state=exec_state,
            max_rounds=max_nudge if source == "desktop_auto_nudge" else None,
            skip_dedupe=source == "desktop_manual",
        )
        if not ok:
            async def _deduped() -> AsyncGenerator[str, None]:
                evt = SseEvent(type="continuation_rejected", data={"text": "续跑请求已去重，请稍后再试"})
                yield f"data: {json.dumps(evt.model_dump(), ensure_ascii=False)}\n\n"
                yield 'data: {"type":"done","data":{}}\n\n'

            return StreamingResponse(_deduped(), media_type="text/event-stream")

        await manager.persist_async(sid)

        async def _wrapped_stream() -> AsyncGenerator[str, None]:
            notice_evt = SseEvent(
                type="continuation_notice",
                data={
                    "text": notice.get("content", ""),
                    "reason": reason,
                    "source": source,
                    "continuation_round": round_n,
                    "metadata": notice.get("metadata", {}),
                },
            )
            yield f"data: {json.dumps(notice_evt.model_dump(), ensure_ascii=False)}\n\n"
            chat_payload = ChatRequest(
                session_id=sid,
                user_input=prompt,
                skip_user_history=True,
                provider=managed.studio_session.provider_name,
                model=managed.studio_session.model_name,
            )
            inner = await chat(chat_payload, request, x_agx_desktop_token)
            if inner.body_iterator is not None:
                async for chunk in inner.body_iterator:
                    yield chunk

        return StreamingResponse(_wrapped_stream(), media_type="text/event-stream")

    @app.get("/api/sessions/{session_id}/stream")
    async def reattach_session_stream(
        session_id: str,
        request: Request,
        since: str | None = Query(default=None),
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> StreamingResponse:
        """Read-only SSE reattach for a running session (live reattach feature)."""
        _check_token(x_agx_desktop_token)
        sid = str(session_id or "").strip()
        if not sid:
            raise HTTPException(status_code=400, detail="session_id is required")

        if not live_reattach_enabled():
            async def _disabled() -> AsyncGenerator[str, None]:
                err = SseEvent(type="error", data={"text": "live reattach disabled"})
                yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
                yield 'data: {"type":"done","data":{"reason":"disabled"}}\n\n'

            return StreamingResponse(_disabled(), media_type="text/event-stream")

        managed = manager.get(sid, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")

        hub = manager.get_event_hub(sid)

        async def _reattach_stream() -> AsyncGenerator[str, None]:
            if hub is None or not hub.is_active:
                yield 'data: {"type":"done","data":{"reason":"not_running"}}\n\n'
                return

            since_seq = _parse_sse_since_seq(last_event_id, since)
            # Subscribe BEFORE replaying so events published during replay land in
            # the live queue; replay covers (since_seq, sub_seq], live covers > sub_seq.
            sub_id, sub_q, sub_seq = hub.subscribe()
            try:
                oldest = hub.oldest_buffered_seq()
                if (
                    since_seq > 0
                    and oldest is not None
                    and since_seq < oldest - 1
                ):
                    gap_evt = SseEvent(
                        type="replay_gap",
                        data={"since": since_seq, "oldest_buffered": oldest},
                    )
                    yield f"data: {json.dumps(gap_evt.model_dump(), ensure_ascii=False)}\n\n"

                done_in_replay = False
                for buffered in hub.replay_since(since_seq):
                    if buffered.seq > sub_seq:
                        # Anything newer than the subscription point is delivered
                        # via the live queue below; avoid double-sending.
                        break
                    for line in _buffered_event_to_sse_lines(buffered):
                        yield line
                    if buffered.event is None:
                        done_in_replay = True
                        break
                if done_in_replay:
                    return

                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        buffered = await asyncio.wait_for(sub_q.get(), timeout=30.0)
                    except asyncio.TimeoutError:
                        if hub.is_runtime_done:
                            break
                        continue
                    if buffered.seq <= sub_seq:
                        # Already emitted during replay.
                        continue
                    for line in _buffered_event_to_sse_lines(buffered):
                        yield line
                    if buffered.event is None:
                        break
            finally:
                hub.unsubscribe(sub_id)

        return StreamingResponse(_reattach_stream(), media_type="text/event-stream")

    @app.put("/api/sessions/{session_id}/unattended")
    async def set_session_unattended(
        session_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        sid = str(session_id or "").strip()
        if not sid:
            raise HTTPException(status_code=400, detail="session_id is required")
        managed = manager.get(sid, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        enabled = bool(payload.get("enabled", False))
        from agenticx.studio.supervisor import set_session_unattended_enabled

        set_session_unattended_enabled(managed.studio_session, enabled)
        await manager.persist_async(sid)
        return {"ok": True, "session_id": sid, "unattended_enabled": enabled}

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
        setattr(session, "_session_id", session_id)
        try:
            load_discovered_hooks()
        except Exception as exc:
            logger.debug("Skipping discovered hooks loading for loop: %s", exc)
        llm = ProviderResolver.resolve(provider_name=session.provider_name, model=session.model_name)
        loop_tm = managed.team_manager

        def _loop_persist_cb() -> None:
            try:
                manager.incremental_persist(session_id)
            except Exception:
                pass

        loop_is_automation = str(getattr(managed, "avatar_id", "") or "").startswith("automation:")
        try:
            runtime = AgentRuntime(
                llm,
                _resolve_confirm_gate(managed, "meta"),
                team_manager=loop_tm,
                max_tool_rounds=_resolve_max_tool_rounds(),
                mid_turn_persist=_loop_persist_cb,
                clarify_gate=_resolve_clarify_gate(managed, "meta", is_automation=loop_is_automation),
                is_unattended=loop_is_automation,
            )
        except TypeError:
            runtime = AgentRuntime(
                llm,
                _resolve_confirm_gate(managed, "meta"),
            )
        controller = LoopController(max_iterations=max_iterations, completion_promise=completion_promise)

        loop_avatar_id = str(getattr(managed, "avatar_id", "") or "").strip()
        loop_is_avatar = bool(loop_avatar_id and not loop_avatar_id.startswith("group:"))
        loop_avatar_tools_enabled: dict[str, bool] = {}
        if loop_is_avatar:
            loop_avatar_cfg = avatar_registry.get_avatar(loop_avatar_id)
            if loop_avatar_cfg is not None:
                loop_avatar_tools_enabled = _sanitize_tools_enabled(loop_avatar_cfg.tools_enabled)
        loop_tools_source: list = list(STUDIO_TOOLS) if loop_is_avatar else list(META_AGENT_TOOLS)
        loop_tools_source = merge_computer_use_tools_into(loop_tools_source)
        loop_tools_source = _strip_disabled_web_search_tools(loop_tools_source)
        loop_tools_source = _maybe_inject_code_search_tools(
            session,
            loop_tools_source,
            avatar_id=loop_avatar_id if loop_is_avatar else None,
        )
        loop_tools: list = _filter_tools_by_policy(
            loop_tools_source,
            avatar_tools_enabled=loop_avatar_tools_enabled,
            global_tools_enabled=_load_global_tools_policy(),
        )
        setattr(
            session,
            "bound_avatar_id",
            loop_avatar_id if loop_is_avatar else None,
        )
        loop_sys_prompt = build_meta_agent_system_prompt(
            session,
            mode="interactive",
            taskspaces=managed.taskspaces,
            group_chat=_meta_group_chat_payload(managed),
        )

        async def _loop_stream() -> AsyncGenerator[str, None]:
            try:
                async for event in controller.run_loop(
                    task=user_input,
                    runtime=runtime,
                    session=session,
                    agent_id="meta",
                    tools=loop_tools,
                    system_prompt=loop_sys_prompt,
                ):
                    if await request.is_disconnected():
                        break
                    if event.agent_id == "meta" and event.type == EventType.TOOL_RESULT.value:
                        _flush_taskspace_hint(manager, session_id, session)
                    if event.agent_id == "meta" and event.type == EventType.CLARIFICATION_REQUIRED.value:
                        _persist_clarification_prompt(session, event.data)
                    elif event.agent_id == "meta" and event.type == EventType.CLARIFICATION_SUSPENDED.value:
                        _persist_clarification_prompt(session, event.data, suspended=True)
                    for line in _runtime_event_to_sse_lines(event):
                        yield line
            except Exception as exc:
                err = SseEvent(type="error", data={"text": f"Loop runtime error: {exc}"})
                yield f"data: {json.dumps(err.model_dump(), ensure_ascii=False)}\n\n"
            finally:
                _flush_taskspace_hint(manager, session_id, session)
                await manager.persist_async(session_id)
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

        if not isinstance(status_payload, dict):
            status_payload = {"ok": True, "subagents": []}
        rows = status_payload.get("subagents") or []
        if not isinstance(rows, list):
            rows = []
        known_ids = {str(r.get("agent_id", "")) for r in rows if isinstance(r, dict)}
        for _sid, _managed in manager._sessions.items():
            info = getattr(_managed, "_delegation_info", None)
            if not isinstance(info, dict):
                continue
            dlg_id = str(info.get("delegation_id", "")).strip()
            if not dlg_id or dlg_id in known_ids:
                continue
            if _sid == session_id:
                continue
            from_session = str(info.get("from_session", "")).strip()
            if not from_session or from_session != session_id:
                continue
            task_obj = getattr(_managed, "_delegation_task", None)
            is_running = task_obj is not None and not task_obj.done()
            dlg_status = str(info.get("status", "")).strip()
            if is_running:
                dlg_status = "running"
            elif not dlg_status:
                dlg_status = "completed" if (task_obj is not None and task_obj.done()) else "unknown"
            rows.append({
                "agent_id": dlg_id,
                "name": str(info.get("avatar_name", "")).strip() or str(getattr(_managed, "avatar_name", "")).strip() or dlg_id,
                "role": "delegated avatar",
                "task": str(info.get("task", "")).strip(),
                "status": dlg_status,
                "result_summary": str(info.get("summary", "")).strip() if dlg_status in ("completed", "failed") else None,
                "error_text": str(info.get("error", "")).strip() if dlg_status == "failed" else None,
                "delegation": True,
                "avatar_session_id": str(info.get("avatar_session_id", _sid)).strip(),
            })
        status_payload["subagents"] = rows
        return status_payload

    @app.post("/api/subagent/retry")
    async def retry_subagent(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", ""))
        agent_id = str(payload.get("agent_id", ""))
        refined_task = payload.get("task")
        provider_raw = payload.get("provider")
        model_raw = payload.get("model")
        provider = str(provider_raw).strip() if isinstance(provider_raw, str) and provider_raw.strip() else None
        model = str(model_raw).strip() if isinstance(model_raw, str) and model_raw.strip() else None
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
            provider=provider,
            model=model,
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
                    provider=provider,
                    model=model,
                )
            if not result.get("ok"):
                raise HTTPException(status_code=400, detail=result.get("message", "retry failed"))
        return result

    @app.post("/api/subagent/model")
    async def update_subagent_model(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", ""))
        agent_id = str(payload.get("agent_id", ""))
        provider_raw = payload.get("provider")
        model_raw = payload.get("model")
        provider = str(provider_raw).strip() if isinstance(provider_raw, str) and provider_raw.strip() else None
        model = str(model_raw).strip() if isinstance(model_raw, str) and model_raw.strip() else None
        if not session_id or not agent_id:
            raise HTTPException(status_code=400, detail="session_id and agent_id are required")
        if not provider and not model:
            raise HTTPException(status_code=400, detail="provider or model is required")
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
        result = await team_manager.update_subagent_model(
            agent_id,
            provider=provider,
            model=model,
        )
        if not result.get("ok"):
            fallback_manager = AgentTeamManager.find_manager_for_agent(
                agent_id,
                include_archived=True,
                session_id=session_id,
            )
            if fallback_manager is not None and fallback_manager is not team_manager:
                result = await fallback_manager.update_subagent_model(
                    agent_id,
                    provider=provider,
                    model=model,
                )
            if not result.get("ok"):
                raise HTTPException(status_code=400, detail=result.get("message", "update model failed"))
        return result

    @app.get("/api/session/subagent-clusters")
    async def session_subagent_clusters(
        session_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        sid = str(session_id or "").strip()
        if not sid:
            return {"ok": False, "error": "session_id is required", "detail": "missing session_id"}
        try:
            memory_map = collect_memory_status_map(sid)
            store = SubAgentRunStore(sid)
            clusters = list_subagent_clusters_payload(
                session_id=sid,
                store=store,
                memory_map=memory_map,
            )
            return {"ok": True, "clusters": clusters}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[subagent-clusters] sid=%s failed: %s", sid, exc)
            return {"ok": False, "error": "subagent clusters read failed", "detail": str(exc)}

    @app.get("/api/subagent/run")
    async def subagent_run_detail(
        session_id: str = Query(...),
        run_id: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        sid = str(session_id or "").strip()
        rid = str(run_id or "").strip()
        if not sid or not rid:
            return {
                "ok": False,
                "error": "session_id and run_id are required",
                "detail": "missing query params",
            }
        try:
            store = SubAgentRunStore(sid)
            record = store.get_run(rid)
            if record is None:
                return {"ok": False, "error": "run not found", "detail": rid}
            memory = collect_memory_status_map(sid).get(rid)
            return {"ok": True, "run": merge_run_record_with_memory(record, memory)}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[subagent/run] sid=%s run=%s failed: %s", sid, rid, exc)
            return {"ok": False, "error": "run read failed", "detail": str(exc)}

    @app.get("/api/subagent/run/activity")
    async def subagent_run_activity(
        session_id: str = Query(...),
        run_id: str = Query(...),
        offset: int = Query(default=0),
        limit: int = Query(default=100),
        order: str = Query(default="asc"),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        sid = str(session_id or "").strip()
        rid = str(run_id or "").strip()
        if not sid or not rid:
            return {
                "ok": False,
                "error": "session_id and run_id are required",
                "detail": "missing query params",
            }
        try:
            store = SubAgentRunStore(sid)
            record = store.get_run(rid)
            if record is None:
                return {"ok": False, "error": "run not found", "detail": rid}
            entries, total, safe_offset, safe_limit = paginate_activity_entries(
                store.read_activity(rid),
                offset=offset,
                limit=limit,
                order=order,
            )
            return {
                "ok": True,
                "entries": entries,
                "total": total,
                "offset": safe_offset,
                "limit": safe_limit,
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("[subagent/run/activity] sid=%s run=%s failed: %s", sid, rid, exc)
            return {"ok": False, "error": "activity read failed", "detail": str(exc)}

    @app.get("/api/subagent/run/artifact-preview")
    async def subagent_run_artifact_preview(
        session_id: str = Query(...),
        run_id: str = Query(...),
        path: str = Query(...),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        sid = str(session_id or "").strip()
        rid = str(run_id or "").strip()
        requested_path = str(path or "").strip()
        if not sid or not rid or not requested_path:
            return {
                "ok": False,
                "error": "session_id, run_id and path are required",
                "detail": "missing query params",
            }
        try:
            store = SubAgentRunStore(sid)
            record = store.get_run(rid)
            if record is None:
                return {"ok": False, "error": "run not found", "detail": rid}
            allowed, resolved, reason = resolve_artifact_path(
                requested_path=requested_path,
                record=record,
                owner_session_id=sid,
            )
            if not allowed or resolved is None:
                return {"ok": False, "error": "path not allowed", "detail": reason or requested_path}
            preview = preview_artifact_file(resolved)
            if not preview.get("ok"):
                return preview
            return preview
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[subagent/run/artifact-preview] sid=%s run=%s path=%s failed: %s",
                sid,
                rid,
                requested_path,
                exc,
            )
            return {"ok": False, "error": "artifact preview failed", "detail": str(exc)}

    @app.get("/api/mcp/servers")
    async def list_mcp_servers(
        session_id: str = Query(default=""),
        reload: bool = Query(default=True),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager
        from types import SimpleNamespace

        sid = (session_id or "").strip()
        managed = manager.get(sid, touch=False) if sid else None
        # No-session fallback: return process-level configs + connection state
        # so the Settings panel works even before a session is bound (FR-1).
        if managed is None:
            gmcp = GlobalMcpManager.singleton()
            if reload:
                gmcp._reload_configs_if_needed()
            configs = gmcp.mcp_configs if isinstance(gmcp.mcp_configs, dict) else {}
            connected = set(gmcp.connected_servers or set())
            shim = SimpleNamespace(mcp_hub=gmcp.hub)
            tool_counts = _mcp_tool_counts_for_session(shim)
            tool_names_map = _mcp_tool_names_for_session(shim)
            server_ops: dict = {}
        else:
            sess = managed.studio_session
            if reload:
                GlobalMcpManager.singleton()._reload_configs_if_needed()
            configs = sess.mcp_configs if isinstance(sess.mcp_configs, dict) else {}
            connected = (
                sess.connected_servers
                if isinstance(sess.connected_servers, set)
                else set(sess.connected_servers or [])
            )
            tool_counts = _mcp_tool_counts_for_session(sess)
            tool_names_map = _mcp_tool_names_for_session(sess)
            server_ops = _get_mcp_server_ops(sess)
        servers = []
        for name, cfg in sorted(configs.items()):
            in_connected = name in connected
            n_tools = int(tool_counts.get(name, 0))
            if in_connected and n_tools > 0:
                conn_state = "healthy"
                err_detail = ""
            elif in_connected:
                conn_state = "error"
                err_detail = _ERR_STALE_MCP
            else:
                conn_state = "disconnected"
                err_detail = ""
            servers.append(
                {
                    "name": name,
                    "connected": in_connected,
                    "command": str(getattr(cfg, "command", "") or ""),
                    "url": str(getattr(cfg, "url", "") or ""),
                    "transport": str(getattr(cfg, "transport", "stdio") or "stdio"),
                    "connection_state": conn_state,
                    "tool_count": n_tools,
                    "tool_names": sorted(tool_names_map.get(name, [])),
                    "error_detail": err_detail,
                    "op_phase": str((server_ops.get(name, {}) or {}).get("phase", "idle") or "idle"),
                    "op_message": str((server_ops.get(name, {}) or {}).get("message", "") or ""),
                    "op_updated_at": (server_ops.get(name, {}) or {}).get("updated_at"),
                }
            )
        healthy_n = sum(1 for item in servers if item.get("connection_state") == "healthy")
        return {
            "ok": True,
            "count": len(servers),
            "connected_count": sum(1 for item in servers if item.get("connected")),
            "healthy_count": healthy_n,
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
        # Trigger config hot-reload in GlobalMcpManager (invalidate mtime cache).
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager
        GlobalMcpManager.singleton()._configs_mtime = 0.0
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
        cfg = (sess.mcp_configs or {}).get(name) if isinstance(sess.mcp_configs, dict) else None
        cmd = str(getattr(cfg, "command", "") or "").strip().lower()
        if cmd == "docker":
            preflight_msg = "准备连接：检查 Docker 服务可用性…"
        elif cmd in {"uvx", "npx"}:
            preflight_msg = f"准备连接：拉起 {cmd} 运行时…"
        elif cmd:
            preflight_msg = f"准备连接：启动 {cmd}…"
        else:
            preflight_msg = "准备连接：初始化 MCP 客户端…"
        _set_mcp_server_op(sess, name, phase="preparing", message=preflight_msg)
        _set_mcp_server_op(sess, name, phase="connecting", message="连接中：握手并发现工具…")
        cancelled_set = _get_mcp_connect_cancelled(sess)
        cancelled_set.discard(name)
        connect_tasks = _get_mcp_connect_tasks(sess)
        task = connect_tasks.get(name)
        if task is None or task.done():
            task = asyncio.create_task(
                mcp_connect_async(sess.mcp_hub, sess.mcp_configs, sess.connected_servers, name)
            )
            connect_tasks[name] = task
        try:
            ok, detail = await task
        except asyncio.CancelledError:
            ok, detail = False, "连接已取消"
        finally:
            if connect_tasks.get(name) is task:
                connect_tasks.pop(name, None)
        if name in cancelled_set:
            cancelled_set.discard(name)
            sess.connected_servers.discard(name)
            _set_mcp_server_op(sess, name, phase="idle", message="未连接")
            return {"ok": False, "error": "连接已取消", "name": name}
        if not ok:
            detail_text = detail.strip() or f"failed to connect MCP server: {name}"
            if "已取消" in detail_text:
                sess.connected_servers.discard(name)
                _set_mcp_server_op(sess, name, phase="idle", message="未连接")
                return {"ok": False, "error": detail_text, "name": name}
            _set_mcp_server_op(
                sess,
                name,
                phase="failed",
                message=f"连接失败：{detail_text}",
                error=detail_text,
            )
            raise HTTPException(
                status_code=400,
                detail=detail_text,
            )
        try:
            append_mcp_auto_connect_name(name)
        except Exception as exc:
            logger.warning("MCP auto_connect persist failed: %s", exc)
        n_tools = int(_mcp_tool_counts_for_session(sess).get(name, 0))
        _set_mcp_server_op(
            sess,
            name,
            phase="healthy",
            message=(f"已连接：{n_tools} 个工具" if n_tools > 0 else "已连接：工具注册同步中…"),
        )
        return {"ok": True, "name": name}

    @app.get("/api/mcp/settings")
    async def get_mcp_settings(x_agx_desktop_token: str | None = Header(default=None)) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        extra = list(get_mcp_extra_search_paths_config())
        ac_raw: Any = ConfigManager.get_value("mcp.auto_connect")
        auto_list: list[str] = []
        if isinstance(ac_raw, list):
            auto_list = [str(x).strip() for x in ac_raw if str(x).strip()]
        elif isinstance(ac_raw, str) and ac_raw.strip() and ac_raw.strip().lower() != "all":
            auto_list = [ac_raw.strip()]
        disabled_tools = get_mcp_disabled_tools_config()
        return {
            "ok": True,
            "extra_search_paths": extra,
            "auto_connect": auto_list,
            "disabled_tools": disabled_tools,
            "skip_default_names": get_mcp_skip_default_names_config(),
            "default_entry_names": get_default_mcp_entry_names(),
        }

    @app.put("/api/mcp/settings")
    async def put_mcp_settings(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        extra = payload.get("extra_search_paths")
        if extra is not None:
            if not isinstance(extra, list):
                raise HTTPException(status_code=400, detail="extra_search_paths must be a list")
            set_mcp_extra_search_paths_config([str(x) for x in extra])
        disabled_tools = payload.get("disabled_tools")
        if disabled_tools is not None:
            if not isinstance(disabled_tools, dict):
                raise HTTPException(status_code=400, detail="disabled_tools must be a dict")
            set_mcp_disabled_tools_config(
                {str(k): [str(t) for t in v] for k, v in disabled_tools.items() if isinstance(v, list)}
            )
        skip_default_names = payload.get("skip_default_names")
        if skip_default_names is not None:
            if not isinstance(skip_default_names, list):
                raise HTTPException(status_code=400, detail="skip_default_names must be a list")
            set_mcp_skip_default_names_config([str(x) for x in skip_default_names])
        return {
            "ok": True,
            "extra_search_paths": list(get_mcp_extra_search_paths_config()),
            "skip_default_names": get_mcp_skip_default_names_config(),
            "default_entry_names": get_default_mcp_entry_names(),
        }

    @app.get("/api/mcp/discover")
    async def discover_mcp_configs(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        hits = [item.to_dict() for item in detect_all(Path.cwd())]
        return {
            "ok": True,
            "count": len(hits),
            "hits": hits,
        }

    @app.get("/api/mcp/raw")
    async def get_mcp_raw(
        path: str | None = Query(default=None),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        target = _normalize_mcp_path_for_edit(path)
        if not target.exists():
            raise HTTPException(status_code=404, detail=f"file not found: {target}")
        text = target.read_text(encoding="utf-8")
        fmt = _detect_mcp_file_format(target)
        parse_ok = True
        parse_error = ""
        line = None
        column = None
        if fmt == "json":
            try:
                json.loads(text)
            except json.JSONDecodeError as exc:
                parse_ok = False
                parse_error = exc.msg
                line = exc.lineno
                column = exc.colno
        return {
            "ok": True,
            "path": str(target),
            "format": fmt,
            "text": text,
            "parse_ok": parse_ok,
            "parse_error": parse_error,
            "line": line,
            "column": column,
        }

    @app.put("/api/mcp/raw")
    async def put_mcp_raw(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        target = _normalize_mcp_path_for_edit(str(payload.get("path", "")).strip() or None)
        text = str(payload.get("text", ""))
        fmt = _detect_mcp_file_format(target)
        if fmt != "json":
            raise HTTPException(status_code=400, detail="only .json mcp file is editable in this endpoint")
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": exc.msg,
                    "line": exc.lineno,
                    "column": exc.colno,
                },
            )

        validation_errors = _validate_json_mcp_payload(parsed)
        if validation_errors:
            raise HTTPException(status_code=400, detail={"error": "schema validation failed", "items": validation_errors})

        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(target.parent),
            delete=False,
            prefix=f".{target.name}.",
            suffix=".tmp",
        ) as tmp:
            tmp.write(text.rstrip() + "\n")
            tmp_path = Path(tmp.name)
        tmp_path.replace(target)
        return {"ok": True, "path": str(target), "format": fmt}

    @app.get("/api/mcp/marketplace")
    async def list_marketplace_mcps(
        category: str | None = Query(default=None),
        search: str | None = Query(default=None),
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=20, ge=1, le=100),
        is_hosted: bool | None = Query(default=None),
        is_verified: bool | None = Query(default=None),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        cache_key = json.dumps(
            {
                "category": category,
                "search": search,
                "page": page,
                "page_size": page_size,
                "is_hosted": is_hosted,
                "is_verified": is_verified,
            },
            sort_keys=True,
            ensure_ascii=False,
        )
        cached = _marketplace_cache_get(cache_key)
        if cached is not None:
            return cached

        filter_obj: dict[str, Any] = {}
        if category:
            filter_obj["category"] = str(category).strip()
        if is_hosted is not None:
            filter_obj["is_hosted"] = bool(is_hosted)
        body = {
            "filter": filter_obj,
            "page_number": page,
            "page_size": page_size,
            "search": str(search or "").strip(),
        }
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.put(_MODELSCOPE_LIST_URL, json=body, headers=_modelscope_headers())
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"marketplace upstream error: HTTP {resp.status_code}")
        payload = resp.json()
        data = payload.get("data") if isinstance(payload, dict) else {}
        items = data.get("mcp_server_list") if isinstance(data, dict) else []
        if not isinstance(items, list):
            items = []
        if is_verified is not None:
            items = [it for it in items if bool((it or {}).get("is_verified")) is bool(is_verified)]
        result = {
            "ok": True,
            "page": page,
            "page_size": page_size,
            "total_count": int((data or {}).get("total_count") or 0),
            "items": items,
        }
        _marketplace_cache_set(cache_key, result)
        return result

    @app.get("/api/mcp/marketplace/{server_id:path}")
    async def marketplace_mcp_detail(
        server_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        sid = str(server_id).strip()
        if not sid:
            raise HTTPException(status_code=400, detail="server_id required")
        cache_key = f"detail:{sid}"
        cached = _marketplace_cache_get(cache_key)
        if cached is not None:
            return cached
        url = _MODELSCOPE_DETAIL_URL_TMPL.format(server_id=sid)
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=_modelscope_headers())
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"marketplace upstream error: HTTP {resp.status_code}")
        payload = resp.json()
        data = payload.get("data") if isinstance(payload, dict) else {}
        result = {"ok": True, "item": data}
        _marketplace_cache_set(cache_key, result)
        return result

    @app.post("/api/mcp/marketplace/install")
    async def install_marketplace_mcp(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_mcp_admin_token(x_agx_desktop_token)
        server_id = str(payload.get("server_id", "")).strip()
        env_overrides = payload.get("env") or {}
        if not isinstance(env_overrides, dict):
            raise HTTPException(status_code=400, detail="env must be an object")
        if not server_id:
            raise HTTPException(status_code=400, detail="server_id required")
        detail = await marketplace_mcp_detail(server_id=server_id, x_agx_desktop_token=x_agx_desktop_token)
        item = detail.get("item") if isinstance(detail, dict) else {}
        server_config_list = item.get("server_config") if isinstance(item, dict) else None
        if not isinstance(server_config_list, list) or not server_config_list:
            raise HTTPException(status_code=400, detail="invalid marketplace server_config")
        first_cfg = server_config_list[0]
        if not isinstance(first_cfg, dict):
            raise HTTPException(status_code=400, detail="invalid server_config payload")
        mcp_servers = first_cfg.get("mcpServers")
        if not isinstance(mcp_servers, dict):
            raise HTTPException(status_code=400, detail="server_config missing mcpServers")

        merged_cfg = {"mcpServers": {}}
        for name, cfg in mcp_servers.items():
            if not isinstance(cfg, dict):
                continue
            env_block = cfg.get("env")
            base_env = dict(env_block) if isinstance(env_block, dict) else {}
            for k, v in env_overrides.items():
                if str(v).strip():
                    base_env[str(k)] = str(v)
            next_cfg = dict(cfg)
            if base_env:
                next_cfg["env"] = base_env
            merged_cfg["mcpServers"][str(name)] = next_cfg
        if not merged_cfg["mcpServers"]:
            raise HTTPException(status_code=400, detail="empty mcpServers after merge")

        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", delete=False) as tmp:
            tmp.write(json.dumps(merged_cfg, ensure_ascii=False, indent=2) + "\n")
            source_path = tmp.name
        try:
            result = import_mcp_config(source_path)
        finally:
            with contextlib.suppress(Exception):
                Path(source_path).unlink(missing_ok=True)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=str(result.get("error", "install failed")))

        imported_names = [str(x) for x in result.get("imported", [])]
        updated_names = [str(x) for x in result.get("updated", [])]
        for name in imported_names + updated_names:
            with contextlib.suppress(Exception):
                append_mcp_auto_connect_name(name)

        return {
            "ok": True,
            "installed": imported_names,
            "updated": updated_names,
            "result": result,
        }

    @app.post("/api/mcp/disconnect")
    async def disconnect_mcp_server(
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
        connect_tasks = _get_mcp_connect_tasks(sess)
        in_flight_connect = connect_tasks.get(name)
        if in_flight_connect is not None and not in_flight_connect.done():
            _get_mcp_connect_cancelled(sess).add(name)
            in_flight_connect.cancel()
            sess.connected_servers.discard(name)
            try:
                remove_mcp_auto_connect_name(name)
            except Exception as exc:
                logger.warning("MCP auto_connect remove failed: %s", exc)
            _set_mcp_server_op(sess, name, phase="idle", message="未连接")
            return {"ok": True, "name": name}
        _set_mcp_server_op(sess, name, phase="disconnecting", message="断开中：正在关闭 MCP 客户端…")
        okd, err = await mcp_disconnect_async(sess.mcp_hub, sess.mcp_configs, sess.connected_servers, name)
        if not okd:
            err_text = err.strip() or f"disconnect failed: {name}"
            _set_mcp_server_op(
                sess,
                name,
                phase="failed",
                message=f"断开失败：{err_text}",
                error=err_text,
            )
            raise HTTPException(status_code=400, detail=err_text)
        try:
            remove_mcp_auto_connect_name(name)
        except Exception as exc:
            logger.warning("MCP auto_connect remove failed: %s", exc)
        _set_mcp_server_op(sess, name, phase="idle", message="未连接")
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

    @app.get("/api/tools/status")
    async def get_tools_status(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        from agenticx.studio.blocking_io import run_in_settings_pool
        from agenticx.studio.tools_status_api import build_tools_status_sync

        tools = await run_in_settings_pool(build_tools_status_sync, _tool_status)
        return {"ok": True, "tools": tools}

    @app.get("/api/tools/registry")
    async def get_tools_registry(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Return all STUDIO_TOOLS + META tool definitions for the Desktop tools tab."""
        _check_token(x_agx_desktop_token)

        _TOOL_CATEGORIES: dict[str, str] = {
            "bash_exec": "system",
            "desktop_screenshot": "system",
            "desktop_mouse_click": "system",
            "desktop_keyboard_type": "system",
            "file_read": "filesystem", "file_write": "filesystem", "file_edit": "filesystem", "list_files": "filesystem",
            "codegen": "code",
            "lsp_goto_definition": "code", "lsp_find_references": "code", "lsp_hover": "code", "lsp_diagnostics": "code",
            "mcp_connect": "mcp", "mcp_call": "mcp", "mcp_import": "mcp",
            "skill_use": "skill", "skill_list": "skill", "skill_manage": "skill", "skill_import_repo": "skill",
            "todo_write": "agent", "scratchpad_write": "agent", "scratchpad_read": "agent",
            "memory_append": "memory", "memory_search": "memory", "session_search": "memory",
            "liteparse": "document",
            "list_data_sources": "data_source", "query_data_source": "data_source",
            "schedule_task": "scheduling", "list_scheduled_tasks": "scheduling", "cancel_scheduled_task": "scheduling",
            "spawn_subagent": "meta", "cancel_subagent": "meta", "retry_subagent": "meta",
            "query_subagent_status": "meta", "check_resources": "meta", "recommend_subagent_model": "meta",
            "list_skills": "meta", "list_mcps": "meta",
            "send_bug_report_email": "meta", "update_email_config": "meta",
        }

        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for tool in STUDIO_TOOLS:
            fn = tool.get("function", {})
            name = fn.get("name", "")
            if not name or name in seen:
                continue
            seen.add(name)
            items.append({
                "name": name,
                "description": fn.get("description", ""),
                "category": _TOOL_CATEGORIES.get(name, "other"),
                "is_meta": name in META_TOOL_NAMES,
            })
        from agenticx.cli.agent_tools import COMPUTER_USE_TOOLS, computer_use_config_enabled
        from agenticx.runtime.meta_tools import META_AGENT_TOOLS
        for tool in META_AGENT_TOOLS:
            fn = tool.get("function", {})
            name = fn.get("name", "")
            if not name or name in seen:
                continue
            seen.add(name)
            items.append({
                "name": name,
                "description": fn.get("description", ""),
                "category": _TOOL_CATEGORIES.get(name, "meta"),
                "is_meta": True,
            })
        if computer_use_config_enabled():
            for tool in COMPUTER_USE_TOOLS:
                fn = tool.get("function", {})
                name = fn.get("name", "")
                if not name or name in seen:
                    continue
                seen.add(name)
                items.append({
                    "name": name,
                    "description": fn.get("description", ""),
                    "category": _TOOL_CATEGORIES.get(name, "system"),
                    "is_meta": False,
                })
        return {"ok": True, "tools": items}

    @app.get("/api/tools/policy")
    async def get_tools_policy(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        return {
            "ok": True,
            "tools_enabled": _load_global_tools_policy(),
            "tools_options": _load_global_tools_options(),
        }

    @app.put("/api/tools/policy")
    async def save_tools_policy(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        tools_enabled = _sanitize_tools_enabled(payload.get("tools_enabled"))
        _save_global_tools_policy(tools_enabled)
        if "tools_options" in payload:
            _save_global_tools_options(payload.get("tools_options"))
        tools_options = _load_global_tools_options()
        return {"ok": True, "tools_enabled": tools_enabled, "tools_options": tools_options}

    @app.post("/api/tools/install")
    async def install_tool(
        payload: dict,
        request: Request,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> StreamingResponse:
        _check_token(x_agx_desktop_token)
        tool_id = str(payload.get("tool_id", "")).strip().lower()
        if not tool_id:
            raise HTTPException(status_code=400, detail="tool_id is required")
        if tool_id not in {"liteparse", "libreoffice", "imagemagick"}:
            raise HTTPException(status_code=400, detail=f"unsupported tool_id: {tool_id}")

        async def _install_stream() -> AsyncGenerator[str, None]:
            if tool_id in {"libreoffice", "imagemagick"}:
                hint = _tool_install_hint(tool_id)
                yield _sse_event(
                    "progress",
                    {
                        "tool_id": tool_id,
                        "phase": "manual_required",
                        "percent": 0,
                        "message": "该工具需手动安装，请按提示命令执行。",
                        "install_command": hint,
                    },
                )
                yield _sse_event(
                    "progress",
                    {
                        "tool_id": tool_id,
                        "phase": "done",
                        "percent": 100,
                        "message": "已返回安装指南。",
                    },
                )
                return

            npm_executable = shutil.which("npm")
            if not npm_executable:
                yield _sse_event(
                    "progress",
                    {
                        "tool_id": tool_id,
                        "phase": "error",
                        "percent": 0,
                        "message": "未检测到 npm，请先安装 Node.js。",
                    },
                )
                return

            yield _sse_event(
                "progress",
                {
                    "tool_id": tool_id,
                    "phase": "starting",
                    "percent": 5,
                    "message": "准备安装 LiteParse...",
                },
            )

            process = await asyncio.create_subprocess_exec(
                npm_executable,
                "i",
                "-g",
                "@llamaindex/liteparse",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            assert process.stdout is not None
            percent = 10
            try:
                while True:
                    if await request.is_disconnected():
                        process.terminate()
                        break
                    line = await process.stdout.readline()
                    if not line:
                        break
                    text = line.decode("utf-8", errors="ignore").strip()
                    if not text:
                        continue
                    match = re.search(r"(\d{1,3})%", text)
                    if match:
                        parsed = int(match.group(1))
                        percent = max(percent, min(95, parsed))
                    else:
                        percent = min(95, percent + 5)
                    yield _sse_event(
                        "progress",
                        {
                            "tool_id": tool_id,
                            "phase": "installing",
                            "percent": percent,
                            "message": text[:500],
                        },
                    )
                code = await process.wait()
            except Exception as exc:
                yield _sse_event(
                    "progress",
                    {
                        "tool_id": tool_id,
                        "phase": "error",
                        "percent": percent,
                        "message": f"安装失败: {exc}",
                    },
                )
                return

            if code != 0:
                yield _sse_event(
                    "progress",
                    {
                        "tool_id": tool_id,
                        "phase": "error",
                        "percent": percent,
                        "message": f"安装失败，退出码 {code}",
                    },
                )
                return

            status = _tool_status("liteparse")
            version = str(status.get("version", "") or "").strip()
            success_message = f"LiteParse {version} installed".strip() if version else "LiteParse installed"
            yield _sse_event(
                "progress",
                {
                    "tool_id": tool_id,
                    "phase": "done",
                    "percent": 100,
                    "message": success_message,
                    "installed": bool(status.get("installed")),
                    "version": version,
                },
            )

        return StreamingResponse(_install_stream(), media_type="text/event-stream")

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
        raw_tools_enabled = payload.get("tools_enabled")
        tools_enabled: dict[str, bool] = {}
        if isinstance(raw_tools_enabled, dict):
            tools_enabled = {
                str(key): bool(value)
                for key, value in raw_tools_enabled.items()
                if str(key).strip()
            }
        skills_enabled = _sanitize_avatar_skills_enabled(payload.get("skills_enabled"))
        brains_enabled = _sanitize_avatar_brains_enabled(payload.get("brains_enabled"))
        config = avatar_registry.create_avatar(
            name=name,
            role=str(payload.get("role", "")).strip(),
            avatar_url=str(payload.get("avatar_url", "")).strip(),
            system_prompt=str(payload.get("system_prompt", "")).strip(),
            created_by=str(payload.get("created_by", "")).strip(),
            default_provider=str(payload.get("default_provider", "")).strip(),
            default_model=str(payload.get("default_model", "")).strip(),
            tools_enabled=tools_enabled,
            skills_enabled=skills_enabled,
            brains_enabled=brains_enabled,
            workspace_dir=str(payload.get("workspace_dir", "")).strip(),
        )
        return {"ok": True, "avatar": config.to_dict()}

    @app.put("/api/avatars/{avatar_id}")
    async def update_avatar(
        avatar_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        if "tools_enabled" in payload:
            payload = dict(payload)
            payload["tools_enabled"] = _sanitize_tools_enabled(payload.get("tools_enabled"))
        if "skills_enabled" in payload:
            payload = dict(payload)
            payload["skills_enabled"] = _sanitize_avatar_skills_enabled(
                payload.get("skills_enabled")
            )
        if "brains_enabled" in payload:
            payload = dict(payload)
            payload["brains_enabled"] = _sanitize_avatar_brains_enabled(
                payload.get("brains_enabled")
            )
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

    @app.get("/api/sessions/search")
    async def search_sessions_by_messages(
        q: str = Query(default=""),
        avatar_id: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=100),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        t_aid = (str(avatar_id).strip() if avatar_id is not None else "")
        aid = t_aid or None
        raw_q = str(q or "").strip()
        if not raw_q:
            return {"ok": True, "hits": []}
        hits = manager.search_sessions_by_message_text(
            raw_q,
            avatar_id=aid,
            limit_sessions=limit,
        )
        return {"ok": True, "hits": hits}

    @app.post("/api/sessions")
    async def create_session(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        avatar_id = str(payload.get("avatar_id", "")).strip() or None
        session_name = str(payload.get("name", "")).strip() or None
        inherit_from = str(payload.get("inherit_from_session_id", "")).strip() or None
        from agenticx.runtime.session_mode import normalize_session_mode

        session_mode = normalize_session_mode(str(payload.get("session_mode", "")))
        avatar_cfg = avatar_registry.get_avatar(avatar_id) if avatar_id else None
        provider_override = str(payload.get("provider", "") or "").strip() or None
        model_override = str(payload.get("model", "") or "").strip() or None
        provider = (
            provider_override
            if provider_override
            else (avatar_cfg.default_provider if avatar_cfg and avatar_cfg.default_provider else None)
        )
        model = (
            model_override
            if model_override
            else (avatar_cfg.default_model if avatar_cfg and avatar_cfg.default_model else None)
        )

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
        managed.studio_session.session_mode = session_mode
        if session_mode == "code_dev":
            from agenticx.runtime.session_mode import PHASE_EXPLORE, PHASE_SCRATCH_KEY
            from agenticx.runtime.prompts.code_mode import ensure_code_dev_workflow_skill

            scratch = managed.studio_session.scratchpad
            if isinstance(scratch, dict) and PHASE_SCRATCH_KEY not in scratch:
                scratch[PHASE_SCRATCH_KEY] = PHASE_EXPLORE
            ensure_code_dev_workflow_skill(managed.studio_session)
        if avatar_cfg and avatar_cfg.workspace_dir:
            manager.apply_session_workspace_dir(
                managed,
                avatar_workspace_dir=avatar_cfg.workspace_dir,
            )
        else:
            manager.apply_session_workspace_dir(managed)
        manager.apply_avatar_binding(
            managed,
            avatar_id=avatar_id,
            avatar_name=avatar_cfg.name if avatar_cfg else None,
        )
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

        # MCP state is now process-level; new sessions do not trigger MCP auto-connect.
        return {
            "ok": True,
            "session_id": managed.session_id,
            "avatar_id": avatar_id,
            "session_name": session_name,
            "created_at": managed.created_at,
            "inherited": bool(inherited_summary),
            "session_mode": session_mode,
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

    @app.post("/api/sessions/{session_id}/model")
    async def set_session_model(
        session_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Persist the currently-selected provider/model for a session.

        Desktop calls this when the user picks a new model in the chat pane,
        so the selection survives cold restart (list_sessions() re-reads it).
        """
        _check_token(x_agx_desktop_token)
        provider = str(payload.get("provider", "") or "").strip()
        model = str(payload.get("model", "") or "").strip()
        ok = manager.set_session_model(session_id, provider=provider, model=model)
        if not ok:
            raise HTTPException(status_code=404, detail="session not found")
        return {"ok": True, "session_id": session_id, "provider": provider, "model": model}

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
        routing = str(payload.get("routing", "intelligent")).strip()
        allowed_routing = {"user-directed", "meta-routed", "round-robin", "intelligent", "team"}
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
        allowed_routing = {"user-directed", "meta-routed", "round-robin", "intelligent"}
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
            routing = str(payload.get("routing", "intelligent")).strip()
            if routing not in allowed_routing:
                raise HTTPException(status_code=400, detail="invalid routing strategy")
            patch["routing"] = routing
        if not patch:
            raise HTTPException(status_code=400, detail="no valid fields to update")
        config = group_registry.update_group(group_id, patch)
        if config is None:
            raise HTTPException(status_code=404, detail="group not found")
        return {"ok": True, "group": config.to_dict()}

    # ── Group Team Events SSE + Action endpoints ──────────────────────────────
    # Registered event buses keyed by (group_id, session_id).
    # Populated by _run_team_turn in group_router.py; drained here via SSE.
    _group_team_event_buses: dict[str, Any] = {}

    @app.get("/api/groups/{group_id}/events")
    async def stream_group_events(
        group_id: str,
        session_id: str | None = None,
        x_agx_desktop_token: str | None = Header(default=None),
    ):
        """SSE stream of WorkforceEvents for a group team session.

        Clients subscribe here to receive structured workforce events
        (decompose_start / task_assigned / task_completed / workforce_stopped …)
        emitted by _run_team_turn when routing="team".
        """
        from agenticx.collaboration.workforce.events import WorkforceEventBus
        from fastapi.responses import StreamingResponse

        _check_token(x_agx_desktop_token)
        bus_key = f"{group_id}::{session_id or 'default'}"
        bus = _group_team_event_buses.get(bus_key)

        async def event_generator():
            if bus is None:
                # No active team session; send a heartbeat and end.
                yield "data: {\"action\":\"no_active_session\"}\n\n"
                return
            while True:
                evt = await bus.get_next_event(timeout=30)
                if evt is None:
                    yield ": heartbeat\n\n"
                    continue
                try:
                    yield f"data: {evt.json()}\n\n"
                except Exception:
                    yield f"data: {{\"action\":\"{evt.action.value}\"}}\n\n"
                # Stop streaming after workforce session ends.
                from agenticx.collaboration.workforce.events import WorkforceAction
                if evt.action in (WorkforceAction.WORKFORCE_STOPPED, WorkforceAction.WORKFORCE_PAUSED):
                    break

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    @app.post("/api/groups/{group_id}/action")
    async def post_group_action(
        group_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Forward a UI action (ADD_TASK / PAUSE / RESUME / STOP / SKIP_TASK) to TaskLock."""
        from agenticx.collaboration.task_lock import get_or_create_task_lock, ActionData, Action

        _check_token(x_agx_desktop_token)
        action_str = str(payload.get("action", "")).strip()
        session_id = str(payload.get("session_id", "default")).strip()
        data = payload.get("data") or {}
        try:
            action = Action(action_str)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"unknown action: {action_str!r}")
        task_lock = get_or_create_task_lock(
            project_id=f"group::{group_id}::{session_id}"
        )
        try:
            await task_lock.put_queue(ActionData(action=action, data=data))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"queue full: {exc}")
        return {"ok": True, "action": action_str}

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

    @app.get("/api/memory/favorites")
    async def get_memory_favorites(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        workspace_dir = resolve_workspace_dir()
        items = load_favorites(workspace_dir)
        items_sorted = sorted(items, key=lambda x: str(x.get("saved_at", "") or ""), reverse=True)
        return {"ok": True, "items": items_sorted}

    @app.delete("/api/memory/favorites/{message_id}")
    async def delete_memory_favorite(
        message_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        workspace_dir = resolve_workspace_dir()
        existing = next(
            (
                row
                for row in load_favorites(workspace_dir)
                if str(row.get("message_id", "") or "").strip() == str(message_id).strip()
            ),
            None,
        )
        ok = delete_favorite(workspace_dir, message_id)
        memory_reconciled = False
        if ok and isinstance(existing, dict):
            try:
                content = str(existing.get("content", "") or "").strip()
                if content and remove_favorite_memory_note(workspace_dir, content):
                    WorkspaceMemoryStore().index_workspace_sync(workspace_dir)
                    memory_reconciled = True
            except Exception:
                pass
        return {"ok": ok, "memory_reconciled": memory_reconciled}

    @app.patch("/api/memory/favorites/{message_id}/tags")
    async def patch_memory_favorite_tags(
        message_id: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        tags_raw = payload.get("tags")
        if not isinstance(tags_raw, list):
            raise HTTPException(status_code=400, detail="tags must be a list")
        tag_list = [str(x) for x in tags_raw]
        workspace_dir = resolve_workspace_dir()
        ok = update_favorite_tags(workspace_dir, message_id, tag_list)
        return {"ok": ok}

    @app.post("/api/memory/save")
    async def save_message_memory(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        session_id = str(payload.get("session_id", "") or "").strip()
        content = str(payload.get("content", "") or "").strip()
        source_message_id = str(payload.get("message_id", "") or "").strip()
        role = str(payload.get("role", "") or "").strip() or "unknown"
        if not session_id or not content:
            raise HTTPException(status_code=400, detail="session_id and content are required")
        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        scratch = getattr(managed.studio_session, "scratchpad", None)
        if not isinstance(scratch, dict):
            scratch = {}
            setattr(managed.studio_session, "scratchpad", scratch)
        records = scratch.get("saved_messages")
        if not isinstance(records, list):
            records = []

        saved_at = datetime.now().isoformat()
        workspace_dir = resolve_workspace_dir()
        truncated = content[:500].strip()
        entry = {
            "message_id": source_message_id,
            "session_id": session_id,
            "content": content,
            "saved_at": saved_at,
            "role": role,
            "tags": [],
        }
        inserted = upsert_favorite(workspace_dir, entry)
        already_saved = not inserted

        memory_persisted = False
        if inserted:
            records.append({
                "message_id": source_message_id,
                "content": content,
                "saved_at": str(saved_at),
            })
            scratch["saved_messages"] = records[-200:]
            await manager.persist_async(session_id)
            try:
                append_long_term_memory(workspace_dir, f"[用户收藏] {truncated}")
                WorkspaceMemoryStore().index_workspace_sync(workspace_dir)
                memory_persisted = True
            except Exception:
                pass
            try:
                from agenticx.memory.graph.writer import MemoryGraphWriter

                avatar_id = getattr(managed, "avatar_id", None)
                writer = MemoryGraphWriter.singleton()
                asyncio.create_task(
                    writer.enqueue_favorite(
                        session_id=session_id,
                        avatar_id=avatar_id,
                        content=truncated,
                        role=role,
                    )
                )
            except Exception:
                pass

        return {
            "ok": True,
            "saved_count": len(scratch.get("saved_messages", [])),
            "memory_persisted": memory_persisted,
            "already_saved": already_saved,
        }

    def _memory_workspace_dir_from_payload(payload: dict | None = None, *, avatar_id: str | None = None) -> Path:
        aid = (avatar_id or "").strip()
        if not aid and isinstance(payload, dict):
            aid = str(payload.get("avatar_id") or "").strip()
        if aid:
            return resolve_subject_workspace_dir(aid)
        return resolve_workspace_dir()

    @app.get("/api/memory/workspace")
    async def get_memory_workspace(
        avatar_id: str | None = None,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        workspace_dir = _memory_workspace_dir_from_payload(avatar_id=avatar_id)
        entries = read_memory_entries(workspace_dir)
        sections_map: dict[str, list[dict]] = {}
        sections_order: list[str] = []
        for entry in entries:
            sec = str(entry.get("section") or "")
            if sec not in sections_map:
                sections_map[sec] = []
                sections_order.append(sec)
            item: dict = {
                "index": int(entry.get("index", 0)),
                "text": str(entry.get("text") or ""),
                "line": int(entry.get("line") or 0),
            }
            raw_children = entry.get("children")
            if isinstance(raw_children, list) and raw_children:
                item["children"] = [str(c) for c in raw_children if str(c).strip()]
            sections_map[sec].append(item)
        sections = [{"section": sec, "entries": sections_map[sec]} for sec in sections_order]
        return {
            "ok": True,
            "sections": sections,
            "path": str(workspace_dir / "MEMORY.md"),
        }

    @app.post("/api/memory/workspace/entry")
    async def create_memory_workspace_entry(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        text = str(payload.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="empty text")
        section = str(payload.get("section") or "User Anchors").strip() or "User Anchors"
        workspace_dir = _memory_workspace_dir_from_payload(payload)
        append_long_term_memory(workspace_dir, text, section=section)
        try:
            WorkspaceMemoryStore().index_workspace_sync(workspace_dir)
        except Exception as exc:
            logger.warning("workspace reindex after memory edit failed: %s", exc)
        return {"ok": True}

    @app.patch("/api/memory/workspace/entry")
    async def patch_memory_workspace_entry(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        section = str(payload.get("section") or "").strip()
        text = str(payload.get("text") or "").strip()
        if not section:
            raise HTTPException(status_code=400, detail="section is required")
        if not text:
            raise HTTPException(status_code=400, detail="empty text")
        try:
            index = int(payload.get("index"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="index must be an integer")
        workspace_dir = _memory_workspace_dir_from_payload(payload)
        children: list[str] | None = None
        raw_children = payload.get("children")
        if raw_children is not None:
            if not isinstance(raw_children, list):
                raise HTTPException(status_code=400, detail="children must be a list")
            children = [str(c).strip() for c in raw_children if str(c).strip()]
        try:
            if children is not None:
                update_memory_entry(workspace_dir, section, index, text, children=children)
            else:
                update_memory_entry(workspace_dir, section, index, text)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            WorkspaceMemoryStore().index_workspace_sync(workspace_dir)
        except Exception as exc:
            logger.warning("workspace reindex after memory edit failed: %s", exc)
        return {"ok": True}

    @app.delete("/api/memory/workspace/entry")
    async def delete_memory_workspace_entry(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        section = str(payload.get("section") or "").strip()
        if not section:
            raise HTTPException(status_code=400, detail="section is required")
        try:
            index = int(payload.get("index"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="index must be an integer")
        workspace_dir = _memory_workspace_dir_from_payload(payload)
        try:
            delete_memory_entry(workspace_dir, section, index)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            WorkspaceMemoryStore().index_workspace_sync(workspace_dir)
        except Exception as exc:
            logger.warning("workspace reindex after memory edit failed: %s", exc)
        return {"ok": True}

    @app.post("/api/memory/workspace/entries/batch-delete")
    async def batch_delete_memory_workspace_entries(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        raw_entries = payload.get("entries")
        if not isinstance(raw_entries, list) or not raw_entries:
            raise HTTPException(status_code=400, detail="entries is required")
        targets: list[tuple[str, int]] = []
        for item in raw_entries:
            if not isinstance(item, dict):
                continue
            section = str(item.get("section") or "").strip()
            if not section:
                continue
            try:
                index = int(item.get("index"))
            except (TypeError, ValueError):
                continue
            targets.append((section, index))
        if not targets:
            raise HTTPException(status_code=400, detail="no valid entries")
        workspace_dir = _memory_workspace_dir_from_payload(payload)
        deleted = delete_memory_entries_batch(workspace_dir, targets)
        if deleted <= 0:
            raise HTTPException(status_code=400, detail="no entries deleted")
        try:
            WorkspaceMemoryStore().index_workspace_sync(workspace_dir)
        except Exception as exc:
            logger.warning("workspace reindex after memory edit failed: %s", exc)
        return {"ok": True, "deleted": deleted}

    @app.post("/api/messages/forward")
    async def forward_messages(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        source_session_id = str(payload.get("source_session_id", "") or "").strip()
        target_session_id = str(payload.get("target_session_id", "") or "").strip()
        follow_up_note = str(payload.get("follow_up_note", "") or "").strip()
        if not follow_up_note:
            # Backward-compatible fallback: some clients may omit follow_up_note.
            # Keep the forwarded card self-contained so reload still shows user follow-up intent.
            follow_up_note = "请阅读刚转发的聊天记录并继续回复。"
        messages = payload.get("messages", [])
        if not source_session_id or not target_session_id:
            raise HTTPException(status_code=400, detail="source_session_id and target_session_id are required")
        if not isinstance(messages, list) or not messages:
            raise HTTPException(status_code=400, detail="messages must be a non-empty list")
        source_managed = manager.get(source_session_id, touch=False)
        target_managed = manager.get(target_session_id, touch=False)
        if target_managed is None:
            raise HTTPException(status_code=404, detail="target session not found")
        normalized_items: list[dict[str, Any]] = []
        for item in messages:
            if not isinstance(item, dict):
                continue
            sender = str(item.get("sender", "") or "").strip() or "unknown"
            role = str(item.get("role", "") or "").strip() or "assistant"
            avatar_url = str(item.get("avatar_url", "") or "").strip()
            content = str(item.get("content", "") or "").strip()
            timestamp_raw = item.get("timestamp")
            timestamp: int | None
            try:
                timestamp = int(timestamp_raw) if timestamp_raw is not None else None
            except (TypeError, ValueError):
                timestamp = None
            if not content:
                continue
            normalized_items.append(
                {
                    "sender": sender,
                    "role": role,
                    "content": content,
                    "avatar_url": avatar_url or None,
                    "timestamp": timestamp,
                }
            )
        if not normalized_items:
            raise HTTPException(status_code=400, detail="no valid messages to forward")
        source_name = "会话"
        if source_managed is not None:
            source_name = (
                str(getattr(source_managed, "session_name", "") or "").strip()
                or str(getattr(source_managed, "avatar_name", "") or "").strip()
                or source_name
            )
        preview_lines = [f"{item['sender']}: {item['content']}" for item in normalized_items[:2]]
        preview_text = "\n".join(preview_lines) if preview_lines else "聊天记录"
        if follow_up_note:
            preview_text = f"{preview_text}\n附加说明: {follow_up_note}"
        ts = int(datetime.now().timestamp() * 1000)
        forward_entry: dict[str, Any] = {
            "role": "user",
            "content": preview_text,
            "timestamp": ts,
            "forwarded_history": {
                "title": f"聊天记录 · 来自 {source_name}",
                "source_session": source_session_id,
                "note": follow_up_note or None,
                "items": normalized_items,
            },
        }
        session = target_managed.studio_session
        session.chat_history.append(forward_entry)
        # run_turn reads agent_messages, not chat_history alone — mirror so the model sees the forward.
        session.agent_messages.append(copy.deepcopy(forward_entry))
        target_managed.updated_at = datetime.now().timestamp()
        await manager.persist_async(target_session_id)
        return {"ok": True, "forwarded": len(normalized_items), "appended_messages": 1}

    # --- Skills API ---

    @app.get("/api/skills/settings")
    async def get_skill_settings(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Skill scan roots: preset toggles + custom paths (``~/.agenticx/config.yaml``)."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.tools.skill_bundle import skill_scan_settings_payload

            body = skill_scan_settings_payload()
            return {"ok": True, **body}
        except Exception as exc:
            logger.warning("get_skill_settings error: %s", exc)
            return {
                "ok": False,
                "preset_paths": [],
                "custom_paths": [],
                "preferred_sources": {},
                "disabled_skills": [],
                "error": str(exc),
            }

    @app.put("/api/skills/settings")
    async def put_skill_settings(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Persist skill scan settings and return the merged effective payload."""
        _check_token(x_agx_desktop_token)
        preset = payload.get("preset_paths")
        custom = payload.get("custom_paths")
        preferred = payload.get("preferred_sources")
        disabled_skills_arg: list[str] | None = None
        if "disabled_skills" in payload:
            ds = payload.get("disabled_skills")
            if ds is None:
                disabled_skills_arg = []
            elif isinstance(ds, list):
                disabled_skills_arg = [str(x).strip() for x in ds if str(x).strip()]
            else:
                raise HTTPException(
                    status_code=400, detail="disabled_skills must be a list or null"
                )
        if preset is not None and not isinstance(preset, list):
            raise HTTPException(
                status_code=400, detail="preset_paths must be a list or omitted"
            )
        if custom is not None and not isinstance(custom, list):
            raise HTTPException(
                status_code=400, detail="custom_paths must be a list or omitted"
            )
        if preferred is not None and not isinstance(preferred, dict):
            raise HTTPException(
                status_code=400, detail="preferred_sources must be a dict or omitted"
            )
        try:
            from agenticx.tools.skill_bundle import (
                persist_skill_scan_settings,
                skill_scan_settings_payload,
            )

            persist_skill_scan_settings(
                list(preset) if isinstance(preset, list) else [],
                list(custom) if isinstance(custom, list) else [],
                dict(preferred) if isinstance(preferred, dict) else {},
                disabled_skills=disabled_skills_arg,
            )
            from agenticx.hooks.list_api import invalidate_hooks_list_cache
            from agenticx.studio.skills_list_api import invalidate_skills_list_cache

            invalidate_skills_list_cache()
            invalidate_hooks_list_cache()
            return {"ok": True, **skill_scan_settings_payload()}
        except Exception as exc:
            logger.warning("put_skill_settings error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/skills/guard-settings")
    async def get_guard_settings(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.skills.guard_config import guard_settings_payload

            return {"ok": True, **guard_settings_payload()}
        except Exception as exc:
            logger.warning("get_guard_settings error: %s", exc)
            return {"ok": False, "error": str(exc)}

    @app.put("/api/skills/guard-settings")
    async def put_guard_settings(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.skills.guard_config import guard_settings_payload, persist_guard_settings

            version = payload.get("version")
            scan_mode = payload.get("scan_mode")
            llm_verify = payload.get("llm_verify")
            if version is not None:
                version = int(version)
                if version not in (1, 2):
                    raise HTTPException(status_code=400, detail="version must be 1 or 2")
            if scan_mode is not None:
                sm = str(scan_mode).strip().lower()
                if sm not in {"quick", "standard", "full"}:
                    raise HTTPException(status_code=400, detail="invalid scan_mode")
                scan_mode = sm
            if llm_verify is not None and not isinstance(llm_verify, bool):
                raise HTTPException(status_code=400, detail="llm_verify must be boolean")

            # ignored: full overwrite ("ignored") or incremental add/remove.
            from agenticx.skills.guard_config import load_guard_config

            ignored_arg: list[str] | None = None
            raw_ignored = payload.get("ignored")
            if raw_ignored is not None:
                if not isinstance(raw_ignored, list):
                    raise HTTPException(status_code=400, detail="ignored must be a list")
                ignored_arg = [str(x).strip() for x in raw_ignored if str(x).strip()]
            add_ignore = str(payload.get("add_ignore") or "").strip()
            remove_ignore = str(payload.get("remove_ignore") or "").strip()
            if add_ignore or remove_ignore:
                current = list(load_guard_config().ignored_skills)
                if add_ignore and add_ignore not in current:
                    current.append(add_ignore)
                if remove_ignore:
                    current = [x for x in current if x != remove_ignore]
                ignored_arg = current

            persist_guard_settings(
                version=version,
                scan_mode=scan_mode,
                llm_verify=llm_verify,
                ignored=ignored_arg,
            )
            return {"ok": True, **guard_settings_payload()}
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("put_guard_settings error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/skills/guard-scan")
    async def post_guard_scan(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Deep skill security scan by directory path or SKILL.md markdown body."""
        _check_token(x_agx_desktop_token)
        skill_path = str(payload.get("skill_path") or "").strip()
        markdown = payload.get("markdown")
        skill_name = str(payload.get("skill_name") or "").strip()
        mode = str(payload.get("mode") or "standard").strip().lower()
        if mode not in {"quick", "standard", "full"}:
            raise HTTPException(status_code=400, detail="mode must be quick|standard|full")
        verify_llm = bool(payload.get("verify_with_llm", False))
        html_report = bool(payload.get("html_report", False))
        try:
            import tempfile
            from pathlib import Path as _Path

            from agenticx.skills.guard import scan_result_to_payload, scan_skill_deep, scan_skill_markdown_text
            from agenticx.skills.guard_report import render_html_report

            if markdown is not None:
                text = str(markdown)
                if mode == "full":
                    with tempfile.TemporaryDirectory() as td:
                        d = _Path(td) / "skill"
                        d.mkdir()
                        (d / "SKILL.md").write_text(text, encoding="utf-8")
                        result = scan_skill_deep(
                            d, source="community", mode=mode, verify_with_llm=verify_llm,
                        )
                else:
                    result = scan_skill_markdown_text(text, source="community")
            elif skill_path:
                p = _Path(skill_path).expanduser()
                if not p.exists():
                    raise HTTPException(status_code=400, detail="skill_path not found")
                result = scan_skill_deep(p, source="community", mode=mode, verify_with_llm=verify_llm)
            else:
                raise HTTPException(status_code=400, detail="skill_path or markdown required")
            out: dict = {"ok": True, "scan": scan_result_to_payload(result, skill_name or skill_path or "skill")}
            if html_report:
                out["html"] = render_html_report(result, skill_name=skill_name, skill_path=skill_path)
            return out
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("post_guard_scan error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/skills/guard-scan-all")
    async def post_guard_scan_all(
        payload: dict | None = None,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Scan every installed skill directory and return per-skill verdicts.

        Skills listed in ``skills.guard.ignored`` are excluded. ``can_fix`` is
        true only for skills stored under ``~/.agenticx/skills`` (market or
        self-authored), so external sources (Cursor/Claude/etc.) are read-only.
        """
        _check_token(x_agx_desktop_token)
        include_ignored = bool((payload or {}).get("include_ignored", False))
        try:
            from pathlib import Path as _Path

            from agenticx.skills.guard import scan_result_to_payload, scan_skill_deep
            from agenticx.skills.guard_config import load_guard_config
            from agenticx.tools.skill_bundle import SkillBundleLoader

            cfg = load_guard_config()
            ignored = set(cfg.ignored_skills)
            mode = cfg.scan_mode if cfg.version >= 2 else "standard"
            agx_root = _Path("~/.agenticx/skills").expanduser().resolve(strict=False)

            loader = SkillBundleLoader()
            skills = loader.scan()
            results: list[dict] = []
            ignored_seen: list[str] = []
            for s in skills:
                if s.name in ignored:
                    if s.name not in ignored_seen:
                        ignored_seen.append(s.name)
                    if not include_ignored:
                        continue
                base = _Path(str(s.base_dir)).expanduser().resolve(strict=False)
                try:
                    can_fix = base == agx_root or agx_root in base.parents
                except Exception:
                    can_fix = False
                try:
                    sr = scan_skill_deep(base, source=getattr(s, "source", "community"), mode=mode)
                except Exception as scan_exc:  # noqa: BLE001
                    logger.warning("guard-scan-all skill %s failed: %s", s.name, scan_exc)
                    continue
                if sr.verdict == "safe":
                    continue
                one = scan_result_to_payload(sr, s.name)
                one["source"] = getattr(s, "source", "unknown")
                one["base_dir"] = str(s.base_dir)
                one["can_fix"] = can_fix
                one["ignored"] = s.name in ignored
                results.append(one)

            severity_rank = {"dangerous": 2, "caution": 1, "safe": 0}
            results.sort(key=lambda r: severity_rank.get(r.get("verdict", "safe"), 0), reverse=True)
            return {
                "ok": True,
                "results": results,
                "ignored": ignored_seen,
                "scanned": len(skills),
            }
        except Exception as exc:
            logger.warning("post_guard_scan_all error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/skills/snapshot")
    async def post_skill_snapshot(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Create a pre-fix snapshot of a skill directory."""
        _check_token(x_agx_desktop_token)
        base_dir = str((payload or {}).get("base_dir") or "").strip()
        if not base_dir:
            raise HTTPException(status_code=400, detail="base_dir required")
        trigger = str((payload or {}).get("trigger") or "guard_ai_fix")
        skill_name = str((payload or {}).get("skill_name") or "")
        try:
            from pathlib import Path as _Path

            from agenticx.skills.snapshot import create_snapshot

            out = create_snapshot(
                _Path(base_dir),
                trigger=trigger,
                skill_name=skill_name,
            )
            return {"ok": True, **out}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.warning("post_skill_snapshot error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/skills/snapshots")
    async def get_skill_snapshots(
        base_dir: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """List snapshots for a skill directory (newest first)."""
        _check_token(x_agx_desktop_token)
        base = (base_dir or "").strip()
        if not base:
            raise HTTPException(status_code=400, detail="base_dir required")
        try:
            from pathlib import Path as _Path

            from agenticx.skills.snapshot import list_snapshots

            snaps = list_snapshots(_Path(base))
            return {
                "ok": True,
                "snapshots": [
                    {
                        "id": s.id,
                        "ts": s.timestamp,
                        "files_count": s.files_count,
                        "trigger": s.trigger,
                    }
                    for s in snaps
                ],
            }
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.warning("get_skill_snapshots error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/skills/snapshot/restore")
    async def post_skill_snapshot_restore(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Restore skill files from a snapshot (incremental overwrite)."""
        _check_token(x_agx_desktop_token)
        base_dir = str((payload or {}).get("base_dir") or "").strip()
        snapshot_id = str((payload or {}).get("snapshot_id") or "").strip()
        if not base_dir or not snapshot_id:
            raise HTTPException(status_code=400, detail="base_dir and snapshot_id required")
        try:
            from pathlib import Path as _Path

            from agenticx.skills.snapshot import restore_snapshot

            restored = restore_snapshot(_Path(base_dir), snapshot_id)
            return {"ok": True, "restored_files": restored}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.warning("post_skill_snapshot_restore error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # -- Usage dashboard ---------------------------------------------------------

    def _usage_parse_range_ms(
        range_key: str,
        from_s: str | None,
        to_s: str | None,
    ) -> tuple[int, int]:
        now_ms = int(time.time() * 1000)
        rk = (range_key or "month").strip().lower()
        if rk == "day":
            return now_ms - 86400000, now_ms
        if rk == "week":
            return now_ms - 7 * 86400000, now_ms
        if rk == "month":
            return now_ms - 30 * 86400000, now_ms
        if rk == "total":
            return 0, now_ms
        if rk == "custom":
            fs = (from_s or "").strip()
            ts = (to_s or "").strip()
            if not fs or not ts:
                raise HTTPException(
                    status_code=400,
                    detail="custom range requires from and to (YYYY-MM-DD)",
                )
            try:
                d0 = datetime.strptime(fs, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                d1 = datetime.strptime(ts, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail="invalid date format, use YYYY-MM-DD",
                ) from exc
            start_ms = int(d0.timestamp() * 1000)
            end_ms = int(d1.timestamp() * 1000) + 86400000 - 1
            if start_ms > end_ms:
                raise HTTPException(status_code=400, detail="from must be <= to")
            if end_ms - start_ms > 366 * 86400000:
                raise HTTPException(status_code=400, detail="range too large (max 366 days)")
            return start_ms, end_ms
        raise HTTPException(status_code=400, detail="invalid range")

    def _usage_run_in_pool(func, /, *args: Any, **kwargs: Any):
        from agenticx.studio.blocking_io import run_in_settings_pool

        return run_in_settings_pool(func, *args, **kwargs)

    @app.get("/api/usage/dashboard")
    async def usage_dashboard(
        range_key: str = Query("month", alias="range"),
        from_date: str | None = Query(None, alias="from"),
        to_date: str | None = Query(None, alias="to"),
        limit: int = Query(3, ge=1, le=20),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_token(x_agx_desktop_token)
        from agenticx.runtime.usage_store import get_usage_store

        start_ms, end_ms = _usage_parse_range_ms(range_key, from_date, to_date)
        now_ms = int(time.time() * 1000)
        now = datetime.now(timezone.utc)
        month_start_ms = int(datetime(now.year, now.month, 1, tzinfo=timezone.utc).timestamp() * 1000)

        def _collect() -> dict[str, Any]:
            return get_usage_store().dashboard_sync(
                range_start_ms=start_ms,
                range_end_ms=end_ms,
                week_start_ms=now_ms - 7 * 86400000,
                week_end_ms=now_ms,
                month_start_ms=now_ms - 30 * 86400000,
                month_end_ms=now_ms,
                calendar_month_start_ms=month_start_ms,
                now_ms=now_ms,
                top_limit=limit,
            )

        return await _usage_run_in_pool(_collect)

    @app.get("/api/usage/summary")
    async def usage_summary(
        range_key: str = Query("month", alias="range"),
        from_date: str | None = Query(None, alias="from"),
        to_date: str | None = Query(None, alias="to"),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_token(x_agx_desktop_token)
        from agenticx.runtime.usage_store import get_usage_store

        start_ms, end_ms = _usage_parse_range_ms(range_key, from_date, to_date)
        return await _usage_run_in_pool(get_usage_store().summary_sync, start_ms, end_ms)

    @app.get("/api/usage/breakdown")
    async def usage_breakdown(
        range_key: str = Query("month", alias="range"),
        from_date: str | None = Query(None, alias="from"),
        to_date: str | None = Query(None, alias="to"),
        dimension: str = Query("provider"),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_token(x_agx_desktop_token)
        from agenticx.runtime.usage_store import get_usage_store

        start_ms, end_ms = _usage_parse_range_ms(range_key, from_date, to_date)
        dim = (dimension or "provider").strip().lower()
        if dim not in {"provider", "model"}:
            raise HTTPException(status_code=400, detail="dimension must be provider or model")
        rows = await _usage_run_in_pool(
            get_usage_store().breakdown_sync, start_ms, end_ms, dimension=dim
        )
        return {"dimension": dim, "items": rows}

    @app.get("/api/usage/daily")
    async def usage_daily(
        range_key: str = Query("month", alias="range"),
        from_date: str | None = Query(None, alias="from"),
        to_date: str | None = Query(None, alias="to"),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_token(x_agx_desktop_token)
        from agenticx.runtime.usage_store import get_usage_store

        start_ms, end_ms = _usage_parse_range_ms(range_key, from_date, to_date)
        rows = await _usage_run_in_pool(get_usage_store().daily_sync, start_ms, end_ms)
        return {"items": rows}

    @app.get("/api/usage/heatmap")
    async def usage_heatmap(
        range_key: str = Query("month", alias="range"),
        from_date: str | None = Query(None, alias="from"),
        to_date: str | None = Query(None, alias="to"),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_token(x_agx_desktop_token)
        from agenticx.runtime.usage_store import get_usage_store

        start_ms, end_ms = _usage_parse_range_ms(range_key, from_date, to_date)
        rows = await _usage_run_in_pool(get_usage_store().heatmap_sync, start_ms, end_ms)
        return {"items": rows}

    @app.get("/api/usage/top-models")
    async def usage_top_models(
        range_key: str = Query("month", alias="range"),
        from_date: str | None = Query(None, alias="from"),
        to_date: str | None = Query(None, alias="to"),
        limit: int = Query(3, ge=1, le=20),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_token(x_agx_desktop_token)
        from agenticx.runtime.usage_store import get_usage_store

        start_ms, end_ms = _usage_parse_range_ms(range_key, from_date, to_date)
        rows = await _usage_run_in_pool(
            get_usage_store().top_models_sync, start_ms, end_ms, limit=limit
        )
        return {"items": rows}

    @app.get("/api/usage/meta")
    async def usage_meta(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_token(x_agx_desktop_token)
        from agenticx.runtime.usage_store import get_usage_store

        store = get_usage_store()
        now_ms = int(time.time() * 1000)
        now = datetime.now(timezone.utc)
        month_start_ms = int(datetime(now.year, now.month, 1, tzinfo=timezone.utc).timestamp() * 1000)

        def _collect_meta() -> dict[str, Any]:
            return {
                "started_at": store.started_at_sync(),
                "active_days_30d": store.active_days_sync(now_ms - 30 * 86400000, now_ms),
                "month_conversations": store.month_conversations_sync(month_start_ms, now_ms),
            }

        return await _usage_run_in_pool(_collect_meta)

    # -- Health Probe & Recovery ------------------------------------------------

    _health_probe: Optional[Any] = None

    @app.get("/api/health/providers")
    async def health_providers(
        x_agx_desktop_token: str | None = Header(default=None),
    ):
        nonlocal _health_probe
        _verify_desktop_token(x_agx_desktop_token)
        if _health_probe is None:
            from agenticx.runtime.health_probe import HealthProbeManager
            _health_probe = HealthProbeManager()
        return {"providers": _health_probe.statuses}

    @app.get("/api/sessions/interrupted")
    async def list_interrupted_sessions(
        x_agx_desktop_token: str | None = Header(default=None),
    ):
        _verify_desktop_token(x_agx_desktop_token)
        interrupted = getattr(app.state, "interrupted_sessions", []) or []
        return {"sessions": interrupted, "count": len(interrupted)}

    # -- Skills ----------------------------------------------------------------

    @app.get("/api/skills")
    async def list_skills(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """List all available skills with metadata."""
        _check_token(x_agx_desktop_token)
        from agenticx.studio.blocking_io import run_in_settings_pool
        from agenticx.studio.skills_list_api import build_skills_list_payload_sync

        payload = await run_in_settings_pool(build_skills_list_payload_sync)
        if not payload.get("ok"):
            logger.warning("list_skills error: %s", payload.get("error"))
        return payload

    @app.get("/api/skills/proposals")
    async def list_skill_proposals(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        from agenticx.skills.pending_queue import list_pending

        return {"ok": True, "proposals": list_pending()}

    @app.post("/api/skills/proposals/{pid}/approve")
    async def approve_skill_proposal(
        pid: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        from agenticx.skills.pending_queue import approve

        return approve(pid, approver="desktop-user")

    @app.post("/api/skills/proposals/{pid}/reject")
    async def reject_skill_proposal(
        pid: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        from agenticx.skills.pending_queue import reject

        return reject(pid, reason="rejected from desktop")

    @app.get("/api/skills/{name}")
    async def get_skill_detail(
        name: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Get full SKILL.md content for a skill."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.tools.skill_bundle import SkillBundleLoader

            loader = SkillBundleLoader()
            loader.scan()
            content = loader.get_skill_content(name)
            if content is None:
                raise HTTPException(status_code=404, detail=f"Skill '{name}' not found")
            meta = loader.get_skill(name)
            return {
                "ok": True,
                "name": name,
                "description": meta.description if meta else "",
                "location": meta.location if meta else "",
                "source": meta.source if meta else "",
                "content": content,
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("get_skill_detail error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/skills/refresh")
    async def refresh_skills(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Force rescan skill directories."""
        _check_token(x_agx_desktop_token)

        def _refresh_sync() -> dict:
            from agenticx.studio.skills_list_api import invalidate_skills_list_cache
            from agenticx.tools.skill_bundle import SkillBundleLoader

            invalidate_skills_list_cache()
            loader = SkillBundleLoader()
            skills = loader.refresh()
            return {"ok": True, "count": len(skills)}

        from agenticx.studio.blocking_io import run_in_settings_pool

        try:
            return await run_in_settings_pool(_refresh_sync)
        except Exception as exc:
            logger.warning("refresh_skills error: %s", exc)
            return {"ok": False, "count": 0, "error": str(exc)}

    # --- Permissions API ---

    @app.get("/api/permissions")
    async def get_permissions(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Return permission settings from config.yaml."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cli.config_manager import ConfigManager

            mode = ConfigManager.get_value("permissions.mode") or "default"
            path_rules = ConfigManager.get_value("permissions.path_rules") or []
            denied_commands = ConfigManager.get_value("permissions.denied_commands") or []
            denied_tools = ConfigManager.get_value("permissions.denied_tools") or []
            allowed_tools = ConfigManager.get_value("permissions.allowed_tools") or []
            return {
                "ok": True,
                "mode": mode,
                "path_rules": path_rules if isinstance(path_rules, list) else [],
                "denied_commands": denied_commands if isinstance(denied_commands, list) else [],
                "denied_tools": denied_tools if isinstance(denied_tools, list) else [],
                "allowed_tools": allowed_tools if isinstance(allowed_tools, list) else [],
            }
        except Exception as exc:
            logger.warning("get_permissions error: %s", exc)
            return {"ok": False, "mode": "default", "path_rules": [], "denied_commands": [], "error": str(exc)}

    @app.put("/api/permissions")
    async def put_permissions(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Persist permission settings."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cli.config_manager import ConfigManager

            for key in ("mode", "path_rules", "denied_commands", "denied_tools", "allowed_tools"):
                if key in payload:
                    ConfigManager.set_value(f"permissions.{key}", payload[key])

            mode = ConfigManager.get_value("permissions.mode") or "default"
            path_rules = ConfigManager.get_value("permissions.path_rules") or []
            denied_commands = ConfigManager.get_value("permissions.denied_commands") or []
            denied_tools = ConfigManager.get_value("permissions.denied_tools") or []
            allowed_tools = ConfigManager.get_value("permissions.allowed_tools") or []
            return {
                "ok": True,
                "mode": mode,
                "path_rules": path_rules if isinstance(path_rules, list) else [],
                "denied_commands": denied_commands if isinstance(denied_commands, list) else [],
                "denied_tools": denied_tools if isinstance(denied_tools, list) else [],
                "allowed_tools": allowed_tools if isinstance(allowed_tools, list) else [],
            }
        except Exception as exc:
            logger.warning("put_permissions error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # --- Provider config (Desktop remote-mode source of truth) ---

    @app.get("/api/config/providers")
    async def get_config_providers(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Return provider configuration (providers map + default/active selections).

        Mirrors the shape that Desktop's local ``load-config`` IPC returns for the
        provider-related fields, so the renderer can transparently swap between
        local YAML reads and remote API reads in remote mode.
        """
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cli.config_manager import ConfigManager

            providers_raw = ConfigManager.get_value("providers") or {}
            providers: dict[str, Any] = {}
            if isinstance(providers_raw, dict):
                for name, entry in providers_raw.items():
                    if not isinstance(entry, dict):
                        continue
                    providers[str(name)] = dict(entry)
            return {
                "ok": True,
                "defaultProvider": str(ConfigManager.get_value("default_provider") or ""),
                "providers": providers,
                "activeProvider": str(ConfigManager.get_value("active_provider") or ""),
                "activeModel": str(ConfigManager.get_value("active_model") or ""),
            }
        except Exception as exc:
            logger.warning("get_config_providers error: %s", exc)
            return {"ok": False, "providers": {}, "error": str(exc)}

    @app.put("/api/config/providers/{name}")
    async def put_config_provider(
        name: str,
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Upsert a single provider entry by name.

        Body fields are optional; missing fields preserve the previous value
        (parity with Desktop's local ``save-provider`` IPC semantics).
        """
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cli.config_manager import ConfigManager

            cleaned = str(name or "").strip()
            if not cleaned:
                raise HTTPException(status_code=400, detail="provider name required")
            existing = ConfigManager.get_value(f"providers.{cleaned}") or {}
            if not isinstance(existing, dict):
                existing = {}
            entry: dict[str, Any] = dict(existing)
            for src_key, dst_key in (
                ("apiKey", "api_key"),
                ("baseUrl", "base_url"),
                ("model", "model"),
                ("models", "models"),
            ):
                if src_key in payload and payload[src_key] is not None:
                    entry[dst_key] = payload[src_key]
            if "enabled" in payload and isinstance(payload["enabled"], bool):
                entry["enabled"] = payload["enabled"]
            elif not isinstance(entry.get("enabled"), bool):
                entry["enabled"] = True
            if payload.get("dropParams") is True:
                entry["drop_params"] = True
            elif payload.get("dropParams") is False and "drop_params" in entry:
                del entry["drop_params"]
            if "displayName" in payload:
                disp = str(payload.get("displayName") or "").strip()
                if disp:
                    entry["display_name"] = disp
                elif "display_name" in entry:
                    del entry["display_name"]
            if "interface" in payload:
                if payload["interface"] == "openai":
                    entry["interface"] = "openai"
                elif "interface" in entry:
                    del entry["interface"]
            ConfigManager.set_value(f"providers.{cleaned}", entry)
            return {"ok": True}
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("put_config_provider error name=%s: %s", name, exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.delete("/api/config/providers/{name}")
    async def delete_config_provider(
        name: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Remove a provider entry; promotes the first remaining as default if needed."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cli.config_manager import ConfigManager

            cleaned = str(name or "").strip()
            if not cleaned:
                raise HTTPException(status_code=400, detail="provider name required")
            providers_raw = ConfigManager.get_value("providers") or {}
            if not isinstance(providers_raw, dict):
                providers_raw = {}
            providers = {str(k): v for k, v in providers_raw.items() if str(k) != cleaned}
            ConfigManager.set_value("providers", providers)
            current_default = str(ConfigManager.get_value("default_provider") or "")
            if current_default == cleaned:
                fallback = next(iter(providers.keys())) if providers else ""
                ConfigManager.set_value("default_provider", fallback)
            return {"ok": True}
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("delete_config_provider error name=%s: %s", name, exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.put("/api/config/default-provider")
    async def put_config_default_provider(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cli.config_manager import ConfigManager

            ConfigManager.set_value("default_provider", str(payload.get("name") or "").strip())
            return {"ok": True}
        except Exception as exc:
            logger.warning("put_config_default_provider error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.put("/api/config/active-model")
    async def put_config_active_model(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cli.config_manager import ConfigManager

            if "provider" in payload:
                ConfigManager.set_value("active_provider", str(payload.get("provider") or "").strip())
            if "model" in payload:
                ConfigManager.set_value("active_model", str(payload.get("model") or "").strip())
            return {"ok": True}
        except Exception as exc:
            logger.warning("put_config_active_model error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # --- CC Bridge (local Claude Code HTTP) config ---

    @app.get("/api/cc-bridge/config")
    async def get_cc_bridge_config(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Return bridge URL and token (Desktop-only; requires desktop token)."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cc_bridge.settings import (
                cc_bridge_base_url,
                cc_bridge_mode_configured,
                cc_bridge_mode_env_override,
                cc_bridge_mode,
                ensure_cc_bridge_token_persisted,
            )

            url = cc_bridge_base_url()
            token = ensure_cc_bridge_token_persisted()
            mode_effective = cc_bridge_mode()
            mode_configured = cc_bridge_mode_configured()
            env_override = cc_bridge_mode_env_override()
            mode = mode_configured or mode_effective
            raw_idle = ConfigManager.get_value("cc_bridge.idle_stop_seconds")
            try:
                idle = int(raw_idle) if raw_idle is not None else 600
            except (TypeError, ValueError):
                idle = 600
            idle = max(0, min(86400, idle))
            return {
                "ok": True,
                "url": url,
                "token": token,
                "idle_stop_seconds": idle,
                "mode": mode,
                "mode_effective": mode_effective,
                "mode_env_override": env_override or "",
            }
        except Exception as exc:
            logger.warning("get_cc_bridge_config error: %s", exc)
            return {
                "ok": False,
                "url": "http://127.0.0.1:9742",
                "token": "",
                "idle_stop_seconds": 600,
                "mode": "headless",
                "error": str(exc),
            }

    @app.put("/api/cc-bridge/config")
    async def put_cc_bridge_config(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cc_bridge.settings import (
                cc_bridge_base_url,
                cc_bridge_mode_configured,
                cc_bridge_mode_env_override,
                cc_bridge_mode,
                ensure_cc_bridge_token_persisted,
                validate_bridge_url_for_studio,
            )

            if "url" in payload:
                u = str(payload.get("url") or "").strip().rstrip("/")
                if u:
                    err = validate_bridge_url_for_studio(u)
                    if err:
                        raise HTTPException(status_code=400, detail=err)
                    ConfigManager.set_cc_bridge_field("url", u)
            if "token" in payload:
                t = str(payload.get("token") or "").strip()
                ConfigManager.set_cc_bridge_field("token", t)
            if "idle_stop_seconds" in payload:
                try:
                    idle = int(payload.get("idle_stop_seconds"))
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail="idle_stop_seconds must be integer") from None
                idle = max(0, min(86400, idle))
                ConfigManager.set_cc_bridge_field("idle_stop_seconds", idle)
            if "mode" in payload:
                m = str(payload.get("mode") or "").strip().lower()
                if m not in {"headless", "visible_tui"}:
                    raise HTTPException(status_code=400, detail="mode must be headless or visible_tui") from None
                ConfigManager.set_cc_bridge_field("mode", m)

            raw_idle = ConfigManager.get_value("cc_bridge.idle_stop_seconds")
            try:
                idle_now = int(raw_idle) if raw_idle is not None else 600
            except (TypeError, ValueError):
                idle_now = 600
            idle_now = max(0, min(86400, idle_now))
            return {
                "ok": True,
                "url": cc_bridge_base_url(),
                "token": ensure_cc_bridge_token_persisted(),
                "idle_stop_seconds": idle_now,
                "mode": cc_bridge_mode_configured() or cc_bridge_mode(),
                "mode_effective": cc_bridge_mode(),
                "mode_env_override": cc_bridge_mode_env_override() or "",
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("put_cc_bridge_config error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/cc-bridge/token/regenerate")
    async def regenerate_cc_bridge_token(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        _check_token(x_agx_desktop_token)
        import secrets

        try:
            tok = secrets.token_urlsafe(32)
            ConfigManager.set_cc_bridge_field("token", tok)
            return {"ok": True, "token": tok}
        except Exception as exc:
            logger.warning("regenerate_cc_bridge_token error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # --- Hooks API ---

    @app.get("/api/hooks")
    async def list_hooks(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Return curated + deduplicated imported hooks."""
        _check_token(x_agx_desktop_token)
        from agenticx.hooks.list_api import build_hooks_list_payload
        from agenticx.studio.blocking_io import run_in_settings_pool

        payload = await run_in_settings_pool(build_hooks_list_payload)
        if not payload.get("ok"):
            logger.warning("list_hooks error: %s", payload.get("error"))
        return payload

    @app.get("/api/hooks/settings")
    async def get_hook_settings(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Return hook scan settings (preset toggles + custom paths)."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.hooks.loader import get_hook_settings_from_config

            body = get_hook_settings_from_config()
            return {"ok": True, **body}
        except Exception as exc:
            logger.warning("get_hook_settings error: %s", exc)
            return {"ok": False, "preset_paths": {}, "custom_paths": [], "error": str(exc)}

    @app.put("/api/hooks/settings")
    async def put_hook_settings(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Persist hook scan settings and return updated state."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.cli.config_manager import ConfigManager

            if "preset_paths" in payload:
                ConfigManager.set_value("hooks.preset_paths", payload["preset_paths"])
            if "custom_paths" in payload:
                ConfigManager.set_value("hooks.custom_paths", payload["custom_paths"])
            if "declarative" in payload:
                ConfigManager.set_value("hooks.declarative", payload["declarative"])
            if "disabled" in payload:
                ConfigManager.set_value("hooks.disabled", payload["disabled"])

            from agenticx.hooks.loader import get_hook_settings_from_config

            body = get_hook_settings_from_config()
            return {"ok": True, **body}
        except Exception as exc:
            logger.warning("put_hook_settings error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # --- Bundles API ---

    @app.get("/api/bundles")
    async def list_bundles(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """List all installed AGX Bundles."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.extensions.installer import list_installed_bundles

            bundles = list_installed_bundles()
            return {"ok": True, "items": [b.to_dict() for b in bundles], "count": len(bundles)}
        except Exception as exc:
            logger.warning("list_bundles error: %s", exc)
            return {"ok": False, "items": [], "count": 0, "error": str(exc)}

    @app.post("/api/bundles/install-preview")
    async def install_bundle_preview(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Scan bundle skills before install (no filesystem writes to bundle targets)."""
        _check_token(x_agx_desktop_token)
        source_path = str(payload.get("source_path", "")).strip()
        if not source_path:
            raise HTTPException(status_code=400, detail="source_path is required")
        try:
            from agenticx.extensions.installer import scan_bundle_source

            raw = scan_bundle_source(Path(source_path))
            if not raw.get("ok"):
                return {"ok": False, "error": str(raw.get("error", "scan failed"))}
            return {
                "ok": True,
                "scan": {
                    "overall": raw.get("overall"),
                    "skills": raw.get("skills", []),
                    "bundle_name": raw.get("bundle_name"),
                },
            }
        except Exception as exc:
            logger.warning("install_bundle_preview error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/bundles/install")
    async def install_bundle_endpoint(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Install an AGX Bundle from a local directory path."""
        _check_token(x_agx_desktop_token)
        source_path = str(payload.get("source_path", "")).strip()
        if not source_path:
            raise HTTPException(status_code=400, detail="source_path is required")
        try:
            from agenticx.extensions.installer import install_bundle

            auto_non_high = _load_non_high_risk_auto_install()
            acknowledge_high_risk = bool(payload.get("acknowledge_high_risk"))
            confirm_non_high_risk = bool(payload.get("confirm_non_high_risk"))
            result = install_bundle(
                Path(source_path),
                acknowledge_high_risk=acknowledge_high_risk,
                confirm_non_high_risk=confirm_non_high_risk,
                auto_non_high=auto_non_high,
            )
            if result.success:
                from agenticx.studio.skills_list_api import invalidate_skills_list_cache

                invalidate_skills_list_cache()
                return {
                    "ok": True,
                    "name": result.name,
                    "version": result.version,
                    "skills_installed": result.skills_installed,
                    "mcp_servers_installed": result.mcp_servers_installed,
                    "avatars_installed": result.avatars_installed,
                    "memory_templates_installed": result.memory_templates_installed,
                }
            body: dict[str, Any] = {"ok": False, "error": result.error}
            if result.error_code:
                body["error_code"] = result.error_code
            if result.scan_summary:
                body["scan_summary"] = result.scan_summary
            return body
        except Exception as exc:
            logger.warning("install_bundle error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.delete("/api/bundles/{name}")
    async def uninstall_bundle_endpoint(
        name: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Uninstall an AGX Bundle by name."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.extensions.installer import uninstall_bundle

            ok = uninstall_bundle(name)
            if not ok:
                raise HTTPException(status_code=404, detail=f"Bundle '{name}' is not installed")
            return {"ok": True, "name": name}
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("uninstall_bundle error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # --- Registry / Marketplace API ---

    # Short-lived in-memory cache: maps "source:name" -> (content, expiry_ts).
    # preview fetches SKILL.md and stores it here; install reuses it to avoid
    # a second round of ClawHub HTTP requests (which can trigger rate limits).
    _registry_preview_cache: dict[str, tuple[str, float]] = {}
    _REGISTRY_CACHE_TTL = 120.0  # seconds

    @app.get("/api/registry/search")
    async def registry_search(
        q: str = "",
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Search across all configured extension registries."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.extensions.registry_hub import RegistryHub

            hub = RegistryHub.from_config()
            results = hub.search(q)
            q_trim = (q or "").strip()
            hint = ""
            if not results:
                if q_trim:
                    hint = f"未找到与「{q_trim}」相关的技能"
                elif hub.using_default_clawhub:
                    hint = "未找到技能；可在 ~/.agenticx/config.yaml 的 extensions.registries 中添加更多注册源。"
            return {
                "ok": True,
                "items": [r.to_dict() for r in results],
                "count": len(results),
                "using_default_clawhub": hub.using_default_clawhub,
                "hint": hint,
            }
        except Exception as exc:
            logger.warning("registry_search error: %s", exc)
            return {"ok": False, "items": [], "count": 0, "error": str(exc)}

    @app.get("/api/registry/skillhub/search")
    async def registry_skillhub_search(
        q: str = "",
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Search Tencent SkillHub market (CLI or ClawHub mirror fallback)."""
        _check_token(x_agx_desktop_token)
        try:
            from agenticx.extensions.skillhub_adapter import search_skillhub_market

            return search_skillhub_market(q)
        except Exception as exc:
            logger.warning("registry_skillhub_search error: %s", exc)
            return {"ok": False, "items": [], "count": 0, "error": str(exc)}

    @app.post("/api/registry/install-preview")
    async def registry_install_preview(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Fetch registry skill content and return security scan (no install).

        The downloaded SKILL.md is cached briefly so the subsequent install
        request can reuse it without a second round of ClawHub HTTP calls.
        """
        _check_token(x_agx_desktop_token)
        source_name = str(payload.get("source", "")).strip()
        skill_name = str(payload.get("name", "")).strip()
        if not source_name or not skill_name:
            raise HTTPException(status_code=400, detail="source and name are required")
        try:
            import time as _time
            from agenticx.extensions.registry_hub import RegistryHub
            from agenticx.skills.guard import scan_result_to_payload, scan_skill_markdown_text

            hub = RegistryHub.from_config()
            content, err = hub.fetch_skill_markdown(source_name, skill_name)
            if err or content is None:
                return {"ok": False, "error": err or "fetch failed"}

            cache_key = f"{source_name}:{skill_name}"
            _registry_preview_cache[cache_key] = (content, _time.monotonic() + _REGISTRY_CACHE_TTL)

            sr = scan_skill_markdown_text(content)
            one = scan_result_to_payload(sr, skill_name)
            return {
                "ok": True,
                "scan": {"overall": one["verdict"], "skills": [one]},
            }
        except Exception as exc:
            logger.warning("registry_install_preview error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/registry/install")
    async def registry_install(
        payload: dict,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        """Install a skill from a specific configured registry source.

        Reuses the SKILL.md content cached by install-preview when available,
        avoiding a redundant second fetch to the remote registry.
        """
        _check_token(x_agx_desktop_token)
        source_name = str(payload.get("source", "")).strip()
        skill_name = str(payload.get("name", "")).strip()
        if not source_name or not skill_name:
            raise HTTPException(status_code=400, detail="source and name are required")
        try:
            import time as _time
            from agenticx.extensions.registry_hub import RegistryHub
            from agenticx.skills.guard import scan_result_to_payload, scan_skill_markdown_text

            hub = RegistryHub.from_config()

            cache_key = f"{source_name}:{skill_name}"
            cached = _registry_preview_cache.get(cache_key)
            if cached and _time.monotonic() < cached[1]:
                content = cached[0]
                err = ""
            else:
                content, err = hub.fetch_skill_markdown(source_name, skill_name)

            if err or content is None:
                return {"ok": False, "error": err or "fetch failed"}

            sr = scan_skill_markdown_text(content)
            summary = {
                "overall": sr.verdict,
                "skills": [scan_result_to_payload(sr, skill_name)],
            }
            auto_non_high = _load_non_high_risk_auto_install()
            acknowledge_high_risk = bool(payload.get("acknowledge_high_risk"))
            confirm_non_high_risk = bool(payload.get("confirm_non_high_risk"))

            if sr.verdict == "dangerous" and not acknowledge_high_risk:
                return {
                    "ok": False,
                    "error": "high_risk_confirm_required",
                    "error_code": "high_risk_confirm_required",
                    "scan_summary": summary,
                }
            if sr.verdict in ("safe", "caution") and not auto_non_high and not confirm_non_high_risk:
                return {
                    "ok": False,
                    "error": "non_high_risk_confirm_required",
                    "error_code": "non_high_risk_confirm_required",
                    "scan_summary": summary,
                }

            md_path = hub.write_registry_skill(skill_name, content)
            from agenticx.studio.skills_list_api import invalidate_skills_list_cache

            invalidate_skills_list_cache()
            return {
                "ok": True,
                "name": skill_name,
                "installed_path": str(md_path),
                "scan_summary": summary,
            }
        except Exception as exc:
            logger.warning("registry_install error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Machi knowledge base — Stage-1 MVP (Plan-Id: machi-kb-stage1-local-mvp)
    register_kb_routes(app)
    register_brain_routes(app)
    register_code_index_routes(app)
    from agenticx.studio.web_search.routes import register_web_search_routes

    register_web_search_routes(app)

    from agenticx.studio.delivery_api import register_delivery_routes

    register_delivery_routes(app, _check_token)

    return app
