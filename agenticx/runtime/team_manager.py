#!/usr/bin/env python3
"""Agent Team manager for sub-agent lifecycle and scheduling."""

from __future__ import annotations

import asyncio
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
    ) -> None:
        self.llm_factory = llm_factory
        self.base_session = base_session
        self.event_emitter = event_emitter
        self.summary_sink = summary_sink
        self.max_concurrent_subagents = max_concurrent_subagents
        self.resource_monitor = resource_monitor or ResourceMonitor()

        self._lock = asyncio.Lock()
        self._agents: Dict[str, SubAgentContext] = {}
        self._tasks: Dict[str, asyncio.Task[None]] = {}
        self._cancelled: set[str] = set()

    def _build_isolated_session(self) -> StudioSession:
        session = StudioSession(
            provider_name=self.base_session.provider_name,
            model_name=self.base_session.model_name,
        )
        # MCP clients are shared, while per-agent messages/artifacts remain isolated.
        session.mcp_hub = self.base_session.mcp_hub
        session.mcp_configs = self.base_session.mcp_configs
        session.connected_servers = self.base_session.connected_servers
        session.context_files = dict(self.base_session.context_files)
        return session

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
    ) -> Dict[str, Any]:
        async with self._lock:
            active = self._active_running_count()
            if active >= self.max_concurrent_subagents:
                return {
                    "ok": False,
                    "error": "max_concurrency_reached",
                    "message": f"当前并行子智能体已达上限({self.max_concurrent_subagents})",
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
            context = SubAgentContext(
                agent_id=agent_id,
                name=name.strip() or agent_id,
                role=role.strip() or "worker",
                task=task.strip(),
                source_tool_call_id=source_tool_call_id,
                context_files=dict(self.base_session.context_files),
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
        }

    async def _run_subagent(
        self,
        context: SubAgentContext,
        *,
        allowed_tools: Sequence[Dict[str, Any]],
    ) -> None:
        session = self._build_isolated_session()
        llm = self.llm_factory()
        runtime = AgentRuntime(llm, context.confirm_gate)

        try:
            async for event in runtime.run_turn(
                context.task,
                session,
                should_stop=lambda: context.agent_id in self._cancelled,
                agent_id=context.agent_id,
                tools=allowed_tools,
            ):
                context.updated_at = time.time()
                if event.type == EventType.FINAL.value:
                    context.final_text = str(event.data.get("text", ""))
                if event.type == EventType.ERROR.value:
                    context.error_text = str(event.data.get("text", ""))
                if event.type in {
                    EventType.TOOL_CALL.value,
                    EventType.TOOL_RESULT.value,
                    EventType.CONFIRM_REQUIRED.value,
                    EventType.CONFIRM_RESPONSE.value,
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
            self._cancelled.discard(context.agent_id)
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
