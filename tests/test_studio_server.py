#!/usr/bin/env python3
"""Tests for Studio FastAPI service adapter."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _TextLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield "do"
        yield "ne"


class _ConfirmLLM:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                "need confirm",
                [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "bash_exec", "arguments": {"command": "rm -rf /tmp/demo"}},
                    }
                ],
            )
        return _FakeResponse("after confirm", [])

    def stream(self, *_args, **_kwargs):
        yield "after confirm"


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


def test_server_session_lifecycle() -> None:
    app = create_studio_app()
    client = TestClient(app)

    created = client.get("/api/session")
    assert created.status_code == 200
    session_id = created.json()["session_id"]

    state = client.get("/api/session", params={"session_id": session_id})
    assert state.status_code == 200
    assert state.json()["session_id"] == session_id

    deleted = client.delete("/api/session", params={"session_id": session_id})
    assert deleted.status_code == 200


def test_server_chat_sse_stream(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())
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

    assert any(e.get("type") == "token" for e in events)
    assert any(e.get("type") == "final" for e in events)


def test_server_confirm_gate_flow(monkeypatch) -> None:
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    manager = app.state.session_manager
    managed = manager.get(session_id)
    assert managed is not None

    import asyncio

    async def _await_confirm() -> bool:
        return await managed.confirm_gate.request_confirm(
            "确认执行？",
            {"request_id": "req-1"},
        )

    async def _run_flow() -> bool:
        task = asyncio.create_task(_await_confirm())
        await asyncio.sleep(0)
        confirm_resp = client.post(
            "/api/confirm",
            json={"session_id": session_id, "request_id": "req-1", "approved": False},
        )
        assert confirm_resp.status_code == 200
        return await task

    approved = asyncio.run(_run_flow())
    assert approved is False
