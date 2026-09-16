#!/usr/bin/env python3
"""Tests for canonical sub-agent run resolution.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

import agenticx.runtime.subagent_runs.store as run_store_module
from agenticx.runtime.subagent_runs import SubAgentRunStore


def _open_run(
    owner_session_id: str,
    run_id: str,
    *,
    kind: str = "delegate",
    status: str = "pending",
) -> None:
    SubAgentRunStore(owner_session_id).open_run(
        run_id=run_id,
        kind=kind,
        name="Worker",
        role="worker",
        task="test task",
        status=status,
        avatar_id="avatar-1" if kind == "delegate" else "",
        avatar_session_id="avatar-session-1" if kind == "delegate" else "",
    )


class _FakeTeamManager:
    def __init__(self, owner_session_id: str, rows: list[dict[str, Any]]) -> None:
        self.owner_session_id = owner_session_id
        self._rows = rows

    def get_status_with_task_fallback(self, agent_id: str | None = None) -> dict[str, Any]:
        if agent_id:
            row = next(
                (item for item in self._rows if item.get("agent_id") == agent_id),
                None,
            )
            return {"ok": bool(row), "subagent": row}
        return {"ok": True, "subagents": list(self._rows)}


def test_list_resolved_runs_reads_cold_start_delegate_from_disk(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    _open_run("owner-a", "delegate-cold")

    from agenticx.runtime.subagent_runs.resolver import list_resolved_runs

    rows = list_resolved_runs("owner-a")

    assert [row["run_id"] for row in rows] == ["delegate-cold"]
    assert rows[0]["source"] == "ledger"
    assert rows[0]["delegation"] is True


def test_list_resolved_runs_merges_live_spawn_overlay(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    _open_run("owner-a", "spawn-live", kind="spawn")
    manager = _FakeTeamManager(
        "owner-a",
        [
            {
                "agent_id": "spawn-live",
                "status": "running",
                "updated_at": 9999999999.0,
                "result_summary": "working",
            }
        ],
    )

    from agenticx.runtime.subagent_runs.resolver import list_resolved_runs

    rows = list_resolved_runs("owner-a", team_manager=manager)

    assert len(rows) == 1
    assert rows[0]["status"] == "running"
    assert rows[0]["result_summary"] == "working"


def test_resolve_run_keeps_newer_terminal_ledger_status(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    _open_run("owner-a", "terminal-run", status="completed")
    manager = _FakeTeamManager(
        "owner-a",
        [
            {
                "agent_id": "terminal-run",
                "status": "running",
                "updated_at": 1.0,
                "result_summary": "stale",
            }
        ],
    )

    from agenticx.runtime.subagent_runs.resolver import resolve_run

    row = resolve_run("owner-a", "terminal-run", team_manager=manager)

    assert row is not None
    assert row["status"] == "completed"
    assert row["result_summary"] != "stale"


def test_resolver_deduplicates_store_and_delegate_memory(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    _open_run("owner-a", "delegate-same")
    avatar_managed = SimpleNamespace(
        _delegation_info={
            "delegation_id": "delegate-same",
            "from_session": "owner-a",
            "status": "running",
            "updated_at": 9999999999.0,
            "avatar_id": "avatar-1",
        },
        session_id="avatar-session-1",
        avatar_name="Coder",
    )
    session_manager = SimpleNamespace(_sessions={"avatar-session-1": avatar_managed})

    from agenticx.runtime.subagent_runs.resolver import list_resolved_runs

    rows = list_resolved_runs("owner-a", session_manager=session_manager)

    assert [row["run_id"] for row in rows] == ["delegate-same"]
    assert rows[0]["status"] == "running"


def test_resolver_never_leaks_other_owner_session(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    _open_run("owner-b", "private-run")
    other_manager = _FakeTeamManager(
        "owner-b",
        [{"agent_id": "other-live", "status": "running", "updated_at": 1.0}],
    )
    avatar_managed = SimpleNamespace(
        _delegation_info={
            "delegation_id": "other-delegate",
            "from_session": "owner-b",
            "status": "running",
        },
        session_id="avatar-session-b",
    )
    session_manager = SimpleNamespace(_sessions={"avatar-session-b": avatar_managed})

    from agenticx.runtime.subagent_runs.resolver import list_resolved_runs

    rows = list_resolved_runs(
        "owner-a",
        session_manager=session_manager,
        team_manager=other_manager,
    )

    assert rows == []


def test_empty_owner_session_does_not_read_global_store(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    _open_run("", "global-run")

    from agenticx.runtime.subagent_runs.resolver import list_resolved_runs, resolve_run

    assert list_resolved_runs("") == []
    assert resolve_run("", "global-run") is None


@pytest.mark.parametrize(
    ("query", "expected_run_id"),
    [
        ("run-alias", "run-alias"),
        ("Named Worker", "run-alias"),
        ("avatar-alias", "run-alias"),
    ],
)
def test_resolve_run_supports_same_owner_legacy_lookup_keys(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
    query: str,
    expected_run_id: str,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    SubAgentRunStore("owner-a").open_run(
        run_id="run-alias",
        kind="delegate",
        name="Named Worker",
        role="worker",
        task="test task",
        status="running",
        avatar_id="avatar-alias",
    )

    from agenticx.runtime.subagent_runs.resolver import resolve_run

    row = resolve_run("owner-a", query)

    assert row is not None
    assert row["run_id"] == expected_run_id


def test_resolve_run_prefers_active_run_for_shared_avatar(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    clock = [100.0]
    monkeypatch.setattr(run_store_module.time, "time", lambda: clock[0])
    store = SubAgentRunStore("owner-a")
    store.open_run(
        run_id="old-completed",
        kind="delegate",
        name="Old Worker",
        role="worker",
        task="old task",
        status="completed",
        avatar_id="shared-avatar",
    )
    clock[0] = 200.0
    store.open_run(
        run_id="new-running",
        kind="delegate",
        name="New Worker",
        role="worker",
        task="new task",
        status="running",
        avatar_id="shared-avatar",
    )

    from agenticx.runtime.subagent_runs.resolver import resolve_run

    row = resolve_run("owner-a", "shared-avatar")

    assert row is not None
    assert row["run_id"] == "new-running"


def test_resolve_run_prefers_latest_terminal_run_for_shared_name(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    clock = [100.0]
    monkeypatch.setattr(run_store_module.time, "time", lambda: clock[0])
    store = SubAgentRunStore("owner-a")
    store.open_run(
        run_id="old-terminal",
        kind="delegate",
        name="Shared Worker",
        role="worker",
        task="old task",
        status="completed",
    )
    clock[0] = 300.0
    store.open_run(
        run_id="new-terminal",
        kind="delegate",
        name="Shared Worker",
        role="worker",
        task="new task",
        status="failed",
    )

    from agenticx.runtime.subagent_runs.resolver import resolve_run

    row = resolve_run("owner-a", "Shared Worker")

    assert row is not None
    assert row["run_id"] == "new-terminal"


def test_resolve_run_exact_run_id_beats_newer_alias_match(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    clock = [50.0]
    monkeypatch.setattr(run_store_module.time, "time", lambda: clock[0])
    store = SubAgentRunStore("owner-a")
    store.open_run(
        run_id="oldest-alias-run",
        kind="delegate",
        name="exact-old-run",
        role="worker",
        task="oldest task",
        status="completed",
    )
    clock[0] = 100.0
    store.open_run(
        run_id="exact-old-run",
        kind="delegate",
        name="Original Worker",
        role="worker",
        task="old task",
        status="completed",
    )
    clock[0] = 400.0
    store.open_run(
        run_id="new-alias-run",
        kind="delegate",
        name="exact-old-run",
        role="worker",
        task="new task",
        status="running",
    )

    from agenticx.runtime.subagent_runs.resolver import resolve_run

    row = resolve_run("owner-a", "exact-old-run")

    assert row is not None
    assert row["run_id"] == "exact-old-run"
