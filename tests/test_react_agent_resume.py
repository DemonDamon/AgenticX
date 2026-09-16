#!/usr/bin/env python3
"""Tests for ReActAgent durability and aresume.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import pytest

from agenticx.agents.agent_events import (
    FinalEvent,
    InterruptedEvent,
    ToolCallEvent,
)
from agenticx.agents.react_agent_async import ReActAgent
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMChoice, LLMResponse, TokenUsage
from agenticx.reliability.call_identity import canonical_call_key
from agenticx.reliability.call_ledger import CallLedger
from agenticx.reliability.errors import ToolCallIdentityError
from agenticx.reliability.run_state import PendingCall, RunState, RunStateStore
from agenticx.runtime.interrupted_closers import (
    KIND_OUTCOME_UNKNOWN,
    OUTCOME_UNKNOWN_CONTENT,
)
from agenticx.tools.base import BaseTool


class MockFCProvider(BaseLLMProvider):
    model: str = "mock-fc"

    def __init__(self, responses: List[LLMResponse], **data: Any):
        super().__init__(**data)
        object.__setattr__(self, "_responses", list(responses))
        object.__setattr__(self, "_calls", 0)
        object.__setattr__(self, "_raise_on", data.pop("_raise_on", None) if False else None)

    @property
    def call_count(self) -> int:
        return object.__getattribute__(self, "_calls")

    def _pop(self) -> LLMResponse:
        idx = object.__getattribute__(self, "_calls")
        responses = object.__getattribute__(self, "_responses")
        object.__setattr__(self, "_calls", idx + 1)
        if idx < len(responses):
            return responses[idx]
        return LLMResponse(
            id="fallback",
            model_name=self.model,
            created=0,
            content="fallback answer",
            choices=[LLMChoice(index=0, content="fallback answer")],
            token_usage=TokenUsage(),
        )

    async def ainvoke(
        self,
        prompt: Union[str, List[Dict[str, Any]]],
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        return self._pop()

    def invoke(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError

    def stream(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError

    async def astream(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError


class BoomOnInvoke(MockFCProvider):
    async def ainvoke(self, prompt, tools=None, **kwargs):
        raise RuntimeError("llm down")


class CounterTool(BaseTool):
    """Increments a shared counter; the count IS the side effect under test."""

    def __init__(self) -> None:
        super().__init__(name="bump", description="Bump a counter.")
        self.calls: List[str] = []

    def _run(self, **kwargs):
        key = str(kwargs.get("key", "") or "")
        self.calls.append(key)
        return f"count={len(self.calls)}"


class InterruptTool(BaseTool):
    def __init__(self) -> None:
        super().__init__(name="bump", description="Raise during execution.")
        self.calls: List[str] = []

    def _run(self, **kwargs):
        self.calls.append(str(kwargs.get("key", "") or ""))
        raise KeyboardInterrupt("kill-before-result")


def _tc(name: str, args: dict, tc_id: str = "tc1") -> Dict[str, Any]:
    return {
        "id": tc_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


def _final(text: str = "done") -> LLMResponse:
    return LLMResponse(
        id="final",
        model_name="mock",
        created=0,
        content=text,
        choices=[LLMChoice(index=0, content=text)],
        token_usage=TokenUsage(),
    )


def _tool_round(*calls: Dict[str, Any]) -> LLMResponse:
    return LLMResponse(
        id="tools",
        model_name="mock",
        created=0,
        content="",
        choices=[],
        token_usage=TokenUsage(),
        tool_calls=list(calls),
    )


def _collect(agent: ReActAgent, query: str = "go"):
    async def _run():
        events = []
        async for event in agent.astream(query):
            events.append(event)
        return events

    return asyncio.run(_run())


def test_no_store_behaves_identically(tmp_path: Path) -> None:
    llm = MockFCProvider([_final("ok")])
    events = _collect(ReActAgent(llm=llm, tools=[], system_prompt="t"), "hi")
    assert [type(e).__name__ for e in events] == ["ReasoningEvent", "FinalEvent"]
    assert not any(tmp_path.rglob("run_state.json"))
    assert not any(tmp_path.rglob("call_ledger.jsonl"))


def test_state_written_before_llm(tmp_path: Path) -> None:
    store = RunStateStore("sess", root=tmp_path)
    agent = ReActAgent(
        llm=BoomOnInvoke([]),
        tools=[],
        session_id="sess",
        run_store=store,
    )
    with pytest.raises(RuntimeError, match="llm down"):
        _collect(agent, "hi")
    loaded = store.load()
    assert loaded is not None
    assert loaded.phase == "before_llm"


def test_state_written_before_tools(tmp_path: Path) -> None:
    store = RunStateStore("sess", root=tmp_path)
    llm = MockFCProvider([_tool_round(_tc("bump", {"key": "a"}, "c1"))])
    agent = ReActAgent(
        llm=llm,
        tools=[InterruptTool()],
        session_id="sess",
        run_store=store,
        call_ledger=CallLedger("sess", root=tmp_path),
    )
    with pytest.raises(KeyboardInterrupt):
        _collect(agent, "hi")
    loaded = store.load()
    assert loaded is not None
    assert loaded.phase == "tools_dispatched"
    assert len(loaded.pending_calls) == 1
    assert loaded.pending_calls[0].canonical_key


def test_resume_skips_completed_tool(tmp_path: Path) -> None:
    counter = CounterTool()
    ledger = CallLedger("sess", root=tmp_path)
    ledger.record_dispatch("c1", "bump", {"key": "a"})
    ledger.record_result("c1", "count=1")
    store = RunStateStore("sess", root=tmp_path)
    store.save(
        RunState(
            run_id="r1",
            session_id="sess",
            query="hi",
            messages=[
                {"role": "system", "content": "t"},
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [_tc("bump", {"key": "a"}, "c1")],
                },
            ],
            iteration=1,
            phase="tools_dispatched",
            pending_calls=[
                PendingCall(
                    "c1",
                    "bump",
                    {"key": "a"},
                    canonical_call_key("bump", {"key": "a"}),
                )
            ],
        )
    )
    llm = MockFCProvider([_final("done")])
    agent = ReActAgent(
        llm=llm,
        tools=[counter],
        session_id="sess",
        run_store=store,
        call_ledger=ledger,
        run_id="r1",
    )

    async def _run():
        return [event async for event in agent.aresume()]

    events = asyncio.run(_run())
    assert counter.calls == []
    assert any(
        m.get("role") == "tool" and m.get("content") == "count=1"
        for m in events[-1].messages  # type: ignore[attr-defined]
    )


def test_resume_reruns_fresh_tool(tmp_path: Path) -> None:
    counter = CounterTool()
    store = RunStateStore("sess", root=tmp_path)
    store.save(
        RunState(
            run_id="r1",
            session_id="sess",
            query="hi",
            messages=[
                {"role": "system", "content": "t"},
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [_tc("bump", {"key": "a"}, "c1")],
                },
            ],
            iteration=1,
            phase="tools_dispatched",
            pending_calls=[
                PendingCall(
                    "c1",
                    "bump",
                    {"key": "a"},
                    canonical_call_key("bump", {"key": "a"}),
                )
            ],
        )
    )
    llm = MockFCProvider([_final("done")])
    agent = ReActAgent(
        llm=llm,
        tools=[counter],
        session_id="sess",
        run_store=store,
        call_ledger=CallLedger("sess", root=tmp_path),
        run_id="r1",
    )
    asyncio.run(_consume_resume(agent))
    assert counter.calls == ["a"]


def test_resume_marks_ambiguous(tmp_path: Path) -> None:
    counter = CounterTool()
    ledger = CallLedger("sess", root=tmp_path)
    ledger.record_dispatch("c1", "bump", {"key": "a"})
    store = RunStateStore("sess", root=tmp_path)
    store.save(
        RunState(
            run_id="r1",
            session_id="sess",
            query="hi",
            messages=[
                {"role": "system", "content": "t"},
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [_tc("bump", {"key": "a"}, "c1")],
                },
            ],
            iteration=1,
            phase="tools_dispatched",
            pending_calls=[
                PendingCall(
                    "c1",
                    "bump",
                    {"key": "a"},
                    canonical_call_key("bump", {"key": "a"}),
                )
            ],
        )
    )
    agent = ReActAgent(
        llm=MockFCProvider([_final("done")]),
        tools=[counter],
        session_id="sess",
        run_store=store,
        call_ledger=ledger,
        run_id="r1",
    )
    events = asyncio.run(_consume_resume(agent))
    assert counter.calls == []
    final = events[-1]
    assert isinstance(final, FinalEvent)
    tool_rows = [m for m in final.messages if m.get("role") == "tool"]
    assert tool_rows
    assert OUTCOME_UNKNOWN_CONTENT in tool_rows[0]["content"]
    assert tool_rows[0]["metadata"]["kind"] == KIND_OUTCOME_UNKNOWN


def test_resume_identity_conflict_raises(tmp_path: Path) -> None:
    ledger = CallLedger("sess", root=tmp_path)
    ledger.record_dispatch("c1", "bump", {"key": "old"})
    store = RunStateStore("sess", root=tmp_path)
    store.save(
        RunState(
            run_id="r1",
            session_id="sess",
            phase="tools_dispatched",
            messages=[{"role": "user", "content": "hi"}],
            pending_calls=[
                PendingCall(
                    "c1",
                    "bump",
                    {"key": "new"},
                    canonical_call_key("bump", {"key": "new"}),
                )
            ],
        )
    )
    agent = ReActAgent(
        llm=MockFCProvider([]),
        tools=[CounterTool()],
        session_id="sess",
        run_store=store,
        call_ledger=ledger,
        run_id="r1",
    )
    with pytest.raises(ToolCallIdentityError):
        asyncio.run(_consume_resume(agent))


def test_resume_completed_returns_final(tmp_path: Path) -> None:
    store = RunStateStore("sess", root=tmp_path)
    store.save(
        RunState(
            run_id="r1",
            session_id="sess",
            phase="completed",
            iteration=2,
            messages=[
                {"role": "assistant", "content": "already done"},
            ],
        )
    )
    llm = MockFCProvider([_final("should-not-run")])
    agent = ReActAgent(
        llm=llm,
        tools=[],
        session_id="sess",
        run_store=store,
        run_id="r1",
    )
    events = asyncio.run(_consume_resume(agent))
    assert llm.call_count == 0
    assert isinstance(events[0], FinalEvent)
    assert events[0].success is True


def test_final_clears_state(tmp_path: Path) -> None:
    store = RunStateStore("sess", root=tmp_path)
    agent = ReActAgent(
        llm=MockFCProvider([_final("ok")]),
        tools=[],
        session_id="sess",
        run_store=store,
    )
    _collect(agent, "hi")
    assert store.load() is None


def test_stop_yields_interrupted_event(tmp_path: Path) -> None:
    store = RunStateStore("sess", root=tmp_path)
    agent = ReActAgent(
        llm=MockFCProvider([_final("ok")]),
        tools=[],
        session_id="sess",
        run_store=store,
    )
    agent.stop()
    events = _collect(agent, "hi")
    interrupted = [e for e in events if isinstance(e, InterruptedEvent)]
    assert interrupted
    assert interrupted[0].reason == "user_stop"
    assert interrupted[0].messages
    loaded = store.load()
    assert loaded is not None
    assert loaded.phase == "interrupted"


def test_cancel_persists_then_reraises(tmp_path: Path) -> None:
    store = RunStateStore("sess", root=tmp_path)

    class SlowLLM(MockFCProvider):
        async def ainvoke(self, prompt, tools=None, **kwargs):
            await asyncio.sleep(10)
            return _final("late")

    agent = ReActAgent(
        llm=SlowLLM([]),
        tools=[],
        session_id="sess",
        run_store=store,
    )

    async def _run() -> None:
        task = asyncio.create_task(_consume_stream(agent))
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(_run())
    loaded = store.load()
    assert loaded is not None
    assert loaded.phase == "interrupted"


def test_stable_id_when_provider_omits_id(tmp_path: Path) -> None:
    ledger = CallLedger("sess", root=tmp_path)
    store = RunStateStore("sess", root=tmp_path)
    llm = MockFCProvider(
        [
            _tool_round(_tc("bump", {"key": "a"}, "")),
            _final("done"),
        ]
    )
    counter = CounterTool()
    agent = ReActAgent(
        llm=llm,
        tools=[counter],
        session_id="sess",
        run_store=store,
        call_ledger=ledger,
    )
    events = _collect(agent, "hi")
    tool_events = [e for e in events if isinstance(e, ToolCallEvent)]
    assert tool_events
    call_id = tool_events[0].tool_call_id
    assert call_id
    final = events[-1]
    assert isinstance(final, FinalEvent)
    tool_rows = [m for m in final.messages if m.get("role") == "tool"]
    assert tool_rows[0]["tool_call_id"] == call_id
    assert ledger.lookup(call_id) is not None


def test_end_to_end_no_duplicate_side_effect(tmp_path: Path) -> None:
    counter = CounterTool()
    ledger = CallLedger("sess", root=tmp_path)
    store = RunStateStore("sess", root=tmp_path)
    llm = MockFCProvider(
        [
            _tool_round(
                _tc("bump", {"key": "a"}, "c1"),
                _tc("bump", {"key": "b"}, "c2"),
            ),
            _final("done"),
        ]
    )

    original = ledger.record_result
    seen = {"n": 0}

    def _record(call_id: str, result: str, *, success: bool = True) -> None:
        original(call_id, result, success=success)
        seen["n"] += 1
        if seen["n"] >= 2:
            raise KeyboardInterrupt("kill-after-second-result")

    ledger.record_result = _record  # type: ignore[method-assign]
    agent = ReActAgent(
        llm=llm,
        tools=[counter],
        session_id="sess",
        run_store=store,
        call_ledger=ledger,
    )
    with pytest.raises(KeyboardInterrupt):
        _collect(agent, "hi")
    assert len(counter.calls) == 2

    ledger.record_result = original  # type: ignore[method-assign]
    resume_agent = ReActAgent(
        llm=MockFCProvider([_final("done")]),
        tools=[counter],
        session_id="sess",
        run_store=store,
        call_ledger=CallLedger.load("sess", root=tmp_path),
    )
    asyncio.run(_consume_resume(resume_agent))
    assert counter.calls == ["a", "b"]


def _dispatched_counter_setup(
    tmp_path: Path,
    counter: CounterTool,
):
    ledger = CallLedger("sess", root=tmp_path)
    ledger.record_dispatch("c1", "bump", {"key": "a"})
    store = RunStateStore("sess", root=tmp_path)
    store.save(
        RunState(
            run_id="r1",
            session_id="sess",
            query="hi",
            messages=[
                {"role": "system", "content": "t"},
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [_tc("bump", {"key": "a"}, "c1")],
                },
            ],
            iteration=1,
            phase="tools_dispatched",
            pending_calls=[
                PendingCall(
                    "c1",
                    "bump",
                    {"key": "a"},
                    canonical_call_key("bump", {"key": "a"}),
                )
            ],
        )
    )
    agent = ReActAgent(
        llm=MockFCProvider([_final("done")]),
        tools=[counter],
        session_id="sess",
        run_store=store,
        call_ledger=ledger,
        run_id="r1",
    )
    return agent


def test_resume_external_write_not_replayed(tmp_path: Path) -> None:
    counter = CounterTool()
    counter.effect_class = "external_write"
    agent = _dispatched_counter_setup(tmp_path, counter)
    events = asyncio.run(_consume_resume(agent))
    assert counter.calls == []
    final = events[-1]
    assert isinstance(final, FinalEvent)
    tool_rows = [m for m in final.messages if m.get("role") == "tool"]
    assert tool_rows
    assert tool_rows[0]["metadata"]["veto"] == "external_side_effect"


def test_resume_read_tool_replayed(tmp_path: Path) -> None:
    counter = CounterTool()
    counter.effect_class = "read"
    agent = _dispatched_counter_setup(tmp_path, counter)
    asyncio.run(_consume_resume(agent))
    assert counter.calls == ["a"]


def test_resume_with_approval_replays(tmp_path: Path) -> None:
    counter = CounterTool()
    counter.effect_class = "external_write"
    agent = _dispatched_counter_setup(tmp_path, counter)
    asyncio.run(_consume_resume(agent, approve_unsafe_replay=True))
    assert counter.calls == ["a"]


async def _consume_stream(agent: ReActAgent):
    async for _ in agent.astream("hi"):
        pass


async def _consume_resume(agent: ReActAgent, **kwargs: Any):
    return [event async for event in agent.aresume(**kwargs)]
