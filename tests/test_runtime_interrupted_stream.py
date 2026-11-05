#!/usr/bin/env python3
"""Contracts for preserving partial streams without implicit replay."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime import agent_runtime as runtime_module
from agenticx.runtime.loop_controller import LoopController


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question, context=None):
        return True


class _InterruptedLLM:
    def __init__(self, chunks):
        self.chunks = chunks
        self.stream_calls = 0
        self.invoke_calls = 0

    def stream_with_tools(self, *_args, **_kwargs):
        self.stream_calls += 1
        yield from self.chunks
        raise ConnectionError("private-upstream-marker")

    def invoke(self, *_args, **_kwargs):
        self.invoke_calls += 1
        return SimpleNamespace(content="Fallback completed.", tool_calls=[], finish_reason="stop")


def _collect(runtime, session, **kwargs):
    async def run():
        return [event async for event in runtime.run_turn("continue", session, **kwargs)]

    return asyncio.run(run())


def _assert_interrupted(events):
    errors = [event for event in events if event.type == EventType.ERROR.value]
    assert len(errors) == 1
    assert events[-1] is errors[0]
    assert errors[0].data == {
        "text": "模型响应中断，已保留收到的内容。请检查后继续。",
        "detector": "stream_interrupted",
        "partial": True,
        "retryable": False,
    }
    assert not any(event.type == EventType.FINAL.value for event in events)
    assert "private-upstream-marker" not in repr(events)


def test_text_disconnect_preserves_partial_and_persists_before_error():
    llm = _InterruptedLLM([{"type": "content", "text": "Received prefix."}])
    session = StudioSession()
    snapshots = []
    runtime = AgentRuntime(
        llm, _ApproveGate(),
        mid_turn_persist=lambda: snapshots.append(deepcopy(session.agent_messages)),
    )

    events = _collect(runtime, session)

    _assert_interrupted(events)
    assert llm.stream_calls == 1
    assert llm.invoke_calls == 0
    assert any(event.type == EventType.TOKEN.value and event.data["text"] == "Received prefix." for event in events)
    assert session.agent_messages[-1] == {"role": "assistant", "content": "Received prefix."}
    assert snapshots[-1][-1] == session.agent_messages[-1]
    assert session.chat_history[-1] == {
        "role": "assistant", "content": "Received prefix.",
        "metadata": {"source": "interrupted-partial", "interrupted": True, "turn_terminal": False},
    }
    assert "private-upstream-marker" not in repr(session.agent_messages + session.chat_history)


@pytest.mark.parametrize("raw,body", [
    ("<think>private reasoning", ""),
    ("<think>private reasoning</think>Visible body.", "Visible body."),
    ("Visible body.<followups>uncompleted suggestion", "Visible body."),
])
def test_reasoning_or_control_prefix_is_not_replayed_or_saved_as_body(raw, body):
    llm = _InterruptedLLM([{"type": "content", "text": raw}])
    session = StudioSession()

    events = _collect(AgentRuntime(llm, _ApproveGate()), session)

    _assert_interrupted(events)
    assert llm.invoke_calls == 0
    assistant_rows = [row for row in session.agent_messages if row["role"] == "assistant"]
    assert assistant_rows == ([{"role": "assistant", "content": body}] if body else [])
    assert "private reasoning" not in repr(session.agent_messages + session.chat_history)
    assert "uncompleted suggestion" not in repr(session.agent_messages + session.chat_history)


@pytest.mark.parametrize("delta", [
    {"tool_call_id": "call-partial"},
    {"tool_name": "list_items"},
    {"arguments_delta": '{"message":'},
    {"tool_name": "list_items", "arguments_delta": "{}"},
])
@pytest.mark.parametrize("prefix", ["", "Visible before the tool."])
def test_tool_delta_disconnect_never_invokes_or_dispatches(monkeypatch, delta, prefix):
    dispatched = []

    async def dispatch(*args, **kwargs):
        dispatched.append((args, kwargs))
        return "ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", dispatch)
    chunks = [{"type": "content", "text": prefix}] if prefix else []
    llm = _InterruptedLLM([*chunks, {"type": "tool_call_delta", **delta}])
    session = StudioSession()
    tools = [{"type": "function", "function": {
        "name": "list_items", "description": "List items",
        "parameters": {"type": "object", "properties": {"message": {"type": "string"}}},
    }}]

    events = _collect(AgentRuntime(llm, _ApproveGate()), session, tools=tools)

    _assert_interrupted(events)
    assert llm.stream_calls == 1
    assert llm.invoke_calls == 0
    assert dispatched == []
    assert not any("tool_calls" in row for row in session.agent_messages + session.chat_history)
    assert not any(event.type == EventType.TOOL_CALL.value for event in events)
    assistant_rows = [row for row in session.agent_messages if row["role"] == "assistant"]
    assert assistant_rows == ([{"role": "assistant", "content": prefix}] if prefix else [])


@pytest.mark.parametrize("chunks", [
    [],
    [{"type": "content", "text": ""}],
    [{"type": "usage", "usage": {"completion_tokens": 0}}],
    [{"type": "done", "finish_reason": "stop"}],
    [{"type": "tool_call_delta", "arguments_delta": ""}],
])
def test_failure_before_output_keeps_invoke_fallback(chunks):
    llm = _InterruptedLLM(chunks)
    session = StudioSession()

    events = _collect(AgentRuntime(llm, _ApproveGate()), session)

    assert llm.stream_calls == 1
    assert llm.invoke_calls == 1
    assert events[-1].type == EventType.FINAL.value
    assert events[-1].data["text"] == "Fallback completed."
    assert not any(event.data.get("detector") == "stream_interrupted" for event in events)


def test_watchdog_timeout_after_content_cannot_replay(monkeypatch):
    original = runtime_module._iter_sync_stream_with_watchdog

    async def timeout_after_first(**kwargs):
        stream = original(**kwargs)
        try:
            async for chunk in stream:
                if chunk is runtime_module._STREAM_WAITING_HINT:
                    continue
                yield chunk
                raise asyncio.TimeoutError()
        finally:
            await stream.aclose()

    monkeypatch.setattr(runtime_module, "_iter_sync_stream_with_watchdog", timeout_after_first)
    llm = _InterruptedLLM([{"type": "content", "text": "Before timeout."}])
    session = StudioSession()

    events = _collect(AgentRuntime(llm, _ApproveGate()), session)

    _assert_interrupted(events)
    assert llm.invoke_calls == 0
    assert session.agent_messages[-1]["content"] == "Before timeout."


def test_network_partial_history_does_not_depend_on_cancellation_flag(monkeypatch):
    monkeypatch.setenv("AGX_CANCELLED_PREFIX_FINALIZE", "0")
    llm = _InterruptedLLM([{"type": "content", "text": "Keep this prefix."}])
    session = StudioSession()

    events = _collect(AgentRuntime(llm, _ApproveGate()), session)

    _assert_interrupted(events)
    assert session.agent_messages[-1]["content"] == "Keep this prefix."
    assert session.chat_history[-1]["content"] == "Keep this prefix."


@pytest.mark.parametrize("consume", ["exhaust", "close_at_error", "loop", "close_loop_at_error"])
def test_interrupted_turn_closes_existing_checkpoint_and_recorder(consume):
    class CheckpointStore:
        def __init__(self):
            self.saved = []
            self.cleared = []

        def new_turn_id(self):
            return "turn-interrupted"

        def save(self, checkpoint):
            self.saved.append(checkpoint)

        def clear(self, session_id):
            self.cleared.append(session_id)

    class Recorder:
        current_run_id = "run-interrupted"

        def __init__(self):
            self.statuses = []

        def start_turn(self, **kwargs):
            pass

        def observe(self, event, **kwargs):
            pass

        def finish(self, status):
            self.statuses.append(status)

    store = CheckpointStore()
    recorder = Recorder()
    session = StudioSession()
    session.session_id = "session-interrupted"
    llm = _InterruptedLLM([{"type": "content", "text": "Keep once."}])
    runtime = AgentRuntime(llm, _ApproveGate(), checkpoint_store=store, run_recorder=recorder)

    async def run():
        if "loop" in consume:
            turn = LoopController(max_iterations=3).run_loop(task="continue", runtime=runtime, session=session)
        else:
            turn = runtime.run_turn("continue", session)
        events = []
        try:
            async for event in turn:
                events.append(event)
                if "close" in consume and event.type == EventType.ERROR.value:
                    break
        finally:
            await turn.aclose()
        return events

    events = asyncio.run(run())

    _assert_interrupted(events)
    assert store.saved
    assert all(not checkpoint.pending_tool_calls for checkpoint in store.saved)
    assert store.cleared == ["session-interrupted"]
    assert recorder.statuses == ["interrupted"]
    assert llm.stream_calls == 1
    assert llm.invoke_calls == 0


def test_next_explicit_turn_can_continue_from_safe_partial():
    first = _InterruptedLLM([{"type": "content", "text": "A safe partial."}])
    session = StudioSession()
    _collect(AgentRuntime(first, _ApproveGate()), session)
    captured = []

    class ContinuedLLM:
        def stream_with_tools(self, messages, **kwargs):
            captured.extend(deepcopy(messages))
            yield {"type": "content", "text": "Continued normally."}

    events = _collect(AgentRuntime(ContinuedLLM(), _ApproveGate()), session)

    assert any(row.get("role") == "assistant" and row.get("content") == "A safe partial." for row in captured)
    assert events[-1].type == EventType.FINAL.value
    assert events[-1].data["text"] == "Continued normally."


def test_loop_with_real_interrupted_runtime_calls_model_once():
    llm = _InterruptedLLM([{"type": "content", "text": "Partial loop output."}])
    runtime = AgentRuntime(llm, _ApproveGate())
    controller = LoopController(max_iterations=3, completion_promise="DONE")

    async def run():
        return [event async for event in controller.run_loop(task="continue", runtime=runtime, session=StudioSession())]

    events = asyncio.run(run())

    _assert_interrupted(events)
    assert llm.stream_calls == 1
    assert llm.invoke_calls == 0
