#!/usr/bin/env python3
"""AgentRuntime core loop with structured event stream.

Author: Damon Li
"""

from __future__ import annotations

import json
import asyncio
import inspect
import re
import uuid
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
LLM_INVOKE_TIMEOUT_SECONDS = 45.0


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


def _sanitize_context_messages(messages: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Repair history to satisfy strict tool-call pairing providers.

    Rules:
    - Keep tool messages only when their tool_call_id is declared by some assistant tool_calls.
    - Keep assistant tool_calls only when each call id has a corresponding tool response in history.
      Unmatched calls are removed from that assistant message.
    """
    declared_tool_call_ids: set[str] = set()
    responded_tool_call_ids: set[str] = set()

    for msg in messages:
        role = str(msg.get("role", ""))
        if role == "assistant":
            for call in (msg.get("tool_calls") or []):
                if isinstance(call, dict):
                    cid = str(call.get("id", "")).strip()
                    if cid:
                        declared_tool_call_ids.add(cid)
        elif role == "tool":
            cid = str(msg.get("tool_call_id", "")).strip()
            if cid:
                responded_tool_call_ids.add(cid)

    valid_tool_call_ids = declared_tool_call_ids & responded_tool_call_ids

    sanitized: List[Dict[str, Any]] = []
    for msg in messages:
        role = str(msg.get("role", ""))
        if role == "assistant":
            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                sanitized.append(msg)
                continue
            kept_calls: List[Dict[str, Any]] = []
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                cid = str(call.get("id", "")).strip()
                if cid and cid in valid_tool_call_ids:
                    kept_calls.append(call)
            if kept_calls:
                msg_copy = dict(msg)
                msg_copy["tool_calls"] = kept_calls
                sanitized.append(msg_copy)
            else:
                # Remove dangling tool_calls but keep assistant content.
                msg_copy = dict(msg)
                msg_copy.pop("tool_calls", None)
                sanitized.append(msg_copy)
            continue

        if role == "tool":
            cid = str(msg.get("tool_call_id", "")).strip()
            if not cid or cid not in valid_tool_call_ids:
                continue
            sanitized.append(msg)
            continue

        sanitized.append(msg)
    return sanitized


def _iter_text_chunks(text: str, chunk_size: int = 16) -> List[str]:
    if chunk_size <= 0:
        chunk_size = 16
    return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]


def _extract_inline_tool_call(
    text: str, allowed_tool_names: set[str]
) -> Optional[Dict[str, Any]]:
    """
    Parse tool-like text (e.g. <tool_code>check_resources()</tool_code>)
    and convert it to one synthetic tool call payload.
    """
    if not text:
        return None
    snippet = text
    tag_block = re.search(r"<tool_code>\s*(.*?)\s*</tool_code>", text, re.S)
    if tag_block:
        snippet = tag_block.group(1).strip()

    # Find the first allowed tool call anywhere in the snippet.
    # This supports wrappers such as print(check_resources()).
    tool_name: Optional[str] = None
    raw_args = ""
    for name in sorted(allowed_tool_names, key=len, reverse=True):
        match = re.search(rf"\b{re.escape(name)}\s*\((.*?)\)", snippet, re.S)
        if match:
            tool_name = name
            raw_args = (match.group(1) or "").strip()
            break
    if not tool_name:
        return None

    if not raw_args:
        args_obj: Dict[str, Any] = {}
    else:
        # Allow JSON object in parentheses: foo({"a":1})
        try:
            parsed = json.loads(raw_args)
            args_obj = parsed if isinstance(parsed, dict) else {}
        except Exception:
            args_obj = {}
    return {"name": tool_name, "arguments": args_obj}


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
        messages.extend(_sanitize_context_messages(session.agent_messages[-16:]))
        messages.append({"role": "user", "content": user_input})
        session.agent_messages.append({"role": "user", "content": user_input})
        synced_session_message_count = len(session.agent_messages)
        session.chat_history.append({"role": "user", "content": user_input})
        status_query_total = 0
        last_status_query_signature: Optional[str] = None
        repeated_status_query_count = 0
        executed_tool_names: List[str] = []

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
                messages.extend(
                    _sanitize_context_messages(session.agent_messages[synced_session_message_count:])
                )
                synced_session_message_count = len(session.agent_messages)
            try:
                response = await asyncio.wait_for(
                    asyncio.to_thread(
                        self.llm.invoke,
                        messages,
                        tools=active_tools,
                        tool_choice="auto",
                        temperature=0.2,
                        max_tokens=1200,
                    ),
                    timeout=LLM_INVOKE_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                yield RuntimeEvent(
                    type=EventType.ERROR.value,
                    data={"text": f"模型响应超时（>{int(LLM_INVOKE_TIMEOUT_SECONDS)}s），请检查当前 provider/model/api_key 是否匹配。"},
                    agent_id=agent_id,
                )
                return
            except Exception as exc:
                yield RuntimeEvent(
                    type=EventType.ERROR.value,
                    data={"text": f"模型调用失败: {exc}"},
                    agent_id=agent_id,
                )
                return
            response_text = (response.content or "").strip()
            tool_calls = response.tool_calls or []
            if not tool_calls:
                inline_tool = _extract_inline_tool_call(response_text, allowed_tool_names)
                if inline_tool is not None:
                    tool_calls = [
                        {
                            "id": f"inline-{uuid.uuid4().hex[:8]}",
                            "type": "function",
                            "function": {
                                "name": inline_tool["name"],
                                "arguments": json.dumps(inline_tool["arguments"], ensure_ascii=False),
                            },
                        }
                    ]
            assistant_message: Dict[str, Any] = {"role": "assistant", "content": response_text}
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
            session.agent_messages.append(assistant_message)
            synced_session_message_count = len(session.agent_messages)

            if not tool_calls:
                if response_text.strip():
                    final_text = response_text.strip()
                    for tok in _iter_text_chunks(final_text):
                        if await _check_should_stop():
                            yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                            return
                        yield RuntimeEvent(type=EventType.TOKEN.value, data={"text": tok}, agent_id=agent_id)
                else:
                    streamed_text = ""
                    try:
                        token_queue: asyncio.Queue[str | None] = asyncio.Queue()

                        def _run_sync_stream() -> None:
                            try:
                                for chunk in self.llm.stream(messages, temperature=0.2, max_tokens=1200):
                                    tok = chunk if isinstance(chunk, str) else str(chunk.get("content", ""))
                                    if tok:
                                        token_queue.put_nowait(tok)
                            finally:
                                token_queue.put_nowait(None)

                        stream_task = asyncio.get_running_loop().run_in_executor(None, _run_sync_stream)

                        while True:
                            if await _check_should_stop():
                                stream_task.cancel()
                                yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                                return
                            try:
                                tok = await asyncio.wait_for(token_queue.get(), timeout=0.05)
                            except asyncio.TimeoutError:
                                continue
                            if tok is None:
                                break
                            streamed_text += tok
                            yield RuntimeEvent(type=EventType.TOKEN.value, data={"text": tok}, agent_id=agent_id)

                        await stream_task
                    except Exception:
                        streamed_text = response_text
                    final_text = streamed_text.strip() if streamed_text.strip() else response_text
                if not str(final_text).strip() and executed_tool_names:
                    unique_tools = ", ".join(dict.fromkeys(executed_tool_names))
                    final_text = (
                        "已完成工具调用（"
                        f"{unique_tools}）。\n"
                        "当前模型未返回进一步正文，请继续给我下一步指令。"
                    )
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
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": denied_message,
                        }
                    )
                    session.agent_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": denied_message,
                        }
                    )
                    synced_session_message_count = len(session.agent_messages)
                    session.chat_history.append(
                        {"role": "assistant", "content": f"工具结果({tool_name}):\n{denied_message}"}
                    )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": denied_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={"name": tool_name, "result": denied_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue
                if tool_name == "query_subagent_status":
                    status_query_total += 1
                    try:
                        signature = json.dumps(arguments, ensure_ascii=False, sort_keys=True)
                    except Exception:
                        signature = str(arguments)
                    if signature == last_status_query_signature:
                        repeated_status_query_count += 1
                    else:
                        last_status_query_signature = signature
                        repeated_status_query_count = 1
                    if status_query_total > 3 or repeated_status_query_count > 2:
                        throttled = (
                            "已阻止高频 query_subagent_status 轮询。"
                            "子智能体状态会通过 subagent_progress/subagent_completed 事件自动推送，"
                            "无需重复查询；请继续给出总结或下一步动作。"
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled,
                            }
                        )
                        session.agent_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled,
                            }
                        )
                        synced_session_message_count = len(session.agent_messages)
                        session.chat_history.append(
                            {"role": "assistant", "content": f"工具结果({tool_name}):\n{throttled}"}
                        )
                        yield RuntimeEvent(
                            type=EventType.TOOL_RESULT.value,
                            data={"name": tool_name, "result": throttled, "tool_call_id": tool_call_id},
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

                try:
                    result = await dispatch_task
                except Exception as exc:
                    result = f"ERROR: tool execution failed: {exc}"
                executed_tool_names.append(tool_name)
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
