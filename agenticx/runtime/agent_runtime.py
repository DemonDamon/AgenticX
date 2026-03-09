#!/usr/bin/env python3
"""AgentRuntime core loop with structured event stream.

Author: Damon Li
"""

from __future__ import annotations

import json
import asyncio
import inspect
from typing import TYPE_CHECKING, Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional, Sequence

from agenticx.cli.agent_tools import STUDIO_TOOLS, dispatch_tool_async
from agenticx.cli.studio_mcp import build_mcp_tools_context
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.runtime.confirm import ConfirmGate
from agenticx.runtime.events import EventType, RuntimeEvent

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession
else:
    StudioSession = Any


MAX_TOOL_ROUNDS = 10
MAX_CONTEXT_CHARS = 16_000
STOP_MESSAGE = "已中断当前生成"


def _truncate(text: str, limit: int = MAX_CONTEXT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... (truncated, total {len(text)} chars)"


def _serialize_artifacts(session: StudioSession) -> str:
    if not session.artifacts:
        return "(empty)"
    parts: List[str] = []
    for path, content in session.artifacts.items():
        parts.append(f"--- {path} ---\n{_truncate(content, 4000)}")
    return "\n\n".join(parts)


def _serialize_context_files(session: StudioSession) -> str:
    if not session.context_files:
        return "(empty)"
    parts: List[str] = []
    for fpath, content in session.context_files.items():
        parts.append(f"--- {fpath} ---\n{_truncate(content, 4000)}")
    return "\n\n".join(parts)


def _serialize_skill_summaries() -> str:
    try:
        summaries = get_all_skill_summaries()
    except Exception:
        summaries = []
    if not summaries:
        return "(no skills discovered)"
    return "\n".join(f"- {item['name']}: {item['description']}" for item in summaries[:120])


def _build_agent_system_prompt(session: StudioSession) -> str:
    mcp_context = ""
    if session.mcp_hub is not None:
        mcp_context = build_mcp_tools_context(session.mcp_hub)
    if not mcp_context:
        mcp_context = "(no MCP tools connected)"

    return (
        "你是 AgenticX Studio 的执行型 Agent（implement 角色）。\n"
        "核心目标：根据用户请求完成代码/命令操作，并在不确定或高风险动作前主动确认。\n\n"
        "## 回复语言\n"
        "- 必须使用中文回复。\n"
        "- 简洁、可执行、优先给出当前进度。\n\n"
        "## 可用元 Skills 摘要\n"
        f"{_serialize_skill_summaries()}\n\n"
        "## 当前会话 artifacts\n"
        f"{_serialize_artifacts(session)}\n\n"
        "## 当前 context_files\n"
        f"{_serialize_context_files(session)}\n\n"
        "## 当前 MCP 工具上下文\n"
        f"{_truncate(mcp_context, 6000)}\n\n"
        "## 安全与确认规则（必须遵守）\n"
        "- bash_exec 仅对白名单命令自动执行；非白名单命令必须先征得用户确认。\n"
        "- file_write 与 file_edit 必须先展示 unified diff，再征得用户确认。\n"
        "- 当信息不足、需求含糊、或操作有副作用时，优先使用 ask_user。\n"
        "- 优先最小改动，避免无关重构。\n"
    )


def _parse_tool_arguments(raw_args: Any) -> Dict[str, Any]:
    if isinstance(raw_args, dict):
        return raw_args
    if isinstance(raw_args, str):
        stripped = raw_args.strip()
        if not stripped:
            return {}
        try:
            decoded = json.loads(stripped)
        except json.JSONDecodeError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


class AgentRuntime:
    """LLM-driven runtime that emits structured events."""

    def __init__(
        self,
        llm: Any,
        confirm_gate: ConfirmGate,
        *,
        max_tool_rounds: int = MAX_TOOL_ROUNDS,
    ) -> None:
        self.llm = llm
        self.confirm_gate = confirm_gate
        self.max_tool_rounds = max_tool_rounds

    async def run_turn(
        self,
        user_input: str,
        session: StudioSession,
        should_stop: Optional[Callable[[], bool | Awaitable[bool]]] = None,
        *,
        agent_id: str = "meta",
        tools: Optional[Sequence[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[RuntimeEvent, None]:
        async def _check_should_stop() -> bool:
            if should_stop is None:
                return False
            try:
                result = should_stop()
                if inspect.isawaitable(result):
                    return bool(await result)
                return bool(result)
            except Exception:
                return False

        current_system_prompt = system_prompt or _build_agent_system_prompt(session)
        active_tools: Sequence[Dict[str, Any]] = STUDIO_TOOLS if tools is None else tools
        allowed_tool_names = {
            str(tool.get("function", {}).get("name", "")).strip()
            for tool in active_tools
            if isinstance(tool, dict)
        }
        messages: List[Dict[str, Any]] = [{"role": "system", "content": current_system_prompt}]
        messages.extend(session.agent_messages[-16:])
        messages.append({"role": "user", "content": user_input})
        session.agent_messages.append({"role": "user", "content": user_input})
        synced_session_message_count = len(session.agent_messages)
        session.chat_history.append({"role": "user", "content": user_input})

        for round_idx in range(1, self.max_tool_rounds + 1):
            if await _check_should_stop():
                yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                return
            yield RuntimeEvent(
                type=EventType.ROUND_START.value,
                data={"round": round_idx, "max_rounds": self.max_tool_rounds},
                agent_id=agent_id,
            )
            if len(session.agent_messages) > synced_session_message_count:
                messages.extend(session.agent_messages[synced_session_message_count:])
                synced_session_message_count = len(session.agent_messages)
            response = self.llm.invoke(
                messages,
                tools=active_tools,
                tool_choice="auto",
                temperature=0.2,
                max_tokens=1200,
            )
            response_text = (response.content or "").strip()
            tool_calls = response.tool_calls or []
            assistant_message: Dict[str, Any] = {"role": "assistant", "content": response_text}
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
            session.agent_messages.append(assistant_message)
            synced_session_message_count = len(session.agent_messages)

            if not tool_calls:
                streamed_text = ""
                try:
                    for chunk in self.llm.stream(
                        messages,
                        temperature=0.2,
                        max_tokens=1200,
                    ):
                        if await _check_should_stop():
                            yield RuntimeEvent(
                                type=EventType.ERROR.value,
                                data={"text": STOP_MESSAGE},
                                agent_id=agent_id,
                            )
                            return
                        token = chunk if isinstance(chunk, str) else str(chunk.get("content", ""))
                        if not token:
                            continue
                        streamed_text += token
                        yield RuntimeEvent(type=EventType.TOKEN.value, data={"text": token}, agent_id=agent_id)
                except Exception:
                    streamed_text = response_text

                final_text = streamed_text.strip() if streamed_text.strip() else response_text
                session.chat_history.append({"role": "assistant", "content": final_text})
                yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text}, agent_id=agent_id)
                return

            assistant_tool_message = {
                "role": "assistant",
                "content": response_text,
                "tool_calls": tool_calls,
            }
            messages.append(assistant_tool_message)
            tool_call_text = (
                f"{response_text}\n\n工具调用:\n{json.dumps(tool_calls, ensure_ascii=False)}"
                if response_text
                else f"工具调用:\n{json.dumps(tool_calls, ensure_ascii=False)}"
            )
            session.chat_history.append({"role": "assistant", "content": tool_call_text})

            for call in tool_calls:
                if await _check_should_stop():
                    yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                    return
                function_obj = call.get("function", {}) if isinstance(call, dict) else {}
                tool_name = str(function_obj.get("name", "")).strip()
                tool_call_id = str(call.get("id", "")) if isinstance(call, dict) else ""
                arguments = _parse_tool_arguments(function_obj.get("arguments"))
                dispatch_arguments = dict(arguments)
                dispatch_arguments["__tool_call_id"] = tool_call_id
                dispatch_arguments["__agent_id"] = agent_id
                if tool_name not in allowed_tool_names:
                    denied_message = f"工具 '{tool_name}' 不在当前允许列表中，已拒绝执行。"
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": denied_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue

                yield RuntimeEvent(
                    type=EventType.TOOL_CALL.value,
                    data={"name": tool_name, "arguments": arguments, "tool_call_id": tool_call_id},
                    agent_id=agent_id,
                )
                pending_events: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()

                async def _on_tool_event(event_payload: Dict[str, Any]) -> None:
                    pending_events.put_nowait(event_payload)

                dispatch_task = asyncio.create_task(
                    dispatch_tool_async(
                        tool_name,
                        dispatch_arguments,
                        session,
                        confirm_gate=self.confirm_gate,
                        event_callback=_on_tool_event,
                    )
                )

                while True:
                    if await _check_should_stop():
                        dispatch_task.cancel()
                        try:
                            await dispatch_task
                        except asyncio.CancelledError:
                            pass
                        yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                        return
                    if dispatch_task.done() and pending_events.empty():
                        break
                    try:
                        emitted = await asyncio.wait_for(pending_events.get(), timeout=0.05)
                        yield RuntimeEvent(
                            type=str(emitted.get("type", "")),
                            data=dict(emitted.get("data", {})),
                            agent_id=agent_id,
                        )
                    except asyncio.TimeoutError:
                        continue

                result = await dispatch_task
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "content": result,
                    }
                )
                session.agent_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "content": result,
                    }
                )
                synced_session_message_count = len(session.agent_messages)
                session.chat_history.append(
                    {"role": "assistant", "content": f"工具结果({tool_name}):\n{result}"}
                )
                yield RuntimeEvent(
                    type=EventType.TOOL_RESULT.value,
                    data={"name": tool_name, "result": result, "tool_call_id": tool_call_id},
                    agent_id=agent_id,
                )

        message = (
            "已达到最大工具调用轮数，已停止自动执行。"
            "请基于当前结果继续指示，或缩小任务范围。"
        )
        yield RuntimeEvent(type=EventType.ERROR.value, data={"text": message}, agent_id=agent_id)
