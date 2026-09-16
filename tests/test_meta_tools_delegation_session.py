from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from agenticx.runtime import meta_tools


class _FakeManaged:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.avatar_id: str | None = None
        self.avatar_name: str | None = None
        self.session_name: str | None = None
        self.updated_at = 0.0
        self.archived = False
        self.studio_session = SimpleNamespace(
            provider_name=None,
            model_name=None,
            workspace_dir="",
            chat_history=[],
            agent_messages=[],
        )


class _FakeSessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, _FakeManaged] = {}
        self.persisted: list[str] = []

    def create(self, provider: str | None = None, model: str | None = None) -> _FakeManaged:
        managed = _FakeManaged(f"session-{len(self._sessions) + 1}")
        managed.studio_session.provider_name = provider
        managed.studio_session.model_name = model
        self._sessions[managed.session_id] = managed
        return managed

    def list_sessions(self, avatar_id: str | None = None) -> list[dict[str, Any]]:
        return [
            {"session_id": managed.session_id, "avatar_id": managed.avatar_id}
            for managed in self._sessions.values()
            if avatar_id is None or managed.avatar_id == avatar_id
        ]

    def get(self, session_id: str, *, touch: bool = False) -> _FakeManaged | None:
        del touch
        return self._sessions.get(session_id)

    def persist(self, session_id: str) -> None:
        self.persisted.append(session_id)


def _avatar() -> SimpleNamespace:
    return SimpleNamespace(
        id="avatar-1",
        name="程基岩",
        default_provider="openai",
        default_model="gpt-test",
        workspace_dir="",
    )


def test_new_delegations_create_distinct_avatar_sessions() -> None:
    manager = _FakeSessionManager()
    historical = manager.create()
    historical.avatar_id = "avatar-1"
    historical.studio_session.chat_history.append(
        {"role": "user", "content": "旧任务：番薯飞行员"}
    )

    first = meta_tools._find_or_create_avatar_session(
        manager,
        "avatar-1",
        _avatar(),
        delegation_id="dlg-first",
        owner_session_id="meta-session",
        task="实现第一个任务",
    )
    second = meta_tools._find_or_create_avatar_session(
        manager,
        "avatar-1",
        _avatar(),
        delegation_id="dlg-second",
        owner_session_id="meta-session",
        task="实现第二个任务",
    )

    assert first.session_id != historical.session_id
    assert second.session_id != first.session_id
    assert second.studio_session.chat_history == []
    assert second.studio_session.agent_messages == []
    assert second.avatar_id == "avatar-1"
    assert second.session_kind == "delegation"
    assert second.delegation_id == "dlg-second"
    assert second.parent_owner_session_id == "meta-session"


def test_running_delegation_is_found_across_avatar_sessions() -> None:
    manager = _FakeSessionManager()
    idle = manager.create()
    idle.avatar_id = "avatar-1"
    running = manager.create()
    running.avatar_id = "avatar-1"
    running._delegation_task = SimpleNamespace(done=lambda: False)
    running._delegation_info = {
        "delegation_id": "dlg-running",
        "from_session": "owner-a",
    }

    found = meta_tools._find_running_avatar_delegation(
        manager,
        "avatar-1",
        owner_session_id="owner-a",
    )

    assert found is running


def test_running_delegation_lookup_isolated_by_owner_session() -> None:
    manager = _FakeSessionManager()
    other_owner = manager.create()
    other_owner.avatar_id = "avatar-1"
    other_owner._delegation_task = SimpleNamespace(done=lambda: False)
    other_owner._delegation_info = {
        "delegation_id": "dlg-owner-b",
        "from_session": "owner-b",
    }

    found = meta_tools._find_running_avatar_delegation(
        manager,
        "avatar-1",
        owner_session_id="owner-a",
    )

    assert found is None
