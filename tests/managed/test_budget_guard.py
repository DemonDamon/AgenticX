#!/usr/bin/env python3
"""Budget guard proxy and a hosted turn that stops on the marker.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from agenticx.managed.budget import BudgetExceededError, BudgetGuardedLLMFactory
from agenticx.managed.host.app import create_ma_app
from agenticx.managed.llm import LLMCallContext
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep
from tests.managed.conftest import make_config


class _FakeLLM:
    def __init__(self) -> None:
        self.model = "m"
        self.invoked = 0
        self.streamed = 0
        self.ainvoked = 0

    def invoke(self, *_args: Any, **_kwargs: Any) -> str:
        self.invoked += 1
        return "ok"

    def stream_with_tools(self, *_args: Any, **_kwargs: Any) -> Any:
        self.streamed += 1
        return iter(())

    async def ainvoke(self, *_args: Any, **_kwargs: Any) -> str:
        self.ainvoked += 1
        return "ok"


class _Factory:
    def __init__(self, llm: _FakeLLM) -> None:
        self._llm = llm

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> _FakeLLM:
        del provider, model, context
        return self._llm


def test_guard_runs_before_invoke_and_stream() -> None:
    inner = _FakeLLM()
    calls = {"n": 0}

    def guard(_context: LLMCallContext) -> None:
        calls["n"] += 1

    llm = BudgetGuardedLLMFactory(_Factory(inner), guard).create(
        provider="fake",
        model="m",
        context=LLMCallContext("t", "s", "a", 1, "u"),
    )
    assert llm.model == "m"
    assert getattr(llm, "missing", None) is None
    llm.invoke()
    assert calls["n"] == 1
    llm.stream_with_tools()
    assert calls["n"] == 2
    assert inner.invoked == 1
    assert inner.streamed == 1

    def block(_context: LLMCallContext) -> None:
        raise BudgetExceededError(period="daily", used=2, limit=1)

    blocked = BudgetGuardedLLMFactory(_Factory(inner), block).create(
        provider="fake",
        model="m",
        context=LLMCallContext("t", "s", "a", 1, "u"),
    )
    try:
        blocked.invoke()
    except BudgetExceededError:
        pass
    else:
        raise AssertionError("guard did not stop invoke")
    assert inner.invoked == 1


async def test_async_methods_are_guarded() -> None:
    inner = _FakeLLM()
    calls = {"n": 0}

    def guard(_context: LLMCallContext) -> None:
        calls["n"] += 1

    llm = BudgetGuardedLLMFactory(_Factory(inner), guard).create(
        provider="fake",
        model="m",
        context=LLMCallContext("t", "s", "a", 1, "u"),
    )
    result = await llm.ainvoke()
    assert result == "ok"
    assert calls["n"] == 1
    assert inner.ainvoked == 1


def _plain_manifest() -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "Reply with the scripted text.",
        "runtime": {"max_tool_rounds": 4},
    }


async def test_hosted_turn_stops_with_budget_exceeded(tmp_path: Any) -> None:
    def always_raise(_context: LLMCallContext) -> None:
        raise BudgetExceededError(period="monthly", used=10, limit=5)

    config = make_config(tmp_path, manifest=_plain_manifest())
    app = create_ma_app(
        config,
        llm_factory=BudgetGuardedLLMFactory(
            PerSessionScriptFactory([ScriptStep("should-not-appear")]),
            always_raise,
        ),
    )
    started = time.monotonic()
    await app.state.ma.startup()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
            assert created.status_code == 201, created.text
            session_id = created.json()["id"]
            posted = await client.post(
                f"/ma/v1/sessions/{session_id}/events",
                json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "hi"}]}]},
            )
            assert posted.status_code == 200, posted.text
            record: dict[str, Any] = {}
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                response = await client.get(f"/ma/v1/sessions/{session_id}")
                record = response.json()
                stop = record.get("stop_reason") or {}
                if record.get("status") == "idle" and stop.get("type") == "budget_exceeded":
                    break
                await asyncio.sleep(0.05)
            else:
                events = await client.get(f"/ma/v1/sessions/{session_id}/events")
                raise AssertionError({"session": record, "events": events.json(), "elapsed": time.monotonic() - started})
            assert time.monotonic() - started < 10
    finally:
        await app.state.ma.shutdown()
