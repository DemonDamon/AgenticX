#!/usr/bin/env python3
"""Studio chat binds one stable request id around its LLM producer."""

from __future__ import annotations

import uuid
from collections import deque
from functools import partial
from typing import Any

from fastapi.testclient import TestClient

from agenticx.llms.request_context import (
    current_llm_turn_id,
    reset_current_llm_turn_id,
    set_current_llm_turn_id,
)
from agenticx.memory import session_store as session_store_module
from agenticx.runtime.group_context import GroupChatContext
from agenticx.studio.server import create_studio_app


class _Response:
    content = "done"
    tool_calls: list[dict[str, Any]] = []


class _TurnAwareLLM:
    def __init__(self) -> None:
        self.turn_ids: list[str] = []

    def invoke(self, *_args: Any, **_kwargs: Any) -> _Response:
        self.turn_ids.append(current_llm_turn_id())
        return _Response()

    def stream(self, *_args: Any, **_kwargs: Any):
        self.turn_ids.append(current_llm_turn_id())
        yield "done"


def _client(monkeypatch, tmp_path) -> tuple[TestClient, str, _TurnAwareLLM]:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(
        session_store_module,
        "DEFAULT_SESSION_DB_PATH",
        tmp_path / "memory" / "sessions.sqlite",
    )
    from agenticx.studio import server as server_module

    llm = _TurnAwareLLM()
    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: llm)
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    return client, session_id, llm


def test_chat_producer_uses_client_turn_id(monkeypatch, tmp_path) -> None:
    client, session_id, llm = _client(monkeypatch, tmp_path)

    response = client.post(
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "hello",
            "client_turn_id": "desktop-turn-1",
        },
    )

    assert response.status_code == 200
    assert llm.turn_ids
    assert set(llm.turn_ids) == {"desktop-turn-1"}
    assert current_llm_turn_id() == ""


def test_chat_producer_generates_request_local_turn_id(monkeypatch, tmp_path) -> None:
    client, session_id, llm = _client(monkeypatch, tmp_path)

    response = client.post(
        "/api/chat",
        json={"session_id": session_id, "user_input": "hello"},
    )

    assert response.status_code == 200
    assert llm.turn_ids
    assert len(set(llm.turn_ids)) == 1
    assert str(uuid.UUID(llm.turn_ids[0])) == llm.turn_ids[0]
    managed = client.app.state.session_manager.get(session_id, touch=False)
    assert managed is not None
    user_rows = [
        row
        for row in managed.studio_session.chat_history
        if row.get("role") == "user"
    ]
    assert user_rows[-1]["metadata"]["client_turn_id"] == llm.turn_ids[0]
    assert current_llm_turn_id() == ""


def test_separate_chat_requests_generate_separate_turn_ids(monkeypatch, tmp_path) -> None:
    client, session_id, llm = _client(monkeypatch, tmp_path)

    for user_input in ("first task", "second task"):
        response = client.post(
            "/api/chat",
            json={"session_id": session_id, "user_input": user_input},
        )
        assert response.status_code == 200

    assert len(llm.turn_ids) >= 2
    first_turn_id, second_turn_id = llm.turn_ids[0], llm.turn_ids[-1]
    assert first_turn_id != second_turn_id
    managed = client.app.state.session_manager.get(session_id, touch=False)
    assert managed is not None
    user_rows = [
        row
        for row in managed.studio_session.chat_history
        if row.get("role") == "user"
    ]
    assert [
        row["metadata"]["client_turn_id"] for row in user_rows[-2:]
    ] == [first_turn_id, second_turn_id]


def test_loop_reuses_one_client_turn_id_across_iterations(monkeypatch, tmp_path) -> None:
    client, session_id, llm = _client(monkeypatch, tmp_path)

    response = client.post(
        "/api/loop",
        json={
            "session_id": session_id,
            "user_input": "keep iterating",
            "client_turn_id": "loop-turn-1",
            "completion_promise": "NEVER_RETURNED",
            "max_iterations": 2,
        },
    )

    assert response.status_code == 200
    assert len(llm.turn_ids) >= 2
    assert set(llm.turn_ids) == {"loop-turn-1"}
    managed = client.app.state.session_manager.get(session_id, touch=False)
    assert managed is not None
    loop_user_rows = [
        row
        for row in managed.studio_session.chat_history
        if row.get("role") == "user"
        and str(row.get("content", "")).startswith("[Loop Iteration")
    ]
    assert len(loop_user_rows) == 2
    assert {
        row["metadata"]["client_turn_id"] for row in loop_user_rows
    } == {"loop-turn-1"}
    assert current_llm_turn_id() == ""


def test_continuation_after_loop_reuses_loop_turn_id(monkeypatch, tmp_path) -> None:
    client, session_id, llm = _client(monkeypatch, tmp_path)
    response = client.post(
        "/api/loop",
        json={
            "session_id": session_id,
            "user_input": "build in stages",
            "client_turn_id": "loop-task-continuation",
            "completion_promise": "NEVER_RETURNED",
            "max_iterations": 2,
        },
    )
    assert response.status_code == 200

    from agenticx.studio import server as server_module

    monkeypatch.setattr(
        server_module,
        "prepare_continue",
        lambda *_args, **_kwargs: (
            True,
            "continue the staged work",
            1,
            {"content": "continuing", "metadata": {}},
        ),
    )
    llm.turn_ids.clear()
    response = client.post(
        f"/api/sessions/{session_id}/continue",
        json={"reason": "manual", "source": "desktop_manual"},
    )

    assert response.status_code == 200
    assert llm.turn_ids
    assert set(llm.turn_ids) == {"loop-task-continuation"}


def test_loop_rejects_invalid_header_id_and_generates_uuid(monkeypatch, tmp_path) -> None:
    client, session_id, llm = _client(monkeypatch, tmp_path)

    response = client.post(
        "/api/loop",
        json={
            "session_id": session_id,
            "user_input": "one pass",
            "client_turn_id": "bad\nheader",
            "max_iterations": 1,
        },
    )

    assert response.status_code == 200
    assert llm.turn_ids
    assert len(set(llm.turn_ids)) == 1
    assert str(uuid.UUID(llm.turn_ids[0])) == llm.turn_ids[0]


def test_continuation_reuses_latest_real_user_turn_id(monkeypatch, tmp_path) -> None:
    client, session_id, llm = _client(monkeypatch, tmp_path)
    managed = client.app.state.session_manager.get(session_id, touch=False)
    assert managed is not None
    managed.studio_session.chat_history = [
        {
            "role": "user",
            "content": "build the report",
            "metadata": {"client_turn_id": "original-turn-7"},
        },
        {"role": "assistant", "content": "partial result"},
        {
            "role": "user",
            "content": "[auto-nudge] continue",
            "metadata": {"client_turn_id": "internal-nudge-id"},
        },
    ]
    # A continuation deliberately reuses the task id. It must bypass the
    # external POST idempotency guard while still propagating that identity.
    managed._recent_client_turn_ids = deque(["original-turn-7"], maxlen=64)

    from agenticx.studio import server as server_module

    monkeypatch.setattr(
        server_module,
        "prepare_continue",
        lambda *_args, **_kwargs: (
            True,
            "continue from the partial result",
            1,
            {"content": "continuing", "metadata": {}},
        ),
    )

    response = client.post(
        f"/api/sessions/{session_id}/continue",
        json={"reason": "manual", "source": "desktop_manual"},
    )

    assert response.status_code == 200
    assert llm.turn_ids
    assert set(llm.turn_ids) == {"original-turn-7"}
    assert current_llm_turn_id() == ""


def test_supervisor_continuation_reuses_latest_real_user_turn_id(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(
        session_store_module,
        "DEFAULT_SESSION_DB_PATH",
        tmp_path / "memory" / "sessions.sqlite",
    )
    from agenticx.studio import server as server_module
    from agenticx.studio import supervisor as supervisor_module

    llm = _TurnAwareLLM()
    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: llm)
    monkeypatch.setattr(
        server_module,
        "prepare_continue",
        lambda *_args, **_kwargs: (
            True,
            "continue unattended work",
            1,
            {"content": "continuing", "metadata": {}},
        ),
    )
    captured: dict[str, Any] = {}

    async def _capture_supervisor(_app, _manager, continue_fn):
        captured["continue_fn"] = continue_fn
        return None

    monkeypatch.setattr(supervisor_module, "maybe_start_supervisor", _capture_supervisor)
    app = create_studio_app()
    with TestClient(app) as client:
        session_id = client.get("/api/session").json()["session_id"]
        managed = app.state.session_manager.get(session_id, touch=False)
        assert managed is not None
        managed.studio_session.chat_history = [
            {
                "role": "user",
                "content": "finish the unattended task",
                "metadata": {"client_turn_id": "unattended-turn-4"},
            },
            {"role": "assistant", "content": "partial result"},
        ]

        result = client.portal.call(
            partial(
                captured["continue_fn"],
                session_id,
                reason="interrupted",
                source="supervisor",
                skip_dedupe=True,
            )
        )

    assert result is True
    assert llm.turn_ids
    assert set(llm.turn_ids) == {"unattended-turn-4"}
    assert current_llm_turn_id() == ""


def test_group_user_history_persists_bound_turn_id() -> None:
    session = type("Session", (), {"chat_history": []})()
    context = GroupChatContext(session)
    token = set_current_llm_turn_id("group-turn-3")
    try:
        context.append_user("coordinate the specialists")
    finally:
        reset_current_llm_turn_id(token)

    assert session.chat_history == [
        {
            "role": "user",
            "content": "coordinate the specialists",
            "sender_id": "user",
            "sender_name": "我",
            "agent_id": "user",
            "quoted_message_id": "",
            "quoted_content": "",
            "metadata": {"client_turn_id": "group-turn-3"},
        }
    ]
