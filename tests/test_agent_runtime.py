#!/usr/bin/env python3
"""Tests for AgentRuntime event stream behavior."""

from __future__ import annotations

from typing import Any, Dict, List

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _ToolThenFinalLLM:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                "need tool",
                [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "bash_exec", "arguments": {"command": "rm -rf /tmp/demo"}},
                    }
                ],
            )
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield "done"


class _AlwaysToolLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse(
            "loop",
            [
                {
                    "id": "call-x",
                    "type": "function",
                    "function": {"name": "list_files", "arguments": {"path": ".", "limit": 1}},
                }
            ],
        )

    def stream(self, *_args, **_kwargs):
        yield ""


class _AlwaysStatusQueryLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse(
            "checking",
            [
                {
                    "id": "call-status",
                    "type": "function",
                    "function": {
                        "name": "query_subagent_status",
                        "arguments": {},
                    },
                }
            ],
        )

    def stream(self, *_args, **_kwargs):
        yield ""


class _TextOnlyLLM:
    def invoke(self, *_args, **_kwargs):
        # Empty invoke text forces the stream fallback path (TOKEN chunks then FINAL).
        return _FakeResponse("", [])

    def stream(self, *_args, **_kwargs):
        yield "tok1"
        yield "tok2"


class _RateLimitLLM:
    def invoke(self, *_args, **_kwargs):
        raise RuntimeError("RateLimitError: rate limit reached")

    def stream(self, *_args, **_kwargs):
        yield ""


class _CaptureMessagesLLM:
    def __init__(self) -> None:
        self.messages: List[Dict[str, Any]] = []

    def invoke(self, messages, **_kwargs):
        self.messages = [dict(item) for item in messages]
        return _FakeResponse("ok", [])


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


async def _collect(runtime: AgentRuntime, session: StudioSession, text: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    async for event in runtime.run_turn(text, session):
        items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
    return items


class _InvalidToolNameLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse(
            "bad tool call",
            [
                {
                    "id": "call-invalid",
                    "type": "function",
                    "function": {"name": None, "arguments": {}},
                }
            ],
        )

    def stream(self, *_args, **_kwargs):
        yield ""


def test_runtime_event_flow_tool_confirm_result_final(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_ToolThenFinalLLM(), _ApproveGate())
    session = StudioSession()
    checkpoints: list[list[Dict[str, Any]]] = []

    def _persist() -> None:
        checkpoints.append([dict(row) for row in session.chat_history])

    runtime._mid_turn_persist = _persist  # type: ignore[attr-defined]
    events = __import__("asyncio").run(_collect(runtime, session, "do it"))

    types = [e["type"] for e in events]
    assert all(e["agent_id"] == "meta" for e in events)
    assert EventType.ROUND_START.value in types
    assert EventType.TOOL_CALL.value in types
    assert EventType.TOOL_RESULT.value in types
    assert EventType.FINAL.value in types
    assert checkpoints
    assert any(row.get("role") == "tool" for row in checkpoints[-1])
    assert checkpoints[-1][-1] == {"role": "assistant", "content": "done"}


def test_runtime_max_rounds_emits_error(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_AlwaysToolLLM(), _ApproveGate(), max_tool_rounds=2)
    events = __import__("asyncio").run(_collect(runtime, StudioSession(), "loop"))
    assert all(e["agent_id"] == "meta" for e in events)
    assert events[-1]["type"] == EventType.ERROR.value


def test_runtime_text_only_emits_tokens_then_final() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())
    events = __import__("asyncio").run(_collect(runtime, StudioSession(), "hello"))
    types = [e["type"] for e in events]
    assert all(e["agent_id"] == "meta" for e in events)
    assert EventType.TOKEN.value in types
    assert events[-1]["type"] == EventType.FINAL.value


def test_runtime_synthetic_final_is_added_before_checkpoint() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())
    session = StudioSession()
    persisted: list[list[Dict[str, Any]]] = []

    def _persist() -> None:
        persisted.append([dict(row) for row in session.chat_history])

    runtime._mid_turn_persist = _persist  # type: ignore[attr-defined]
    runtime._append_terminal_assistant(
        session,
        "状态查询达到预算上限，已停止轮询。",
        is_system_trigger=False,
    )
    runtime._persist_final_checkpoint()

    assert session.agent_messages[-1]["content"] == "状态查询达到预算上限，已停止轮询。"
    assert session.chat_history[-1]["content"] == "状态查询达到预算上限，已停止轮询。"
    assert persisted[-1][-1]["content"] == "状态查询达到预算上限，已停止轮询。"


def test_runtime_status_query_synthetic_final_is_checkpointed() -> None:
    runtime = AgentRuntime(_AlwaysStatusQueryLLM(), _ApproveGate())
    session = StudioSession()
    checkpoints: list[list[Dict[str, Any]]] = []
    tools = [
        {
            "type": "function",
            "function": {
                "name": "query_subagent_status",
                "description": "Query status",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    def _persist() -> None:
        checkpoints.append([dict(row) for row in session.chat_history])

    runtime._mid_turn_persist = _persist  # type: ignore[attr-defined]

    async def _run() -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []
        async for event in runtime.run_turn("check status", session, tools=tools):
            events.append({"type": event.type, "data": event.data})
        return events

    events = __import__("asyncio").run(_run())

    assert events[-1]["type"] == EventType.FINAL.value
    assert checkpoints
    assert checkpoints[-1][-1]["role"] == "assistant"
    assert checkpoints[-1][-1]["content"] == events[-1]["data"]["text"]


def test_runtime_stream_fallback_syncs_agent_messages_with_chat_history() -> None:
    """Empty invoke + stream fallback must not leave agent_messages assistant blank."""
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())
    session = StudioSession()
    events = __import__("asyncio").run(_collect(runtime, session, "hello"))
    assert events[-1]["type"] == EventType.FINAL.value
    assert events[-1]["data"]["text"] == "tok1tok2"
    assert session.chat_history[-1] == {"role": "assistant", "content": "tok1tok2"}
    assert session.agent_messages[-1] == {"role": "assistant", "content": "tok1tok2"}


def test_runtime_should_stop_interrupts_generation() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())
    calls = {"n": 0}

    async def _should_stop() -> bool:
        calls["n"] += 1
        return calls["n"] >= 2

    async def _collect_interrupt() -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for event in runtime.run_turn("hello", StudioSession(), should_stop=_should_stop):
            items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
        return items

    events = __import__("asyncio").run(_collect_interrupt())
    assert any(e["type"] == EventType.ROUND_START.value for e in events)
    assert events[-1]["type"] == EventType.ERROR.value
    assert events[-1]["agent_id"] == "meta"
    assert events[-1]["data"]["text"] == "已中断当前生成"
    assert not any(e["type"] == EventType.FINAL.value for e in events)


def test_runtime_accepts_custom_agent_id() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())

    async def _collect_custom() -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for event in runtime.run_turn("hello", StudioSession(), agent_id="sa-1"):
            items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
        return items

    events = __import__("asyncio").run(_collect_custom())
    assert events
    assert all(e["agent_id"] == "sa-1" for e in events)


def test_runtime_rate_limit_pauses_subagent(monkeypatch) -> None:
    monkeypatch.setenv("AGX_LLM_RETRY_RATE_LIMIT", "0")
    runtime = AgentRuntime(_RateLimitLLM(), _ApproveGate())

    async def _collect_rate_limited() -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for event in runtime.run_turn("long task", StudioSession(), agent_id="worker-1"):
            items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
        return items

    events = __import__("asyncio").run(_collect_rate_limited())
    assert events[-1]["type"] == EventType.SUBAGENT_PAUSED.value
    assert events[-1]["agent_id"] == "worker-1"
    assert events[-1]["data"]["detector"] == "rate_limit"
    assert events[-1]["data"]["retryable"] is True


def test_runtime_minimax_does_not_send_non_initial_system_messages() -> None:
    llm = _CaptureMessagesLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    session.provider_name = "minimax"
    session.model_name = "MiniMax-M2.7"

    events = __import__("asyncio").run(_collect(runtime, session, "hello"))

    assert events[-1]["type"] == EventType.FINAL.value
    assert llm.messages
    assert llm.messages[0]["role"] == "system"
    assert all(message.get("role") != "system" for message in llm.messages[1:])


def test_runtime_rejects_tool_outside_allowlist(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    called = {"n": 0}

    async def _fake_dispatch(*_args, **_kwargs):
        called["n"] += 1
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_ToolThenFinalLLM(), _ApproveGate())
    allow_only_list_files = [
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    async def _collect_blocked() -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for event in runtime.run_turn("do it", StudioSession(), tools=allow_only_list_files):
            items.append({"type": event.type, "data": event.data, "agent_id": event.agent_id})
        return items

    events = __import__("asyncio").run(_collect_blocked())
    assert called["n"] == 0
    assert any("不在当前允许列表" in str(e["data"].get("text", "")) for e in events if e["type"] == EventType.ERROR.value)


def test_runtime_handles_invalid_tool_name_without_none_noise(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    called = {"n": 0}

    async def _fake_dispatch(*_args, **_kwargs):
        called["n"] += 1
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    runtime = AgentRuntime(_InvalidToolNameLLM(), _ApproveGate())
    events = __import__("asyncio").run(_collect(runtime, StudioSession(), "who is cole"))

    assert called["n"] == 0
    error_texts = [str(e["data"].get("text", "")) for e in events if e["type"] == EventType.ERROR.value]
    assert not any("Tool 'None'" in text or "工具 'None'" in text for text in error_texts)


def test_summarize_tool_calls_for_history_removes_runtime_ids() -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    tool_calls = [
        {
            "id": "call_abc123",
            "type": "function",
            "function": {
                "name": "file_write",
                "arguments": "{\"path\":\"demo.py\",\"content\":\"print('ok')\"}",
            },
        }
    ]
    summary = runtime_module._summarize_tool_calls_for_history(tool_calls)
    assert summary == [
        {
            "name": "file_write",
            "arguments": {"path": "demo.py", "content": "print('ok')"},
        }
    ]
    assert "call_abc123" not in str(summary)


def test_sanitize_context_messages_drops_empty_assistant_without_tools() -> None:
    from agenticx.runtime.agent_runtime import _sanitize_context_messages

    history = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": ""},
        {"role": "user", "content": "forwarded card"},
    ]
    sanitized = _sanitize_context_messages(history)
    assert sanitized == [
        {"role": "user", "content": "hello"},
        {"role": "user", "content": "forwarded card"},
    ]


async def test_skip_user_history_still_persists_display_user() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())
    session = StudioSession()
    persisted: list[int] = []

    def _persist() -> None:
        persisted.append(len(session.chat_history))

    runtime._mid_turn_persist = _persist  # type: ignore[attr-defined]

    async for _ in runtime.run_turn(
        "能不能听到？",
        session,
        persist_user_message=False,
    ):
        pass

    user_rows = [m for m in session.agent_messages if m.get("role") == "user"]
    assert user_rows == []
    assert session.chat_history[0] == {"role": "user", "content": "能不能听到？"}
    assert persisted == [1, 2]
    assert session.chat_history[-1] == {"role": "assistant", "content": "tok1tok2"}


async def test_skip_user_history_dedupes_existing_tail_user() -> None:
    runtime = AgentRuntime(_TextOnlyLLM(), _ApproveGate())
    session = StudioSession()
    session.chat_history = [{"role": "user", "content": "能不能听到？"}]

    async for _ in runtime.run_turn(
        "能不能听到？",
        session,
        persist_user_message=False,
    ):
        pass

    user_rows = [m for m in session.chat_history if m.get("role") == "user"]
    assert len(user_rows) == 1
    assert user_rows[0]["content"] == "能不能听到？"


def test_sanitize_context_messages_placeholders_empty_assistant_with_tools() -> None:
    from agenticx.runtime.agent_runtime import _sanitize_context_messages

    history = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "bash_exec", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call-1", "content": "ok"},
    ]
    sanitized = _sanitize_context_messages(history)
    assert len(sanitized) == 2
    assert sanitized[0]["role"] == "assistant"
    assert sanitized[0]["content"] == " "
    assert sanitized[0]["tool_calls"]


def test_should_emit_show_widget_delta_first_frame_and_throttle() -> None:
    from agenticx.runtime.agent_runtime import _should_emit_show_widget_delta

    state: Dict[int, Dict[str, float]] = {}
    assert _should_emit_show_widget_delta(state, 0, "", now_mono=1.0) is True
    # No growth: do not emit repeatedly.
    assert _should_emit_show_widget_delta(state, 0, "", now_mono=1.2) is False
    # Small growth + short interval: still throttled.
    assert _should_emit_show_widget_delta(state, 0, "x" * 100, now_mono=1.06) is False
    # Enough interval: emit.
    assert _should_emit_show_widget_delta(state, 0, "x" * 100, now_mono=1.2) is True
    # Large growth: emit even before interval threshold.
    huge = "x" * 1200
    assert _should_emit_show_widget_delta(state, 0, huge, now_mono=1.25) is True


def test_should_emit_show_widget_delta_force_flush_only_when_new_data() -> None:
    from agenticx.runtime.agent_runtime import _should_emit_show_widget_delta

    state: Dict[int, Dict[str, float]] = {}
    assert _should_emit_show_widget_delta(state, 1, "", now_mono=2.0) is True
    assert _should_emit_show_widget_delta(state, 1, "", force=True, now_mono=2.1) is False
    assert _should_emit_show_widget_delta(state, 1, "<svg", force=True, now_mono=2.2) is True
