#!/usr/bin/env python3
"""Route-level tests for token-budget preflight before session mutation.

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient

from agenticx.memory import session_store as session_store_module
from agenticx.runtime.token_budget import TOKEN_BUDGET_SCRATCHPAD_KEY
from agenticx.studio.server import create_studio_app


def _events(response_text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in response_text.splitlines():
        if not line.startswith("data: "):
            continue
        rows.append(json.loads(line[6:]))
    return rows


def _blocked_session(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(
        session_store_module,
        "DEFAULT_SESSION_DB_PATH",
        tmp_path / "memory" / "sessions.sqlite",
    )
    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    managed = app.state.session_manager.get(session_id, touch=False)
    assert managed is not None
    managed.studio_session.scratchpad[TOKEN_BUDGET_SCRATCHPAD_KEY] = {
        "version": 1,
        "cumulative_input": 9_000_000,
        "cumulative_output": 0,
        "warning_emitted": True,
    }
    return app, client, session_id, managed


def _assert_budget_terminal(response_text: str) -> None:
    events = _events(response_text)
    assert [row["type"] for row in events] == ["error", "done"]
    payload = events[0]["data"]
    assert payload["detector"] == "token_budget"
    assert payload["budget_exceeded"] is True
    assert payload["blocked_before_model"] is True
    assert payload["agent_id"] == "meta"


def test_chat_budget_preflight_runs_before_route_mutations(monkeypatch, tmp_path) -> None:
    from agenticx.studio import server as server_module

    app, client, session_id, managed = _blocked_session(monkeypatch, tmp_path)
    monkeypatch.setattr(
        server_module.ProviderResolver,
        "resolve",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("LLM must not resolve")),
    )
    updated_before = managed.updated_at
    name_before = managed.session_name
    chat_before = list(managed.studio_session.chat_history)
    agent_before = list(managed.studio_session.agent_messages)

    response = client.post(
        "/api/chat",
        json={"session_id": session_id, "user_input": "must remain unpersisted"},
    )

    assert response.status_code == 200
    _assert_budget_terminal(response.text)
    assert managed.updated_at == updated_before
    assert managed.session_name == name_before
    assert managed.studio_session.chat_history == chat_before
    assert managed.studio_session.agent_messages == agent_before


def test_loop_budget_preflight_runs_before_touch_or_llm_resolution(monkeypatch, tmp_path) -> None:
    from agenticx.studio import server as server_module

    _app, client, session_id, managed = _blocked_session(monkeypatch, tmp_path)
    monkeypatch.setattr(
        server_module.ProviderResolver,
        "resolve",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("LLM must not resolve")),
    )
    updated_before = managed.updated_at
    chat_before = list(managed.studio_session.chat_history)
    agent_before = list(managed.studio_session.agent_messages)

    response = client.post(
        "/api/loop",
        json={"session_id": session_id, "user_input": "must remain unpersisted"},
    )

    assert response.status_code == 200
    _assert_budget_terminal(response.text)
    assert managed.updated_at == updated_before
    assert managed.studio_session.chat_history == chat_before
    assert managed.studio_session.agent_messages == agent_before


def test_continue_budget_preflight_runs_before_recovery_mutations(monkeypatch, tmp_path) -> None:
    _app, client, session_id, managed = _blocked_session(monkeypatch, tmp_path)
    updated_before = managed.updated_at
    provider_before = managed.studio_session.provider_name
    model_before = managed.studio_session.model_name
    chat_before = list(managed.studio_session.chat_history)
    agent_before = list(managed.studio_session.agent_messages)

    response = client.post(
        f"/api/sessions/{session_id}/continue",
        json={
            "reason": "manual",
            "source": "desktop_manual",
            "provider": "must-not-apply",
            "model": "must-not-apply",
        },
    )

    assert response.status_code == 200
    _assert_budget_terminal(response.text)
    assert managed.updated_at == updated_before
    assert managed.studio_session.provider_name == provider_before
    assert managed.studio_session.model_name == model_before
    assert managed.studio_session.chat_history == chat_before
    assert managed.studio_session.agent_messages == agent_before
