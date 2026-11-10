#!/usr/bin/env python3
"""Tests for the SP5b studio harness wiring layer.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.registry import HarnessRegistry
from agenticx.harness.types import (
    TURN_STATUS_ERROR,
    TURN_STATUS_SUCCESS,
    HarnessCapabilities,
    TurnRequest,
    TurnResult,
)
from agenticx.harness.handoff import HandoffEngine, HandoffStore
from agenticx.harness.types import UnknownHarnessError


# ----------------------------------------------------------------------
# fixtures: fake adapter / fake manager
# ----------------------------------------------------------------------
class RecordingAdapter(HarnessAdapter):
    """In-memory adapter with native-thread bookkeeping."""

    def __init__(
        self,
        harness_id: str,
        available: bool = True,
        resume: bool = True,
    ) -> None:
        self.harness_id = harness_id
        self.display_name = harness_id.title()
        self.description = f"{harness_id} adapter"
        self._available = available
        self._resume = resume
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self.spawn_count = 0
        self.turns: List[Dict[str, Any]] = []
        self.adopted: List[tuple] = []

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=False,
            pty=False,
            streaming=False,
            turn_snapshots=False,
            idempotency=False,
            resume=self._resume,
        )

    def spawn(self, cwd: str, *, options: Optional[Dict[str, Any]] = None):
        self.spawn_count += 1
        sid = f"{self.harness_id}-surf-{self.spawn_count}"
        opts = dict(options or {})
        model = str(opts.get("model") or "").strip() or None
        self._sessions[sid] = {
            "session_id": sid,
            "cwd": cwd,
            "state": "idle",
            "options": opts,
            "native_thread_id": f"{self.harness_id}-native-{self.spawn_count}",
            "model": model,
            "raw": {"model": model},
        }
        return dict(self._sessions[sid])

    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        session = self._sessions[session_id]
        self.turns.append(
            {"session_id": session_id, "text": request.text}
        )
        return TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=TURN_STATUS_SUCCESS,
            result_text=f"{self.harness_id} reply #{len(self.turns)}",
            tail="",
            detail={"native_thread_id": session.get("native_thread_id")},
        )

    def stop(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None

    def available(self) -> bool:
        return self._available

    def describe(self, session_id: str) -> Optional[Dict[str, Any]]:
        return self._sessions.get(session_id)

    def list_sessions(self) -> List[Dict[str, Any]]:
        return list(self._sessions.values())

    def adopt_thread(self, session_id: str, native_thread_id: str) -> None:
        self._sessions[session_id]["native_thread_id"] = native_thread_id
        self.adopted.append((session_id, native_thread_id))


class FakeManaged:
    def __init__(self, session: StudioSession) -> None:
        self.studio_session = session
        self.execution_state = "idle"
        self.updated_at = 0.0
        self.session_name = "test session"


class FakeManager:
    """Minimal SessionManager stand-in covering the wiring surface."""

    def __init__(self, session: StudioSession) -> None:
        self._session = session
        self.persisted: List[str] = []

    def get(self, session_id: str, touch: bool = True) -> Optional[FakeManaged]:
        if str(session_id) == self._session.session_id:
            return FakeManaged(self._session)
        return None

    def set_session_harness(
        self,
        session_id: str,
        *,
        harness_id: Optional[str],
        thread_id: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
        surface_session_id: Optional[str] = None,
    ) -> bool:
        s = self._session
        normalized = harness_id
        if normalized in (None, "", "python-agent"):
            normalized = None
        s.harness_id = normalized
        # Mirror the real setter: str(None) must NOT become the string "None".
        s.harness_thread_id = (
            (str(thread_id).strip() or None)
            if (normalized is not None and thread_id is not None)
            else None
        )
        s.harness_options = dict(options) if (normalized and options) else None
        s.harness_session_id = (
            (str(surface_session_id).strip() or None)
            if (normalized is not None and surface_session_id is not None)
            else None
        )
        return True

    def get_session_harness(self, session_id: str) -> Optional[Dict[str, Any]]:
        s = self._session
        return {
            "harness_id": s.harness_id,
            "harness_thread_id": s.harness_thread_id,
            "harness_options": s.harness_options,
            "harness_session_id": s.harness_session_id,
        }

    def _persist_session_state(self, session_id: str, session: Any) -> bool:
        self.persisted.append(str(session_id))
        return True

    def set_session_model(
        self,
        session_id: str,
        *,
        provider: Optional[str] = None,
        model: Optional[str] = None,
    ) -> bool:
        if str(session_id) != self._session.session_id:
            return False
        if provider is not None:
            self._session.provider_name = str(provider or "").strip()
        if model is not None:
            self._session.model_name = str(model or "").strip()
        return True


def make_session(sid: str = "sess-1", cwd: str = "/tmp/wiring-ws") -> StudioSession:
    s = StudioSession()
    s.session_id = sid
    s.workspace_dir = cwd
    s.chat_history = []
    return s


@pytest.fixture
def wiring(tmp_path, monkeypatch):
    import agenticx.studio.harness_wiring as hw

    alpha = RecordingAdapter("alpha")
    beta = RecordingAdapter("beta")
    reg = HarnessRegistry()
    reg.register(alpha)
    reg.register(beta)
    store = HandoffStore(str(tmp_path / "handoffs"))
    engine = HandoffEngine(reg, store)
    monkeypatch.setattr(hw, "_registry", reg)
    monkeypatch.setattr(hw, "_engine", engine)
    monkeypatch.setattr(hw, "_inflight_turns", {})
    return hw, alpha, beta, store


# ----------------------------------------------------------------------
# turn routing
# ----------------------------------------------------------------------
def test_run_turn_requires_external_binding(wiring):
    hw, alpha, beta, _ = wiring
    manager = FakeManager(make_session())
    with pytest.raises(ValueError):
        hw.run_external_harness_turn(manager, "sess-1", "hello")


def test_run_turn_happy_path_records_messages(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")

    result = hw.run_external_harness_turn(manager, "sess-1", "first task")

    assert result.ok and result.result_text == "alpha reply #1"
    assert alpha.spawn_count == 1
    roles = [m["role"] for m in session.chat_history]
    assert roles == ["user", "assistant"]
    user_msg, asst_msg = session.chat_history
    assert user_msg["content"] == "first task"
    assert user_msg["metadata"]["harness"] == "alpha"
    assert asst_msg["metadata"]["harness"] == "alpha"
    assert asst_msg["metadata"]["native_thread_id"] == "alpha-native-1"
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_session_id"] == "alpha-surf-1"
    assert binding["harness_thread_id"] == "alpha-native-1"
    assert "sess-1" in manager.persisted


def test_skip_user_history_restamps_tail_user_without_duplicate(wiring):
    hw, alpha, _beta, _store = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")
    session.chat_history = [
        {
            "role": "user",
            "content": "first task",
            "metadata": {"harness": "codebuddy", "client_turn_id": "c1"},
        }
    ]

    hw.run_external_harness_turn(
        manager, "sess-1", "first task", skip_user_history=True
    )

    user_rows = [m for m in session.chat_history if m["role"] == "user"]
    assert len(user_rows) == 1
    assert user_rows[0]["metadata"]["harness"] == "alpha"
    assert user_rows[0]["metadata"]["harness_id"] == "alpha"
    assert user_rows[0]["metadata"]["client_turn_id"] == "c1"
    assert [m["role"] for m in session.chat_history] == ["user", "assistant"]


def test_derive_sticky_harness_from_latest_message_when_session_field_missing(wiring):
    hw, _alpha, _beta, _store = wiring
    history = [
        {"role": "user", "content": "hi", "metadata": {"harness": "codebuddy"}},
        {
            "role": "system",
            "content": "switched",
            "metadata": {
                "kind": "harness_switch",
                "from_harness": "codebuddy",
                "to_harness": None,
                "strategy": "builtin",
            },
        },
        {
            "role": "assistant",
            "content": "[harness codebuddy turn exited]",
            "metadata": {"harness": "codebuddy"},
        },
    ]
    assert hw.derive_sticky_harness_id(history, None) == "codebuddy"
    assert hw.derive_sticky_harness_id(history, "claude-code") == "claude-code"


def test_derive_sticky_harness_keeps_builtin_when_switch_is_the_tail(wiring):
    hw, _alpha, _beta, _store = wiring
    history = [
        {"role": "user", "content": "hi", "metadata": {"harness": "codebuddy"}},
        {"role": "assistant", "content": "done", "metadata": {"harness": "codebuddy"}},
        {
            "role": "system",
            "content": "switched",
            "metadata": {
                "kind": "harness_switch",
                "from_harness": "codebuddy",
                "to_harness": None,
                "strategy": "builtin",
            },
        },
    ]
    assert hw.derive_sticky_harness_id(history, None) is None


def test_derive_sticky_harness_without_metadata_is_unset(wiring):
    hw, _alpha, _beta, _store = wiring
    history = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "yo"},
    ]
    assert hw.derive_sticky_harness_id(history, None) is None


def test_run_turn_reuses_surface_session(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")

    hw.run_external_harness_turn(manager, "sess-1", "one")
    hw.run_external_harness_turn(manager, "sess-1", "two")

    assert alpha.spawn_count == 1  # no respawn on the second turn
    assert [t["text"] for t in alpha.turns] == ["one", "two"]
    assert len(session.chat_history) == 4  # user+assistant per turn


def test_run_turn_cold_start_respawns_and_adopts(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    # Cold start: persisted surface id the (fresh) adapter does not know,
    # but the native thread survived in the binding.
    manager.set_session_harness(
        "sess-1",
        harness_id="alpha",
        thread_id="alpha-native-9",
        surface_session_id="alpha-surf-9",
    )

    result = hw.run_external_harness_turn(manager, "sess-1", "after restart")

    assert alpha.spawn_count == 1
    assert alpha.adopted == [(f"alpha-surf-{alpha.spawn_count}", "alpha-native-9")]
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_session_id"] != "alpha-surf-9"
    assert result.detail.get("native_thread_id") == "alpha-native-9"


def test_run_turn_busy_single_flight(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")

    assert hw._begin_inflight("sess-1")
    with pytest.raises(hw.HarnessTurnBusyError):
        hw.run_external_harness_turn(manager, "sess-1", "concurrent")
    assert hw.is_turn_inflight("sess-1")

    hw._end_inflight("sess-1")
    assert not hw.is_turn_inflight("sess-1")
    result = hw.run_external_harness_turn(manager, "sess-1", "ok now")
    assert result.ok


def test_run_turn_session_not_found(wiring):
    hw, alpha, beta, _ = wiring
    manager = FakeManager(make_session())
    with pytest.raises(ValueError):
        hw.run_external_harness_turn(manager, "missing", "hi")


# ----------------------------------------------------------------------
# snapshot assembly
# ----------------------------------------------------------------------
def test_snapshot_assembly(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    session.chat_history = [
        {"role": "user", "content": "build the report"},
        {"role": "assistant", "content": "done", "metadata": {"run_id": "r1", "harness": "alpha"}},
        {"role": "system", "content": "boundary marker", "system_notice": True},
        {"role": "user", "content": "thanks"},
    ]
    manager = FakeManager(session)
    manager.set_session_harness(
        "sess-1", harness_id="alpha", thread_id="alpha-native-1"
    )

    snap = hw.snapshot_from_session(manager, "sess-1", pending_user_message="next q")

    assert [m.role for m in snap.history] == ["user", "assistant", "user", "user"]
    assert snap.history[-1].content == "next q"
    assert snap.runs[0].run_id == "r1"
    assert snap.runs[0].harness == "alpha"
    assert snap.current_harness == "alpha"
    assert snap.threads[0].harness == "alpha"
    assert snap.threads[0].native_thread_id == "alpha-native-1"
    assert snap.cwd == "/tmp/wiring-ws"


def test_snapshot_prior_source_thread_for_resume(wiring):
    """A→B→A: after switching alpha→beta, the snapshot must expose alpha's
    OWN native thread (source side), not beta's target thread."""
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")
    hw.run_external_harness_turn(manager, "sess-1", "remember REPORT-KEY-1")
    assert manager.get_session_harness("sess-1")["harness_thread_id"] == "alpha-native-1"

    hw.switch_harness(manager, "sess-1", "beta")

    snap = hw.snapshot_from_session(manager, "sess-1")
    prior = {t.harness: t.native_thread_id for t in snap.threads}
    assert prior.get("alpha") == "alpha-native-1"  # source side preserved
    assert prior.get("beta") == "beta-native-1"  # current binding
    # The stored record keeps both sides distinct.
    records = hw.handoff_audit("sess-1")
    assert records[0]["handoff"]["source_native_thread_id"] == "alpha-native-1"
    assert records[0]["handoff"]["target_native_thread_id"] == "beta-native-1"


# ----------------------------------------------------------------------
# switch orchestration
# ----------------------------------------------------------------------
def test_switch_noop_same_harness(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")
    hw.run_external_harness_turn(manager, "sess-1", "one")

    result = hw.switch_harness(manager, "sess-1", "alpha")

    assert result["strategy"] == "noop"
    assert manager.get_session_harness("sess-1")["harness_id"] == "alpha"
    # No boundary marker for a no-op.
    assert not any(
        m.get("system_notice") for m in session.chat_history
    )


def test_switch_to_builtin_boundary_and_unbind(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")
    hw.run_external_harness_turn(manager, "sess-1", "one")
    # External turns never touch agent_messages — the bug surface.
    assert session.agent_messages == []

    result = hw.switch_harness(manager, "sess-1", "python-agent")

    assert result["ok"] and result["strategy"] == "builtin"
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_id"] is None
    assert binding["harness_session_id"] is None
    boundaries = [m for m in session.chat_history if m.get("system_notice")]
    assert len(boundaries) == 1
    meta = boundaries[0]["metadata"]
    assert meta["kind"] == "harness_switch"
    assert meta["from_harness"] == "alpha"
    assert meta["to_harness"] is None
    assert "alpha" in boundaries[0]["content"] and "agenticx" in boundaries[0]["content"]
    # chat_history stays the UI transcript.
    assert len([m for m in session.chat_history if m["role"] in ("user", "assistant")]) == 2
    # Builtin run_turn reads agent_messages — must be projected from chat_history.
    assert result.get("synced_agent_messages") == 2
    assert [(m["role"], m["content"]) for m in session.agent_messages] == [
        ("user", "one"),
        ("assistant", "alpha reply #1"),
    ]


def test_switch_to_builtin_replaces_stale_agent_messages(wiring):
    hw, alpha, _beta, _ = wiring
    session = make_session()
    session.agent_messages = [
        {"role": "user", "content": "stale only"},
        {"role": "assistant", "content": "old builtin reply"},
    ]
    session.chat_history = [
        {"role": "user", "content": "earlier", "metadata": {"harness": "alpha"}},
        {
            "role": "assistant",
            "content": "from claude-code",
            "metadata": {"harness": "claude-code"},
        },
        {
            "role": "system",
            "content": "已切换执行引擎：claude-code → python-agent（策略 builtin）",
            "system_notice": True,
            "metadata": {"kind": "harness_switch"},
        },
    ]
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")

    result = hw.switch_harness(manager, "sess-1", "agenticx")

    assert result["ok"] and result["strategy"] == "builtin"
    assert result.get("synced_agent_messages") == 2
    assert [m["content"] for m in session.agent_messages] == [
        "earlier",
        "from claude-code",
    ]
    assert all(not m.get("system_notice") for m in session.agent_messages)


def test_switch_external_records_handoff_and_boundary(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    session.chat_history = [
        {"role": "user", "content": "build the payment reconciliation report"},
        {"role": "assistant", "content": "shipped v1", "metadata": {"run_id": "r1"}},
        {"role": "user", "content": "add tax column"},
        {"role": "assistant", "content": "done", "metadata": {"run_id": "r2"}},
    ]
    manager = FakeManager(session)

    result = hw.switch_harness(manager, "sess-1", "beta")

    assert result["ok"]
    assert result["strategy"] in ("delta", "full_summary", "resume", "manual_context")
    assert result["from"] in (None, "", "python-agent")
    assert result["to"] == "beta"
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_id"] == "beta"
    assert binding["harness_session_id"] == "beta-surf-1"
    # Injection turn carried the wrapped payload.
    assert "AGENTICX CONTEXT HANDOFF" in beta.turns[0]["text"]
    assert "payment reconciliation" in beta.turns[0]["text"]
    # Boundary marker recorded with handoff id.
    boundaries = [m for m in session.chat_history if m.get("system_notice")]
    assert len(boundaries) == 1
    assert boundaries[0]["metadata"]["handoff_id"] == result["handoff_id"]
    # Store has one active record.
    records = hw.handoff_audit("sess-1")
    assert len(records) == 1 and records[0]["status"] == "active"


def test_switch_back_resume_strategy(wiring):
    """A→B→A: switching back picks resume and re-adopts alpha's thread."""
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")
    hw.run_external_harness_turn(manager, "sess-1", "remember REPORT-KEY-1")

    first = hw.switch_harness(manager, "sess-1", "beta")
    assert first["ok"]
    back = hw.switch_harness(manager, "sess-1", "alpha")

    assert back["strategy"] == "resume"
    assert back["native_thread_id"] == "alpha-native-1"
    assert any(n == "alpha-native-1" for _, n in alpha.adopted)
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_id"] == "alpha"
    assert binding["harness_thread_id"] == "alpha-native-1"
    # Two boundaries: alpha→beta and beta→alpha.
    boundaries = [m for m in session.chat_history if m.get("system_notice")]
    assert len(boundaries) == 2
    # Second handoff supersedes the first.
    records = hw.handoff_audit("sess-1")
    statuses = {r["handoff"]["handoff_id"]: r["status"] for r in records}
    assert statuses[first["handoff_id"]] == "superseded"
    assert statuses[back["handoff_id"]] == "active"


def test_switch_fail_closed_unknown_harness(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")

    with pytest.raises(UnknownHarnessError):
        hw.switch_harness(manager, "sess-1", "nope")
    assert manager.get_session_harness("sess-1")["harness_id"] == "alpha"
    assert not any(m.get("system_notice") for m in session.chat_history)


def test_switch_fail_closed_unavailable_harness(wiring):
    import agenticx.studio.harness_wiring as hw_mod
    from agenticx.harness.handoff import HandoffError

    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")

    # Register an unavailable adapter directly on the singleton registry.
    gamma = RecordingAdapter("gamma", available=False)
    hw.harness_registry().register(gamma)
    try:
        with pytest.raises(HandoffError):
            hw.switch_harness(manager, "sess-1", "gamma")
        assert manager.get_session_harness("sess-1")["harness_id"] == "alpha"
        assert not any(m.get("system_notice") for m in session.chat_history)
        assert hw.handoff_audit("sess-1") == []
    finally:
        hw.harness_registry().unregister("gamma")
        hw_mod  # silence linters


def test_switch_busy_mid_turn(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")

    assert hw._begin_inflight("sess-1")
    try:
        with pytest.raises(hw.HarnessTurnBusyError):
            hw.switch_harness(manager, "sess-1", "beta")
        assert manager.get_session_harness("sess-1")["harness_id"] == "alpha"
    finally:
        hw._end_inflight("sess-1")


def test_switch_manual_requires_context(wiring):
    from agenticx.harness.handoff import HandoffError

    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")

    with pytest.raises(HandoffError):
        hw.switch_harness(manager, "sess-1", "beta", strategy="manual_context")
    assert manager.get_session_harness("sess-1")["harness_id"] == "alpha"


def test_switch_manual_injects_context(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    session.chat_history = [
        {"role": "user", "content": "build the report"},
        {"role": "assistant", "content": "done", "metadata": {}},
    ]
    manager = FakeManager(session)

    result = hw.switch_harness(
        manager, "sess-1", "beta", strategy="manual_context", manual_context="carry this"
    )
    assert result["strategy"] == "manual_context"
    assert "carry this" in beta.turns[0]["text"]


def test_switch_session_not_found(wiring):
    hw, alpha, beta, _ = wiring
    manager = FakeManager(make_session())
    with pytest.raises(ValueError):
        hw.switch_harness(manager, "missing", "beta")


# ----------------------------------------------------------------------
# persisted binding round-trip (harness_session_id)
# ----------------------------------------------------------------------
def test_set_session_harness_persists_surface_id(tmp_path):
    """The real SessionManager keeps harness_session_id in its binding view
    and never materializes the literal string "None" for absent values."""
    from agenticx.studio.session_manager import ManagedSession, SessionManager

    class _CaptureStore:
        def __init__(self) -> None:
            self.saved_metadata: Dict[str, Dict[str, Any]] = {}

        def _save_session_summary_sync(self, sid, summary, metadata) -> None:
            self.saved_metadata[sid] = dict(metadata or {})

        def _load_latest_session_metadata_sync(self, sid):
            return self.saved_metadata.get(sid)

        def _save_todos_sync(self, sid, payload) -> None:
            return None

        def _save_scratchpad_sync(self, sid, payload) -> None:
            return None

        def _index_session_messages_sync(self, sid, messages) -> None:
            return None

        def _max_message_timestamps_sync(self, sids):
            return {}

        def _recover_activity_from_summaries_bulk_sync(self, sids):
            return {}

    manager = SessionManager()
    managed = ManagedSession(session_id="sess-rt", studio_session=make_session("sess-rt"))
    manager._sessions["sess-rt"] = managed
    store = _CaptureStore()
    manager._session_store = store
    manager._persist_core_snapshots = lambda *a, **k: True
    try:
        # Bind without a thread id: must not become the string "None".
        assert manager.set_session_harness("sess-rt", harness_id="claude-code")
        view = manager.get_session_harness("sess-rt")
        assert view["harness_thread_id"] is None
        assert view["harness_session_id"] is None

        assert manager.set_session_harness(
            "sess-rt",
            harness_id="claude-code",
            thread_id="cc-thread-1",
            surface_session_id="cc-surf-1",
        )
        view = manager.get_session_harness("sess-rt")
        assert view["harness_session_id"] == "cc-surf-1"
        assert view["harness_thread_id"] == "cc-thread-1"
        # The metadata persist carries the surface id (cold-restart input).
        saved = store.saved_metadata.get("sess-rt") or {}
        assert saved.get("harness_session_id") == "cc-surf-1"

        # Unbind clears it.
        manager.set_session_harness("sess-rt", harness_id=None)
        assert manager.get_session_harness("sess-rt")["harness_session_id"] is None
    finally:
        manager._sessions.pop("sess-rt", None)


# ----------------------------------------------------------------------
# Near ChatRequest.model → harness spawn options
# ----------------------------------------------------------------------
def test_apply_chat_model_folds_into_options_for_cc(wiring):
    hw, alpha, beta, _ = wiring
    # Register a claude-code stand-in (native model knob allowlist).
    cc = RecordingAdapter("claude-code")
    hw.harness_registry().register(cc)
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="claude-code")

    hw.apply_chat_model_to_harness_options(
        manager, "sess-1", "claude-code", "  glm-5.3-flash  "
    )
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_options"]["model"] == "glm-5.3-flash"


def test_apply_chat_model_ignored_for_harness_without_native_option(wiring):
    hw, alpha, beta, _ = wiring
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness(
        "sess-1", harness_id="alpha", options={"mode": "headless"}
    )
    hw.apply_chat_model_to_harness_options(
        manager, "sess-1", "alpha", "glm-5.3-flash"
    )
    binding = manager.get_session_harness("sess-1")
    assert "model" not in (binding["harness_options"] or {})


def test_apply_chat_model_folds_into_options_for_codebuddy(wiring):
    hw, alpha, beta, _ = wiring
    cb = RecordingAdapter("codebuddy")
    hw.harness_registry().register(cb)
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="codebuddy")

    hw.apply_chat_model_to_harness_options(
        manager, "sess-1", "codebuddy", "  glm-5.3-flash  "
    )
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_options"]["model"] == "glm-5.3-flash"


def test_run_turn_passes_chat_model_into_spawn(wiring):
    hw, alpha, beta, _ = wiring
    cc = RecordingAdapter("claude-code")
    hw.harness_registry().register(cc)
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="claude-code")

    hw.run_external_harness_turn(
        manager, "sess-1", "hi", chat_model="glm-5.3-flash"
    )
    assert cc.spawn_count == 1
    surf = next(iter(cc._sessions.values()))
    assert surf["options"]["model"] == "glm-5.3-flash"
    assert manager.get_session_harness("sess-1")["harness_options"]["model"] == (
        "glm-5.3-flash"
    )


def test_model_change_respawns_surface_session(wiring):
    hw, alpha, beta, _ = wiring
    cc = RecordingAdapter("claude-code")
    hw.harness_registry().register(cc)
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="claude-code")

    hw.run_external_harness_turn(
        manager, "sess-1", "one", chat_model="model-a"
    )
    first_sid = manager.get_session_harness("sess-1")["harness_session_id"]
    assert cc.spawn_count == 1

    hw.run_external_harness_turn(
        manager, "sess-1", "two", chat_model="model-b"
    )
    second_sid = manager.get_session_harness("sess-1")["harness_session_id"]
    assert cc.spawn_count == 2
    assert second_sid != first_sid
    assert first_sid not in cc._sessions
    surf = cc._sessions[second_sid]
    assert surf["options"]["model"] == "model-b"
    # resume=True: the new surface adopts the native thread, so the
    # outbound user text stays the raw prompt (no second handoff wrap).
    assert cc.turns[-1]["text"] == "two"
    assert session.chat_history[-2]["content"] == "two"


def test_model_change_injects_history_when_resume_unavailable(wiring):
    """CodeBuddy-like CLIs respawn on --model change with no resume.

    The new first turn must carry recent history; the visible user row
    stays the raw prompt (session 093e132d dropped CubeSandbox context).
    """
    hw, _alpha, _beta, _ = wiring
    cb = RecordingAdapter("codebuddy", resume=False)
    hw.harness_registry().register(cb)
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="codebuddy")

    hw.run_external_harness_turn(
        manager, "sess-1", "国内除了 OpenSandbox 还有哪些很不错的？", chat_model="deepseek-v4-flash"
    )
    first_sid = manager.get_session_harness("sess-1")["harness_session_id"]
    # Pretend the first assistant actually answered about CubeSandbox,
    # as in the real Near transcript.
    session.chat_history[-1]["content"] = (
        "按信创可落地程度排序：第一梯队 CubeSandbox（腾讯云，Apache 2.0）"
    )

    hw.run_external_harness_turn(
        manager, "sess-1", "好像没有说完的感觉", chat_model="glm-5.3-flash"
    )
    second_sid = manager.get_session_harness("sess-1")["harness_session_id"]
    assert cb.spawn_count == 2
    assert second_sid != first_sid
    assert cb.adopted == []
    outbound = cb.turns[-1]["text"]
    assert "AGENTICX CONTEXT HANDOFF (BEGIN)" in outbound
    assert "CubeSandbox" in outbound
    assert "OpenSandbox" in outbound
    assert outbound.endswith("好像没有说完的感觉")
    # UI transcript must not swallow the raw user prompt into the payload.
    assert session.chat_history[-2]["role"] == "user"
    assert session.chat_history[-2]["content"] == "好像没有说完的感觉"


def test_cold_start_without_resume_injects_history(wiring):
    """App relaunch / dead surface with no native thread still keeps context."""
    hw, _alpha, _beta, _ = wiring
    cb = RecordingAdapter("codebuddy", resume=False)
    hw.harness_registry().register(cb)
    session = make_session()
    session.chat_history = [
        {
            "role": "user",
            "content": "国内除了 OpenSandbox 还有哪些很不错的？",
            "metadata": {"harness": "codebuddy"},
        },
        {
            "role": "assistant",
            "content": "按信创可落地程度排序：第一梯队 CubeSandbox。",
            "metadata": {"harness": "codebuddy"},
        },
    ]
    manager = FakeManager(session)
    manager.set_session_harness(
        "sess-1",
        harness_id="codebuddy",
        options={"model": "deepseek-v4-flash"},
        surface_session_id="dead-surf-1",
    )

    hw.run_external_harness_turn(
        manager, "sess-1", "好像没有说完的感觉", chat_model="deepseek-v4-flash"
    )
    assert cb.spawn_count == 1
    outbound = cb.turns[-1]["text"]
    assert "AGENTICX CONTEXT HANDOFF (BEGIN)" in outbound
    assert "CubeSandbox" in outbound
    assert outbound.endswith("好像没有说完的感觉")
    assert session.chat_history[-2]["content"] == "好像没有说完的感觉"


def test_same_model_reuses_surface_session(wiring):
    hw, alpha, beta, _ = wiring
    cc = RecordingAdapter("claude-code")
    hw.harness_registry().register(cc)
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="claude-code")

    hw.run_external_harness_turn(
        manager, "sess-1", "one", chat_model="glm-5.3-flash"
    )
    hw.run_external_harness_turn(
        manager, "sess-1", "two", chat_model="glm-5.3-flash"
    )
    assert cc.spawn_count == 1

def test_apply_chat_model_empty_prev_keeps_injected_surface(wiring):
    """Handoff spawn often has options=None; filling model must keep surface."""
    hw, alpha, beta, _ = wiring
    cc = RecordingAdapter("claude-code")
    hw.harness_registry().register(cc)
    session = make_session()
    manager = FakeManager(session)
    # Simulate post-handoff binding: live surface, no model in options yet.
    manager.set_session_harness(
        "sess-1",
        harness_id="claude-code",
        options=None,
        surface_session_id="cc-injected-1",
    )
    cc._sessions["cc-injected-1"] = {
        "session_id": "cc-injected-1",
        "cwd": "/tmp",
        "state": "idle",
        "options": {},
        "native_thread_id": "cc-native-inj",
        "model": None,
        "raw": {"model": None},
    }

    hw.apply_chat_model_to_harness_options(
        manager, "sess-1", "claude-code", "glm-5.3-flash"
    )
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_options"]["model"] == "glm-5.3-flash"
    assert binding["harness_session_id"] == "cc-injected-1"
    assert "cc-injected-1" in cc._sessions
    assert cc.spawn_count == 0


def test_switch_handoff_spawns_with_session_model(wiring):
    """Cross-harness handoff should pass Near chat model into spawn options."""
    hw, alpha, beta, _ = wiring
    cc = RecordingAdapter("claude-code")
    hw.harness_registry().register(cc)
    session = make_session()
    session.model_name = "glm-5.3-flash"
    session.chat_history = [
        {"role": "user", "content": "特朗普新闻最近有啥"},
        {
            "role": "assistant",
            "content": "新闻摘要",
            "metadata": {"harness": "python-agent"},
        },
        {"role": "user", "content": "南沙今天天气怎么样"},
        {
            "role": "assistant",
            "content": "南沙多云 24–28℃",
            "metadata": {"harness": "python-agent"},
        },
    ]
    manager = FakeManager(session)

    result = hw.switch_harness(manager, "sess-1", "claude-code")
    assert result["ok"]
    assert cc.spawn_count == 1
    surf = next(iter(cc._sessions.values()))
    assert surf["options"]["model"] == "glm-5.3-flash"
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_options"]["model"] == "glm-5.3-flash"
    assert "南沙" in cc.turns[0]["text"]


def test_harness_turn_stamps_per_turn_model_on_assistant(wiring):
    """Two turns with different chat_model keep distinct model badges."""
    hw, _alpha, _beta, _ = wiring
    cb = RecordingAdapter("codebuddy")
    hw.harness_registry().register(cb)
    session = make_session()
    session.provider_name = "zhipu"
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="codebuddy")

    hw.run_external_harness_turn(
        manager, "sess-1", "turn one", chat_model="model-a"
    )
    hw.run_external_harness_turn(
        manager, "sess-1", "turn two", chat_model="model-b"
    )

    assistants = [m for m in session.chat_history if m["role"] == "assistant"]
    assert len(assistants) == 2
    assert assistants[0]["model"] == "model-a"
    assert assistants[1]["model"] == "model-b"
    assert assistants[0]["provider"] == "zhipu"
    assert assistants[0]["model_selection"] == "manual"
    assert assistants[1]["model_selection"] == "manual"


def test_set_session_model_does_not_rewrite_harness_history_models(wiring):
    hw, alpha, _beta, _ = wiring
    session = make_session()
    session.provider_name = "zhipu"
    session.model_name = "model-a"
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="alpha")

    hw.run_external_harness_turn(manager, "sess-1", "one", chat_model="model-a")

    manager.set_session_model(
        "sess-1", provider="zhipu", model="model-b"
    )
    assert session.model_name == "model-b"

    assistants = [m for m in session.chat_history if m["role"] == "assistant"]
    assert len(assistants) == 1
    assert assistants[0]["model"] == "model-a"



class ProviderMismatchOnceAdapter(RecordingAdapter):
    """Resume-capable Codex stand-in that fails once on a stamped stale thread."""

    def __init__(self, *args: Any, stale_thread_id: str, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.stale_thread_id = stale_thread_id
        self.mismatch_turns = 0

    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        session = self._sessions[session_id]
        native = str(session.get("native_thread_id") or "")
        if native == self.stale_thread_id:
            self.mismatch_turns += 1
            self.turns.append({"session_id": session_id, "text": request.text})
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_ERROR,
                result_text="",
                tail="",
                detail={
                    "native_thread_id": native,
                    "error": (
                        "thread/resume: thread/resume failed: This chat uses "
                        "agenticx-custom-openai-1782269503107, but your current "
                        "provider is agenticx-mimo. Switch to "
                        "agenticx-custom-openai-1782269503107 to continue. "
                        '(code -32600), data: {"type":"modelProviderMismatch"}'
                    ),
                },
            )
        return super().turn(session_id, request)


def test_codex_provider_change_skips_resume_and_injects_history(wiring):
    """Mid-session official MiMo switch must not resume a 彩讯-bound thread."""
    hw, _alpha, _beta, _ = wiring
    codex = RecordingAdapter("codex", resume=True)
    hw.harness_registry().register(codex)
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="codex")

    hw.run_external_harness_turn(
        manager,
        "sess-1",
        "国内除了 OpenSandbox 还有哪些很不错的？",
        chat_model="glm-5.3-flash",
        chat_provider="custom_openai_1782269503107",
    )
    session.chat_history[-1]["content"] = (
        "按信创可落地程度排序：第一梯队 CubeSandbox（腾讯云，Apache 2.0）"
    )
    first_binding = manager.get_session_harness("sess-1")
    first_thread = first_binding["harness_thread_id"]
    assert first_thread == "codex-native-1"
    assert first_binding["harness_options"]["model_provider"] == (
        "agenticx-custom-openai-1782269503107"
    )
    adopts_before_switch = list(codex.adopted)

    hw.run_external_harness_turn(
        manager,
        "sess-1",
        "你好",
        chat_model="mimo-v2.6-flash",
        chat_provider="mimo",
    )

    assert codex.spawn_count == 2
    assert codex.adopted == adopts_before_switch
    outbound = codex.turns[-1]["text"]
    assert "AGENTICX CONTEXT HANDOFF (BEGIN)" in outbound
    assert "CubeSandbox" in outbound
    assert outbound.endswith("你好")
    assert session.chat_history[-2]["role"] == "user"
    assert session.chat_history[-2]["content"] == "你好"
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_thread_id"] == "codex-native-2"
    assert binding["harness_thread_id"] != first_thread
    assert binding["harness_options"]["model_provider"] == "agenticx-mimo"
    assert session.chat_history[-1]["content"] == "codex reply #2"


def test_codex_same_provider_model_change_still_resumes(wiring):
    """Same Codex provider, different model: resume the native thread, no wrap."""
    hw, _alpha, _beta, _ = wiring
    codex = RecordingAdapter("codex", resume=True)
    hw.harness_registry().register(codex)
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="codex")

    hw.run_external_harness_turn(
        manager,
        "sess-1",
        "one",
        chat_model="mimo-v2.6-flash",
        chat_provider="mimo",
    )
    first_thread = manager.get_session_harness("sess-1")["harness_thread_id"]
    assert manager.get_session_harness("sess-1")["harness_options"][
        "model_provider"
    ] == "agenticx-mimo"

    hw.run_external_harness_turn(
        manager,
        "sess-1",
        "two",
        chat_model="mimo-v2.6-pro",
        chat_provider="mimo",
    )

    assert codex.spawn_count == 2
    assert codex.adopted == [("codex-surf-2", first_thread)]
    assert codex.turns[-1]["text"] == "two"
    assert session.chat_history[-2]["content"] == "two"
    assert "AGENTICX CONTEXT HANDOFF (BEGIN)" not in codex.turns[-1]["text"]
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_thread_id"] == first_thread
    assert binding["harness_options"]["model_provider"] == "agenticx-mimo"


def test_unstamped_codex_provider_mismatch_retries_with_history(wiring):
    """Old sessions have a thread id but no provider stamp; retry once."""
    hw, _alpha, _beta, _ = wiring
    stale = "01a1c36d-994b-7f02-a685-d0a5322db6c4"
    codex = ProviderMismatchOnceAdapter(
        "codex", resume=True, stale_thread_id=stale
    )
    hw.harness_registry().register(codex)
    session = make_session()
    session.chat_history = [
        {
            "role": "user",
            "content": "国内除了 OpenSandbox 还有哪些很不错的？",
            "metadata": {"harness": "codex"},
        },
        {
            "role": "assistant",
            "content": "按信创可落地程度排序：第一梯队 CubeSandbox。",
            "metadata": {"harness": "codex", "native_thread_id": stale},
        },
    ]
    manager = FakeManager(session)
    manager.set_session_harness(
        "sess-1",
        harness_id="codex",
        thread_id=stale,
        options={"model": "glm-5.3-flash"},
        surface_session_id=None,
    )

    result = hw.run_external_harness_turn(
        manager,
        "sess-1",
        "你好",
        chat_model="mimo-v2.6-flash",
        chat_provider="mimo",
    )

    assert result.ok
    assert codex.mismatch_turns == 1
    assert codex.spawn_count == 2
    assert codex.adopted == [("codex-surf-1", stale)]
    # First outbound is a resume of the stale thread (raw prompt).
    assert codex.turns[0]["text"] == "你好"
    outbound = codex.turns[-1]["text"]
    assert "AGENTICX CONTEXT HANDOFF (BEGIN)" in outbound
    assert "CubeSandbox" in outbound
    assert outbound.endswith("你好")
    assert session.chat_history[-2]["content"] == "你好"
    assistants = [row for row in session.chat_history if row["role"] == "assistant"]
    assert "modelProviderMismatch" not in assistants[-1]["content"]
    assert "but your current provider is" not in assistants[-1]["content"]
    assert assistants[-1]["content"] == "codex reply #2"
    binding = manager.get_session_harness("sess-1")
    assert binding["harness_thread_id"] != stale
    assert binding["harness_thread_id"] == "codex-native-2"
    assert binding["harness_options"]["model_provider"] == "agenticx-mimo"
