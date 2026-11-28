#!/usr/bin/env python3
"""Replay-ledger wiring tests for the harness event outlet (04).

Drives ``run_external_harness_turn`` with the studio wiring-test fakes
(RecordingAdapter / FakeManager) against a tmp sessions root, then
asserts the ledger namespace, event sequence, and the isolation of every
existing ledger reader.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.registry import HarnessRegistry
from agenticx.harness.types import (
    TURN_STATUS_ERROR,
    TURN_STATUS_SUCCESS,
    TURN_STATUS_TIMEOUT,
    HarnessCapabilities,
    TurnRequest,
    TurnResult,
)
from agenticx.harness.handoff import HandoffEngine, HandoffStore
import agenticx.studio.harness_wiring as hw


class LedgerRecordingAdapter(HarnessAdapter):
    """In-memory adapter; turn status is scripted per test."""

    def __init__(self, harness_id: str = "alpha", status: str = "success") -> None:
        self.harness_id = harness_id
        self.display_name = harness_id.title()
        self.description = f"{harness_id} adapter"
        self._status = status
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self.spawn_count = 0

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=False, pty=False, streaming=False, resume=True
        )

    def spawn(self, cwd: str, *, options: Optional[Dict[str, Any]] = None):
        self.spawn_count += 1
        sid = f"{self.harness_id}-surf-{self.spawn_count}"
        self._sessions[sid] = {
            "session_id": sid,
            "cwd": cwd,
            "state": "idle",
            "options": dict(options or {}),
            "native_thread_id": f"{self.harness_id}-native-{self.spawn_count}",
            "raw": {},
        }
        return dict(self._sessions[sid])

    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        self._emit_turn_started(session_id, request)
        result = TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=self._status,
            result_text=f"{self.harness_id} reply",
            tail="",
            detail={"native_thread_id": "n-1"},
        )
        self._emit_turn_finished(session_id, result)
        return result

    def stop(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None

    def available(self) -> bool:
        return True

    def describe(self, session_id: str):
        return self._sessions.get(session_id)

    def list_sessions(self) -> List[Dict[str, Any]]:
        return list(self._sessions.values())


class FakeManaged:
    def __init__(self, session: StudioSession) -> None:
        self.studio_session = session
        self.execution_state = "idle"
        self.updated_at = 0.0


class FakeManager:
    def __init__(self, session: StudioSession, sessions_root: str) -> None:
        self._session = session
        self._sessions_root = sessions_root

    def get(self, session_id: str, touch: bool = True):
        if str(session_id) == self._session.session_id:
            return FakeManaged(self._session)
        return None

    def get_session_harness(self, session_id: str):
        s = self._session
        return {
            "harness_id": s.harness_id,
            "harness_thread_id": s.harness_thread_id,
            "harness_options": s.harness_options,
            "harness_session_id": s.harness_session_id,
        }

    def set_session_harness(
        self,
        session_id: str,
        *,
        harness_id,
        thread_id=None,
        options=None,
        surface_session_id=None,
    ) -> bool:
        s = self._session
        normalized = harness_id if harness_id not in (None, "", "python-agent") else None
        s.harness_id = normalized
        s.harness_thread_id = (
            str(thread_id).strip() or None
            if (normalized is not None and thread_id is not None)
            else None
        )
        s.harness_options = dict(options) if (normalized and options) else None
        s.harness_session_id = (
            str(surface_session_id).strip() or None
            if (normalized is not None and surface_session_id is not None)
            else None
        )
        return True

    def _persist_session_state(self, session_id: str, session: Any) -> bool:
        return True


def make_session(sid: str = "sess-ledger", cwd: str = "/tmp/led-ws") -> StudioSession:
    s = StudioSession()
    s.session_id = sid
    s.workspace_dir = cwd
    s.chat_history = []
    return s


@pytest.fixture
def ledger_env(tmp_path, monkeypatch):
    alpha = LedgerRecordingAdapter()
    reg = HarnessRegistry()
    reg.register(alpha)
    store = HandoffStore(str(tmp_path / "handoffs"))
    engine = HandoffEngine(reg, store)
    monkeypatch.setattr(hw, "_registry", reg)
    monkeypatch.setattr(hw, "_engine", engine)
    monkeypatch.setattr(hw, "_inflight_turns", {})
    monkeypatch.delenv("AGX_HARNESS_LEDGER_EVENTS", raising=False)
    root = tmp_path / "sessions"
    root.mkdir()
    return {
        "adapter": alpha,
        "root": root,
        "manager": lambda session: FakeManager(session, str(root)),
    }


def _read_events(root: Path, namespace: str):
    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    ledger = ReplayLedgerStore(root)
    runs = ledger.list_runs(namespace)
    assert runs, f"no runs under {namespace}"
    events, _more = ledger.read_events(runs[0].run_id)
    return runs[0], list(events)


def test_external_turn_is_recorded_in_the_ledger_namespace(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    result = hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    assert result.ok and result.result_text == "alpha reply"
    run, events = _read_events(env["root"], "sess-ledger:harness")
    assert run.status == "completed"
    assert run.agent_id == "alpha"
    assert [e.type for e in events] == [
        "run_started",
        "user_message",
        "assistant_output_completed",
        "run_completed",
    ]
    user_row = next(e for e in events if e.type == "user_message")
    assert user_row.payload["text"] == "first task"


def test_harness_ledger_never_shadows_the_owner_session(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    from agenticx.runtime.replay_ledger.resume_anchor import find_open_run
    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    ledger = ReplayLedgerStore(env["root"])
    assert ledger.list_runs("sess-ledger") == []
    assert find_open_run(ledger, "sess-ledger") is None


def test_failed_turn_is_recorded_with_error_event(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")
    env["adapter"]._status = TURN_STATUS_ERROR

    result = hw.run_external_harness_turn(manager, "sess-ledger", "boom")

    assert not result.ok
    run, events = _read_events(env["root"], "sess-ledger:harness")
    assert run.status == "failed"
    types = [e.type for e in events]
    assert "error" in types
    assert types[-1] == "run_completed"


def test_timeout_turn_maps_to_interrupted(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")
    env["adapter"]._status = TURN_STATUS_TIMEOUT

    hw.run_external_harness_turn(manager, "sess-ledger", "slow")

    run, _events = _read_events(env["root"], "sess-ledger:harness")
    assert run.status == "interrupted"


def test_switch_off_keeps_the_ledger_empty(ledger_env, monkeypatch):
    env = ledger_env
    monkeypatch.setenv("AGX_HARNESS_LEDGER_EVENTS", "0")
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    result = hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    assert result.ok
    assert not (env["root"] / "sess-ledger:harness").exists()
    roles = [m["role"] for m in session.chat_history]
    assert roles == ["user", "assistant"]


def test_bridge_failure_does_not_break_the_turn(ledger_env, monkeypatch):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")
    monkeypatch.setattr(
        "agenticx.harness.ledger_outlet.build_turn_ledger_bridge",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("no ledger")),
    )

    result = hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    assert result.ok and result.result_text == "alpha reply"


def test_provider_mismatch_retry_is_recorded_as_a_second_run(
    ledger_env, monkeypatch
):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    calls = {"n": 0}

    def _mismatch_only_once(result):
        calls["n"] += 1
        return calls["n"] == 1

    monkeypatch.setattr(hw, "is_codex_model_provider_mismatch", _mismatch_only_once)

    result = hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    assert result.ok
    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    ledger = ReplayLedgerStore(env["root"])
    runs = ledger.list_runs("sess-ledger:harness")
    # The retry runs on a fresh surface session; the sink must move with it
    # so both the failed attempt and the retried turn reach the bridge.
    assert len(runs) == 2
    assert [r.status for r in runs] == ["completed", "completed"]


def test_output_blob_carries_the_result_text(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    ledger = ReplayLedgerStore(env["root"])
    run = ledger.list_runs("sess-ledger:harness")[0]
    events, _more = ledger.read_events(run.run_id)
    final = [e for e in events if e.type == "assistant_output_completed"][0]
    # FINAL rows are not truncated summaries (resolve_payload would return
    # the row payload); the full text lives in the content-addressed blob.
    payload = ledger.read_blob(final.run_id, final.payload_ref)
    assert payload["text"] == "alpha reply"
    assert payload["harness"] == "alpha"
