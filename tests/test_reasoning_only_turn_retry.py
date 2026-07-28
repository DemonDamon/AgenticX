#!/usr/bin/env python3
"""Tests for tool-turn premature end fix: reasoning-only empty turn nudge retry.

Covers FR-2 (reasoning-only detection + nudge retry), FR-2a (补救 logic uses
visible_text), FR-4 (content回退改为 _clean_body, no < Mattis> leak), and the
stream-fallback dict-chunk text-key fix.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.agent_runtime import _turn_has_external_context
from agenticx.runtime.truncated_final import reasoning_has_action_intent

_THINK_OPEN = chr(60) + "think" + chr(62)
_THINK_CLOSE = chr(60) + "/think" + chr(62)


class _FakeResponse:
    def __init__(self, content: str, tool_calls, reasoning_content: str = ""):
        self.content = content
        self.tool_calls = tool_calls
        self.reasoning_content = reasoning_content


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _ReasoningInContentThenReply:
    """1st invoke: reasoning-only in content. 2nd invoke: real reply."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(_THINK_OPEN + "需要继续" + _THINK_CLOSE, [])
        return _FakeResponse("已查到价格表", [])

    def stream(self, *_args, **_kwargs):
        yield _THINK_OPEN + "需要继续" + _THINK_CLOSE


class _ReasoningInSeparateFieldThenReply:
    """1st invoke: empty content + reasoning_content. 2nd invoke: real reply."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse("", [], reasoning_content="需要继续")
        return _FakeResponse("已查到价格表", [])

    def stream(self, *_args, **_kwargs):
        yield {"type": "content", "text": _THINK_OPEN + "需要继续" + _THINK_CLOSE}


class _AlwaysReasoningOnly:
    """Every invoke returns reasoning-only; nudge exhausts, turn ends empty."""

    def invoke(self, *_args, **_kwargs):
        return _FakeResponse(_THINK_OPEN + "只会思考" + _THINK_CLOSE, [])

    def stream(self, *_args, **_kwargs):
        yield _THINK_OPEN + "只会思考" + _THINK_CLOSE


class _SeparateReasoningOnlyWithEmptyStream:
    """Return only a provider reasoning field and no streaming chunks."""

    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("", [], reasoning_content="我在想")

    def stream(self, *_args, **_kwargs):
        if False:
            yield ""


class _ReasoningThenEmptyResponse:
    """Emit reasoning once, then return a fully empty nudge response."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(_THINK_OPEN + "第一轮思考" + _THINK_CLOSE, [])
        return _FakeResponse("", [])

    def stream(self, *_args, **_kwargs):
        if self.calls == 1:
            yield _THINK_OPEN + "第一轮思考" + _THINK_CLOSE


class _NormalReasoningPlusBody:
    """reasoning + body in one turn; must NOT trigger nudge."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        return _FakeResponse(_THINK_OPEN + "思考" + _THINK_CLOSE + "这是回复", [])

    def stream(self, *_args, **_kwargs):
        yield _THINK_OPEN + "思考" + _THINK_CLOSE + "这是回复"


class _CapturedReasoningThenReply:
    """Capture each invoke tool projection around a reasoning-only retry."""

    def __init__(self, reasoning: str = "继续思考") -> None:
        self.calls = 0
        self.reasoning = reasoning
        self.tools_seen: List[List[Dict[str, Any]]] = []
        self.messages_seen: List[List[Dict[str, Any]]] = []

    def invoke(self, messages, *_args, **kwargs):
        self.calls += 1
        self.tools_seen.append(list(kwargs.get("tools") or []))
        self.messages_seen.append(list(messages))
        if self.calls == 1:
            return _FakeResponse("", [], reasoning_content=self.reasoning)
        return _FakeResponse("这是可见回复。", [])

    def stream(self, *_args, **_kwargs):
        if False:
            yield ""


class _ShortTruncatedThenReply:
    """First turn is a short action-intent stub; the retry completes it."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                "团长，这条信息涉及具体发布日期、定价和竞品对比",
                [],
                reasoning_content="I need to search the web to verify this. Let me do that.",
            )
        return _FakeResponse("这条说法并不成立，我已核实官方来源。", [])

    def stream(self, *_args, **_kwargs):
        if self.calls == 1:
            yield {
                "type": "content",
                "text": "团长，这条信息涉及具体发布日期、定价和竞品对比",
            }
        else:
            yield {"type": "content", "text": "这条说法并不成立，我已核实官方来源。"}


class _AlwaysShortTruncated:
    """Both attempts are short action-intent stubs; retry must stop after one."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        return _FakeResponse(
            "团长，这条信息涉及具体发布日期、定价和竞品对比",
            [],
            reasoning_content="I need to search the web to verify this. Let me do that.",
        )

    def stream(self, *_args, **_kwargs):
        yield {
            "type": "content",
            "text": "团长，这条信息涉及具体发布日期、定价和竞品对比",
        }


class _ToolThenReasoningOnlyThenStillReasoning:
    """1st: tool_call; then keep reasoning-only until post-tool budget (3) exhausts."""

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
                        "function": {"name": "list_files", "arguments": {"path": "."}},
                    }
                ],
            )
        return _FakeResponse(_THINK_OPEN + "还在思考" + _THINK_CLOSE, [])

    def stream(self, *_args, **_kwargs):
        yield _THINK_OPEN + "还在思考" + _THINK_CLOSE


class _ToolThenTwoReasoningOnlyThenReply:
    """Tool success, two reasoning-only nudges, then a visible reply."""

    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                "",
                [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "list_files", "arguments": {"path": "."}},
                    }
                ],
            )
        if self.calls <= 3:
            return _FakeResponse(_THINK_OPEN + "还在想" + _THINK_CLOSE, [])
        return _FakeResponse("根据工具结果：目录已列出。", [])

    def stream(self, *_args, **_kwargs):
        if self.calls <= 3:
            yield _THINK_OPEN + "还在想" + _THINK_CLOSE
        else:
            yield "根据工具结果：目录已列出。"


class _TextOnlyDictStream:
    """stream yields dict chunks with text key; verifies stream-fallback tok fix."""

    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("", [])

    def stream(self, *_args, **_kwargs):
        yield {"type": "content", "text": "hello "}
        yield {"type": "content", "text": "world"}


async def _collect(runtime: AgentRuntime, session: StudioSession, text: Any) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    async for event in runtime.run_turn(text, session):
        items.append({"type": event.type, "data": event.data})
    return items


async def _collect_with_tools(
    runtime: AgentRuntime,
    session: StudioSession,
    text: Any,
    tools: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    async for event in runtime.run_turn(text, session, tools=tools):
        items.append({"type": event.type, "data": event.data})
    return items


def _final_text(events: List[Dict[str, Any]]) -> str:
    finals = [e for e in events if e["type"] == EventType.FINAL.value]
    return finals[-1]["data"].get("text", "") if finals else ""


def test_reasoning_in_content_triggers_nudge_then_real_reply() -> None:
    """FR-2: reasoning-only in content triggers nudge; 2nd invoke gives real reply."""
    llm = _ReasoningInContentThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    assert llm.calls == 2, "nudge should trigger a 2nd invoke"
    assert _final_text(events) == "已查到价格表"
    last = session.chat_history[-1]
    assert last["role"] == "assistant"
    assert last["content"] == "已查到价格表"
    assert _THINK_OPEN not in last["content"], "content must not leak < Mattis>"
    assistant_rows = [
        message
        for message in session.agent_messages
        if message.get("role") == "assistant"
    ]
    assert len(assistant_rows) == 2
    assert assistant_rows[0]["content"] == " "
    assert assistant_rows[0]["reasoning_content"] == "需要继续"


def test_reasoning_in_separate_field_triggers_nudge_then_real_reply() -> None:
    """FR-2: reasoning in reasoning_content (empty content) also triggers nudge."""
    llm = _ReasoningInSeparateFieldThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    assert llm.calls == 2
    assert _final_text(events) == "已查到价格表"
    last = session.chat_history[-1]
    assert last["content"] == "已查到价格表"
    assert _THINK_OPEN not in last["content"]


def test_reasoning_only_exhausts_nudge_emits_visible_retry_fallback() -> None:
    """After one nudge, reasoning-only turns emit a non-empty neutral fallback."""
    llm = _AlwaysReasoningOnly()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    final = _final_text(events)
    assert final.strip(), "FINAL text must be non-empty after nudge exhausts"
    assert "未能生成完整的可见回复" in final
    last = session.chat_history[-1]
    assert last["role"] == "assistant"
    assert last["content"] == final
    assert last.get("metadata", {}).get("turn_terminal") is True
    assert last["reasoning"] == "只会思考"
    assert last["metadata"]["terminal_reason"] == "empty_response_fallback"
    assert last["metadata"]["model_finish_reason"] == "unknown"
    assert last["metadata"]["protocol_errors"] == []
    assert _THINK_OPEN not in last["content"]


def test_sync_fallback_empty_turn_persists_provider_reasoning() -> None:
    """A sync-fallback terminal response preserves provider reasoning."""
    runtime = AgentRuntime(_SeparateReasoningOnlyWithEmptyStream(), _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    final = _final_text(events)
    last = session.chat_history[-1]

    assert "未能生成完整的可见回复" in final
    assert last["content"] == final
    assert last["reasoning"] == "我在想"
    assert last["metadata"]["terminal_reason"] == "empty_response_fallback"
    assert last["metadata"]["model_finish_reason"] == "unknown"


def test_empty_nudge_response_preserves_prior_reasoning() -> None:
    """A silent nudge response retains the reasoning from the prior round."""
    llm = _ReasoningThenEmptyResponse()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "继续"))
    final = _final_text(events)
    last = session.chat_history[-1]

    assert llm.calls == 2
    assert "未能生成完整的可见回复" in final
    assert last["reasoning"] == "第一轮思考"
    assert last["metadata"]["terminal_reason"] == "empty_response_fallback"


def test_normal_reasoning_plus_body_does_not_trigger_nudge() -> None:
    """NFR-1: normal reasoning+body turn must not trigger nudge (single invoke)."""
    llm = _NormalReasoningPlusBody()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "hi"))
    assert llm.calls == 1, "normal turn must not trigger nudge"
    assert _final_text(events) == "这是回复"
    last = session.chat_history[-1]
    assert last["content"] == "这是回复"
    assert last["metadata"]["model_finish_reason"] == "unknown"
    assert last["metadata"]["body_len"] == len("这是回复")
    assert last["metadata"]["had_tool_calls"] is False
    assert _THINK_OPEN not in last["content"]


def test_action_intent_helper_reuses_truncated_final_pattern() -> None:
    assert reasoning_has_action_intent("让我先搜索并核实来源") is True
    assert reasoning_has_action_intent("这只是内部思考") is False


@pytest.mark.parametrize(
    ("user_input", "context_files", "expected"),
    [
        ("你好", {}, False),
        ("请看 @file[说明](/tmp/readme.md)", {}, True),
        ({"attachments": [{"name": "a.txt"}]}, {}, True),
        ({"context_files": ["/tmp/a.txt"]}, {}, True),
        ("你好", {"/tmp/a.txt": "content"}, True),
    ],
)
def test_turn_external_context_detection(
    user_input: Any,
    context_files: Dict[str, str],
    expected: bool,
) -> None:
    session = StudioSession()
    session.context_files = context_files
    assert _turn_has_external_context(session, user_input) is expected


def test_safe_reasoning_only_retry_removes_tools_and_records_timings() -> None:
    llm = _CapturedReasoningThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    tools = [
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files.",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    events = asyncio.run(_collect_with_tools(runtime, session, "你好", tools))

    assert llm.calls == 2
    assert llm.tools_seen[0]
    assert llm.tools_seen[1] == []
    retry_system_messages = [
        str(message.get("content") or "")
        for message in llm.messages_seen[1]
        if message.get("role") == "system"
        and "[runtime-reasoning-only]" in str(message.get("content") or "")
    ]
    assert retry_system_messages
    assert "不要调用工具" in retry_system_messages[-1]
    assert _final_text(events) == "这是可见回复。"

    metadata = session.chat_history[-1]["metadata"]
    assert metadata["model_round_count"] == 2
    assert metadata["reasoning_only_retry_count"] == 1
    assert metadata["model_elapsed_ms"] >= 0
    assert metadata["first_visible_token_ms"] >= 0
    assert len(metadata["round_timings"]) == 2
    assert metadata["round_timings"][0]["reasoning_only"] is True
    assert metadata["round_timings"][1]["tool_schema_tokens_sent"] == 0
    serialized = repr(metadata).lower()
    assert "继续思考" not in serialized
    assert "prompt" not in serialized
    assert "email" not in serialized


def test_reasoning_only_with_action_intent_keeps_tools() -> None:
    llm = _CapturedReasoningThenReply("让我先搜索并核实来源")
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    tools = [
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files.",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    asyncio.run(_collect_with_tools(runtime, session, "核实一下", tools))

    assert llm.calls == 2
    assert llm.tools_seen[1]
    retry_hints = [
        str(message.get("content") or "")
        for message in llm.messages_seen[1]
        if "[runtime-reasoning-only]" in str(message.get("content") or "")
    ]
    assert retry_hints
    assert "最终回复" in retry_hints[-1]
    assert "tool_call" in retry_hints[-1]


def test_reasoning_only_with_context_files_keeps_tools() -> None:
    llm = _CapturedReasoningThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    session.context_files = {"/tmp/a.txt": "content"}
    tools = [
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files.",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    asyncio.run(_collect_with_tools(runtime, session, "看看附件", tools))

    assert llm.calls == 2
    assert llm.tools_seen[1]


def test_reasoning_only_with_attachments_keeps_tools() -> None:
    llm = _CapturedReasoningThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    tools = [
        {
            "type": "function",
            "function": {
                "name": "list_files",
                "description": "List files.",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    asyncio.run(
        _collect_with_tools(
            runtime,
            session,
            {"attachments": [{"name": "a.txt"}]},
            tools,
        )
    )

    assert llm.calls == 2
    assert llm.tools_seen[1]


def test_system_trigger_does_not_retry_reasoning_only() -> None:
    llm = _CapturedReasoningThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()

    asyncio.run(_collect(runtime, session, "[系统通知] 刷新状态"))

    assert llm.calls == 1


def test_short_truncated_action_intent_retries_once_then_returns_complete_reply() -> None:
    llm = _ShortTruncatedThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()

    events = asyncio.run(_collect(runtime, session, "核实这条信息"))

    assert llm.calls == 2
    assert _final_text(events) == "这条说法并不成立，我已核实官方来源。"
    assert session.chat_history[-1]["metadata"]["terminal_reason"] == "model_final"
    assert session.chat_history[-1]["metadata"]["body_len"] == len(
        "这条说法并不成立，我已核实官方来源。"
    )


def test_short_truncated_action_intent_stops_after_one_retry_with_suspected_terminal() -> None:
    llm = _AlwaysShortTruncated()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()

    events = asyncio.run(_collect(runtime, session, "核实这条信息"))

    assert llm.calls == 2
    assert _final_text(events) == "团长，这条信息涉及具体发布日期、定价和竞品对比"
    assert session.chat_history[-1]["metadata"]["terminal_reason"] == "suspected_truncated_final"
    assert session.chat_history[-1]["metadata"]["truncation_signal"] == (
        "short_unterminated_with_intent"
    )


def test_reasoning_only_after_tool_triggers_fallback_placeholder(monkeypatch) -> None:
    """FR-2a + AC-6: tool executed, then reasoning-only, nudge exhausts -> 补救 placeholder.

    Without the visible_text fix, the Mattis in final_text would mask the补救
    trigger (final_text.strip() non-empty) and the turn would end with Mattis
    pollution instead of the placeholder.
    """
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ToolThenReasoningOnlyThenStillReasoning()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "do it"))
    # Post-tool reason-only budget is 3: tool + 3 nudges + terminal = 5 calls.
    assert llm.calls == 5
    final = _final_text(events)
    # Success-silence fallback when the tool succeeded but the model stayed silent.
    assert "没有给出总结" in final, f"tool-turn success silence expected, got {final!r}"
    assert "失败原因" not in final
    assert "已完成工具调用" not in final
    assert _THINK_OPEN not in final, "FINAL text must not leak Mattis"
    last = session.chat_history[-1]
    assert _THINK_OPEN not in last["content"], "chat_history content must not leak Mattis"
    assert last.get("metadata", {}).get("terminal_reason") == "tool_turn_empty_fallback"
    assert last.get("metadata", {}).get("tool_silence_kind") == "success"


def test_reasoning_only_budget_after_tools_allows_two_nudges_then_reply(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ToolThenTwoReasoningOnlyThenReply()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "do it"))
    assert llm.calls == 4
    assert _final_text(events) == "根据工具结果：目录已列出。"


def test_user_facing_tool_success_silence_fallback_helper() -> None:
    from agenticx.runtime.agent_runtime import _user_facing_tool_success_silence_fallback

    text = _user_facing_tool_success_silence_fallback(
        ["file_read", "list_files", "file_read"],
        {"/tmp/out.html"},
    )
    assert "没有给出总结" in text
    assert "失败原因" not in text
    assert "`list_files`" in text
    assert "`file_read`" in text
    assert "`/tmp/out.html`" in text


def test_tool_error_read_only_surfaces_plain_language_fallback(monkeypatch) -> None:
    """When file_edit fails on a reference mount and the model stays silent, explain clearly."""
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return (
            "ERROR: path is read-only (mounted as reference): "
            "/Users/damon/myWork/research-agent/requirements.txt. "
            "Do not retry file_edit/file_write/bash_exec on this path. "
            "Ask the user to remount the parent folder as link (直连), "
            "or write a copy under the session workspace."
        )

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)

    class _ToolEditThenSilent:
        def __init__(self) -> None:
            self.calls = 0

        def invoke(self, *_args, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                return _FakeResponse(
                    "",
                    [
                        {
                            "id": "call-edit-1",
                            "type": "function",
                            "function": {
                                "name": "file_edit",
                                "arguments": {
                                    "path": "/Users/damon/myWork/research-agent/requirements.txt",
                                    "old_text": "a",
                                    "new_text": "b",
                                },
                            },
                        }
                    ],
                )
            return _FakeResponse(_THINK_OPEN + "还在想" + _THINK_CLOSE, [])

        def stream(self, *_args, **_kwargs):
            yield _THINK_OPEN + "还在想" + _THINK_CLOSE

    llm = _ToolEditThenSilent()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "改 requirements.txt"))
    final = _final_text(events)
    assert "没法修改这个文件" in final
    assert "引用" in final
    assert "直连" in final
    assert "/Users/damon/myWork/research-agent/requirements.txt" in final
    assert "未能生成完整的最终说明" not in final
    last = session.chat_history[-1]
    assert last.get("metadata", {}).get("terminal_reason") == "tool_turn_empty_fallback"


def test_user_facing_tool_error_fallback_helper() -> None:
    from agenticx.runtime.agent_runtime import _user_facing_tool_error_fallback

    text = _user_facing_tool_error_fallback(
        [
            {
                "role": "tool",
                "name": "file_edit",
                "content": (
                    "ERROR: path is read-only (mounted as reference): /tmp/a.txt. "
                    "Do not retry file_edit/file_write/bash_exec on this path."
                ),
            }
        ]
    )
    assert text is not None
    assert "没法修改这个文件" in text
    assert "`/tmp/a.txt`" in text


def test_stream_fallback_dict_chunk_text_key_parsed() -> None:
    """FR (stream-fallback fix): dict chunks with 'text' key must be accumulated."""
    llm = _TextOnlyDictStream()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "hi"))
    # Without the fix, chunk.get("content", "") returned "" for dict-with-text-key,
    # leaving streamed_text empty. With the fix, "hello world" is accumulated.
    assert _final_text(events) == "hello world"
    last = session.chat_history[-1]
    assert last["content"] == "hello world"


def test_interleaved_duplicate_reasoning_is_stripped_clean() -> None:
    """Phase 2 regression: case B interleaved-duplicate reasoning must be stripped.

    Case B (e3033b24) saw the upstream provider echo reasoning chunks with
    character-level interleaving ("用户已经看到了我上一轮的 用户已经看到了我上一轮的...").
    _split_reasoning_and_body must still strip the < Mattis> block so content
    stays clean, and nudge retry must fire so the model gives a real reply.
    """
    from agenticx.runtime.agent_runtime import _split_reasoning_and_body

    interleaved = (
        _THINK_OPEN
        + "用户已经看到了我上一轮的 用户已经看到了我上一轮的完整代码示例。"
        + "系统提示说我之前的工具调用（list完整代码示例。系统提示说我之前的工具调用（list_files）已经完成"
        + _THINK_CLOSE
    )
    reasoning, body = _split_reasoning_and_body(interleaved)
    assert body == "", "interleaved reasoning must strip to empty body"
    assert reasoning, "reasoning text must be captured"
    assert _THINK_OPEN not in body


class _ToolThenPublicFinalInReasoningStream:
    """GLM-like stream: successful edit, then polished final only in reasoning."""

    def __init__(self) -> None:
        self.calls = 0
        self.kwargs_seen: List[Dict[str, Any]] = []

    def stream_with_tools(self, *_args, **kwargs):
        self.calls += 1
        self.kwargs_seen.append(dict(kwargs))
        if self.calls == 1:
            yield {
                "type": "tool_call_delta",
                "tool_index": 0,
                "tool_call_id": "call-edit",
                "tool_name": "file_edit",
                "arguments_delta": (
                    '{"path":"/tmp/demo.html","old_text":"width: 0",'
                    '"new_text":"min-width: 30px"}'
                ),
            }
            yield {"type": "done", "finish_reason": "tool_calls"}
            return
        yield {
            "type": "content",
            "text": (
                _THINK_OPEN
                + "\n✅ **已修复进度条显示问题！**\n\n"
                + "在 `.progress-fill` 中添加了 `min-width: 30px;`，现在会显示完整的 0%。"
                + _THINK_CLOSE
            ),
        }
        yield {"type": "done", "finish_reason": "stop"}


class _ToolThenReadFinalInReasoningStream(_ToolThenPublicFinalInReasoningStream):
    """A non-file successful tool followed by a public final in reasoning."""

    def stream_with_tools(self, *_args, **kwargs):
        self.calls += 1
        self.kwargs_seen.append(dict(kwargs))
        if self.calls == 1:
            yield {
                "type": "tool_call_delta",
                "tool_index": 0,
                "tool_call_id": "call-read",
                "tool_name": "file_read",
                "arguments_delta": '{"path":"/tmp/demo.html"}',
            }
            yield {"type": "done", "finish_reason": "tool_calls"}
            return
        yield {
            "type": "content",
            "text": _THINK_OPEN + "\n✅ 已读取并确认文件内容。" + _THINK_CLOSE,
        }
        yield {"type": "done", "finish_reason": "stop"}


@pytest.mark.parametrize("model_name", ["glm-4.5-air", "glm-4.7"])
def test_public_completion_in_reasoning_is_recovered_after_successful_file_edit(
    monkeypatch,
    model_name: str,
) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "OK: edited /tmp/demo.html"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ToolThenPublicFinalInReasoningStream()
    runtime = AgentRuntime(llm, _ApproveGate(), max_tool_rounds=30)
    session = StudioSession()
    session.provider_name = "zhipu"
    session.model_name = model_name

    events = asyncio.run(
        _collect(
            runtime,
            session,
            "@/tmp/demo.html:el-snippet-a1b2c3 修复 0% 显示",
        )
    )

    assert llm.calls == 2
    final = [event for event in events if event["type"] == EventType.FINAL.value][-1]
    assert final["data"]["text"].startswith("✅ **已修复进度条显示问题！**")
    assert final["data"]["terminal_reason"] == "reasoning_field_final_recovered"
    assert final["data"]["model_finish_reason"] == "stop"
    assert final["data"]["reasoning_field_final_recovered"] is True
    assert _THINK_OPEN not in final["data"]["text"]
    assert session.chat_history[-1]["content"] == final["data"]["text"]
    assert session.chat_history[-1]["metadata"]["model_finish_reason"] == "stop"


def test_public_completion_in_reasoning_is_recovered_after_successful_read(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "<html><body>demo</body></html>"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ToolThenReadFinalInReasoningStream()
    runtime = AgentRuntime(llm, _ApproveGate(), max_tool_rounds=30)
    session = StudioSession()
    session.provider_name = "zhipu"
    session.model_name = "glm-4.7"

    events = asyncio.run(_collect(runtime, session, "读取 /tmp/demo.html 并汇报"))

    final = [event for event in events if event["type"] == EventType.FINAL.value][-1]
    assert final["data"]["text"].startswith("✅ 已读取并确认")
    assert final["data"]["terminal_reason"] == "reasoning_field_final_recovered"
    assert _THINK_OPEN not in final["data"]["text"]


def test_streamed_ordinary_tool_delta_is_visible_before_tool_dispatch(monkeypatch) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    async def _fake_dispatch(*_args, **_kwargs):
        return "OK: read /tmp/demo.html"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    llm = _ToolThenReadFinalInReasoningStream()
    runtime = AgentRuntime(llm, _ApproveGate(), max_tool_rounds=30)
    session = StudioSession()
    session.provider_name = "zhipu"
    session.model_name = "glm-4.7"

    events = asyncio.run(_collect(runtime, session, "读取 /tmp/demo.html 并汇报"))
    deltas = [
        event for event in events
        if event["type"] == EventType.TOOL_CALL_DELTA.value
        and event["data"].get("name") == "file_read"
    ]
    calls = [
        event for event in events
        if event["type"] == EventType.TOOL_CALL.value
        and event["data"].get("name") == "file_read"
    ]
    assert deltas
    assert calls
    assert deltas[0]["data"]["tool_call_id"] == calls[0]["data"]["tool_call_id"]


def test_internal_reasoning_is_not_promoted_even_after_successful_write() -> None:
    from agenticx.runtime.agent_runtime import _recover_public_completion_from_reasoning

    assert (
        _recover_public_completion_from_reasoning(
            "我需要先继续检查工具结果，再确认问题是否已经修复。",
            has_successful_file_write=True,
            last_tool_outcome="success",
            finish_reason="stop",
        )
        == ""
    )
    assert (
        _recover_public_completion_from_reasoning(
            "✅ 已修复显示问题。",
            has_successful_file_write=True,
            last_tool_outcome="success",
            finish_reason="length",
        )
        == ""
    )

