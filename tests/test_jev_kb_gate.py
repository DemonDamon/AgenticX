#!/usr/bin/env python3
"""Tests for Jev KB auto retrieval gate.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from agenticx.llms.typesafe_config import TypesafeSettings
from agenticx.runtime.agent_runtime import (
    _eager_knowledge_search_events,
    _kb_retrieval_always_mode,
    _kb_retrieval_jev_should_search,
)
from agenticx.runtime import agent_runtime as runtime_module


def _session(*, mode: str) -> SimpleNamespace:
    return SimpleNamespace(
        kb_retrieval_mode=mode,
        chat_history=[],
        agent_messages=[],
        _team_manager=None,
    )


def _ready_settings() -> TypesafeSettings:
    return TypesafeSettings(
        enabled=True,
        kb_auto=True,
        has_key=True,
        model="jev-latest",
        timeout_sec=8,
        group_routing=True,
        show_decision_card=True,
    )


def test_always_mode_does_not_call_jev(monkeypatch) -> None:
    called = {"n": 0}

    async def _boom(**_kwargs):
        called["n"] += 1
        raise AssertionError("system_one should not run in always mode")

    monkeypatch.setattr("agenticx.llms.typesafe_client.system_one", _boom)
    monkeypatch.setattr(runtime_module, "system_one", _boom, raising=False)
    session = _session(mode="always")
    assert _kb_retrieval_always_mode(session) is True
    result = asyncio.run(_kb_retrieval_jev_should_search(session, "查一下知识库里的网关文档"))
    assert result is None
    assert called["n"] == 0
    assert session.chat_history == []


def test_auto_high_noul_should_search(monkeypatch) -> None:
    async def _ok(**_kwargs):
        return {
            "model": "jev-1.13.0",
            "answers": {"need_search": {"type": "noul", "noul": 0.9}},
        }

    monkeypatch.setattr(
        "agenticx.llms.typesafe_config.load_typesafe_settings",
        _ready_settings,
    )
    monkeypatch.setattr(
        "agenticx.llms.typesafe_config.resolve_typesafe_api_key",
        lambda: "test-key",
    )
    monkeypatch.setattr("agenticx.llms.typesafe_client.system_one", _ok)
    session = _session(mode="auto")
    result = asyncio.run(_kb_retrieval_jev_should_search(session, "仓库里那份网关方案怎么写的"))
    assert result is True
    assert session.chat_history
    row = session.chat_history[-1]
    assert row["tool_name"] == "jev"
    assert "Jev" in row["content"]
    assert row["metadata"]["kind"] == "jev_kb_gate"
    assert row["metadata"]["action"] == "search"
    assert row["metadata"]["source"] == "jev"


def test_auto_low_noul_skips_search(monkeypatch) -> None:
    async def _ok(**_kwargs):
        return {
            "model": "jev-1.13.0",
            "answers": {"need_search": {"type": "noul", "noul": 0.1}},
        }

    monkeypatch.setattr(
        "agenticx.llms.typesafe_config.load_typesafe_settings",
        _ready_settings,
    )
    monkeypatch.setattr(
        "agenticx.llms.typesafe_config.resolve_typesafe_api_key",
        lambda: "test-key",
    )
    monkeypatch.setattr("agenticx.llms.typesafe_client.system_one", _ok)
    session = _session(mode="auto")
    result = asyncio.run(_kb_retrieval_jev_should_search(session, "你好"))
    assert result is False
    assert session.chat_history[-1]["metadata"]["action"] == "skip"
    assert "Jev" in session.chat_history[-1]["content"]


def test_eager_search_runs_when_jev_says_yes(monkeypatch) -> None:
    dispatched = {"n": 0}

    async def _ok(**_kwargs):
        return {
            "model": "jev-1.13.0",
            "answers": {"need_search": {"type": "noul", "noul": 0.9}},
        }

    async def _fake_dispatch(*_args, **_kwargs):
        dispatched["n"] += 1
        return "kb-hit"

    async def _before_tool(*_a, **_k):
        return SimpleNamespace(blocked=False, reason="")

    class _Runtime:
        hooks = SimpleNamespace(run_before_tool_call=_before_tool)
        confirm_gate = None
        compactor = SimpleNamespace(micro_compact_tool_result=lambda _n, raw: raw)
        _tools_since_persist = 0

        def _maybe_mid_turn_persist(self) -> None:
            return None

    monkeypatch.setattr(
        "agenticx.llms.typesafe_config.load_typesafe_settings",
        _ready_settings,
    )
    monkeypatch.setattr(
        "agenticx.llms.typesafe_config.resolve_typesafe_api_key",
        lambda: "test-key",
    )
    monkeypatch.setattr("agenticx.llms.typesafe_client.system_one", _ok)
    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    session = _session(mode="auto")
    should = asyncio.run(_kb_retrieval_jev_should_search(session, "查网关文档"))
    assert should is True

    async def _run() -> None:
        executed: list[str] = []
        async for _evt in _eager_knowledge_search_events(
            runtime=_Runtime(),
            session=session,
            user_input="查网关文档",
            messages=[],
            agent_id="meta",
            executed_tool_names=executed,
            is_system_trigger=False,
            team_manager=None,
        ):
            pass
        assert "knowledge_search" in executed

    asyncio.run(_run())
    assert dispatched["n"] == 1


def test_auto_disabled_without_key_does_not_call_jev(monkeypatch) -> None:
    called = {"n": 0}

    async def _boom(**_kwargs):
        called["n"] += 1
        raise AssertionError("no http without key")

    monkeypatch.setattr(
        "agenticx.llms.typesafe_config.load_typesafe_settings",
        lambda: TypesafeSettings(enabled=True, kb_auto=True, has_key=False),
    )
    monkeypatch.setattr(
        "agenticx.llms.typesafe_config.resolve_typesafe_api_key",
        lambda: "",
    )
    monkeypatch.setattr("agenticx.llms.typesafe_client.system_one", _boom)
    session = _session(mode="auto")
    result = asyncio.run(_kb_retrieval_jev_should_search(session, "查文档"))
    assert result is None
    assert called["n"] == 0
