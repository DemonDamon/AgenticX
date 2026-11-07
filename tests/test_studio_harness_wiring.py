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

    def __init__(self, harness_id: str, available: bool = True) -> None:
        self.harness_id = harness_id
        self.display_name = harness_id.title()
        self.description = f"{harness_id} adapter"
        self._available = available
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
            resume=True,
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
    assert "alpha" in boundaries[0]["content"] and "python-agent" in boundaries[0]["content"]
    # chat_history itself is untouched (it IS the builtin context).
    assert len([m for m in session.chat_history if m["role"] in ("user", "assistant")]) == 2


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

