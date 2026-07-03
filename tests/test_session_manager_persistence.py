#!/usr/bin/env python3
"""Tests for SessionManager state restore/save.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.memory.session_store import SessionStore
from agenticx.studio import session_manager as session_manager_module
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


def test_list_sessions_prefers_message_timestamp_over_polluted_touch(tmp_path: Path) -> None:
    """Real chat timestamps must win over a polluted managed.updated_at.

    Regression: taskspace add/remove used to bulk-bump updated_at for every
    sibling session, then the resolver's old `touch_at > message_based` branch
    pushed all of them into the Today bucket after restart. With the fix, the
    last user/assistant message timestamp is the source of truth.
    """
    import time

    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    sid = "activity-bucket-session"
    old_activity = 1_700_000_000.0
    polluted_touch = time.time()
    managed = manager.create(session_id=sid)
    managed.updated_at = polluted_touch
    managed.created_at = old_activity
    managed.studio_session.chat_history = [
        {
            "id": "u1",
            "role": "user",
            "content": "hello from the past",
            "timestamp": int(old_activity * 1000),
        }
    ]

    rows = manager.list_sessions()
    row = next(item for item in rows if item["session_id"] == sid)
    assert abs(float(row["updated_at"]) - old_activity) < 1.0


def test_add_taskspace_does_not_bulk_bump_updated_at(tmp_path: Path) -> None:
    """Adding a workspace folder must not shove sibling sessions into Today."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    taskspaces_root = tmp_path / "taskspaces"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)
    manager._taskspaces_root = str(taskspaces_root)

    sibling_sid = "sibling-session"
    actor_sid = "taskspace-actor-session"
    old_activity = 1_700_000_000.0

    sibling = manager.create(session_id=sibling_sid)
    sibling.updated_at = old_activity
    sibling.created_at = old_activity
    sibling.studio_session.chat_history = [
        {"id": "u1", "role": "user", "content": "old", "timestamp": int(old_activity * 1000)},
        {"id": "a1", "role": "assistant", "content": "reply", "timestamp": int(old_activity * 1000) + 1},
    ]

    actor = manager.create(session_id=actor_sid)
    actor.updated_at = old_activity
    actor.created_at = old_activity
    actor.studio_session.chat_history = [
        {"id": "u2", "role": "user", "content": "old2", "timestamp": int(old_activity * 1000)},
    ]

    folder = tmp_path / "newly-added-folder"
    folder.mkdir()
    manager.add_taskspace(actor_sid, path=str(folder), label="x")

    assert abs(sibling.updated_at - old_activity) < 1.0
    rows = manager.list_sessions()
    sibling_row = next(item for item in rows if item["session_id"] == sibling_sid)
    assert abs(float(sibling_row["updated_at"]) - old_activity) < 1.0


def test_list_sessions_recovers_activity_from_summary_history(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    sid = "summary-recover-session"
    created_at = 1_700_000_000.0
    real_activity = created_at + 2 * 24 * 3600
    bulk_activity = created_at + 9 * 24 * 3600
    managed = manager.create(session_id=sid)
    managed.created_at = created_at
    managed.updated_at = real_activity
    managed.studio_session.chat_history = [
        {"id": "u1", "role": "user", "content": "first message"},
        {"id": "a1", "role": "assistant", "content": "reply"},
    ]
    assert manager.persist(sid) is True

    managed.updated_at = bulk_activity
    assert manager.persist(sid) is True

    fresh = SessionManager()
    fresh._session_store = store
    fresh._sessions_root = str(sessions_root)
    rows = fresh.list_sessions()
    row = next(item for item in rows if item["session_id"] == sid)
    assert abs(float(row["updated_at"]) - real_activity) < 1.0


def test_list_sessions_derives_title_from_wrapped_messages_json(tmp_path: Path) -> None:
    """Filesystem-only sessions with {\"messages\": [...]} must not show id-prefix titles."""
    import json

    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    sid = "repro-fix-wrap-test"
    session_dir = sessions_root / sid
    session_dir.mkdir(parents=True)
    payload = {
        "messages": [
            {
                "role": "user",
                "content": "我叫 Damon，住在上海，同事 Alice 负责 Near 桌面端",
            },
            {"role": "assistant", "content": "已记下。"},
        ]
    }
    (session_dir / "messages.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    rows = manager.list_sessions()
    row = next(item for item in rows if item["session_id"] == sid)
    assert row["session_name"] == "我叫 Damon，住在上海，同事 Alice 负责 Near 桌面端"

    loaded = manager._load_messages_snapshot(sid)
    assert len(loaded) == 2
    assert loaded[0]["role"] == "user"


def test_scan_interrupted_normalizes_running_with_completed_reply_to_idle(tmp_path: Path) -> None:
    """Startup scan must not mark a finished turn as interrupted."""
    import json

    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    sid = "running-but-finished-session"
    session_dir = sessions_root / sid
    session_dir.mkdir(parents=True)
    (session_dir / "messages.json").write_text(
        json.dumps(
            {
                "messages": [
                    {"role": "user", "content": "现在AI网关有什么特别的"},
                    {"role": "assistant", "content": "团长，UToken 网关的几个特别之处…"},
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    store._save_session_summary_sync(
        sid,
        "summary",
        {
            "session_name": "AI网关的新特点",
            "execution_state": "running",
            "chat_messages": 2,
            "updated_at": 1.0,
            "created_at": 1.0,
        },
    )

    fresh = SessionManager()
    fresh._session_store = store
    fresh._sessions_root = str(sessions_root)
    interrupted = fresh.scan_interrupted_sessions()
    assert sid not in interrupted

    rows = fresh.list_sessions()
    row = next(r for r in rows if r["session_id"] == sid)
    assert row["execution_state"] == "idle"


def test_list_sessions_idle_when_running_metadata_but_terminal_reply(tmp_path: Path) -> None:
    """History spinner must clear when the turn finished but execution_state lagged."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    sid = "running-metadata-terminal-reply"
    managed = manager.create(session_id=sid)
    managed.studio_session.chat_history = [
        {"id": "u1", "role": "user", "content": "查下知识库关于AI网关内容"},
        {
            "id": "a1",
            "role": "assistant",
            "content": "知识库中关于 AI 网关的内容命中 5 条记录。",
            "suggested_questions": ["问题1", "问题2", "问题3"],
        },
    ]
    manager.set_execution_state(sid, "running")
    assert manager.persist(sid) is True

    rows = manager.list_sessions()
    row = next(r for r in rows if r["session_id"] == sid)
    assert row["execution_state"] == "idle"


def test_list_sessions_keeps_running_during_mid_turn_thinking_only(tmp_path: Path) -> None:
    """Incremental thinking persist must not hide the running badge mid tool-loop."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    sid = "running-mid-turn-thinking"
    managed = manager.create(session_id=sid)
    managed.studio_session.chat_history = [
        {"id": "u1", "role": "user", "content": "查下知识库"},
        {
            "id": "a1",
            "role": "assistant",
            "content": "用户要求查知识库",
        },
    ]
    manager.set_execution_state(sid, "running")

    rows = manager.list_sessions()
    row = next(r for r in rows if r["session_id"] == sid)
    assert row["execution_state"] == "running"


def test_list_sessions_idle_when_interrupted_metadata_but_reply_on_disk(tmp_path: Path) -> None:
    """History badge must not stay 已中断 when the last turn already completed on disk."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    sid = "interrupted-metadata-complete-reply"
    managed = manager.create(session_id=sid)
    managed.studio_session.chat_history = [
        {"id": "u1", "role": "user", "content": "hello"},
        {"id": "a1", "role": "assistant", "content": "full answer on disk"},
    ]
    manager.set_execution_state(sid, "interrupted")
    assert manager.persist(sid) is True

    rows = manager.list_sessions()
    row = next(r for r in rows if r["session_id"] == sid)
    assert row["execution_state"] == "idle"


def test_get_messages_page_tail_rounds_and_before_index(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    manager = SessionManager()
    manager._session_store = store  # test override: never touch the real DB
    manager._sessions_root = str(tmp_path / "sessions")

    sid = "paged-session"
    managed = manager.create(session_id=sid)
    managed.studio_session.chat_history = [
        {"id": "u0", "role": "user", "content": "turn0"},
        {"id": "a0", "role": "assistant", "content": "reply0"},
        {"id": "t0", "role": "tool", "content": "tool0"},
        {"id": "u1", "role": "user", "content": "turn1"},
        {"id": "a1", "role": "assistant", "content": "reply1"},
        {"id": "u2", "role": "user", "content": "turn2"},
        {"id": "a2", "role": "assistant", "content": "reply2"},
    ]

    tail = manager.get_messages_page(sid, tail_rounds=2)
    assert tail["total_count"] == 7
    assert tail["start_index"] == 3
    assert tail["has_older"] is True
    assert len(tail["messages"]) == 4
    assert tail["messages"][0]["content"] == "turn1"

    older = manager.get_messages_page(sid, before_index=tail["start_index"], limit=2)
    assert older["start_index"] == 1
    assert older["has_older"] is True
    assert len(older["messages"]) == 2
    assert older["messages"][0]["content"] == "reply0"

    full = manager.get_messages(sid)
    assert len(full) == 7

    limited = manager.get_messages_page(sid, tail_rounds=3, tail_limit=2)
    assert limited["total_count"] == 7
    # tail_limit alone would keep 2 rows, but the last user anchor must stay addressable.
    assert limited["start_index"] == 0
    assert len(limited["messages"]) == 7
    assert limited["messages"][-2]["content"] == "turn2"

    assert manager.persist(sid) is True
    tail_path = tmp_path / "sessions" / sid / "messages_tail.json"
    assert tail_path.is_file()
    fast = SessionManager()
    fast._session_store = store  # test override: never touch the real DB
    fast._sessions_root = str(tmp_path / "sessions")
    page = fast.get_messages_page(sid, tail_rounds=1, tail_limit=40)
    assert page["total_count"] == 7
    assert len(page["messages"]) >= 1


def test_tail_limit_keeps_last_user_turn_for_stall_policy(tmp_path: Path) -> None:
    """tail_limit must not drop the last user row — otherwise desktop stall policy misfires."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(tmp_path / "sessions")

    sid = "tail-user-anchor"
    managed = manager.create(session_id=sid)
    history: list[dict] = [
        {"id": "u0", "role": "user", "content": "early turn"},
        {"id": "a0", "role": "assistant", "content": "early reply"},
    ]
    for i in range(40):
        history.append({"id": f"f{i}", "role": "tool", "content": f"filler-{i}"})
    history.extend(
        [
            {"id": "u1", "role": "user", "content": "final turn"},
            {"id": "a1", "role": "assistant", "content": "final answer body"},
            {"id": "t1", "role": "tool", "content": "orphan tool tail"},
        ]
    )
    managed.studio_session.chat_history = history
    assert manager.persist(sid) is True

    page = manager.get_messages_page(sid, tail_rounds=3, tail_limit=40)
    roles = [str(m.get("role", "")) for m in page["messages"]]
    assert "user" in roles
    user_rows = [m for m in page["messages"] if str(m.get("role", "")) == "user"]
    assert user_rows[-1]["content"] == "final turn"
    assert any(
        str(m.get("role", "")) == "assistant" and "final answer" in str(m.get("content", ""))
        for m in page["messages"]
    )


def test_add_taskspace_respects_configurable_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    taskspaces_root = tmp_path / "taskspaces"

    monkeypatch.setattr(session_manager_module, "_resolve_max_taskspaces", lambda: 3)

    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)
    manager._taskspaces_root = str(taskspaces_root)

    sid = "taskspace-limit-session"
    manager.create(session_id=sid)

    manager.add_taskspace(sid, path=str(tmp_path / "ws-a"), label="a")
    manager.add_taskspace(sid, path=str(tmp_path / "ws-b"), label="b")

    with pytest.raises(ValueError, match=r"taskspace limit reached \(3\)"):
        manager.add_taskspace(sid, path=str(tmp_path / "ws-c"), label="c")

