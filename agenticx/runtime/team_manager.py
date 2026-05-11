#!/usr/bin/env python3
"""Agent Team manager for sub-agent lifecycle and scheduling.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field, replace
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence

from agenticx.cli.agent_tools import STUDIO_TOOLS, merge_computer_use_tools_into
from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.runtime import AgentRuntime, AutoApproveConfirmGate, AsyncConfirmGate, EventType, RuntimeEvent
from agenticx.runtime.resource_monitor import ResourceMonitor
from agenticx.runtime.agent_runtime import STOP_MESSAGE

_log = logging.getLogger(__name__)

EventEmitter = Callable[[RuntimeEvent], Awaitable[None]]
SummarySink = Callable[[str, "SubAgentContext"], Awaitable[None]]


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
    return max(10, min(120, value))


def _resolve_subagent_min_run_timeout_seconds() -> int:
    """Minimum wall-clock timeout for a sub-agent run (seconds).

    Meta-agents often pass 300s for ``run_timeout_seconds``, which is too low for
    multi-round tool use plus confirm gates. Set ``AGX_SUBAGENT_MIN_RUN_TIMEOUT_SECONDS=0``
    to disable clamping.
    """
    raw = str(os.getenv("AGX_SUBAGENT_MIN_RUN_TIMEOUT_SECONDS", "")).strip()
    if raw == "0":
        return 0
    if raw:
        try:
            parsed = int(raw)
            if parsed >= 60:
                return min(parsed, 86400)
        except ValueError:
            pass
    return 600


class SubAgentStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class SpawnConfig:
    max_spawn_depth: int = 2
    max_children_per_agent: int = 5
    max_concurrent: int = 8
    run_timeout_seconds: int = 600
    cleanup: str = "keep"  # keep | delete
    mode: str = "run"  # run | session


def _resolve_max_escalation() -> int:
    """Max failure-escalation attempts before final circuit-break."""
    raw = os.environ.get("AGX_SUBAGENT_MAX_ESCALATION", "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    return 3


@dataclass
class SubAgentContext:
    agent_id: str
    name: str
    role: str
    task: str
    source_tool_call_id: str = ""
    status: SubAgentStatus = SubAgentStatus.PENDING
    agent_messages: List[Dict[str, Any]] = field(default_factory=list)
    artifacts: Dict[Path, str] = field(default_factory=dict)
    context_files: Dict[str, str] = field(default_factory=dict)
    confirm_gate: AsyncConfirmGate = field(default_factory=AsyncConfirmGate)
    result_summary: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    final_text: str = ""
    error_text: str = ""
    recent_events: List[Dict[str, Any]] = field(default_factory=list)
    parent_agent_id: str = "meta"
    depth: int = 1
    mode: str = "run"
    cleanup: str = "keep"
    run_timeout_seconds: int = 600
    attachments: Dict[str, str] = field(default_factory=dict)
    allowed_tool_names: List[str] = field(default_factory=list)
    spawn_tree_path: str = ""
    provider_name: str = ""
    model_name: str = ""
    output_files: List[str] = field(default_factory=list)
    workspace_dir: str = ""
    persona_prompt: str = ""
    avatar_id: str = ""
    failure_count: int = 0
    escalation_level: int = 0


class AgentTeamManager:
    """Manage a pool of sub-agents with isolated context and bounded concurrency."""
    _registry: Dict[str, "AgentTeamManager"] = {}

    def __init__(
        self,
        *,
        llm_factory: Callable[[], Any],
        base_session: StudioSession,
        owner_session_id: Optional[str] = None,
        event_emitter: Optional[EventEmitter] = None,
        summary_sink: Optional[SummarySink] = None,
        max_concurrent_subagents: int = 4,
        resource_monitor: Optional[ResourceMonitor] = None,
        spawn_config: Optional[SpawnConfig] = None,
    ) -> None:
        self._manager_id = uuid.uuid4().hex
        AgentTeamManager._registry[self._manager_id] = self
        self.owner_session_id = (owner_session_id or "").strip() or None
        self.llm_factory = llm_factory
        self.base_session = base_session
        self.event_emitter = event_emitter
        self.summary_sink = summary_sink
        self.max_concurrent_subagents = max_concurrent_subagents
        self.resource_monitor = resource_monitor or ResourceMonitor()
        self.spawn_config = spawn_config or SpawnConfig(max_concurrent=max_concurrent_subagents)

        self._lock = asyncio.Lock()
        self._agents: Dict[str, SubAgentContext] = {}
        self._tasks: Dict[str, asyncio.Task[None]] = {}
        self._cancelled: set[str] = set()
        self._agent_sessions: Dict[str, StudioSession] = {}
        self._archived_agents: Dict[str, SubAgentContext] = {}
        self._archive_limit = 200

    @classmethod
    def collect_global_statuses(
        cls,
        session_id: Optional[str] = None,
        *,
        allow_cross_session_fallback: bool = False,
    ) -> List[Dict[str, Any]]:
        """Collect merged statuses across registered managers.

        When ``session_id`` is set, only managers with matching
        ``owner_session_id`` are merged (strict session isolation for Desktop).

        If ``allow_cross_session_fallback`` is True and the restricted pass
        returns nothing, merges from **all** managers (debug / legacy only;
        breaks multi-pane isolation and must not be default).
        """
        merged: Dict[str, Dict[str, Any]] = {}
        stale_ids: List[str] = []
        sid = (session_id or "").strip() or None

        def _merge_from_managers(*, restrict_sid: Optional[str]) -> None:
            for manager_id, manager in cls._registry.items():
                if manager is None:
                    stale_ids.append(manager_id)
                    continue
                if restrict_sid is not None and manager.owner_session_id != restrict_sid:
                    continue
                payload = manager.get_status_with_task_fallback()
                if not payload.get("ok"):
                    continue
                for item in payload.get("subagents", []) or []:
                    aid = str(item.get("agent_id", "")).strip()
                    if not aid:
                        continue
                    prev = merged.get(aid)
                    if prev is None:
                        merged[aid] = item
                        continue
                    prev_status = str(prev.get("status", ""))
                    curr_status = str(item.get("status", ""))
                    active = {"running", "pending"}
                    if curr_status in active and prev_status not in active:
                        merged[aid] = item
                    elif curr_status in active and prev_status in active:
                        prev_updated = float(prev.get("updated_at", 0) or 0)
                        curr_updated = float(item.get("updated_at", 0) or 0)
                        if curr_updated >= prev_updated:
                            merged[aid] = item

        _merge_from_managers(restrict_sid=sid)
        if not merged and sid is not None and allow_cross_session_fallback:
            _log.warning(
                "[collect_global] cross-session fallback enabled; widening past session %s",
                sid,
            )
            _merge_from_managers(restrict_sid=None)
        for manager_id in stale_ids:
            cls._registry.pop(manager_id, None)
        return list(merged.values())

    @classmethod
    def lookup_global_status(cls, agent_id: str, session_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        aid = (agent_id or "").strip()
        if not aid:
            return None
        sid = (session_id or "").strip() or None
        for manager in cls._registry.values():
            if manager is None:
                continue
            if sid is not None and manager.owner_session_id != sid:
                continue
            payload = manager.get_status(aid)
            if payload.get("ok"):
                return payload.get("subagent")
        if sid is not None:
            for manager in cls._registry.values():
                if manager is None:
                    continue
                if manager.owner_session_id == sid:
                    continue
                payload = manager.get_status(aid)
                if payload.get("ok"):
                    _log.info("[lookup_global] cross-session hit for '%s' in tm=%s", aid, manager._manager_id)
                    return payload.get("subagent")
        return None

    @classmethod
    def find_manager_for_agent(
        cls,
        agent_id: str,
        *,
        include_archived: bool = True,
        session_id: Optional[str] = None,
    ) -> Optional["AgentTeamManager"]:
        aid = (agent_id or "").strip()
        if not aid:
            return None
        sid = (session_id or "").strip() or None
        for manager in cls._registry.values():
            if manager is None:
                continue
            if sid is not None and manager.owner_session_id != sid:
                continue
            if aid in manager._agents:
                return manager
            if include_archived and aid in manager._archived_agents:
                return manager
        return None

    def _unregister(self) -> None:
        AgentTeamManager._registry.pop(self._manager_id, None)

    def _build_isolated_session(self, workspace_dir: Optional[str] = None) -> StudioSession:
        resolved_workspace_dir = (
            str(workspace_dir or "").strip()
            or self.base_session.workspace_dir
        )
        session = StudioSession(
            provider_name=self.base_session.provider_name,
            model_name=self.base_session.model_name,
            workspace_dir=resolved_workspace_dir,
        )
        # MCP clients are shared, while per-agent messages/artifacts remain isolated.
        session.mcp_hub = self.base_session.mcp_hub
        session.mcp_configs = self.base_session.mcp_configs
        session.connected_servers = self.base_session.connected_servers
        session.context_files = dict(self.base_session.context_files)
        try:
            session.todo_manager.load_payload(self.base_session.todo_manager.to_payload())
        except Exception:
            pass
        session.scratchpad = dict(getattr(self.base_session, "scratchpad", {}) or {})
        return session

    def _build_parent_context_summary(self) -> str:
        """Build a truncated summary of the parent session's recent chat history."""
        chat_history = getattr(self.base_session, "chat_history", None) or []
        recent = chat_history[-10:]
        lines: List[str] = []
        for msg in recent:
            role = msg.get("role", "")
            if role not in ("user", "assistant"):
                continue
            content = str(msg.get("content", ""))[:200]
            lines.append(f"- {role}: {content}")
        if not lines:
            return ""
        block = "\n".join(lines)
        while len(block) > 800 and lines:
            lines.pop(0)
            block = "\n".join(lines)
        return block

    def _build_subagent_system_prompt(self, context: SubAgentContext, session: StudioSession) -> str:
        workspace_dir = (
            (session.workspace_dir or "").strip()
            or os.getenv("AGX_WORKSPACE_ROOT", "").strip()
            or os.getcwd()
        )
        context_file_keys = list(context.context_files.keys())
        context_hint = (
            "\n".join(f"- {item}" for item in context_file_keys[:20])
            if context_file_keys
            else "(empty)"
        )
        parent_summary = self._build_parent_context_summary()
        parent_section = (
            f"## 父智能体对话上下文（最近摘要）\n{parent_summary}\n\n"
            if parent_summary
            else ""
        )
        persona_section = (
            f"- persona: {context.persona_prompt}\n"
            if context.persona_prompt
            else ""
        )
        return (
            "你是 AgenticX Studio 的子智能体。\n"
            "你的核心目标：在指定工作目录中完成被委派任务，并持续汇报可验证进展。\n\n"
            "## 你的身份\n"
            f"- agent_id: {context.agent_id}\n"
            f"- name: {context.name}\n"
            f"- role: {context.role}\n"
            f"- delegated_task: {context.task}\n\n"
            f"{persona_section}"
            "## 模型配置\n"
            f"- provider: {context.provider_name or session.provider_name or '(inherit)'}\n"
            f"- model: {context.model_name or session.model_name or '(inherit)'}\n\n"
            "## ⚠️ 轮次预算（严格遵守）\n"
            "你最多只有 30 轮工具调用，必须高效利用每一轮：\n"
            "- 前 1-2 轮：快速确认目标路径是否存在（最多 1 次 list_files）\n"
            "- 第 3 轮起必须开始 write_file 产出代码，不要反复 read/list 做调研\n"
            "- 严禁在探索/分析上消耗超过 3 轮\n"
            "- 写完一个文件立即写下一个，不要规划完所有文件才开始写\n\n"
            "## 工作目录约束\n"
            f"- 工作目录: {workspace_dir}\n"
            "- 所有文件读写必须限定在该目录或其子目录\n"
            "- 禁止扫描 `/Users`、`~`、`/` 等系统路径\n\n"
            "## 已注入上下文文件\n"
            f"{context_hint}\n\n"
            f"{parent_section}"
            "## 执行要求\n"
            "- 优先产出文件，边写边推进，不要等规划完毕才动手。\n"
            "- 在 Desktop 服务模式下，不要要求用户输入 A/B，也不要调用不存在的 `confirm_*` 工具。\n"
            "- 需要确认高风险命令时，直接发起真实工具调用（如 bash_exec）；系统会自动弹出 confirm_required。\n"
            "- 只有在收到工具返回 `OK: wrote ...` / `OK: edited ...` 后，才能宣称已落盘。\n"
            "- 对外汇报文件产出时，引用工具返回的绝对路径。\n"
            "- 不做无关全盘扫描，直接在目标目录下工作。\n\n"
            "## 反模式规则（关键）\n"
            "- 除非任务明确要求产出文档，否则禁止创建说明类、报告类、状态类文件（例如 TODO_FINAL.md、REPORT.md、完成确认.md）。\n"
            "- 禁止用多个相似文件名「确认完成」；完成时以正文总结回复并停止调用工具，不要用新建文件证明完成。\n"
            "- 若收到 todo_write 提醒，只更新现有待办一次，不要为此再写确认文件。\n"
            "- 每次工具调用必须直接推进 delegated_task；禁止为响应系统提醒而堆叠无意义文件。\n"
        )

    async def _emit(self, event: RuntimeEvent) -> None:
        if self.event_emitter is not None:
            await self.event_emitter(event)

    def _build_toolset(self, allowed_names: Optional[Sequence[str]]) -> Sequence[Dict[str, Any]]:
        if allowed_names is None:
            return merge_computer_use_tools_into(list(STUDIO_TOOLS))
        allowed = {name.strip() for name in allowed_names if name and name.strip()}
        if not allowed:
            return merge_computer_use_tools_into(list(STUDIO_TOOLS))
        filtered = [tool for tool in STUDIO_TOOLS if tool.get("function", {}).get("name") in allowed]
        if not filtered:
            _log.warning(
                "tools whitelist %s matched nothing in STUDIO_TOOLS; falling back to full toolset",
                allowed,
            )
            return merge_computer_use_tools_into(list(STUDIO_TOOLS))
        return filtered

    def _get_depth(self, agent_id: str) -> int:
        if agent_id == "meta":
            return 0
        context = self._agents.get(agent_id)
        if context is None:
            return 0
        return context.depth

    def _active_children_count(self, parent_agent_id: str) -> int:
        return sum(
            1
            for item in self._agents.values()
            if item.parent_agent_id == parent_agent_id and item.status == SubAgentStatus.RUNNING
        )

    def _active_running_count(self) -> int:
        return sum(1 for item in self._agents.values() if item.status == SubAgentStatus.RUNNING)

    async def spawn_subagent(
        self,
        *,
        name: str,
        role: str,
        task: str,
        tools: Optional[Sequence[str]] = None,
        source_tool_call_id: str = "",
        parent_agent_id: str = "meta",
        mode: Optional[str] = None,
        cleanup: Optional[str] = None,
        run_timeout_seconds: Optional[int] = None,
        attachments: Optional[Sequence[Dict[str, Any]]] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        workspace_dir: Optional[str] = None,
        system_prompt: Optional[str] = None,
        avatar_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._lock:
            active = self._active_running_count()
            max_concurrent = self.spawn_config.max_concurrent
            if active >= max_concurrent:
                return {
                    "ok": False,
                    "error": "max_concurrency_reached",
                    "message": f"当前并行子智能体已达上限({max_concurrent})",
                }
            parent_depth = self._get_depth(parent_agent_id)
            if parent_depth + 1 > self.spawn_config.max_spawn_depth:
                return {
                    "ok": False,
                    "error": "max_spawn_depth_reached",
                    "message": "已达到子智能体嵌套深度上限",
                }
            parent_children = self._active_children_count(parent_agent_id)
            if parent_children >= self.spawn_config.max_children_per_agent:
                return {
                    "ok": False,
                    "error": "max_children_reached",
                    "message": "当前父智能体的活跃子智能体数达到上限",
                }
            if active > 0:
                spawn_check = self.resource_monitor.can_spawn(active_subagents=active)
                if not spawn_check["allowed"]:
                    return {
                        "ok": False,
                        "error": "resource_limit",
                        "message": "当前资源占用较高，暂不建议继续启动子智能体",
                        "resource": spawn_check,
                    }

            allowed_tools = self._build_toolset(tools)
            agent_id = f"sa-{uuid.uuid4().hex[:8]}"
            resolved_mode = (mode or self.spawn_config.mode).strip().lower()
            if resolved_mode not in {"run", "session"}:
                resolved_mode = "run"
            resolved_cleanup = (cleanup or self.spawn_config.cleanup).strip().lower()
            if resolved_cleanup not in {"keep", "delete"}:
                resolved_cleanup = "keep"
            resolved_timeout = int(run_timeout_seconds or self.spawn_config.run_timeout_seconds or 0)
            timeout_floor = _resolve_subagent_min_run_timeout_seconds()
            if timeout_floor > 0:
                cfg_default = int(self.spawn_config.run_timeout_seconds or 600)
                if resolved_timeout <= 0:
                    resolved_timeout = max(cfg_default, timeout_floor)
                else:
                    resolved_timeout = max(resolved_timeout, timeout_floor)
            attached_payload: Dict[str, str] = {}
            if attachments:
                for item in attachments[:20]:
                    if not isinstance(item, dict):
                        continue
                    name_key = str(item.get("name", "")).strip()
                    content_val = str(item.get("content", ""))
                    if not name_key:
                        continue
                    attached_payload[name_key] = content_val
            parent_ctx = self._agents.get(parent_agent_id)
            parent_path = parent_ctx.spawn_tree_path if parent_ctx and parent_ctx.spawn_tree_path else "meta"
            display_name = (name.strip() or agent_id)
            spawn_tree_path = f"{parent_path}/{display_name}-{agent_id[:6]}"
            context = SubAgentContext(
                agent_id=agent_id,
                name=display_name,
                role=role.strip() or "worker",
                task=task.strip(),
                source_tool_call_id=source_tool_call_id,
                context_files=dict(self.base_session.context_files),
                confirm_gate=AutoApproveConfirmGate(),
                parent_agent_id=parent_agent_id,
                depth=parent_depth + 1,
                mode=resolved_mode,
                cleanup=resolved_cleanup,
                run_timeout_seconds=resolved_timeout,
                attachments=attached_payload,
                allowed_tool_names=[
                    str(item.get("function", {}).get("name", "")).strip()
                    for item in allowed_tools
                    if isinstance(item, dict)
                ],
                spawn_tree_path=spawn_tree_path,
                provider_name=str(provider or "").strip(),
                model_name=str(model or "").strip(),
                workspace_dir=str(workspace_dir or "").strip(),
                persona_prompt=str(system_prompt or "").strip(),
                avatar_id=str(avatar_id or "").strip(),
            )
            self._agents[agent_id] = context
            context.status = SubAgentStatus.RUNNING
            context.updated_at = time.time()
            self._tasks[agent_id] = asyncio.create_task(
                self._run_subagent(context, allowed_tools=allowed_tools)
            )

        started_event = RuntimeEvent(
            type=EventType.SUBAGENT_STARTED.value,
            data={
                "agent_id": context.agent_id,
                "name": context.name,
                "role": context.role,
                "task": context.task,
                "status": context.status.value,
                "depth": context.depth,
                "mode": context.mode,
                "provider": context.provider_name or self.base_session.provider_name or "",
                "model": context.model_name or self.base_session.model_name or "",
            },
            agent_id=context.agent_id,
        )
        _log.info(
            "[spawn_subagent] emitting SUBAGENT_STARTED agent=%s emitter=%s",
            context.agent_id,
            "yes" if self.event_emitter is not None else "NO_EMITTER",
        )
        await self._emit(started_event)
        status_probe = self.get_status(context.agent_id)
        if not status_probe.get("ok"):
            _log.error(
                "[spawn_subagent] status probe failed right after spawn: tm=%s owner_sid=%s agent=%s agents=%s archived=%s tasks=%s",
                id(self),
                self.owner_session_id,
                context.agent_id,
                list(self._agents.keys()),
                list(self._archived_agents.keys()),
                list(self._tasks.keys()),
            )
        return {
            "ok": True,
            "agent_id": context.agent_id,
            "name": context.name,
            "role": context.role,
            "task": context.task,
            "depth": context.depth,
            "mode": context.mode,
            "provider": context.provider_name or self.base_session.provider_name or "",
            "model": context.model_name or self.base_session.model_name or "",
            "workspace_dir": context.workspace_dir or self.base_session.workspace_dir or "",
        }

    async def cancel_subagent(self, agent_id: str) -> Dict[str, Any]:
        context = self._agents.get(agent_id)
        if context is None:
            context = self._find_by_name_or_avatar(agent_id)
            if context is not None:
                agent_id = context.agent_id
        if context is None:
            return {"ok": False, "error": "not_found", "message": f"未找到子智能体: {agent_id}"}
        self._cancelled.add(agent_id)
        context.status = SubAgentStatus.CANCELLED
        context.updated_at = time.time()
        task = self._tasks.get(agent_id)
        if task is not None and not task.done():
            task.cancel()
        await self._emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_ERROR.value,
                data={"agent_id": agent_id, "status": context.status.value, "text": "已取消子智能体"},
                agent_id=agent_id,
            )
        )
        return {"ok": True, "agent_id": agent_id, "status": context.status.value}

    async def send_message_to_subagent(self, agent_id: str, message: str) -> Dict[str, Any]:

        context = self._agents.get(agent_id)
        if context is None:
            archived = self._archived_agents.pop(agent_id, None)
            if archived is not None:
                self._agents[agent_id] = archived
                context = archived
        if context is None:
            context = self._find_by_name_or_avatar(agent_id)
            if context is not None:
                aid = context.agent_id
                if aid in self._archived_agents:
                    self._archived_agents.pop(aid, None)
                if aid not in self._agents:
                    self._agents[aid] = context
                agent_id = aid
        if context is None:
            _log.warning(
                "send_message_to_subagent: agent_id=%s not in _agents (keys=%s)",
                agent_id,
                list(self._agents.keys()),
            )
            return {"ok": False, "error": "not_found", "message": f"未找到子智能体: {agent_id}"}
        text = message.strip()
        if not text:
            return {"ok": False, "error": "empty_message", "message": "消息不能为空"}

        if context.status == SubAgentStatus.RUNNING:
            session = self._agent_sessions.get(agent_id)
            if session is None:
                _log.warning("send_message: agent %s is RUNNING but session missing, rebuilding", agent_id)
                session = self._rebuild_agent_session(context)
            session.agent_messages.append({"role": "user", "content": text})
            session.chat_history.append({"role": "user", "content": text})
        else:
            _log.info("send_message: resuming agent %s (was %s, mode=%s)", agent_id, context.status.value, context.mode)
            self._ensure_agent_session(context)
            context.status = SubAgentStatus.RUNNING
            context.error_text = ""
            allowed_tools = self._build_toolset(context.allowed_tool_names)
            task = asyncio.create_task(
                self._run_subagent(
                    context,
                    allowed_tools=allowed_tools,
                    resume_input=text,
                )
            )
            self._tasks[agent_id] = task

        context.updated_at = time.time()
        await self._emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_PROGRESS.value,
                data={"agent_id": agent_id, "text": f"收到用户追问: {text}"},
                agent_id=agent_id,
            )
        )
        return {"ok": True, "agent_id": agent_id, "status": context.status.value}

    def _ensure_agent_session(self, context: SubAgentContext) -> StudioSession:
        """Ensure an active session exists for the agent, rebuilding if necessary."""
        session = self._agent_sessions.get(context.agent_id)
        if session is not None:
            return session
        return self._rebuild_agent_session(context)

    def _rebuild_agent_session(self, context: SubAgentContext) -> StudioSession:
        """Rebuild a session from saved context (used when resuming completed/failed agents)."""
        session = self._build_isolated_session(workspace_dir=context.workspace_dir)
        session.context_files.update(context.context_files)
        session.artifacts.update(context.artifacts)
        if context.agent_messages:
            session.agent_messages = list(context.agent_messages)
        if context.attachments:
            session.scratchpad.update(
                {f"attachment::{k}": v for k, v in context.attachments.items()}
            )
        setattr(session, "_team_manager", self)
        self._agent_sessions[context.agent_id] = session
        return session

    async def retry_subagent(self, agent_id: str, refined_task: Optional[str] = None) -> Dict[str, Any]:
        previous = self._agents.get(agent_id)
        if previous is None:
            previous = self._find_by_name_or_avatar(agent_id)
            if previous is not None:
                agent_id = previous.agent_id
        if previous is None:
            return {"ok": False, "error": "not_found", "message": f"未找到子智能体: {agent_id}"}
        if previous.status == SubAgentStatus.RUNNING:
            return {"ok": False, "error": "still_running", "message": "子智能体仍在运行，无法重试"}
        new_task = (refined_task or "").strip() or previous.task
        if previous.error_text:
            new_task = (
                f"{new_task}\n\n"
                "请参考上次失败信息并避免重复问题：\n"
                f"{previous.error_text}"
            )
        result = await self.spawn_subagent(
            name=previous.name,
            role=previous.role,
            task=new_task,
            source_tool_call_id=previous.source_tool_call_id,
            provider=previous.provider_name or None,
            model=previous.model_name or None,
            workspace_dir=previous.workspace_dir or None,
            system_prompt=previous.persona_prompt or None,
        )
        if not result.get("ok"):
            return result
        new_agent_id = str(result.get("agent_id", "")).strip()
        new_context = self._agents.get(new_agent_id)
        if new_context is not None:
            new_context.context_files.update(previous.context_files)
            new_context.artifacts.update(previous.artifacts)
        return result

    async def submit_for_longrun(self, entry: Any) -> Dict[str, Any]:
        """Run one long-running task entry via :meth:`spawn_subagent` and await completion."""
        payload = getattr(entry, "payload", None)
        if not isinstance(payload, dict):
            payload = {}
        workspace_obj = getattr(entry, "workspace", None)
        ws_path = ""
        if workspace_obj is not None:
            p = getattr(workspace_obj, "path", None)
            if p is not None:
                ws_path = str(p)
        task_text = str(payload.get("task") or payload.get("prompt") or "").strip()
        if not task_text:
            raise ValueError("longrun payload requires non-empty task or prompt")
        name = str(payload.get("name") or "longrun").strip() or "longrun"
        role = str(payload.get("role") or "worker").strip() or "worker"
        spawn_res = await self.spawn_subagent(
            name=name,
            role=role,
            task=task_text,
            workspace_dir=ws_path or None,
            provider=str(payload.get("provider") or "").strip() or None,
            model=str(payload.get("model") or "").strip() or None,
        )
        if not spawn_res.get("ok"):
            raise RuntimeError(str(spawn_res.get("error") or spawn_res))
        agent_id = str(spawn_res.get("agent_id", "") or "").strip()
        sub_task = self._tasks.get(agent_id)
        if sub_task is not None:
            await sub_task
        ctx = self._agents.get(agent_id) or self._archived_agents.get(agent_id)
        if ctx is None:
            raise RuntimeError("subagent context missing after run")
        if ctx.status == SubAgentStatus.FAILED:
            raise RuntimeError(ctx.error_text or "subagent_failed")
        if ctx.status == SubAgentStatus.CANCELLED:
            raise asyncio.CancelledError()
        text = (ctx.final_text or "").strip()
        wants = bool(payload.get("wants_continuation"))
        if not wants and "[longrun:continue]" in text.lower():
            wants = True
        return {
            "ok": True,
            "wants_continuation": wants,
            "agent_id": agent_id,
            "final_text": ctx.final_text,
            "status": ctx.status.value,
        }

    def _find_by_name_or_avatar(self, query: str) -> Optional[SubAgentContext]:
        """Fallback lookup by name (case-insensitive) or avatar_id."""
        q = query.strip().lower()
        for ctx in list(self._agents.values()) + list(self._archived_agents.values()):
            if ctx.avatar_id and ctx.avatar_id.lower() == q:
                return ctx
            if ctx.name and ctx.name.lower() == q:
                return ctx
        return None

    def get_status(self, agent_id: Optional[str] = None) -> Dict[str, Any]:
        _log.debug(
            "[get_status] tm_id=%s, _agents=%s, _archived=%s, query_agent_id=%s",
            id(self),
            list(self._agents.keys()),
            list(self._archived_agents.keys()),
            agent_id,
        )
        if agent_id:
            context = self._agents.get(agent_id)
            if context is None:
                context = self._archived_agents.get(agent_id)
            if context is None:
                context = self._find_by_name_or_avatar(agent_id)
            if context is None:
                return {"ok": False, "error": "not_found"}
            return {"ok": True, "subagent": self._serialize_status(context)}
        merged: Dict[str, SubAgentContext] = {}
        merged.update(self._archived_agents)
        merged.update(self._agents)
        return {
            "ok": True,
            "subagents": [self._serialize_status(item) for item in merged.values()],
        }

    def get_status_with_task_fallback(self, agent_id: Optional[str] = None) -> Dict[str, Any]:
        """Return status and synthesize running entries from tasks when needed."""
        status = self.get_status(agent_id)
        if agent_id:
            if status.get("ok"):
                return status
            task = self._tasks.get(agent_id)
            if task is None or task.done():
                return status
            context = self._agents.get(agent_id)
            if context is not None:
                return {"ok": True, "subagent": self._serialize_status(context)}
            return {
                "ok": True,
                "subagent": {
                    "agent_id": agent_id,
                    "name": agent_id,
                    "role": "worker",
                    "task": "",
                    "status": SubAgentStatus.RUNNING.value,
                    "updated_at": time.time(),
                    "result_summary": "",
                    "error_text": "",
                    "recent_events": [],
                    "depth": 1,
                    "parent_agent_id": "meta",
                    "mode": "run",
                    "cleanup": "keep",
                    "spawn_tree_path": "",
                    "provider": self.base_session.provider_name or "",
                    "model": self.base_session.model_name or "",
                    "pending_confirm": None,
                    "source": "task_fallback",
                },
            }

        rows = list(status.get("subagents", [])) if status.get("ok") else []
        known_ids = {str(item.get("agent_id", "")).strip() for item in rows}
        running_task_ids = [aid for aid, task in self._tasks.items() if not task.done()]
        if not running_task_ids:
            return status

        fallback_rows: List[Dict[str, Any]] = []
        for aid in running_task_ids:
            if aid in known_ids:
                continue
            context = self._agents.get(aid)
            if context is not None:
                row = self._serialize_status(context)
                row["source"] = "task_fallback"
                fallback_rows.append(row)
                continue
            fallback_rows.append(
                {
                    "agent_id": aid,
                    "name": aid,
                    "role": "worker",
                    "task": "",
                    "status": SubAgentStatus.RUNNING.value,
                    "updated_at": time.time(),
                    "result_summary": "",
                    "error_text": "",
                    "recent_events": [],
                    "depth": 1,
                    "parent_agent_id": "meta",
                    "mode": "run",
                    "cleanup": "keep",
                    "spawn_tree_path": "",
                    "provider": self.base_session.provider_name or "",
                    "model": self.base_session.model_name or "",
                    "pending_confirm": None,
                    "source": "task_fallback",
                }
            )
        if not fallback_rows:
            return status
        merged_rows = rows + fallback_rows
        _log.warning(
            "[get_status_with_task_fallback] synthesized %d rows from running tasks: tm=%s owner_sid=%s tasks=%s",
            len(fallback_rows),
            id(self),
            self.owner_session_id,
            running_task_ids,
        )
        return {"ok": True, "subagents": merged_rows}

    def get_confirm_gate(self, agent_id: str) -> Optional[AsyncConfirmGate]:
        context = self._agents.get(agent_id)
        if context is None:
            return None
        return context.confirm_gate

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._cancelled.clear()
        self._unregister()

    def shutdown_now(self) -> None:
        for task in list(self._tasks.values()):
            if not task.done():
                task.cancel()
        self._tasks.clear()
        self._cancelled.clear()
        self._unregister()

    def _serialize_status(self, context: SubAgentContext) -> Dict[str, Any]:
        pending_confirm = None
        if context.confirm_gate and context.confirm_gate.last_request:
            req = context.confirm_gate.last_request
            if context.confirm_gate._pending.get(str(req.get("id", ""))):
                pending_confirm = {
                    "request_id": req.get("id", ""),
                    "question": req.get("question", ""),
                    "context": req.get("context"),
                }
        return {
            "agent_id": context.agent_id,
            "name": context.name,
            "role": context.role,
            "task": context.task,
            "status": context.status.value,
            "updated_at": context.updated_at,
            "result_summary": context.result_summary,
            "error_text": context.error_text,
            "recent_events": list(context.recent_events[-20:]),
            "depth": context.depth,
            "parent_agent_id": context.parent_agent_id,
            "mode": context.mode,
            "cleanup": context.cleanup,
            "spawn_tree_path": context.spawn_tree_path,
            "provider": context.provider_name or self.base_session.provider_name or "",
            "model": context.model_name or self.base_session.model_name or "",
            "output_files": list(context.output_files[:200]),
            "pending_confirm": pending_confirm,
            "avatar_id": context.avatar_id or None,
        }

    def _archive_context(self, context: SubAgentContext) -> None:
        """Keep a lightweight finished snapshot for status queries."""
        snapshot = replace(
            context,
            # Avoid retaining heavy runtime payloads after completion.
            agent_messages=[],
            artifacts={},
            context_files={},
            attachments={},
        )
        self._archived_agents[context.agent_id] = snapshot
        if len(self._archived_agents) <= self._archive_limit:
            return
        # Drop oldest snapshots first to avoid unbounded growth.
        overflow = len(self._archived_agents) - self._archive_limit
        if overflow <= 0:
            return
        old_ids = sorted(
            self._archived_agents.keys(),
            key=lambda item: self._archived_agents[item].updated_at,
        )[:overflow]
        for agent_id in old_ids:
            self._archived_agents.pop(agent_id, None)

    async def _run_subagent(
        self,
        context: SubAgentContext,
        *,
        allowed_tools: Sequence[Dict[str, Any]],
        resume_input: Optional[str] = None,
    ) -> None:
        existing_session = self._agent_sessions.get(context.agent_id)
        if context.mode == "session" and existing_session is not None:
            session = existing_session
        else:
            session = self._build_isolated_session(workspace_dir=context.workspace_dir)
            session.context_files.update(context.context_files)
            session.artifacts.update(context.artifacts)
            setattr(session, "_team_manager", self)
            if context.attachments:
                session.scratchpad.update(
                    {f"attachment::{k}": v for k, v in context.attachments.items()}
                )
            self._agent_sessions[context.agent_id] = session
        setattr(session, "_team_manager", self)
        resolved_provider = context.provider_name or session.provider_name or self.base_session.provider_name
        resolved_model = context.model_name or session.model_name or self.base_session.model_name
        if resolved_provider or resolved_model:
            llm = ProviderResolver.resolve(provider_name=resolved_provider, model=resolved_model)
            session.provider_name = resolved_provider
            session.model_name = resolved_model
        else:
            llm = self.llm_factory()
        runtime = AgentRuntime(
            llm,
            context.confirm_gate,
            max_tool_rounds=_resolve_max_tool_rounds(),
            loop_warning_threshold=8,
            loop_critical_threshold=16,
            team_manager=self,
        )
        system_prompt = self._build_subagent_system_prompt(context, session)
        started_at = time.time()
        cancelled_by_request = False
        timed_out = False
        paused_at_limit = False
        heartbeat_stop = asyncio.Event()
        token_buffer = ""
        token_last_emit_at = time.time()

        async def _emit_progress(text: str) -> None:
            await self._emit(
                RuntimeEvent(
                    type=EventType.SUBAGENT_PROGRESS.value,
                    data={"agent_id": context.agent_id, "text": text},
                    agent_id=context.agent_id,
                )
            )

        async def _heartbeat() -> None:
            # Emit lightweight heartbeat so UI can show liveness even when model is thinking.
            while not heartbeat_stop.is_set():
                await asyncio.sleep(3)
                if heartbeat_stop.is_set():
                    break
                elapsed = int(time.time() - started_at)
                await _emit_progress(f"执行中（{elapsed}s）…")

        heartbeat_task = asyncio.create_task(_heartbeat())

        async def _flush_token_buffer() -> None:
            nonlocal token_buffer, token_last_emit_at
            if not token_buffer:
                return
            await self._emit(
                RuntimeEvent(
                    type=EventType.TOKEN.value,
                    data={"agent_id": context.agent_id, "text": token_buffer},
                    agent_id=context.agent_id,
                )
            )
            token_buffer = ""
            token_last_emit_at = time.time()

        try:
            def _should_stop() -> bool:
                nonlocal cancelled_by_request, timed_out
                if context.agent_id in self._cancelled:
                    cancelled_by_request = True
                    return True
                if context.run_timeout_seconds > 0 and (time.time() - started_at) > context.run_timeout_seconds:
                    timed_out = True
                    return True
                return False

            async for event in runtime.run_turn(
                resume_input or context.task,
                session,
                should_stop=_should_stop,
                agent_id=context.agent_id,
                tools=allowed_tools,
                system_prompt=system_prompt,
                usage_session_id=str(self.owner_session_id or ""),
                usage_avatar_id=str(context.avatar_id or ""),
            ):
                context.updated_at = time.time()
                if event.type == EventType.TOKEN.value:
                    tok = str(event.data.get("text", ""))
                    if tok:
                        token_buffer += tok
                        now = time.time()
                        if len(token_buffer) >= 120 or (now - token_last_emit_at) >= 0.2:
                            await _flush_token_buffer()
                    continue
                await _flush_token_buffer()
                if event.type == EventType.FINAL.value:
                    context.final_text = str(event.data.get("text", ""))
                if event.type == EventType.ERROR.value:
                    context.error_text = str(event.data.get("text", ""))
                if event.type == EventType.SUBAGENT_PAUSED.value:
                    paused_at_limit = True
                    context.final_text = context.final_text or str(event.data.get("text", ""))
                if event.type == EventType.ROUND_START.value:
                    round_no = int(event.data.get("round", 0) or 0)
                    max_rounds = int(event.data.get("max_rounds", 0) or 0)
                    elapsed = int(time.time() - started_at)
                    await _emit_progress(f"第 {round_no}/{max_rounds} 轮分析中（{elapsed}s）")
                if event.type in {
                    EventType.TOOL_CALL.value,
                    EventType.TOOL_RESULT.value,
                    EventType.CONFIRM_REQUIRED.value,
                    EventType.CONFIRM_RESPONSE.value,
                    EventType.SUBAGENT_CHECKPOINT.value,
                    EventType.SUBAGENT_PAUSED.value,
                    EventType.ERROR.value,
                }:
                    context.recent_events.append({"type": event.type, "data": event.data})
                if event.type in {EventType.TOOL_CALL.value, EventType.TOOL_RESULT.value}:
                    tool_name = str(event.data.get("name", "tool"))
                    args = event.data.get("arguments") or event.data.get("args") or {}
                    path_hint = ""
                    if isinstance(args, dict):
                        path_val = str(args.get("path", "")).strip()
                        if path_val:
                            path_hint = f" -> {path_val}"
                    action = (
                        f"调用工具 {tool_name}{path_hint}"
                        if event.type == EventType.TOOL_CALL.value
                        else f"完成工具 {tool_name}"
                    )
                    await _emit_progress(action)
                await self._emit(event)

            await _flush_token_buffer()

            if context.status != SubAgentStatus.CANCELLED:
                if context.error_text == STOP_MESSAGE and cancelled_by_request:
                    context.status = SubAgentStatus.CANCELLED
                    context.error_text = "任务已取消"
                elif context.error_text == STOP_MESSAGE and timed_out:
                    context.status = SubAgentStatus.FAILED
                    context.error_text = f"子智能体执行超时（>{context.run_timeout_seconds}s）"
                elif context.error_text == STOP_MESSAGE:
                    context.status = SubAgentStatus.CANCELLED
                    context.error_text = "任务已中断"
                elif paused_at_limit:
                    context.status = SubAgentStatus.COMPLETED
                    context.error_text = ""
                else:
                    context.status = (
                        SubAgentStatus.FAILED
                        if bool(context.error_text and not context.final_text)
                        else SubAgentStatus.COMPLETED
                    )
            context.updated_at = time.time()
        except asyncio.CancelledError:
            context.status = SubAgentStatus.CANCELLED
            context.error_text = context.error_text or "任务已取消"
            context.updated_at = time.time()
        except Exception as exc:
            context.status = SubAgentStatus.FAILED
            context.error_text = f"{exc}"
            context.updated_at = time.time()
            await self._emit(
                RuntimeEvent(
                    type=EventType.SUBAGENT_ERROR.value,
                    data={"agent_id": context.agent_id, "text": context.error_text},
                    agent_id=context.agent_id,
                )
            )
        finally:
            heartbeat_stop.set()
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
            context.agent_messages = list(session.agent_messages)
            context.artifacts = dict(session.artifacts)
            context.context_files = dict(session.context_files)
            context.output_files = self._extract_output_files_from_messages(context.agent_messages)
            context.result_summary = self._build_result_summary(context)
            produced_files = self._merge_output_files(context)
            if (
                context.status == SubAgentStatus.COMPLETED
                and self._task_expects_file_output(context.task)
                and not produced_files
            ):
                context.status = SubAgentStatus.FAILED
                context.error_text = (
                    "Task completed without file artifact. Expected an output file "
                    "but none was detected from tool results."
                )
                context.result_summary = self._build_result_summary(context)
            self.base_session.scratchpad[f"subagent_result::{context.agent_id}"] = (
                f"[{context.name}] 状态={context.status.value}, "
                f"摘要: {(context.result_summary or '(无)')[:500]}, "
                f"产出文件: {', '.join(produced_files[:20]) if produced_files else '(无)'}"
            )
            self._tasks.pop(context.agent_id, None)
            if context.mode != "session" or context.cleanup == "delete":
                self._agent_sessions.pop(context.agent_id, None)
            self._cancelled.discard(context.agent_id)
            self._archive_context(context)
            if context.cleanup == "delete":
                self._agents.pop(context.agent_id, None)
            if context.status == SubAgentStatus.FAILED:
                escalated = await self._auto_escalate(context, allowed_tools=allowed_tools)
                if escalated:
                    return

            if self.summary_sink is not None:
                await self.summary_sink(context.result_summary, context)
            event_type = (
                EventType.SUBAGENT_COMPLETED.value
                if context.status == SubAgentStatus.COMPLETED
                else EventType.SUBAGENT_ERROR.value
            )
            await self._emit(
                RuntimeEvent(
                    type=event_type,
                    data={
                        "agent_id": context.agent_id,
                        "name": context.name,
                        "status": context.status.value,
                        "summary": context.result_summary,
                    },
                    agent_id=context.agent_id,
                )
            )

    @staticmethod
    def _task_expects_file_output(task: str) -> bool:
        """Heuristic: whether a task explicitly asks for a file artifact."""
        t = str(task or "").lower()
        if not t:
            return False
        indicators = (
            ".md",
            ".markdown",
            ".json",
            ".yaml",
            ".yml",
            ".html",
            ".csv",
            ".pdf",
            "report",
            "save to",
            "write to",
            "output file",
            "生成报告",
            "保存到",
            "输出文件",
            "落盘",
        )
        return any(key in t for key in indicators)

    async def _auto_escalate(
        self,
        context: SubAgentContext,
        *,
        allowed_tools: Sequence[Dict[str, Any]],
    ) -> bool:
        """Automatic failure escalation: retry -> escalate model -> circuit-break.

        Returns True if an escalation retry was launched (caller should return
        early to avoid emitting a duplicate completion event).
        """
        max_escalation = _resolve_max_escalation()
        context.failure_count += 1

        if context.failure_count > max_escalation:
            _log.warning(
                "Sub-agent %s circuit-breaker tripped after %d failures",
                context.agent_id, context.failure_count,
            )
            context.error_text = (
                f"Circuit-breaker: {context.failure_count} consecutive failures. "
                f"Last error: {context.error_text}"
            )
            return False

        context.escalation_level += 1
        error_summary = (context.error_text or "unknown error")[:300]

        if context.failure_count <= 2:
            _log.info(
                "Sub-agent %s failed (attempt %d/%d), retrying with focused scope",
                context.agent_id, context.failure_count, max_escalation,
            )
            retry_task = (
                f"RETRY (attempt {context.failure_count}/{max_escalation}): "
                f"Previous attempt failed with: {error_summary}\n\n"
                f"Original task: {context.task}\n\n"
                "Focus on the core objective. Simplify your approach and avoid "
                "repeating the actions that caused the failure."
            )
            context.status = SubAgentStatus.RUNNING
            context.error_text = ""
            context.final_text = ""
            context.recent_events.clear()
            context.updated_at = time.time()
            self._tasks[context.agent_id] = asyncio.create_task(
                self._run_subagent(
                    context,
                    allowed_tools=allowed_tools,
                    resume_input=retry_task,
                )
            )
            await self._emit(
                RuntimeEvent(
                    type=EventType.SUBAGENT_PROGRESS.value,
                    data={
                        "agent_id": context.agent_id,
                        "text": f"Retry {context.failure_count}/{max_escalation}: re-attempting with focused scope",
                    },
                    agent_id=context.agent_id,
                )
            )
            return True

        _log.info(
            "Sub-agent %s escalating (attempt %d/%d), spawning stronger replacement",
            context.agent_id, context.failure_count, max_escalation,
        )
        escalation_task = (
            f"ESCALATION (attempt {context.failure_count}/{max_escalation}): "
            f"Previous {context.failure_count - 1} attempts all failed.\n"
            f"Last error: {error_summary}\n\n"
            f"Original task: {context.task}\n\n"
            "This is an escalated retry. Take a completely different approach. "
            "Analyze why previous attempts failed and devise a new strategy."
        )
        context.status = SubAgentStatus.RUNNING
        context.error_text = ""
        context.final_text = ""
        context.recent_events.clear()
        context.updated_at = time.time()
        self._tasks[context.agent_id] = asyncio.create_task(
            self._run_subagent(
                context,
                allowed_tools=allowed_tools,
                resume_input=escalation_task,
            )
        )
        await self._emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_PROGRESS.value,
                data={
                    "agent_id": context.agent_id,
                    "text": f"Escalation {context.failure_count}/{max_escalation}: trying different approach",
                },
                agent_id=context.agent_id,
            )
        )
        return True

    def _build_result_summary(self, context: SubAgentContext) -> str:
        file_list = self._merge_output_files(context)
        if context.status == SubAgentStatus.COMPLETED:
            text = context.final_text or "任务执行完成"
            summary = (
                f"[{context.name}] 已完成。\n"
                f"结果摘要: {text}\n"
                f"产出文件: {', '.join(file_list) if file_list else '(无)'}"
            )
        elif context.status == SubAgentStatus.CANCELLED:
            summary = f"[{context.name}] 已取消。"
        else:
            summary = f"[{context.name}] 执行失败: {context.error_text or '未知错误'}"
        # Approximate <=500 token with conservative 2000 chars.
        if len(summary) > 2000:
            summary = summary[:2000] + "...(truncated)"
        return summary

    def _extract_output_files_from_messages(self, messages: List[Dict[str, Any]]) -> List[str]:
        paths: List[str] = []
        seen: set[str] = set()
        for msg in messages:
            if str(msg.get("role", "")) != "tool":
                continue
            tool_name = str(msg.get("name", "") or "").strip()
            if tool_name not in {"file_write", "file_edit"}:
                continue
            content = str(msg.get("content", "") or "")
            if not content:
                continue
            for raw_line in content.splitlines():
                line = raw_line.strip()
                if not line:
                    continue
                match = re.match(r"^OK:\s*(?:wrote|edited)\s+(.+?)(?:\s+\(\d+\s+chars\))?$", line)
                if not match:
                    continue
                path = str(match.group(1) or "").strip()
                if path and path not in seen:
                    seen.add(path)
                    paths.append(path)
        return paths

    def _merge_output_files(self, context: SubAgentContext) -> List[str]:
        merged: List[str] = []
        seen: set[str] = set()
        for path in context.artifacts.keys():
            p = str(path)
            if p and p not in seen:
                seen.add(p)
                merged.append(p)
        for p in context.output_files:
            if p and p not in seen:
                seen.add(p)
                merged.append(p)
        return merged
