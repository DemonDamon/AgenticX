#!/usr/bin/env python3
"""Smoke tests for chat end execution_state (idle vs interrupted).

Plan-Id: 2026-05-19-machi-task-stall-recovery

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from fastapi.testclient import TestClient

from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.studio import server as server_module
from agenticx.studio.server import create_studio_app


def _extract_events(lines: List[str]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for line in lines:
        if not line.startswith("data: "):
            continue
        try:
            events.append(json.loads(line[6:]))
        except json.JSONDecodeError:
            continue
    return events


def test_chat_timeout_leaves_session_interrupted(monkeypatch) -> None:
    class _TimeoutRuntime:
        def __init__(self, _llm, _confirm_gate, **_kwargs):
            pass

        async def run_turn(self, user_input, session, should_stop=None, **_kwargs):
            # 真 AgentRuntime 一进 run_turn 就把用户这条写进 chat_history（见
            # agent_runtime 里 persist_user_message 那段）。替身不写的话，会话一条可见
            # 消息都没有，list_sessions 会当成空壳过滤掉——那是替身的失真，不是被测行为。
            session.chat_history.append({"role": "user", "content": user_input})
            yield RuntimeEvent(
                type=EventType.ERROR.value,
                data={"text": "模型响应超时（>60s，provider=openai, model=gpt-4o-mini）。"},
                agent_id="meta",
            )

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: object())
    monkeypatch.setattr(server_module, "AgentRuntime", _TimeoutRuntime)

    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    with client.stream(
        "POST",
        "/api/chat",
        json={"session_id": session_id, "user_input": "hello"},
    ) as resp:
        assert resp.status_code == 200
        events = _extract_events(list(resp.iter_lines()))

    assert any(e.get("type") == "error" for e in events)
    assert not any(e.get("type") == "final" for e in events)

    listed = client.get("/api/sessions").json()
    row = next((s for s in listed.get("sessions", []) if s.get("session_id") == session_id), None)
    assert row is not None
    assert row.get("execution_state") == "interrupted"


def test_chat_final_leaves_session_idle(monkeypatch) -> None:
    class _OkRuntime:
        def __init__(self, _llm, _confirm_gate, **_kwargs):
            pass

        async def run_turn(self, user_input, session, should_stop=None, **_kwargs):
            session.chat_history.append({"role": "user", "content": user_input})
            yield RuntimeEvent(type=EventType.FINAL.value, data={"text": "done"}, agent_id="meta")

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: object())
    monkeypatch.setattr(server_module, "AgentRuntime", _OkRuntime)

    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    with client.stream(
        "POST",
        "/api/chat",
        json={"session_id": session_id, "user_input": "hello"},
    ) as resp:
        assert resp.status_code == 200
        _extract_events(list(resp.iter_lines()))

    listed = client.get("/api/sessions").json()
    row = next((s for s in listed.get("sessions", []) if s.get("session_id") == session_id), None)
    assert row is not None
    assert row.get("execution_state") == "idle"


def test_llm_init_failure_keeps_the_session_and_the_user_message(monkeypatch) -> None:
    """模型初始化就失败时，会话不能从历史里消失。

    这一步发生在 run_turn 之前，而用户那条消息是 run_turn 才写进 chat_history 的。
    不补的话这个会话一条可见消息都没有，list_sessions 把它当「还没说过话的空壳」直接
    过滤掉——用户刚敲的字连同整个会话一起不见了，他看到的只有一句报错。模型没配好、
    企业 token 过期、网络在解析时断了，都会走到这条路。
    """

    def _boom(**_kwargs):
        raise RuntimeError("Unsupported provider: no-such-provider")

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", _boom)

    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    with client.stream(
        "POST",
        "/api/chat",
        json={"session_id": session_id, "user_input": "这条消息不能丢"},
    ) as resp:
        assert resp.status_code == 200
        events = _extract_events(list(resp.iter_lines()))

    assert any(e.get("type") == "error" for e in events)

    listed = client.get("/api/sessions").json()
    row = next((s for s in listed.get("sessions", []) if s.get("session_id") == session_id), None)
    assert row is not None, "会话从历史列表里消失了"
    # 这一轮没产出任何答复，历史里就该显示已中断，而不是看着像正常结束
    assert row.get("execution_state") == "interrupted"

    messages = client.get(f"/api/session/messages?session_id={session_id}").json()
    rows = messages.get("messages") or messages.get("chat_history") or []
    user_rows = [m for m in rows if str(m.get("role")) == "user"]
    assert any("这条消息不能丢" in str(m.get("content", "")) for m in user_rows), (
        "用户刚敲的内容没保住"
    )
    # 还要留下「当时为什么失败」，否则用户回头看到的是一条自己的消息和一片空白
    assert any(
        "no-such-provider" in str(m.get("content", ""))
        for m in rows
        if str(m.get("role")) == "assistant"
    )
