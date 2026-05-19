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

        async def run_turn(self, _user_input, _session, should_stop=None, **_kwargs):
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

        async def run_turn(self, _user_input, _session, should_stop=None, **_kwargs):
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
