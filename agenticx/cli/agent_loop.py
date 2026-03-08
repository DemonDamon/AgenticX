#!/usr/bin/env python3
"""Agent loop runtime for AGX Studio.

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List

from rich.console import Console

from agenticx.cli.agent_tools import STUDIO_TOOLS, dispatch_tool
from agenticx.cli.studio_mcp import build_mcp_tools_context
from agenticx.cli.studio_skill import get_all_skill_summaries

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession
else:
    StudioSession = Any


console = Console()
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
    """Build system prompt with role, context, MCP and safety rules."""
    mcp_context = ""
    if session.mcp_hub is not None:
        mcp_context = build_mcp_tools_context(session.mcp_hub)
    if not mcp_context:
        mcp_context = "(no MCP tools connected)"

    prompt = (
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
    return prompt


def _ensure_agent_history(session: StudioSession) -> List[Dict[str, Any]]:
    existing = getattr(session, "agent_loop_history", None)
    if isinstance(existing, list):
        return existing
    history: List[Dict[str, Any]] = []
    setattr(session, "agent_loop_history", history)
    return history


def _append_round_history(
    session: StudioSession,
    round_idx: int,
    request_messages: List[Dict[str, Any]],
    response_content: str,
    response_tool_calls: List[Dict[str, Any]],
    tool_results: List[Dict[str, Any]],
) -> None:
    payload = {
        "round": round_idx,
        "messages": request_messages,
        "assistant": {
            "content": response_content,
            "tool_calls": response_tool_calls,
        },
        "tool_results": tool_results,
    }
    _ensure_agent_history(session).append(payload)


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


def run_agent_loop(session: StudioSession, llm: Any, user_input: str) -> str:
    """Run agent loop with tool-calling until final text or max rounds."""
    system_prompt = _build_agent_system_prompt(session)
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    messages.extend(session.agent_messages[-16:])
    messages.append({"role": "user", "content": user_input})
    session.agent_messages.append({"role": "user", "content": user_input})
    session.chat_history.append({"role": "user", "content": user_input})

    final_text = ""
    for round_idx in range(1, MAX_TOOL_ROUNDS + 1):
        console.print(f"[dim]Agent loop round {round_idx}/{MAX_TOOL_ROUNDS}...[/dim]")
        request_snapshot = [dict(m) for m in messages]
        response = llm.invoke(
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
            final_text = response_text
            session.chat_history.append({"role": "assistant", "content": response_text})
            _append_round_history(
                session=session,
                round_idx=round_idx,
                request_messages=request_snapshot,
                response_content=response_text,
                response_tool_calls=[],
                tool_results=[],
            )
            break

        assistant_tool_message = {
            "role": "assistant",
            "content": response_text,
            "tool_calls": tool_calls,
        }
        tool_call_text = (
            f"{response_text}\n\n工具调用:\n{json.dumps(tool_calls, ensure_ascii=False)}"
            if response_text
            else f"工具调用:\n{json.dumps(tool_calls, ensure_ascii=False)}"
        )
        session.chat_history.append({"role": "assistant", "content": tool_call_text})
        messages.append(assistant_tool_message)

        round_tool_results: List[Dict[str, Any]] = []
        for call in tool_calls:
            function_obj = call.get("function", {}) if isinstance(call, dict) else {}
            tool_name = str(function_obj.get("name", "")).strip()
            arguments = _parse_tool_arguments(function_obj.get("arguments"))
            tool_call_id = str(call.get("id", "")) if isinstance(call, dict) else ""

            console.print(f"[cyan]↳ 调用工具:[/cyan] {tool_name}")
            result = dispatch_tool(tool_name, arguments, session)
            round_tool_results.append(
                {
                    "tool_call_id": tool_call_id,
                    "name": tool_name,
                    "arguments": arguments,
                    "result": result,
                }
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
                {
                    "role": "assistant",
                    "content": f"工具结果({tool_name}):\n{result}",
                }
            )

        _append_round_history(
            session=session,
            round_idx=round_idx,
            request_messages=request_snapshot,
            response_content=response_text,
            response_tool_calls=tool_calls,
            tool_results=round_tool_results,
        )

    else:
        final_text = (
            "已达到最大工具调用轮数，已停止自动执行。"
            "请基于当前结果继续指示，或缩小任务范围。"
        )

    if not final_text:
        final_text = "任务已执行，但模型未返回文本结论。请查看上方工具结果后继续。"
    return final_text
