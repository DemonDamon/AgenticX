#!/usr/bin/env python3
"""AgentRuntime core loop with structured event stream.

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, AsyncGenerator, Dict, List, Optional

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
    ) -> AsyncGenerator[RuntimeEvent, None]:
        system_prompt = _build_agent_system_prompt(session)
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        messages.extend(session.agent_messages[-16:])
        messages.append({"role": "user", "content": user_input})
        session.agent_messages.append({"role": "user", "content": user_input})
        session.chat_history.append({"role": "user", "content": user_input})

        for round_idx in range(1, self.max_tool_rounds + 1):
            yield RuntimeEvent(
                type=EventType.ROUND_START.value,
                data={"round": round_idx, "max_rounds": self.max_tool_rounds},
            )
            response = self.llm.invoke(
                messages,
                tools=STUDIO_TOOLS,
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

            if not tool_calls:
                streamed_text = ""
                try:
                    for chunk in self.llm.stream(
                        messages,
                        temperature=0.2,
                        max_tokens=1200,
                    ):
                        token = chunk if isinstance(chunk, str) else str(chunk.get("content", ""))
                        if not token:
                            continue
                        streamed_text += token
                        yield RuntimeEvent(type=EventType.TOKEN.value, data={"text": token})
                except Exception:
                    streamed_text = response_text

                final_text = streamed_text.strip() if streamed_text.strip() else response_text
                session.chat_history.append({"role": "assistant", "content": final_text})
                yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text})
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
                function_obj = call.get("function", {}) if isinstance(call, dict) else {}
                tool_name = str(function_obj.get("name", "")).strip()
                arguments = _parse_tool_arguments(function_obj.get("arguments"))
                tool_call_id = str(call.get("id", "")) if isinstance(call, dict) else ""

                yield RuntimeEvent(
                    type=EventType.TOOL_CALL.value,
                    data={"name": tool_name, "arguments": arguments, "tool_call_id": tool_call_id},
                )
                pending_events: List[Dict[str, Any]] = []

                async def _on_tool_event(event_payload: Dict[str, Any]) -> None:
                    pending_events.append(event_payload)

                result = await dispatch_tool_async(
                    tool_name,
                    arguments,
                    session,
                    confirm_gate=self.confirm_gate,
                    event_callback=_on_tool_event,
                )
                for emitted in pending_events:
                    yield RuntimeEvent(
                        type=str(emitted.get("type", "")),
                        data=dict(emitted.get("data", {})),
                    )
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
                session.chat_history.append(
                    {"role": "assistant", "content": f"工具结果({tool_name}):\n{result}"}
                )
                yield RuntimeEvent(
                    type=EventType.TOOL_RESULT.value,
                    data={"name": tool_name, "result": result, "tool_call_id": tool_call_id},
                )

        message = (
            "已达到最大工具调用轮数，已停止自动执行。"
            "请基于当前结果继续指示，或缩小任务范围。"
        )
        yield RuntimeEvent(type=EventType.ERROR.value, data={"text": message})
