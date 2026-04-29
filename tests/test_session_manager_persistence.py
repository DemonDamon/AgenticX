#!/usr/bin/env python3
"""Tests for SessionManager state restore/save.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.memory.session_store import SessionStore
from agenticx.studio.session_manager import SessionManager


def test_session_manager_restores_and_persists(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    manager = SessionManager()
    manager._session_store = store  # test override

    sid = "fixed-session-id"
    store._save_todos_sync(
        sid,
        [{"content": "task", "status": "in_progress", "active_form": "doing"}],
    )
    store._save_scratchpad_sync(sid, {"k": "v"})

    managed = manager.create(session_id=sid)
    assert managed.studio_session.todo_manager.items
    assert managed.studio_session.scratchpad.get("k") == "v"

    managed.studio_session.scratchpad["k2"] = "v2"
    assert manager.persist(sid) is True
    restored = store._load_scratchpad_sync(sid)
    assert restored.get("k2") == "v2"
    assert manager.delete(sid) is True
    assert store._load_scratchpad_sync(sid) == {}


def test_list_sessions_restores_from_persisted_state_after_restart(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"

    manager = SessionManager()
    manager._session_store = store  # test override
    manager._sessions_root = str(sessions_root)

    sid = "restart-session-id"
    managed = manager.create(session_id=sid)
    managed.session_name = "重启后保留"
    managed.studio_session.chat_history = [
        {"id": "u1", "role": "user", "content": "hello"},
        {"id": "a1", "role": "assistant", "content": "world"},
    ]
    assert manager.persist(sid) is True

    fresh = SessionManager()
    fresh._session_store = store  # test override
    fresh._sessions_root = str(sessions_root)

    sessions = fresh.list_sessions()
    session_ids = {row["session_id"] for row in sessions}
    assert sid in session_ids


def test_get_lazy_restores_persisted_session(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"

    manager = SessionManager()
    manager._session_store = store  # test override
    manager._sessions_root = str(sessions_root)

    sid = "lazy-restore-session-id"
    managed = manager.create(session_id=sid)
    managed.studio_session.chat_history = [
        {"id": "u1", "role": "user", "content": "hello"},
    ]
    assert manager.persist(sid) is True

    fresh = SessionManager()
    fresh._session_store = store  # test override
    fresh._sessions_root = str(sessions_root)

    loaded = fresh.get(sid, touch=False)
    assert loaded is not None
    assert loaded.session_id == sid
    assert len(loaded.studio_session.chat_history) == 1


def test_restore_managed_metadata_restores_avatar_binding(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    sid = "avatar-restore-session-id"
    managed = manager.create(session_id=sid)
    managed.avatar_id = "avatar-restore-test"
    managed.avatar_name = "Restore A"
    managed.studio_session.chat_history = [
        {"id": "u1", "role": "user", "content": "hello"},
    ]
    assert manager.persist(sid) is True

    fresh = SessionManager()
    fresh._session_store = store
    fresh._sessions_root = str(sessions_root)

    loaded = fresh.get(sid, touch=False)
    assert loaded is not None
    assert loaded.avatar_id == "avatar-restore-test"
    assert loaded.avatar_name == "Restore A"


def test_taskspace_apis_can_lazy_restore_session(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    taskspaces_root = tmp_path / "taskspaces"

    manager = SessionManager()
    manager._session_store = store  # test override
    manager._sessions_root = str(sessions_root)
    manager._taskspaces_root = str(taskspaces_root)

    sid = "taskspace-lazy-restore-session-id"
    managed = manager.create(session_id=sid)
    assert manager.persist(sid) is True

    fresh = SessionManager()
    fresh._session_store = store  # test override
    fresh._sessions_root = str(sessions_root)
    fresh._taskspaces_root = str(taskspaces_root)

    rows = fresh.list_taskspaces(sid)
    assert rows
    assert rows[0]["id"] == "default"


def test_taskspaces_are_shared_across_sessions_until_removed(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    taskspaces_root = tmp_path / "taskspaces"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)
    manager._taskspaces_root = str(taskspaces_root)

    sid_a = "shared-taskspace-session-a"
    sid_b = "shared-taskspace-session-b"
    managed_a = manager.create(session_id=sid_a)
    managed_b = manager.create(session_id=sid_b)
    managed_a.studio_session.chat_history = [{"id": "u1", "role": "user", "content": "a"}]
    managed_b.studio_session.chat_history = [{"id": "u1", "role": "user", "content": "b"}]
    assert manager.persist(sid_a) is True
    assert manager.persist(sid_b) is True

    shared_dir = tmp_path / "shared-workspace"
    created = manager.add_taskspace(sid_b, path=str(shared_dir), label="shared")
    assert created["id"].startswith("ts-")

    rows_a = manager.list_taskspaces(sid_a)
    rows_b = manager.list_taskspaces(sid_b)
    assert any(row["path"] == str(shared_dir.resolve()) for row in rows_a)
    assert any(row["path"] == str(shared_dir.resolve()) for row in rows_b)

    assert manager.remove_taskspace(sid_a, created["id"]) is True
    rows_a_after = manager.list_taskspaces(sid_a)
    rows_b_after = manager.list_taskspaces(sid_b)
    assert all(row["id"] != created["id"] for row in rows_a_after)
    assert all(row["id"] != created["id"] for row in rows_b_after)

    fresh = SessionManager()
    fresh._session_store = store
    fresh._sessions_root = str(sessions_root)
    fresh._taskspaces_root = str(taskspaces_root)

    rows_a_fresh = fresh.list_taskspaces(sid_a)
    rows_b_fresh = fresh.list_taskspaces(sid_b)
    assert len(rows_a_fresh) == 1 and rows_a_fresh[0]["id"] == "default"
    assert len(rows_b_fresh) == 1 and rows_b_fresh[0]["id"] == "default"


def test_taskspaces_are_isolated_between_different_avatars(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    taskspaces_root = tmp_path / "taskspaces"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)
    manager._taskspaces_root = str(taskspaces_root)

    sid_a1 = "avatar-a-session-1"
    sid_a2 = "avatar-a-session-2"
    sid_b1 = "avatar-b-session-1"
    managed_a1 = manager.create(session_id=sid_a1)
    managed_a2 = manager.create(session_id=sid_a2)
    managed_b1 = manager.create(session_id=sid_b1)
    managed_a1.avatar_id = "avatar-a"
    managed_a2.avatar_id = "avatar-a"
    managed_b1.avatar_id = "avatar-b"

    avatar_a_shared_dir = tmp_path / "avatar-a-shared"
    created = manager.add_taskspace(sid_a1, path=str(avatar_a_shared_dir), label="avatar-a-shared")
    assert created["id"].startswith("ts-")

    rows_a1 = manager.list_taskspaces(sid_a1)
    rows_a2 = manager.list_taskspaces(sid_a2)
    rows_b1 = manager.list_taskspaces(sid_b1)
    assert any(row["path"] == str(avatar_a_shared_dir.resolve()) for row in rows_a1)
    assert any(row["path"] == str(avatar_a_shared_dir.resolve()) for row in rows_a2)
    assert all(row["path"] != str(avatar_a_shared_dir.resolve()) for row in rows_b1)


def test_apply_avatar_binding_rescopes_taskspaces_from_meta_to_avatar(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    taskspaces_root = tmp_path / "taskspaces"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)
    manager._taskspaces_root = str(taskspaces_root)

    meta_dir = tmp_path / "meta-workspace"
    avatar_dir = tmp_path / "avatar-workspace"
    manager._save_global_taskspaces(
        [{"id": "ts-meta", "label": "meta", "path": str(meta_dir)}],
        scope_key="meta",
    )
    manager._save_global_taskspaces(
        [{"id": "ts-avatar", "label": "avatar-a", "path": str(avatar_dir)}],
        scope_key="avatar:avatar-a",
    )

    managed = manager.create(session_id="late-bind-avatar-session")
    rows_before = manager.list_taskspaces(managed.session_id)
    assert any(row["path"] == str(meta_dir.resolve()) for row in rows_before)
    assert all(row["path"] != str(avatar_dir.resolve()) for row in rows_before)

    manager.apply_avatar_binding(managed, avatar_id="avatar-a", avatar_name="A")
    rows_after = manager.list_taskspaces(managed.session_id)
    assert any(row["path"] == str(avatar_dir.resolve()) for row in rows_after)
    assert all(row["path"] != str(meta_dir.resolve()) for row in rows_after)


def test_delete_purges_persistence_and_removes_from_listing(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    taskspaces_root = tmp_path / "taskspaces"

    manager = SessionManager()
    manager._session_store = store  # test override
    manager._sessions_root = str(sessions_root)
    manager._taskspaces_root = str(taskspaces_root)

    sid = "delete-persisted-session-id"
    managed = manager.create(session_id=sid)
    managed.session_name = "to-delete"
    managed.studio_session.chat_history = [{"id": "u1", "role": "user", "content": "bye"}]
    assert manager.persist(sid) is True

    fresh = SessionManager()
    fresh._session_store = store  # test override
    fresh._sessions_root = str(sessions_root)
    fresh._taskspaces_root = str(taskspaces_root)

    # Simulate deletion from a history list item that is not yet loaded in memory.
    assert fresh.delete(sid) is True
    assert fresh.get(sid, touch=False) is None
    assert sid not in {row["session_id"] for row in fresh.list_sessions()}


def test_list_sessions_not_capped_to_one_thousand(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    manager = SessionManager()
    manager._session_store = store  # test override

    total = 1005
    for idx in range(total):
        sid = f"bulk-session-{idx:04d}"
        store._save_session_summary_sync(
            sid,
            "summary",
            {"session_name": f"s-{idx}", "updated_at": float(idx + 1), "created_at": float(idx + 1), "chat_messages": 1},
        )

    listed = manager.list_sessions()
    ids = {row["session_id"] for row in listed}
    assert len(ids) >= total


def test_list_sessions_excludes_empty_persisted_sessions(tmp_path: Path) -> None:
    """Persisted sessions with 0 chat messages should not appear in the listing."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    manager = SessionManager()
    manager._session_store = store

    store._save_session_summary_sync(
        "empty-session",
        "summary",
        {"session_name": "empty", "chat_messages": 0, "updated_at": 1.0, "created_at": 1.0},
    )
    store._save_session_summary_sync(
        "real-session",
        "summary",
        {"session_name": "real", "chat_messages": 3, "updated_at": 2.0, "created_at": 2.0},
    )

    listed = manager.list_sessions()
    ids = {row["session_id"] for row in listed}
    assert "real-session" in ids
    assert "empty-session" not in ids


def test_list_sessions_excludes_in_memory_sessions_with_empty_chat_history(tmp_path: Path) -> None:
    """Memory-only sessions that never received a message should not appear (lazy-create UX)."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    managed = manager.create(session_id="empty-memory-session")
    assert managed.studio_session.chat_history == [] or len(managed.studio_session.chat_history) == 0

    listed = manager.list_sessions()
    ids = {row["session_id"] for row in listed}
    assert "empty-memory-session" not in ids

    managed.studio_session.chat_history = [{"id": "u1", "role": "user", "content": "hi"}]
    listed2 = manager.list_sessions()
    ids2 = {row["session_id"] for row in listed2}
    assert "empty-memory-session" in ids2


def test_list_sessions_normalizes_stale_interrupted_state(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    sid = "stale-interrupted-session-id"
    managed = manager.create(session_id=sid)
    managed.studio_session.chat_history = [
        {"id": "u1", "role": "user", "content": "hello"},
    ]
    manager.set_execution_state(sid, "interrupted")
    assert manager.persist(sid) is True

    # No active interrupt request -> listing should not keep stale "interrupted".
    rows = manager.list_sessions()
    row = next(r for r in rows if r["session_id"] == sid)
    assert row["execution_state"] == "idle"

    # Active interrupt request -> keep "interrupted" visible.
    assert manager.request_interrupt(sid) is True
    rows = manager.list_sessions()
    row = next(r for r in rows if r["session_id"] == sid)
    assert row["execution_state"] == "interrupted"

    # Restarted manager (no in-memory interrupt request) should also normalize stale metadata.
    fresh = SessionManager()
    fresh._session_store = store
    fresh._sessions_root = str(sessions_root)
    fresh_rows = fresh.list_sessions()
    fresh_row = next(r for r in fresh_rows if r["session_id"] == sid)
    assert fresh_row["execution_state"] == "idle"
