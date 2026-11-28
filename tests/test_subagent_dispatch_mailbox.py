"""Unit tests for persistent dispatch records, mailbox claims, and context snapshots.

Plan-Id: 2026-11-27-runtime-invariants-03-dispatch-mailbox

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict

import pytest

from agenticx.runtime.harden_flags import dispatch_mailbox_enabled
from agenticx.runtime.replay_ledger.contracts import LEDGER_ID_PATTERN, ReplayRunRecord
from agenticx.runtime.replay_ledger.resume_anchor import find_open_run
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.subagent_runs import dispatch as dispatch_store

OWNER = "sess-dispatch-unit"


def _open_spawn(
    store: SubAgentRunStore,
    run_id: str,
    *,
    dispatch_id: str = "",
    name: str = "worker",
    kind: str = "spawn",
) -> None:
    detail_refs: Dict[str, Any] = {}
    if dispatch_id:
        detail_refs[dispatch_store.DISPATCH_DETAIL_KEY] = {
            "dispatch_id": dispatch_id,
            "task_id": run_id,
            "state": dispatch_store.DISPATCH_STATE_RUNNING,
        }
    store.open_run(
        run_id=run_id,
        kind=kind,
        name=name,
        role="worker",
        task="do the work",
        status="running",
        provider="",
        model="",
        persona="",
        avatar_id="",
        source_tool_call_id="",
        started_at=1.0,
        detail_refs=detail_refs,
    )


def _claim(store: SubAgentRunStore, run_id: str, dispatch_id: str, message_id: str, consumed_by: str = "wake_turn"):
    return dispatch_store.claim_mail(
        store,
        run_id,
        dispatch_id=dispatch_id,
        message_id=message_id,
        text=f"mail {message_id}",
        consumed_by=consumed_by,
    )


def test_dispatch_mailbox_switch_defaults_on_and_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_DISPATCH_MAILBOX", raising=False)
    assert dispatch_mailbox_enabled() is True
    monkeypatch.setenv("AGX_DISPATCH_MAILBOX", "0")
    assert dispatch_mailbox_enabled() is False


def test_new_dispatch_id_is_prefixed_and_unique() -> None:
    first = dispatch_store.new_dispatch_id()
    second = dispatch_store.new_dispatch_id()
    assert first.startswith("dsp-")
    assert len(first) == 16
    assert first != second


def test_claim_mail_consumes_each_message_id_once(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-000000000001")

    accepted, mail = _claim(store, "sa-aaaa1111", "dsp-000000000001", "m-1")
    assert accepted is True
    assert mail["message_id"] == "m-1"
    assert mail["state"] == "consumed"
    assert mail["consumed_by"] == "wake_turn"

    again, existing = _claim(store, "sa-aaaa1111", "dsp-000000000001", "m-1")
    assert again is False
    assert existing == mail

    other, _ = _claim(store, "sa-aaaa1111", "dsp-000000000001", "m-2", consumed_by="running_turn")
    assert other is True

    mails = dispatch_store.read_mailbox(store, "sa-aaaa1111")
    assert [item["message_id"] for item in mails] == ["m-1", "m-2"]
    assert mails[1]["consumed_by"] == "running_turn"


def test_claim_mail_survives_a_new_store_instance(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    _open_spawn(SubAgentRunStore(OWNER), "sa-aaaa1111", dispatch_id="dsp-1")
    _claim(SubAgentRunStore(OWNER), "sa-aaaa1111", "dsp-1", "m-1")

    accepted, existing = _claim(SubAgentRunStore(OWNER), "sa-aaaa1111", "dsp-1", "m-1")
    assert accepted is False
    assert existing["message_id"] == "m-1"


def test_claim_mail_fails_closed_when_the_mailbox_cannot_be_written(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    # Occupy the mailbox path with a directory so os.replace() cannot succeed.
    (store.root / "sa-aaaa1111.mailbox.json").mkdir()

    with pytest.raises(dispatch_store.DispatchMailboxError):
        _claim(store, "sa-aaaa1111", "dsp-1", "m-1")


def test_claim_mail_rejects_an_empty_message_id(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    with pytest.raises(ValueError):
        _claim(store, "sa-aaaa1111", "dsp-1", "")


def test_find_dispatch_prefers_exact_ids_then_aliases(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-000000000001", name="scout")
    _open_spawn(store, "sa-bbbb2222", dispatch_id="dsp-000000000002", name="scout")
    _open_spawn(store, "dlg-cccc3333", dispatch_id="", name="delegate", kind="delegate")
    # A dispatch-registered worker whose name fell back to its run id must not match "scout".
    _open_spawn(store, "sa-dddd4444", dispatch_id="dsp-000000000004", name="")
    store.update_status("sa-bbbb2222", status="completed")

    assert dispatch_store.find_dispatch(store, "sa-aaaa1111") == (store.get_run("sa-aaaa1111"), "agent_id")

    record, kind = dispatch_store.find_dispatch(store, "dsp-000000000002")
    assert (record.run_id, kind) == ("sa-bbbb2222", "dispatch_id")

    record, kind = dispatch_store.find_dispatch(store, "Scout")
    assert (record.run_id, kind) == ("sa-bbbb2222", "name")

    assert dispatch_store.find_dispatch(store, "dlg-cccc3333") == (None, "")
    assert dispatch_store.find_dispatch(store, "nobody") == (None, "")
    assert dispatch_store.find_dispatch(store, "") == (None, "")


def test_set_dispatch_state_round_trips_through_detail_refs(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    _open_spawn(store, "sa-legacy0000", dispatch_id="")

    assert dispatch_store.set_dispatch_state(store, "sa-aaaa1111", dispatch_store.DISPATCH_STATE_WAITING) is True
    dispatch = dispatch_store.dispatch_of(store.get_run("sa-aaaa1111"))
    assert dispatch["state"] == "waiting"
    assert dispatch["dispatch_id"] == "dsp-1"
    assert dispatch["task_id"] == "sa-aaaa1111"

    assert dispatch_store.set_dispatch_state(store, "sa-zzzz9999", dispatch_store.DISPATCH_STATE_WAITING) is False
    assert dispatch_store.set_dispatch_state(store, "sa-legacy0000", dispatch_store.DISPATCH_STATE_WAITING) is False


def test_context_snapshot_round_trip(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    assert dispatch_store.read_context_snapshot(store, "sa-aaaa1111") is None

    dispatch_store.write_context_snapshot(
        store,
        "sa-aaaa1111",
        {"agent_messages": [{"role": "user", "content": "hi"}], "final_text": "done"},
    )

    snapshot = dispatch_store.read_context_snapshot(store, "sa-aaaa1111")
    assert snapshot["agent_messages"] == [{"role": "user", "content": "hi"}]
    assert snapshot["final_text"] == "done"
    assert snapshot["agent_id"] == "sa-aaaa1111"
    assert snapshot["schema_version"] == dispatch_store.AUX_SCHEMA_VERSION
    assert (store.root / "sa-aaaa1111.context.json").exists()
    assert not (store.root / "sa-aaaa1111.mailbox.json").exists()


def test_dispatch_ledger_session_id_is_a_valid_ledger_id() -> None:
    namespace = dispatch_store.dispatch_ledger_session_id("sess-abc", "sa-aaaa1111")
    assert namespace == "sess-abc:dispatch:sa-aaaa1111"
    assert LEDGER_ID_PATTERN.fullmatch(namespace)


def test_ledger_root_is_none_without_an_owner_session() -> None:
    assert dispatch_store.ledger_root_for(SubAgentRunStore(None)) is None


def test_worker_ledger_namespace_never_shadows_the_owner_session(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    sessions_root = dispatch_store.ledger_root_for(store)
    assert sessions_root == tmp_path / ".agenticx" / "sessions"
    ledger = ReplayLedgerStore(sessions_root)
    namespace = dispatch_store.dispatch_ledger_session_id(OWNER, "sa-aaaa1111")

    ledger.open_run(
        ReplayRunRecord(
            run_id="parent-run",
            session_id=OWNER,
            turn_id="turn-parent",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    # A worker wake-up run left open by a crash is newer than the parent's run.
    ledger.open_run(
        ReplayRunRecord(
            run_id="worker-run",
            session_id=namespace,
            turn_id="turn-worker",
            agent_id="sa-aaaa1111",
            status="running",
            created_at=2.0,
            updated_at=2.0,
        )
    )

    assert find_open_run(ledger, OWNER).run_id == "parent-run"
    assert [run.run_id for run in ledger.list_runs(OWNER)] == ["parent-run"]
    assert [run.run_id for run in ledger.list_runs(namespace)] == ["worker-run"]
    assert ledger.get_run("worker-run") is not None


def test_delete_dispatch_ledger_runs_removes_namespaced_runs(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    _open_spawn(store, "sa-aaaa1111", dispatch_id="dsp-1")
    _open_spawn(store, "sa-legacy0000", dispatch_id="")
    sessions_root = dispatch_store.ledger_root_for(store)
    ledger = ReplayLedgerStore(sessions_root)
    namespace = dispatch_store.dispatch_ledger_session_id(OWNER, "sa-aaaa1111")
    ledger.open_run(
        ReplayRunRecord(
            run_id="worker-run",
            session_id=namespace,
            turn_id="turn-worker",
            agent_id="sa-aaaa1111",
            status="completed",
            created_at=2.0,
            updated_at=2.0,
        )
    )

    assert dispatch_store.delete_dispatch_ledger_runs(OWNER, sessions_root=sessions_root) == 1
    assert ledger.list_runs(namespace) == []
