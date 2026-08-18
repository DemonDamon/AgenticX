#!/usr/bin/env python3
"""Route-level regression tests for non-blocking session token notices.

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient

from agenticx.memory import session_store as session_store_module
from agenticx.runtime.token_budget import TOKEN_BUDGET_SCRATCHPAD_KEY
from agenticx.studio.server import create_studio_app


class _TextResponse:
    content = "done"
    tool_calls: list[dict[str, Any]] = []


class _TextLLM:
    def invoke(self, *_args: Any, **_kwargs: Any) -> _TextResponse:
        return _TextResponse()

    def stream(self, *_args: Any, **_kwargs: Any):
        yield "done"


def _events(response_text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in response_text.splitlines():
        if line.startswith("data: "):
            rows.append(json.loads(line[6:]))
    return rows


def _red_session(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(
        session_store_module,
        "DEFAULT_SESSION_DB_PATH",
        tmp_path / "memory" / "sessions.sqlite",
    )
    from agenticx.studio import server as server_module

    llm = _TextLLM()
    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: llm)
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
        "warning_emitted_at": 500_000,
    }
    return client, session_id


def _assert_non_blocking_red_notice(response_text: str) -> None:
    events = _events(response_text)
    assert any(row["type"] == "final" for row in events)
    assert not any((row.get("data") or {}).get("budget_exceeded") for row in events)
    red = [
        row
        for row in events
        if (row.get("data") or {}).get("detector") == "token_budget_session_reached"
    ]
    assert len(red) == 1
    assert red[0]["data"]["warning_level"] == "red"
    assert red[0]["data"]["blocking"] is False


def test_chat_above_red_threshold_still_runs_to_final(monkeypatch, tmp_path) -> None:
    client, session_id = _red_session(monkeypatch, tmp_path)

    response = client.post(
        "/api/chat",
        json={"session_id": session_id, "user_input": "keep working"},
    )

    assert response.status_code == 200
    _assert_non_blocking_red_notice(response.text)


def test_loop_above_red_threshold_still_runs_to_final(monkeypatch, tmp_path) -> None:
    client, session_id = _red_session(monkeypatch, tmp_path)

    response = client.post(
        "/api/loop",
        json={"session_id": session_id, "user_input": "keep looping", "max_iterations": 1},
    )

    assert response.status_code == 200
    _assert_non_blocking_red_notice(response.text)
