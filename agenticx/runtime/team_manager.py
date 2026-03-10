#!/usr/bin/env python3
"""Agent Team manager for sub-agent lifecycle and scheduling."""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, AsyncConfirmGate, EventType, RuntimeEvent
from agenticx.runtime.resource_monitor import ResourceMonitor

EventEmitter = Callable[[RuntimeEvent], Awaitable[None]]
SummarySink = Callable[[str, "SubAgentContext"], Awaitable[None]]


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


class AgentTeamManager:
    """Manage a pool of sub-agents with isolated context and bounded concurrency."""

    def __init__(
        self,
        *,
        llm_factory: Callable[[], Any],
        base_session: StudioSession,
        event_emitter: Optional[EventEmitter] = None,
        summary_sink: Optional[SummarySink] = None,
        max_concurrent_subagents: int = 4,
        resource_monitor: Optional[ResourceMonitor] = None,
        spawn_config: Optional[SpawnConfig] = None,
    ) -> None:
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

    def _build_isolated_session(self) -> StudioSession:
        session = StudioSession(
            provider_name=self.base_session.provider_name,
            model_name=self.base_session.model_name,
            workspace_dir=self.base_session.workspace_dir,
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
        return (
            "你是 AgenticX Studio 的子智能体。\n"
            "你的核心目标：在指定工作目录中完成被委派任务，并持续汇报可验证进展。\n\n"
            "## 你的身份\n"
            f"- agent_id: {context.agent_id}\n"
            f"- name: {context.name}\n"
            f"- role: {context.role}\n"
            f"- delegated_task: {context.task}\n\n"
            "## 工作目录约束（必须遵守）\n"
            f"- 工作目录: {workspace_dir}\n"
            "- 所有文件读写和命令执行都必须限定在该目录或其子目录。\n"
            "- 禁止把 `/Users`、`~`、`/` 等系统路径当作默认探索目标。\n"
            "- 若路径不确定，先用最小范围的 list/read 确认后再操作。\n\n"
            "## 已注入上下文文件\n"
            f"{context_hint}\n\n"
            "## 执行要求\n"
            "- 先给出你即将执行的最小下一步，再调用工具。\n"
            "- 遇到歧义或高风险操作时，先 ask_user 再继续。\n"
            "- 若用户没有明确给出落盘目录/路径：必须先提出建议路径并征求用户同意，再写文件。\n"
            "- 只有在收到工具返回 `OK: wrote ...` / `OK: edited ...` / `OK: generated ...` 后，才能宣称“已生成/已落盘”。\n"
            "- 对外汇报文件产出时，优先引用工具返回的绝对路径；若未拿到成功返回，必须明确说明“尚未写入磁盘”。\n"
            "- 优先完成用户指定目录中的目标，不做无关全盘扫描。"
        )

    async def _emit(self, event: RuntimeEvent) -> None:
        if self.event_emitter is not None:
            await self.event_emitter(event)

    def _build_toolset(self, allowed_names: Optional[Sequence[str]]) -> Sequence[Dict[str, Any]]:
        if allowed_names is None:
            return STUDIO_TOOLS
        allowed = {name.strip() for name in allowed_names if name and name.strip()}
        if not allowed:
            return []
        return [tool for tool in STUDIO_TOOLS if tool.get("function", {}).get("name") in allowed]

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
            if tools is not None and not allowed_tools:
                return {
                    "ok": False,
                    "error": "invalid_tools",
                    "message": "请求了 tools 白名单，但没有匹配到有效工具",
                }
            agent_id = f"sa-{uuid.uuid4().hex[:8]}"
            resolved_mode = (mode or self.spawn_config.mode).strip().lower()
            if resolved_mode not in {"run", "session"}:
                resolved_mode = "run"
            resolved_cleanup = (cleanup or self.spawn_config.cleanup).strip().lower()
            if resolved_cleanup not in {"keep", "delete"}:
                resolved_cleanup = "keep"
            resolved_timeout = int(run_timeout_seconds or self.spawn_config.run_timeout_seconds or 0)
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
            context = SubAgentContext(
                agent_id=agent_id,
                name=name.strip() or agent_id,
                role=role.strip() or "worker",
                task=task.strip(),
                source_tool_call_id=source_tool_call_id,
                context_files=dict(self.base_session.context_files),
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
            )
            self._agents[agent_id] = context
            context.status = SubAgentStatus.RUNNING
            context.updated_at = time.time()
            self._tasks[agent_id] = asyncio.create_task(
                self._run_subagent(context, allowed_tools=allowed_tools)
            )

        await self._emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_STARTED.value,
                data={
                    "agent_id": context.agent_id,
                    "name": context.name,
                    "role": context.role,
                    "task": context.task,
                    "status": context.status.value,
                    "depth": context.depth,
                    "mode": context.mode,
                },
                agent_id=context.agent_id,
            )
        )
        return {
            "ok": True,
            "agent_id": context.agent_id,
            "name": context.name,
            "role": context.role,
            "task": context.task,
            "depth": context.depth,
            "mode": context.mode,
        }

    async def cancel_subagent(self, agent_id: str) -> Dict[str, Any]:
        context = self._agents.get(agent_id)
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
            return {"ok": False, "error": "not_found", "message": f"未找到子智能体: {agent_id}"}
        if context.status != SubAgentStatus.RUNNING and context.mode != "session":
            return {
                "ok": False,
                "error": "not_running",
                "message": f"子智能体当前状态为 {context.status.value}，无法继续对话",
            }
        session = self._agent_sessions.get(agent_id)
        if session is None:
            return {"ok": False, "error": "session_unavailable", "message": "子智能体会话不可用"}
        text = message.strip()
        if not text:
            return {"ok": False, "error": "empty_message", "message": "消息不能为空"}
        if context.status != SubAgentStatus.RUNNING:
            context.status = SubAgentStatus.RUNNING
            allowed_tools = self._build_toolset(context.allowed_tool_names)
            task = asyncio.create_task(
                self._run_subagent(
                    context,
                    allowed_tools=allowed_tools,
                    resume_input=text,
                )
            )
            self._tasks[agent_id] = task
        else:
            session.agent_messages.append({"role": "user", "content": text})
            session.chat_history.append({"role": "user", "content": text})
        context.updated_at = time.time()
        await self._emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_PROGRESS.value,
                data={"agent_id": agent_id, "text": f"收到用户追问: {text}"},
                agent_id=agent_id,
            )
        )
        return {"ok": True, "agent_id": agent_id, "status": context.status.value}

    async def retry_subagent(self, agent_id: str, refined_task: Optional[str] = None) -> Dict[str, Any]:
        previous = self._agents.get(agent_id)
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
        )
        if not result.get("ok"):
            return result
        new_agent_id = str(result.get("agent_id", "")).strip()
        new_context = self._agents.get(new_agent_id)
        if new_context is not None:
            new_context.context_files.update(previous.context_files)
            new_context.artifacts.update(previous.artifacts)
        return result

    def get_status(self, agent_id: Optional[str] = None) -> Dict[str, Any]:
        if agent_id:
            context = self._agents.get(agent_id)
            if context is None:
                return {"ok": False, "error": "not_found"}
            return {"ok": True, "subagent": self._serialize_status(context)}
        return {
            "ok": True,
            "subagents": [self._serialize_status(item) for item in self._agents.values()],
        }

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

    def shutdown_now(self) -> None:
        for task in list(self._tasks.values()):
            if not task.done():
                task.cancel()
        self._tasks.clear()
        self._cancelled.clear()

    def _serialize_status(self, context: SubAgentContext) -> Dict[str, Any]:
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
        }

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
            session = self._build_isolated_session()
            session.context_files.update(context.context_files)
            session.artifacts.update(context.artifacts)
            setattr(session, "_team_manager", self)
            if context.attachments:
                session.scratchpad.update(
                    {f"attachment::{k}": v for k, v in context.attachments.items()}
                )
            self._agent_sessions[context.agent_id] = session
        setattr(session, "_team_manager", self)
        llm = self.llm_factory()
        runtime = AgentRuntime(llm, context.confirm_gate, max_tool_rounds=25)
        system_prompt = self._build_subagent_system_prompt(context, session)
        started_at = time.time()

        try:
            async for event in runtime.run_turn(
                resume_input or context.task,
                session,
                should_stop=lambda: context.agent_id in self._cancelled
                or (
                    context.run_timeout_seconds > 0
                    and (time.time() - started_at) > context.run_timeout_seconds
                ),
                agent_id=context.agent_id,
                tools=allowed_tools,
                system_prompt=system_prompt,
            ):
                context.updated_at = time.time()
                if event.type == EventType.FINAL.value:
                    context.final_text = str(event.data.get("text", ""))
                if event.type == EventType.ERROR.value:
                    context.error_text = str(event.data.get("text", ""))
                if event.type == EventType.SUBAGENT_PAUSED.value:
                    context.error_text = str(event.data.get("text", ""))
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
                    action = (
                        f"调用工具 {tool_name}"
                        if event.type == EventType.TOOL_CALL.value
                        else f"完成工具 {tool_name}"
                    )
                    await self._emit(
                        RuntimeEvent(
                            type=EventType.SUBAGENT_PROGRESS.value,
                            data={"agent_id": context.agent_id, "text": action},
                            agent_id=context.agent_id,
                        )
                    )
                await self._emit(event)

            if context.status != SubAgentStatus.CANCELLED:
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
            context.agent_messages = list(session.agent_messages)
            context.artifacts = dict(session.artifacts)
            context.context_files = dict(session.context_files)
            context.result_summary = self._build_result_summary(context)
            self._tasks.pop(context.agent_id, None)
            if context.mode != "session" or context.cleanup == "delete":
                self._agent_sessions.pop(context.agent_id, None)
            self._cancelled.discard(context.agent_id)
            if context.cleanup == "delete":
                self._agents.pop(context.agent_id, None)
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

    def _build_result_summary(self, context: SubAgentContext) -> str:
        file_list = [str(path) for path in context.artifacts.keys()]
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
