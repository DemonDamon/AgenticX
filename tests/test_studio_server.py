#!/usr/bin/env python3
"""Tests for Studio FastAPI service adapter."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List

import pytest

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


def test_create_session_returns_without_waiting_for_mcp_autoconnect(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    async def _slow_auto_connect(*_args, **_kwargs):
        await __import__("asyncio").sleep(0.25)
        return {"slow-mcp": True}

    monkeypatch.setattr(
        server_module,
        "load_available_servers",
        lambda: {
            "slow-mcp": {
                "command": "python",
                "args": ["-c", "print('ok')"],
                "timeout": 30.0,
            }
        },
    )
    monkeypatch.setattr(server_module, "auto_connect_servers_async", _slow_auto_connect)

    app = create_studio_app()
    client = TestClient(app)

    start = time.perf_counter()
    created = client.post("/api/sessions", json={})
    elapsed = time.perf_counter() - start

    assert created.status_code == 200
    assert created.json().get("session_id")
    # Regression guard: response should not block on a slow MCP auto-connect.
    assert elapsed < 0.2


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


def _seed_truncate_session(app):
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    managed = app.state.session_manager.get(session_id, touch=False)
    assert managed is not None
    # UI-side timestamps differ from persisted ones; truncate must not depend on them.
    managed.studio_session.chat_history = [
        {"role": "user", "content": "first", "timestamp": 1},
        {"role": "assistant", "content": "ans1", "timestamp": 2},
        {"role": "user", "content": "retry me", "timestamp": 3},
        {"role": "assistant", "content": "已写好 skill", "timestamp": 4},
    ]
    managed.studio_session.agent_messages = [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "ans1"},
        {"role": "system", "content": "[compacted] 已压缩历史…"},
        {"role": "user", "content": "retry me"},
        {"role": "assistant", "content": "已写好 skill", "tool_calls": [{"id": "c1"}]},
        {"role": "tool", "tool_call_id": "c1", "name": "skill_manage", "content": "ok"},
    ]
    return client, session_id, managed


def test_truncate_after_clears_model_context_for_retry() -> None:
    app = create_studio_app()
    client, session_id, managed = _seed_truncate_session(app)

    resp = client.post(
        "/api/session/messages/truncate",
        json={"session_id": session_id, "user_content": "retry me", "mode": "after"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    # AC-1/AC-2: everything after the retried user message is gone in both stores.
    assert [x["content"] for x in managed.studio_session.chat_history] == [
        "first",
        "ans1",
        "retry me",
    ]
    agent_contents = [x["content"] for x in managed.studio_session.agent_messages]
    assert agent_contents == ["first", "ans1", "retry me"]
    assert "已写好 skill" not in agent_contents
    assert not any(str(x.get("role")) == "tool" for x in managed.studio_session.agent_messages)
    assert not any("[compacted]" in c for c in agent_contents)


def test_truncate_after_deletes_session_summary_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "true")
    monkeypatch.setattr("agenticx.runtime.session_summary_store.Path.home", lambda: tmp_path)
    app = create_studio_app()
    client, session_id, managed = _seed_truncate_session(app)
    summary_file = tmp_path / ".agenticx" / "workspace" / "sessions" / f"{session_id}.md"
    summary_file.parent.mkdir(parents=True, exist_ok=True)
    summary_file.write_text("# Session Summary\n- old answer", encoding="utf-8")

    resp = client.post(
        "/api/session/messages/truncate",
        json={"session_id": session_id, "user_content": "retry me", "mode": "after"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert not summary_file.exists()


def test_truncate_after_uses_user_occurrence_not_last_duplicate() -> None:
    app = create_studio_app()
    client, session_id, managed = _seed_truncate_session(app)
    managed.studio_session.chat_history = [
        {"role": "user", "content": "retry me", "timestamp": 1},
        {"role": "assistant", "content": "first answer", "timestamp": 2},
        {"role": "user", "content": "retry me", "timestamp": 3},
        {"role": "assistant", "content": "second answer", "timestamp": 4},
    ]
    managed.studio_session.agent_messages = [
        {"role": "user", "content": "retry me"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "retry me"},
        {"role": "assistant", "content": "second answer"},
    ]

    resp = client.post(
        "/api/session/messages/truncate",
        json={
            "session_id": session_id,
            "user_content": "retry me",
            "mode": "after",
            "user_occurrence": 1,
        },
    )
    assert resp.status_code == 200
    # Retry the first duplicate user turn: drop everything after it, including later rounds.
    assert [x["content"] for x in managed.studio_session.chat_history] == [
        "retry me",
    ]
    assert [x["content"] for x in managed.studio_session.agent_messages] == [
        "retry me",
    ]


def test_truncate_after_first_turn_clears_view_image_inject_and_later_rounds() -> None:
    app = create_studio_app()
    client, session_id, managed = _seed_truncate_session(app)
    inject_prefix = "<system-injected> attached images requested via view_image tool:"
    managed.studio_session.chat_history = [
        {"role": "user", "content": "first question", "timestamp": 1},
        {"role": "assistant", "content": "first answer", "timestamp": 2},
        {"role": "user", "content": "switch model", "timestamp": 3},
        {"role": "user", "content": inject_prefix, "timestamp": 4},
        {"role": "assistant", "content": "second answer", "timestamp": 5},
        {"role": "user", "content": "switch model", "timestamp": 6},
        {"role": "assistant", "content": "third answer", "timestamp": 7},
    ]
    managed.studio_session.agent_messages = [
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "switch model"},
        {"role": "assistant", "content": "second answer"},
        {"role": "user", "content": "switch model"},
        {"role": "assistant", "content": "third answer"},
    ]

    resp = client.post(
        "/api/session/messages/truncate",
        json={
            "session_id": session_id,
            "user_content": "switch model",
            "mode": "after",
            "user_occurrence": 1,
        },
    )
    assert resp.status_code == 200
    assert [x["content"] for x in managed.studio_session.chat_history] == [
        "first question",
        "first answer",
        "switch model",
    ]
    assert [x["content"] for x in managed.studio_session.agent_messages] == [
        "first question",
        "first answer",
        "switch model",
    ]


def test_truncate_after_second_occurrence_targets_later_duplicate() -> None:
    app = create_studio_app()
    client, session_id, managed = _seed_truncate_session(app)
    managed.studio_session.chat_history = [
        {"role": "user", "content": "retry me", "timestamp": 1},
        {"role": "assistant", "content": "first answer", "timestamp": 2},
        {"role": "user", "content": "retry me", "timestamp": 3},
        {"role": "assistant", "content": "second answer", "timestamp": 4},
    ]
    managed.studio_session.agent_messages = [
        {"role": "user", "content": "retry me"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "retry me"},
        {"role": "assistant", "content": "second answer"},
    ]

    resp = client.post(
        "/api/session/messages/truncate",
        json={
            "session_id": session_id,
            "user_content": "retry me",
            "mode": "after",
            "user_occurrence": 2,
        },
    )
    assert resp.status_code == 200
    assert [x["content"] for x in managed.studio_session.chat_history] == [
        "retry me",
        "first answer",
        "retry me",
    ]
    assert [x["content"] for x in managed.studio_session.agent_messages] == [
        "retry me",
        "first answer",
        "retry me",
    ]


def test_truncate_after_strips_compacted_summary_of_removed_turn() -> None:
    app = create_studio_app()
    client, session_id, managed = _seed_truncate_session(app)
    managed.studio_session.agent_messages = [
        {"role": "system", "content": "[compacted] 已创建 a-stock-daily-report skill"},
        {"role": "user", "content": "retry me"},
        {"role": "assistant", "content": "已写好 skill"},
    ]

    resp = client.post(
        "/api/session/messages/truncate",
        json={"session_id": session_id, "user_content": "retry me", "mode": "after", "user_occurrence": 1},
    )
    assert resp.status_code == 200
    agent_contents = [x["content"] for x in managed.studio_session.agent_messages]
    assert agent_contents == ["retry me"]
    assert not any("a-stock-daily-report" in c for c in agent_contents)


def test_truncate_including_removes_user_turn_for_edit() -> None:
    app = create_studio_app()
    client, session_id, managed = _seed_truncate_session(app)

    resp = client.post(
        "/api/session/messages/truncate",
        json={"session_id": session_id, "user_content": "retry me", "mode": "including"},
    )
    assert resp.status_code == 200
    assert [x["content"] for x in managed.studio_session.chat_history] == ["first", "ans1"]
    agent_contents = [x["content"] for x in managed.studio_session.agent_messages]
    assert agent_contents == ["first", "ans1", "[compacted] 已压缩历史…"]


def test_truncate_no_match_is_noop() -> None:
    app = create_studio_app()
    client, session_id, managed = _seed_truncate_session(app)

    resp = client.post(
        "/api/session/messages/truncate",
        json={"session_id": session_id, "user_content": "not present", "mode": "after"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["removed_chat"] == 0
    assert data["removed_agent"] == 0
    assert data["matched_chat"] is False
    assert data["matched_agent"] is False
    assert len(managed.studio_session.chat_history) == 4


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


def test_group_chat_branch_sets_execution_state_running_then_idle(monkeypatch) -> None:
    from agenticx.runtime.group_router import GroupReply
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())

    class _FakeGroupRouter:
        def __init__(self, **_kwargs) -> None:
            pass

        def pick_targets(self, **_kwargs):
            return []

        async def run_group_turn(self, **_kwargs):
            yield GroupReply(
                agent_id="meta",
                avatar_name="Machi",
                avatar_url="",
                content="group done",
                skipped=False,
                event_type="group_reply",
            )

    monkeypatch.setattr(server_module, "GroupChatRouter", _FakeGroupRouter)

    app = create_studio_app()
    client = TestClient(app)
    manager = app.state.session_manager
    avatar_registry = app.state.avatar_registry
    group_registry = app.state.group_registry

    session_id = client.get("/api/session").json()["session_id"]
    avatar = avatar_registry.create_avatar(name="测试成员", role="Engineer")
    group = group_registry.create_group(name="测试群", avatar_ids=[avatar.id], routing="intelligent")

    # Simulate prior user interrupt; a new group turn must reset to running.
    manager.set_execution_state(session_id, "interrupted")

    state_calls: List[str] = []
    original_set_state = manager.set_execution_state

    def _spy_set_state(sid: str, state: str) -> None:
        state_calls.append(state)
        original_set_state(sid, state)

    monkeypatch.setattr(manager, "set_execution_state", _spy_set_state)

    resp = client.post(
        "/api/chat",
        json={
            "session_id": session_id,
            "group_id": group.id,
            "user_input": "你好，群聊测试一下",
        },
    )
    assert resp.status_code == 200
    _ = _extract_events(resp.text.splitlines())

    assert "running" in state_calls
    assert state_calls[-1] == "idle"
    rows = client.get("/api/sessions").json().get("sessions", [])
    current = next((r for r in rows if r.get("session_id") == session_id), None)
    assert current is not None
    assert current.get("execution_state") == "idle"


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


def test_server_chat_passes_should_stop_and_client_turn_metadata(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    called: Dict[str, Any] = {
        "value": False,
        "invoked": False,
        "history_user_metadata": None,
    }

    class _FakeRuntime:
        def __init__(self, _llm, _confirm_gate):
            pass

        async def run_turn(self, _user_input, _session, should_stop=None, **_kwargs):
            assert callable(should_stop)
            called["invoked"] = True
            called["value"] = await should_stop()
            called["history_user_metadata"] = _kwargs.get("history_user_metadata")
            yield RuntimeEvent(type="final", data={"text": "ok"})

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())
    monkeypatch.setattr(server_module, "AgentRuntime", _FakeRuntime)

    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    with client.stream(
        "POST",
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "hello",
            "client_turn_id": "turn-123",
        },
    ) as resp:
        assert resp.status_code == 200
        events = _extract_events(list(resp.iter_lines()))

    assert called["invoked"] is True
    assert called["value"] is False
    assert called["history_user_metadata"] == {"client_turn_id": "turn-123"}
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


def test_studio_cors_origins_include_default_and_env_dev_ports(monkeypatch):
    from agenticx.studio.server import _studio_cors_origins

    monkeypatch.delenv("AGX_CORS_ORIGINS", raising=False)
    monkeypatch.setenv("AGX_DEV_PORT", "5715")
    origins = _studio_cors_origins()
    assert "http://localhost:5173" in origins
    assert "http://localhost:5713" in origins
    assert "http://localhost:5715" in origins
    assert "file://" in origins


def test_studio_cors_origins_merge_extra_env(monkeypatch):
    from agenticx.studio.server import _studio_cors_origins

    monkeypatch.setenv("AGX_CORS_ORIGINS", "https://studio.example.com")
    monkeypatch.delenv("AGX_DEV_PORT", raising=False)
    origins = _studio_cors_origins()
    assert "https://studio.example.com" in origins


def test_chat_hydrates_document_before_building_meta_prompt(monkeypatch, tmp_path) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())

    order: List[str] = []
    captured: Dict[str, str] = {}

    async def _fake_hydrate(turn_cf, session_cf):
        order.append("hydrate")
        for key, value in turn_cf.items():
            if str(value).startswith("[附件] "):
                session_cf[key] = "HYDRATED_BODY"
        return type("R", (), {"attempted": 1, "succeeded": 1, "failed": 0, "skipped": 0})()

    real_build = server_module.build_meta_agent_system_prompt

    def _spy_build(session, *args, **kwargs):
        order.append("prompt")
        captured.update(dict(session.context_files or {}))
        return real_build(session, *args, **kwargs)

    monkeypatch.setattr(server_module, "hydrate_turn_context_files", _fake_hydrate)
    monkeypatch.setattr(server_module, "build_meta_agent_system_prompt", _spy_build)

    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    with client.stream(
        "POST",
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "总结简历",
            "context_files": {str(pdf): "[附件] resume.pdf"},
        },
    ) as resp:
        assert resp.status_code == 200
        events = _extract_events(list(resp.iter_lines()))

    assert "hydrate" in order
    assert "prompt" in order
    assert order.index("hydrate") < order.index("prompt")
    assert captured.get(str(pdf)) == "HYDRATED_BODY"
    assert any(e.get("type") == "tool_progress" for e in events)
    assert any(
        (e.get("data") or {}).get("name") == "document_parse"
        for e in events
        if e.get("type") == "tool_progress"
    )


def test_chat_keeps_running_when_document_hydration_fails(monkeypatch, tmp_path) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())

    async def _boom(_turn_cf, _session_cf):
        raise RuntimeError("hydrate boom")

    monkeypatch.setattr(server_module, "hydrate_turn_context_files", _boom)

    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    with client.stream(
        "POST",
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "总结简历",
            "context_files": {str(pdf): "[附件] resume.pdf"},
        },
    ) as resp:
        assert resp.status_code == 200
        events = _extract_events(list(resp.iter_lines()))

    assert any(e.get("type") == "final" for e in events)
    assert not any(e.get("type") == "error" for e in events)


def test_group_chat_hydrates_document_before_router_turn(monkeypatch, tmp_path) -> None:
    from agenticx.runtime.group_router import GroupReply
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())
    order: List[str] = []
    seen_context: Dict[str, str] = {}

    async def _fake_hydrate(turn_cf, session_cf):
        order.append("hydrate")
        for key, value in turn_cf.items():
            if str(value).startswith("[附件] "):
                session_cf[key] = "GROUP_HYDRATED"
        return type("R", (), {"attempted": 1, "succeeded": 1, "failed": 0, "skipped": 0})()

    class _FakeGroupRouter:
        def __init__(self, **_kwargs) -> None:
            pass

        def pick_targets(self, **_kwargs):
            return ["meta"]

        def _plain_targets_in_text(self, *_args, **_kwargs):
            return []

        async def run_group_turn(self, **kwargs):
            order.append("router")
            base_session = kwargs.get("base_session")
            seen_context.update(dict(getattr(base_session, "context_files", {}) or {}))
            yield GroupReply(
                agent_id="meta",
                avatar_name="Machi",
                avatar_url="",
                content="group done",
                skipped=False,
                event_type="group_reply",
            )

    monkeypatch.setattr(server_module, "hydrate_turn_context_files", _fake_hydrate)
    monkeypatch.setattr(server_module, "GroupChatRouter", _FakeGroupRouter)

    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    app = create_studio_app()
    client = TestClient(app)
    avatar_registry = app.state.avatar_registry
    group_registry = app.state.group_registry
    session_id = client.get("/api/session").json()["session_id"]
    avatar = avatar_registry.create_avatar(name="测试成员", role="Engineer")
    group = group_registry.create_group(name="测试群", avatar_ids=[avatar.id], routing="intelligent")

    resp = client.post(
        "/api/chat",
        json={
            "session_id": session_id,
            "group_id": group.id,
            "user_input": "总结这份简历",
            "context_files": {str(pdf): "[附件] resume.pdf"},
        },
    )
    assert resp.status_code == 200
    _ = _extract_events(resp.text.splitlines())
    assert order == ["hydrate", "router"]
    assert seen_context.get(str(pdf)) == "GROUP_HYDRATED"


def test_chat_does_not_hydrate_plain_context_twice(monkeypatch, tmp_path) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())
    hydrate_calls = {"n": 0}

    async def _fake_hydrate(turn_cf, session_cf):
        hydrate_calls["n"] += 1
        # Plain text should already be present; placeholder path should hydrate.
        for key, value in turn_cf.items():
            if str(value).startswith("[附件] "):
                session_cf[key] = "PDF_BODY"
        return type("R", (), {"attempted": 1, "succeeded": 1, "failed": 0, "skipped": 0})()

    monkeypatch.setattr(server_module, "hydrate_turn_context_files", _fake_hydrate)

    pdf = tmp_path / "resume.pdf"
    notes = tmp_path / "notes.md"
    pdf.write_bytes(b"%PDF-1.4\n")
    notes.write_text("plain notes", encoding="utf-8")
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    manager = app.state.session_manager
    managed = manager.get(session_id)
    assert managed is not None

    with client.stream(
        "POST",
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "看看这些文件",
            "context_files": {
                str(notes): "plain notes",
                str(pdf): "[附件] resume.pdf",
            },
        },
    ) as resp:
        assert resp.status_code == 200
        _ = _extract_events(list(resp.iter_lines()))

    assert hydrate_calls["n"] == 1
    assert managed.studio_session.context_files.get(str(notes)) == "plain notes"
    assert managed.studio_session.context_files.get(str(pdf)) == "PDF_BODY"


def test_context_file_attachment_uses_source_file_size(monkeypatch, tmp_path) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())

    async def _fake_hydrate(turn_cf, session_cf):
        for key, value in turn_cf.items():
            if str(value).startswith("[附件] "):
                session_cf[key] = "HYDRATED"
        return type("R", (), {"attempted": 1, "succeeded": 1, "failed": 0, "skipped": 0})()

    monkeypatch.setattr(server_module, "hydrate_turn_context_files", _fake_hydrate)

    pdf = tmp_path / "resume.pdf"
    payload_bytes = b"%PDF-1.4\n" + (b"x" * 728_000)
    pdf.write_bytes(payload_bytes)
    expected_size = pdf.stat().st_size
    placeholder = "[附件] resume.pdf"
    assert expected_size != len(placeholder.encode("utf-8"))

    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    managed = app.state.session_manager.get(session_id)
    assert managed is not None

    with client.stream(
        "POST",
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "总结简历",
            "context_files": {str(pdf): placeholder},
        },
    ) as resp:
        assert resp.status_code == 200
        _ = _extract_events(list(resp.iter_lines()))

    user_msgs = [
        m for m in managed.studio_session.chat_history if m.get("role") == "user"
    ]
    assert user_msgs
    atts = user_msgs[-1].get("attachments") or []
    assert atts
    doc = next((a for a in atts if a.get("kind") == "context_file"), None)
    assert doc is not None
    assert doc.get("source_path") == str(pdf)
    assert int(doc.get("size") or 0) == expected_size


def test_context_file_attachment_size_falls_back_when_path_missing(monkeypatch, tmp_path) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())

    async def _fake_hydrate(turn_cf, session_cf):
        for key, value in turn_cf.items():
            session_cf.setdefault(key, value)
        return type("R", (), {"attempted": 0, "succeeded": 0, "failed": 0, "skipped": 1})()

    monkeypatch.setattr(server_module, "hydrate_turn_context_files", _fake_hydrate)

    missing = tmp_path / "gone.pdf"
    # Do not create the file — path is absolute but unreadable.
    placeholder = "[附件] gone.pdf"
    expected_fallback = len(placeholder.encode("utf-8"))

    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    managed = app.state.session_manager.get(session_id)
    assert managed is not None

    with client.stream(
        "POST",
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "看看附件",
            "context_files": {str(missing): placeholder},
        },
    ) as resp:
        assert resp.status_code == 200
        _ = _extract_events(list(resp.iter_lines()))

    user_msgs = [
        m for m in managed.studio_session.chat_history if m.get("role") == "user"
    ]
    assert user_msgs
    atts = user_msgs[-1].get("attachments") or []
    assert atts
    doc = next((a for a in atts if a.get("kind") == "context_file"), None)
    assert doc is not None
    assert int(doc.get("size") or 0) == expected_fallback

