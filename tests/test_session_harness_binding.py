#!/usr/bin/env python3
"""Session-harness binding tests (SP3 of harness-control-surface).

Covers: bind/unbind/read semantics, unknown-harness validation, builtin
python-agent aliasing, persistence round-trip (metadata save -> restore),
list_sessions exposure, and the desktop-facing HTTP API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.studio.session_manager import ManagedSession, SessionManager


class _FakeSessionStore:
    """Captures metadata saves; serves them back like the real store."""

    def __init__(self) -> None:
        self.saved_metadata: Dict[str, Dict[str, Any]] = {}

    def _save_session_summary_sync(self, sid: str, summary, metadata) -> None:
        self.saved_metadata[sid] = dict(metadata or {})

    def _load_latest_session_metadata_sync(self, sid: str) -> Optional[Dict[str, Any]]:
        return self.saved_metadata.get(sid)

    def _save_todos_sync(self, sid: str, payload) -> None:
        return None

    def _save_scratchpad_sync(self, sid: str, payload) -> None:
        return None

    def _index_session_messages_sync(self, sid: str, messages) -> None:
        return None

    def _max_message_timestamps_sync(self, sids) -> Dict[str, float]:
        return {}

    def _recover_activity_from_summaries_bulk_sync(self, sids) -> Dict[str, float]:
        return {}


def _manager_with_session(sid: str = "hb-test") -> SessionManager:
    manager = SessionManager()
    managed = ManagedSession(session_id=sid, studio_session=StudioSession())
    manager._sessions[sid] = managed
    return manager


def _stub_persist(manager: SessionManager, store: _FakeSessionStore) -> None:
    manager._session_store = store
    manager._persist_core_snapshots = lambda *a, **k: True  # type: ignore[method-assign]


# ----------------------------------------------------------------------
# manager-level binding semantics
# ----------------------------------------------------------------------
def test_bind_unbind_and_read() -> None:
    manager = _manager_with_session()
    _stub_persist(manager, _FakeSessionStore())

    ok = manager.set_session_harness(
        "hb-test",
        harness_id="claude-code",
        thread_id="  thread-1  ",
        options={"mode": "headless"},
    )
    assert ok is True
    binding = manager.get_session_harness("hb-test")
    assert binding == {
        "harness_id": "claude-code",
        "harness_thread_id": "thread-1",
        "harness_options": {"mode": "headless"},
        "harness_session_id": None,
    }

    assert manager.clear_session_harness("hb-test") is True
    assert manager.get_session_harness("hb-test") == {
        "harness_id": None,
        "harness_thread_id": None,
        "harness_options": None,
        "harness_session_id": None,
    }


def test_bind_unknown_harness_raises() -> None:
    manager = _manager_with_session()
    _stub_persist(manager, _FakeSessionStore())
    with pytest.raises(ValueError, match="unknown harness"):
        manager.set_session_harness("hb-test", harness_id="gpt-9")


def test_python_agent_alias_clears_binding() -> None:
    manager = _manager_with_session()
    _stub_persist(manager, _FakeSessionStore())
    assert manager.set_session_harness(
        "hb-test", harness_id="claude-code", options={"mode": "headless"}
    )
    # re-binding to the builtin runtime clears thread/options too
    assert manager.set_session_harness("hb-test", harness_id="python-agent")
    assert manager.get_session_harness("hb-test")["harness_id"] is None


def test_bind_missing_session_returns_false() -> None:
    manager = _manager_with_session()
    _stub_persist(manager, _FakeSessionStore())
    assert manager.set_session_harness("no-such", harness_id="claude-code") is False
    assert manager.get_session_harness("no-such") is None


def test_unbind_ignores_thread_and_options() -> None:
    manager = _manager_with_session()
    _stub_persist(manager, _FakeSessionStore())
    assert manager.set_session_harness(
        "hb-test", harness_id=None, thread_id="t", options={"x": 1}
    )
    binding = manager.get_session_harness("hb-test")
    assert binding["harness_id"] is None
    assert binding["harness_thread_id"] is None
    assert binding["harness_options"] is None


# ----------------------------------------------------------------------
# persistence round-trip
# ----------------------------------------------------------------------
def test_binding_persists_and_restores_roundtrip() -> None:
    manager = _manager_with_session("hb-rt")
    store = _FakeSessionStore()
    _stub_persist(manager, store)

    assert manager.set_session_harness(
        "hb-rt",
        harness_id="codebuddy",
        thread_id="wb-thread-9",
        options={"permission_mode": "acceptEdits"},
    )

    # metadata written to the store carries the binding
    metadata = store.saved_metadata["hb-rt"]
    assert metadata["harness_id"] == "codebuddy"
    assert metadata["harness_thread_id"] == "wb-thread-9"
    assert metadata["harness_options"] == {"permission_mode": "acceptEdits"}

    # cold restart: a fresh session restores the binding from metadata
    fresh = StudioSession()
    manager._restore_persisted_state("hb-rt", fresh)
    assert fresh.harness_id == "codebuddy"
    assert fresh.harness_thread_id == "wb-thread-9"
    assert fresh.harness_options == {"permission_mode": "acceptEdits"}

    # unbind + persist -> restore yields unbound session
    assert manager.clear_session_harness("hb-rt")
    fresh2 = StudioSession()
    manager._restore_persisted_state("hb-rt", fresh2)
    assert fresh2.harness_id is None
    assert fresh2.harness_thread_id is None
    assert fresh2.harness_options is None


def test_restore_python_agent_alias_normalizes_to_none() -> None:
    manager = _manager_with_session("hb-alias")
    store = _FakeSessionStore()
    _stub_persist(manager, store)
    store.saved_metadata["hb-alias"] = {"harness_id": "python-agent"}
    fresh = StudioSession()
    manager._restore_persisted_state("hb-alias", fresh)
    assert fresh.harness_id is None


def test_list_sessions_exposes_binding() -> None:
    manager = _manager_with_session("hb-list")
    _stub_persist(manager, _FakeSessionStore())
    managed = manager._sessions["hb-list"]
    managed.studio_session.chat_history = [
        {"role": "user", "content": "hello", "timestamp": 1},
    ]
    assert manager.set_session_harness(
        "hb-list", harness_id="claude-code", thread_id="t1"
    )
    rows = manager.list_sessions()
    row = next(r for r in rows if r["session_id"] == "hb-list")
    assert row["harness_id"] == "claude-code"
    assert row["harness_thread_id"] == "t1"


# ----------------------------------------------------------------------
# HTTP API (desktop-facing)
# ----------------------------------------------------------------------
def _headers() -> Dict[str, str]:
    return {"x-agx-desktop-token": "test-token"}


def test_harness_api_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    from agenticx.studio import server as studio_server
    from agenticx.studio.server import create_studio_app

    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "test-token")
    monkeypatch.setattr(studio_server, "load_available_servers", lambda: {})
    app = create_studio_app()
    client = TestClient(app)

    # auth enforced
    assert client.get("/api/harnesses").status_code == 401

    # catalog: builtin first + registered adapters with capabilities
    r = client.get("/api/harnesses", headers=_headers())
    assert r.status_code == 200
    harnesses = {h["harness_id"]: h for h in r.json()["harnesses"]}
    assert harnesses["python-agent"]["builtin"] is True
    assert harnesses["python-agent"]["available"] is True
    assert harnesses["claude-code"]["capabilities"]["permission"] is True
    assert harnesses["claude-code"]["builtin"] is False
    assert isinstance(harnesses["claude-code"]["available"], bool)

    # create a session then bind
    created = client.get("/api/session", headers=_headers())
    assert created.status_code == 200
    sid = created.json()["session_id"]

    # avoid touching the real persistence layer in unit tests; the
    # round-trip itself is covered above at manager level
    app.state.session_manager._persist_session_state = (  # type: ignore[method-assign]
        lambda *a, **k: True
    )

    r = client.post(
        f"/api/sessions/{sid}/harness",
        headers=_headers(),
        json={"harness_id": "claude-code", "options": {"mode": "headless"}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["harness_id"] == "claude-code"
    assert body["harness_options"] == {"mode": "headless"}

    # read-back of the sticky binding
    r = client.get(f"/api/sessions/{sid}/harness", headers=_headers())
    assert r.status_code == 200, r.text
    assert r.json()["harness_id"] == "claude-code"

    # unknown harness -> 400 with available ids
    r = client.post(
        f"/api/sessions/{sid}/harness",
        headers=_headers(),
        json={"harness_id": "nope"},
    )
    assert r.status_code == 400
    assert "unknown harness" in r.json()["detail"]

    # unbind via python-agent alias
    r = client.post(
        f"/api/sessions/{sid}/harness",
        headers=_headers(),
        json={"harness_id": "python-agent"},
    )
    assert r.status_code == 200
    assert r.json()["harness_id"] is None

    # No session-level harness_id: backfill from the latest message stamp
    # and persist it so the next open does not fall through to Settings.
    managed = app.state.session_manager.get(sid)
    assert managed is not None
    managed.studio_session.harness_id = None
    managed.studio_session.chat_history = [
        {"role": "user", "content": "hi", "metadata": {"harness": "claude-code"}},
        {
            "role": "assistant",
            "content": "done",
            "metadata": {"harness": "claude-code"},
        },
    ]
    r = client.get(f"/api/sessions/{sid}/harness", headers=_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["harness_id"] is None
    assert body["recovered_harness_id"] == "claude-code"
    assert app.state.session_manager.get_session_harness(sid)["harness_id"] == "claude-code"

    # An explicit builtin switch that is still the tail must not be undone.
    managed.studio_session.harness_id = None
    managed.studio_session.chat_history = [
        {"role": "user", "content": "hi", "metadata": {"harness": "claude-code"}},
        {
            "role": "system",
            "content": "switched",
            "metadata": {
                "kind": "harness_switch",
                "from_harness": "claude-code",
                "to_harness": None,
                "strategy": "builtin",
            },
        },
    ]
    r = client.get(f"/api/sessions/{sid}/harness", headers=_headers())
    assert r.status_code == 200, r.text
    assert r.json()["recovered_harness_id"] is None
    assert app.state.session_manager.get_session_harness(sid)["harness_id"] is None

    # missing session -> 404
    r = client.post(
        "/api/sessions/00000000-0000-0000-0000-000000000000/harness",
        headers=_headers(),
        json={"harness_id": "claude-code"},
    )
    assert r.status_code == 404
