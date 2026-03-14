#!/usr/bin/env python3
"""AgentRuntime core loop with structured event stream.

Author: Damon Li
"""

from __future__ import annotations

import json
import asyncio
import hashlib
import inspect
import os
import re
import uuid
from typing import TYPE_CHECKING, Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional, Sequence

from agenticx.cli.agent_tools import STUDIO_TOOLS, dispatch_tool_async
from agenticx.cli.studio_mcp import build_mcp_tools_context
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.runtime.compactor import ContextCompactor
from agenticx.runtime.confirm import ConfirmGate
from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.hooks import HookRegistry
from agenticx.runtime.loop_detector import LoopDetector

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession
else:
    StudioSession = Any


MAX_TOOL_ROUNDS = 10
MAX_CONTEXT_CHARS = 16_000
STOP_MESSAGE = "已中断当前生成"
DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS = 60.0
PROVIDER_INVOKE_TIMEOUT_SECONDS: Dict[str, float] = {
    # Some providers/models (especially tool-heavy rounds) often need longer first-token latency.
    "volcengine": 120.0,
    "bailian": 120.0,
    "zhipu": 90.0,
}
DEFAULT_LLM_FIRST_FEEDBACK_SECONDS = 8.0
PROVIDER_FIRST_FEEDBACK_SECONDS: Dict[str, float] = {
    "volcengine": 12.0,
    "bailian": 12.0,
    "zhipu": 10.0,
}


def _truncate(text: str, limit: int = MAX_CONTEXT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... (truncated, total {len(text)} chars)"


def _resolve_llm_invoke_timeout_seconds(session: StudioSession) -> float:
    env_raw = os.getenv("AGX_LLM_INVOKE_TIMEOUT_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    provider_name = str(getattr(session, "provider_name", "") or "").strip().lower()
    if provider_name and provider_name in PROVIDER_INVOKE_TIMEOUT_SECONDS:
        return PROVIDER_INVOKE_TIMEOUT_SECONDS[provider_name]
    return DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS


def _resolve_llm_first_feedback_seconds(session: StudioSession) -> float:
    env_raw = os.getenv("AGX_LLM_FIRST_FEEDBACK_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    provider_name = str(getattr(session, "provider_name", "") or "").strip().lower()
    if provider_name and provider_name in PROVIDER_FIRST_FEEDBACK_SECONDS:
        return PROVIDER_FIRST_FEEDBACK_SECONDS[provider_name]
    return DEFAULT_LLM_FIRST_FEEDBACK_SECONDS


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


def _serialize_todos(session: StudioSession) -> str:
    todo_manager = getattr(session, "todo_manager", None)
    if todo_manager is None:
        return "No todos."
    try:
        return str(todo_manager.render())
    except Exception:
        return "No todos."


def _serialize_scratchpad(session: StudioSession) -> str:
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict) or not scratchpad:
        return "(empty)"
    lines: List[str] = []
    for key in sorted(scratchpad.keys()):
        value = str(scratchpad.get(key, ""))
        preview = value if len(value) <= 200 else value[:200] + "..."
        lines.append(f"- {key}: {preview.replace(chr(10), ' ')}")
    return "\n".join(lines)


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
        "## 当前 Todo 列表\n"
        f"{_serialize_todos(session)}\n\n"
        "## 当前 Scratchpad 摘要\n"
        f"{_serialize_scratchpad(session)}\n\n"
        "## 当前 context_files\n"
        f"{_serialize_context_files(session)}\n\n"
        "## 当前 MCP 工具上下文\n"
        f"{_truncate(mcp_context, 6000)}\n\n"
        "## 安全与确认规则（必须遵守）\n"
        "- bash_exec 仅对白名单命令自动执行；非白名单命令必须先征得用户确认。\n"
        "- file_write 与 file_edit 必须先展示 unified diff，再征得用户确认。\n"
        "- 当信息不足、需求含糊、或操作有副作用时，优先使用 ask_user。\n"
        "- 多步骤任务优先使用 todo_write 跟踪进度，保持只有一个 in_progress。\n"
        "- 对中间结果优先写入 scratchpad_write，后续步骤先 scratchpad_read 复用。\n"
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
    sanitized: List[Dict[str, Any]] = []
    idx = 0
    total = len(messages)

    while idx < total:
        msg = messages[idx]
        role = str(msg.get("role", ""))

        if role != "assistant":
            # Tool messages are only valid as contiguous responses immediately
            # following an assistant tool_calls message. Standalone tool rows are dropped.
            if role != "tool":
                sanitized.append(msg)
            idx += 1
            continue

        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            sanitized.append(msg)
            idx += 1
            continue

        expected_ids: set[str] = set()
        call_map: Dict[str, Dict[str, Any]] = {}
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            cid = str(call.get("id", "")).strip()
            if not cid:
                continue
            expected_ids.add(cid)
            call_map[cid] = call

        # Collect contiguous tool responses right after this assistant turn.
        j = idx + 1
        contiguous_tool_rows: List[Dict[str, Any]] = []
        responded_ids: set[str] = set()
        while j < total:
            next_msg = messages[j]
            if str(next_msg.get("role", "")) != "tool":
                break
            cid = str(next_msg.get("tool_call_id", "")).strip()
            if cid and cid in expected_ids:
                contiguous_tool_rows.append(next_msg)
                responded_ids.add(cid)
            j += 1

        kept_calls: List[Dict[str, Any]] = []
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            cid = str(call.get("id", "")).strip()
            if cid and cid in responded_ids and cid in call_map:
                kept_calls.append(call_map[cid])
        if kept_calls:
            msg_copy = dict(msg)
            msg_copy["tool_calls"] = kept_calls
            sanitized.append(msg_copy)
            sanitized.extend(contiguous_tool_rows)
        else:
            # Remove dangling tool_calls but keep assistant content text.
            msg_copy = dict(msg)
            msg_copy.pop("tool_calls", None)
            sanitized.append(msg_copy)

        # Skip contiguous tool block, whether kept or dropped.
        idx = j

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


def _build_progress_signature(session: StudioSession) -> str:
    artifacts = getattr(session, "artifacts", {}) or {}
    artifact_entries = []
    for key, value in artifacts.items():
        sval = str(value)
        digest = hashlib.sha1(sval.encode("utf-8")).hexdigest()[:12] if sval else ""
        artifact_entries.append({"path": str(key), "len": len(sval), "hash": digest})
    artifact_entries.sort(key=lambda item: item["path"])
    scratchpad = getattr(session, "scratchpad", {}) or {}
    scratch_entries = []
    if isinstance(scratchpad, dict):
        for key, value in scratchpad.items():
            sval = str(value)
            digest = hashlib.sha1(sval.encode("utf-8")).hexdigest()[:12] if sval else ""
            scratch_entries.append({"key": str(key), "len": len(sval), "hash": digest})
    scratch_entries.sort(key=lambda item: item["key"])
    todo_payload: List[Dict[str, Any]] = []
    todo_manager = getattr(session, "todo_manager", None)
    if todo_manager is not None:
        try:
            todo_payload = list(todo_manager.to_payload())
        except Exception:
            todo_payload = []
    context_entries = []
    context_files = getattr(session, "context_files", {}) or {}
    if isinstance(context_files, dict):
        for key, value in context_files.items():
            sval = str(value)
            digest = hashlib.sha1(sval.encode("utf-8")).hexdigest()[:12] if sval else ""
            context_entries.append({"path": str(key), "len": len(sval), "hash": digest})
    context_entries.sort(key=lambda item: item["path"])
    raw = json.dumps(
        {
            "artifacts": artifact_entries,
            "scratchpad": scratch_entries,
            "todos": todo_payload,
            "context_files": context_entries,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class AgentRuntime:
    """LLM-driven runtime that emits structured events."""

    def __init__(
        self,
        llm: Any,
        confirm_gate: ConfirmGate,
        *,
        max_tool_rounds: int = MAX_TOOL_ROUNDS,
        hooks: Optional[HookRegistry] = None,
        team_manager: Optional[Any] = None,
    ) -> None:
        self.llm = llm
        self.confirm_gate = confirm_gate
        self.max_tool_rounds = max_tool_rounds
        self.hooks = hooks or HookRegistry()
        self.compactor = ContextCompactor(llm)
        self.loop_detector = LoopDetector()
        self.team_manager = team_manager
        try:
            from agenticx.runtime.hooks.memory_hook import MemoryHook
            self.hooks.register(MemoryHook(), priority=-10)
        except Exception:
            pass

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
        history = _sanitize_context_messages(session.agent_messages)
        compacted_history, did_compact, compact_summary, compacted_count = await self.compactor.maybe_compact(history)
        messages: List[Dict[str, Any]] = [{"role": "system", "content": current_system_prompt}]
        messages.extend(compacted_history)
        if did_compact:
            yield RuntimeEvent(
                type=EventType.COMPACTION.value,
                data={
                    "compacted_count": compacted_count,
                    "summary": compact_summary,
                },
                agent_id=agent_id,
            )
            await self.hooks.run_on_compaction(compacted_count, compact_summary, session)
        _is_system_trigger = user_input.startswith("[系统通知]")
        messages.append({"role": "user", "content": user_input})
        session.agent_messages.append({"role": "user", "content": user_input})
        synced_session_message_count = len(session.agent_messages)
        if not _is_system_trigger:
            session.chat_history.append({"role": "user", "content": user_input})
        status_query_total = 0
        last_status_query_signature: Optional[str] = None
        repeated_status_query_count = 0
        executed_tool_names: List[str] = []
        rounds_without_todo = 0
        invoke_timeout_seconds = _resolve_llm_invoke_timeout_seconds(session)
        first_feedback_seconds = _resolve_llm_first_feedback_seconds(session)
        provider_name = str(getattr(session, "provider_name", "") or "").strip()
        model_name = str(getattr(session, "model_name", "") or "").strip()

        for round_idx in range(1, self.max_tool_rounds + 1):
            if await _check_should_stop():
                yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                return
            yield RuntimeEvent(
                type=EventType.ROUND_START.value,
                data={"round": round_idx, "max_rounds": self.max_tool_rounds},
                agent_id=agent_id,
            )
            if agent_id != "meta" and round_idx > 1 and (round_idx - 1) % 8 == 0:
                checkpoint = {
                    "agent_id": agent_id,
                    "round": round_idx - 1,
                    "max_rounds": self.max_tool_rounds,
                    "executed_tools": list(dict.fromkeys(executed_tool_names))[-10:],
                    "artifact_count": len(session.artifacts),
                    "text": f"已执行至第 {round_idx - 1} 轮，准备继续。",
                }
                yield RuntimeEvent(
                    type=EventType.SUBAGENT_CHECKPOINT.value,
                    data=checkpoint,
                    agent_id=agent_id,
                )
            if len(session.agent_messages) > synced_session_message_count:
                messages.extend(
                    _sanitize_context_messages(session.agent_messages[synced_session_message_count:])
                )
                synced_session_message_count = len(session.agent_messages)
            if rounds_without_todo > 10:
                messages.append(
                    {
                        "role": "user",
                        "content": "<reminder>10+ rounds without todo_write. Please update todo list.</reminder>",
                    }
                )
            try:
                messages = await self.hooks.run_before_model(messages, session)
                messages = _sanitize_context_messages(messages)
                invoke_task = asyncio.create_task(
                    asyncio.to_thread(
                        self.llm.invoke,
                        messages,
                        tools=active_tools,
                        tool_choice="auto",
                        temperature=0.2,
                        max_tokens=1200,
                    )
                )
                wait_started_at = asyncio.get_running_loop().time()
                waiting_hint_emitted = False
                last_pulse_at = wait_started_at
                while True:
                    if invoke_task.done():
                        response = await invoke_task
                        break
                    now = asyncio.get_running_loop().time()
                    elapsed = now - wait_started_at
                    if (not waiting_hint_emitted) and elapsed >= first_feedback_seconds:
                        waiting_hint_emitted = True
                        last_pulse_at = now
                        # UI feedback before first model output; FINAL event will overwrite this placeholder.
                        yield RuntimeEvent(
                            type=EventType.TOKEN.value,
                            data={"text": "⏳"},
                            agent_id=agent_id,
                        )
                    elif waiting_hint_emitted and (now - last_pulse_at) >= 3.0:
                        last_pulse_at = now
                        yield RuntimeEvent(
                            type=EventType.TOKEN.value,
                            data={"text": "…"},
                            agent_id=agent_id,
                        )
                    if elapsed >= invoke_timeout_seconds:
                        invoke_task.cancel()
                        raise asyncio.TimeoutError()
                    await asyncio.sleep(0.1)
                await self.hooks.run_after_model(response, session)
            except asyncio.TimeoutError:
                provider_hint = provider_name or "(unknown)"
                model_hint = model_name or "(unknown)"
                yield RuntimeEvent(
                    type=EventType.ERROR.value,
                    data={
                        "text": (
                            f"模型响应超时（>{int(invoke_timeout_seconds)}s，provider={provider_hint}, model={model_hint}）。"
                            "当前轮为工具可调用模式，模型可能在内部思考/函数规划后才返回。"
                            "可切换更快模型，或提高 AGX_LLM_INVOKE_TIMEOUT_SECONDS。"
                        )
                    },
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
                if not _is_system_trigger:
                    session.chat_history.append({"role": "assistant", "content": final_text})
                await self.hooks.run_on_agent_end(final_text, session)
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
            if not _is_system_trigger:
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
                hook_outcome = await self.hooks.run_before_tool_call(tool_name, arguments, session)
                if hook_outcome.blocked:
                    blocked_message = hook_outcome.reason or f"工具 {tool_name} 被策略阻止。"
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": blocked_message,
                        }
                    )
                    session.agent_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": blocked_message,
                        }
                    )
                    synced_session_message_count = len(session.agent_messages)
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": blocked_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue
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
                    if not _is_system_trigger:
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
                    if status_query_total > 2 or repeated_status_query_count > 1:
                        throttled = (
                            "【已阻止】query_subagent_status 调用过于频繁，本次调用被拦截。\n"
                            "⚠️ 你必须立即停止查询并执行以下操作之一：\n"
                            "1) 如果子智能体仍在运行 → 直接告知用户任务正在后台执行，结束本轮对话，等待完成事件。\n"
                            "2) 如果子智能体已完成 → 根据已知信息汇报结果，不再查询。\n"
                            "3) 如果不确定 → 告知用户「任务已提交，完成后会自动通知」，结束本轮。\n"
                            "禁止再次调用 query_subagent_status，否则将继续被拦截并消耗轮次配额。"
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
                        if not _is_system_trigger:
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

                before_progress = _build_progress_signature(session)
                effective_tm = self.team_manager or getattr(session, "_team_manager", None)
                dispatch_task = asyncio.create_task(
                    dispatch_tool_async(
                        tool_name,
                        dispatch_arguments,
                        session,
                        confirm_gate=self.confirm_gate,
                        event_callback=_on_tool_event,
                        team_manager=effective_tm,
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
                result = await self.hooks.run_after_tool_call(tool_name, result, session)
                if tool_name == "todo_write":
                    rounds_without_todo = 0
                else:
                    rounds_without_todo += 1
                executed_tool_names.append(tool_name)
                after_progress = _build_progress_signature(session)
                self.loop_detector.record_call(
                    tool_name,
                    LoopDetector.args_signature(arguments),
                    has_progress=(before_progress != after_progress),
                )
                loop_issue = self.loop_detector.check()
                if loop_issue is not None:
                    reminder = (
                        f"[loop-{loop_issue.level}] {loop_issue.message} "
                        "请调整策略：改用不同工具、读取更多上下文，或先总结当前结论。"
                    )
                    messages.append({"role": "user", "content": reminder})
                    if loop_issue.level == "critical":
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={"text": reminder, "detector": loop_issue.detector},
                            agent_id=agent_id,
                        )
                        return
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
                if not _is_system_trigger:
                    session.chat_history.append(
                        {"role": "assistant", "content": f"工具结果({tool_name}):\n{result}"}
                    )
                yield RuntimeEvent(
                    type=EventType.TOOL_RESULT.value,
                    data={"name": tool_name, "result": result, "tool_call_id": tool_call_id},
                    agent_id=agent_id,
                )

        message = (
            "已达到最大工具调用轮数，已暂停自动执行。"
            "请基于当前结果继续指示，或缩小任务范围。"
        )
        if agent_id == "meta":
            await self.hooks.run_on_agent_end(message, session)
            yield RuntimeEvent(type=EventType.ERROR.value, data={"text": message}, agent_id=agent_id)
            return
        await self.hooks.run_on_agent_end(message, session)
        yield RuntimeEvent(
            type=EventType.SUBAGENT_PAUSED.value,
            data={
                "agent_id": agent_id,
                "round": self.max_tool_rounds,
                "max_rounds": self.max_tool_rounds,
                "text": message,
                "executed_tools": list(dict.fromkeys(executed_tool_names))[-10:],
            },
            agent_id=agent_id,
        )
