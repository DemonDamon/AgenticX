#!/usr/bin/env python3
"""Tests for Studio FastAPI service adapter."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from fastapi.testclient import TestClient

from agenticx.runtime.events import RuntimeEvent
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


class _MetaSpawnLLM:
    def __init__(self) -> None:
        self.calls = 0

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return _FakeResponse(
                "准备启动子智能体",
                [
                    {
                        "id": "meta-call-1",
                        "type": "function",
                        "function": {
                            "name": "spawn_subagent",
                            "arguments": {
                                "name": "执行者",
                                "role": "coder",
                                "task": "生成一个最小示例",
                            },
                        },
                    }
                ],
            )
        return _FakeResponse("主智能体汇总完成", [])

    def stream(self, *_args, **_kwargs):
        yield "主智能体汇总完成"


class _SubTextLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("sub done", [])

    def stream(self, *_args, **_kwargs):
        yield "sub done"


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


def test_get_session_avatar_query_does_not_reuse_meta_session() -> None:
    """Regression: same session_id must not serve both Meta and avatar panes (chat/memory leak)."""
    app = create_studio_app()
    client = TestClient(app)
    meta_sid = client.get("/api/session").json()["session_id"]
    r = client.get(
        "/api/session",
        params={"session_id": meta_sid, "avatar_id": "synthetic-avatar-binding-test"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] != meta_sid
    assert body.get("avatar_id") == "synthetic-avatar-binding-test"


def test_get_session_meta_query_does_not_reuse_avatar_session() -> None:
    app = create_studio_app()
    client = TestClient(app)
    created = client.post(
        "/api/sessions",
        json={"avatar_id": "synthetic-avatar-binding-test-2"},
    )
    assert created.status_code == 200
    avatar_sid = created.json()["session_id"]
    r = client.get("/api/session", params={"session_id": avatar_sid})
    assert r.status_code == 200
    assert r.json()["session_id"] != avatar_sid
    assert not r.json().get("avatar_id")


def test_delete_selected_session_messages() -> None:
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    managed = app.state.session_manager.get(session_id, touch=False)
    assert managed is not None
    managed.studio_session.chat_history = [
        {"role": "assistant", "content": "a", "timestamp": 1, "agent_id": "meta"},
        {"role": "assistant", "content": "b", "timestamp": 2, "agent_id": "meta"},
    ]
    managed.studio_session.agent_messages = [
        {"role": "assistant", "content": "a", "timestamp": 1, "agent_id": "meta"},
        {"role": "assistant", "content": "b", "timestamp": 2, "agent_id": "meta"},
    ]

    resp = client.post(
        "/api/session/messages/delete",
        json={
            "session_id": session_id,
            "messages": [
                {"role": "assistant", "content": "a", "timestamp": 1, "agent_id": "meta"},
            ],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["removed"] == 1
    assert data["requested"] == 1
    assert [x["content"] for x in managed.studio_session.chat_history] == ["b"]


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
    assert all((e.get("data") or {}).get("agent_id") for e in events if e.get("type") != "done")


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


def test_server_confirm_route_supports_agent_id() -> None:
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    manager = app.state.session_manager
    managed = manager.get(session_id)
    assert managed is not None
    sub_gate = managed.get_confirm_gate("sa-1")

    import asyncio

    async def _await_confirm() -> bool:
        return await sub_gate.request_confirm("确认执行？", {"request_id": "sub-1"})

    async def _run_flow() -> bool:
        task = asyncio.create_task(_await_confirm())
        await asyncio.sleep(0)
        confirm_resp = client.post(
            "/api/confirm",
            json={
                "session_id": session_id,
                "request_id": "sub-1",
                "approved": True,
                "agent_id": "sa-1",
            },
        )
        assert confirm_resp.status_code == 200
        return await task

    approved = asyncio.run(_run_flow())
    assert approved is True


def test_server_chat_passes_should_stop_callable(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    called: Dict[str, Any] = {"value": False, "invoked": False}

    class _FakeRuntime:
        def __init__(self, _llm, _confirm_gate):
            pass

        async def run_turn(self, _user_input, _session, should_stop=None, **_kwargs):
            assert callable(should_stop)
            called["invoked"] = True
            called["value"] = await should_stop()
            yield RuntimeEvent(type="final", data={"text": "ok"})

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())
    monkeypatch.setattr(server_module, "AgentRuntime", _FakeRuntime)

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

    assert called["invoked"] is True
    assert called["value"] is False
    assert any(e.get("type") == "final" for e in events)
    assert not any(e.get("type") == "error" for e in events)


def test_server_chat_multiplexes_subagent_events(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    calls = {"n": 0}

    def _resolve(**_kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return _MetaSpawnLLM()
        return _SubTextLLM()

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", _resolve)
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    with client.stream(
        "POST",
        "/api/chat",
        json={"session_id": session_id, "user_input": "请并行完成任务"},
    ) as resp:
        assert resp.status_code == 200
        events = _extract_events(list(resp.iter_lines()))

    event_types = [e.get("type") for e in events]
    assert "subagent_started" in event_types
    assert "subagent_completed" in event_types
    assert "final" in event_types
    assert all((e.get("data") or {}).get("agent_id") for e in events if e.get("type") != "done")


def test_server_chat_rebinds_team_callbacks_each_turn(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    calls = {"n": 0}

    def _resolve(**_kwargs):
        calls["n"] += 1
        if calls["n"] % 2 == 1:
            return _MetaSpawnLLM()
        return _SubTextLLM()

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", _resolve)
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    def _run_chat() -> List[Dict[str, Any]]:
        with client.stream(
            "POST",
            "/api/chat",
            json={"session_id": session_id, "user_input": "执行一次并发任务"},
        ) as resp:
            assert resp.status_code == 200
            return _extract_events(list(resp.iter_lines()))

    first_events = _run_chat()
    second_events = _run_chat()

    assert "subagent_started" in [e.get("type") for e in first_events]
    assert "subagent_started" in [e.get("type") for e in second_events]


def test_server_subagent_chat_uses_session_team_fallback(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    calls = {"n": 0}

    def _resolve(**_kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return _MetaSpawnLLM()
        return _SubTextLLM()

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", _resolve)
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    with client.stream(
        "POST",
        "/api/chat",
        json={"session_id": session_id, "user_input": "创建一个子智能体"},
    ) as resp:
        assert resp.status_code == 200
        _ = _extract_events(list(resp.iter_lines()))

    manager = app.state.session_manager
    managed = manager.get(session_id)
    assert managed is not None
    fallback_team = managed.team_manager
    assert fallback_team is not None

    managed.team_manager = None
    setattr(managed.studio_session, "_team_manager", fallback_team)
    subagent_ids = [row.get("agent_id") for row in fallback_team.get_status().get("subagents", [])]
    assert subagent_ids

    with client.stream(
        "POST",
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "继续执行",
            "agent_id": subagent_ids[0],
        },
    ) as resp:
        assert resp.status_code == 200
        events = _extract_events(list(resp.iter_lines()))

    texts = [str((item.get("data") or {}).get("text", "")) for item in events]
    assert not any("子智能体团队尚未初始化" in text for text in texts)


def test_server_subagent_resume_completed_run_mode(monkeypatch) -> None:
    """Completed run-mode subagents can be resumed via direct chat."""
    from agenticx.runtime.team_manager import AgentTeamManager, SubAgentContext, SubAgentStatus

    from agenticx.studio import server as server_module

    calls = {"n": 0}

    def _resolve(**_kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return _MetaSpawnLLM()
        return _SubTextLLM()

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", _resolve)
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    with client.stream(
        "POST",
        "/api/chat",
        json={"session_id": session_id, "user_input": "创建一个子智能体"},
    ) as resp:
        assert resp.status_code == 200
        _ = _extract_events(list(resp.iter_lines()))

    manager = app.state.session_manager
    managed = manager.get(session_id)
    assert managed is not None
    team: AgentTeamManager = managed.team_manager
    assert team is not None

    import asyncio
    import time

    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        all_done = all(
            ctx.status.value not in ("running", "pending")
            for ctx in team._agents.values()
        )
        if all_done and team._agents:
            break
        time.sleep(0.05)

    subagent_ids = list(team._agents.keys())
    assert subagent_ids
    sa_id = subagent_ids[0]
    ctx = team._agents[sa_id]
    assert ctx.status in (SubAgentStatus.COMPLETED, SubAgentStatus.FAILED)
    assert ctx.mode == "run"
    assert sa_id not in team._agent_sessions

    with client.stream(
        "POST",
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "你好，继续",
            "agent_id": sa_id,
        },
    ) as resp:
        assert resp.status_code == 200
        events = _extract_events(list(resp.iter_lines()))

    texts = [str((item.get("data") or {}).get("text", "")) for item in events]
    assert not any("未找到" in text for text in texts), f"Got not_found errors: {texts}"
    assert not any("不可用" in text for text in texts), f"Got unavailable errors: {texts}"
    assert any("已将你的补充指令发送给子智能体" in text for text in texts)
