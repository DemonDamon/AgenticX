#!/usr/bin/env python3
"""Contract tests for the HA session storage backends (Plan A).

Covers:
- backend contract (roundtrip / missing / overwrite / delete) for both the
  local file backend and the redis backend (via fakeredis);
- redis key layout;
- factory resolution order;
- byte-identical local file formats;
- SessionManager wiring through the storage facade.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.memory.session_store import SessionStore
from agenticx.studio.session_manager import SessionManager
from agenticx.studio.storage.backend import SyncStorageFacade
from agenticx.studio.storage.factory import (
    get_storage_backend,
    get_sync_storage,
    reset_storage_backend_for_testing,
)
from agenticx.studio.storage.local_file import LocalFileBackend
from agenticx.studio.storage.redis_backend import RedisSessionStorage


def _make_local(tmp_path: Path) -> LocalFileBackend:
    return LocalFileBackend(
        sessions_root=tmp_path / "sessions",
        config_dir=tmp_path / "cfg",
    )


def _make_redis() -> tuple[RedisSessionStorage, object]:
    fakeredis = pytest.importorskip("fakeredis.aioredis")
    from agenticx.server.redis_backend import RedisBackend

    rb = RedisBackend(url="redis://test/0")
    fake_client = fakeredis.FakeRedis(decode_responses=True)
    rb._client = fake_client
    rb._connected = True
    return RedisSessionStorage(redis_backend=rb), fake_client


@pytest.fixture(params=["local", "redis"])
def backend(request: pytest.FixtureRequest, tmp_path: Path):
    if request.param == "local":
        yield _make_local(tmp_path)
    else:
        storage, _ = _make_redis()
        yield storage
        storage.close()


# ── AC-1: backend contract ──


async def test_backend_contract_messages_roundtrip(backend) -> None:
    messages = [
        {"role": "user", "content": "你好"},
        {"role": "assistant", "content": "world", "timestamp": 123},
    ]
    await backend.save_messages("s1", messages)
    assert await backend.load_messages("s1") == messages


async def test_backend_contract_missing_returns_empty(backend) -> None:
    assert await backend.load_messages("nope") == []
    assert await backend.load_agent_messages("nope") == []
    assert await backend.load_messages_tail("nope") is None
    assert await backend.load_agent_state("nope") is None
    assert await backend.load_automation_tasks() == []
    assert await backend.load_mcp_state() == {}


async def test_backend_contract_overwrite(backend) -> None:
    await backend.save_messages("s1", [{"role": "user", "content": "a"}])
    await backend.save_messages("s1", [{"role": "user", "content": "b"}])
    assert await backend.load_messages("s1") == [{"role": "user", "content": "b"}]


async def test_backend_contract_delete_session(backend) -> None:
    await backend.save_messages("s1", [{"role": "user", "content": "a"}])
    await backend.save_agent_messages("s1", [{"role": "user", "content": "a"}])
    await backend.save_messages_tail("s1", {"total_count": 1, "start_index": 0, "messages": []})
    await backend.save_agent_state("s1", {"round_idx": 2})
    await backend.delete_session("s1")
    assert await backend.load_messages("s1") == []
    assert await backend.load_agent_messages("s1") == []
    assert await backend.load_messages_tail("s1") is None
    assert await backend.load_agent_state("s1") is None


async def test_backend_contract_agent_messages_trimmed_to_40(backend) -> None:
    messages = [{"role": "user", "content": f"m{i}"} for i in range(50)]
    await backend.save_agent_messages("s1", messages)
    loaded = await backend.load_agent_messages("s1")
    assert loaded == messages[-40:]


async def test_backend_contract_tail_and_agent_state(backend) -> None:
    tail = {"total_count": 5, "start_index": 2, "messages": [{"role": "user"}]}
    await backend.save_messages_tail("s1", tail)
    assert await backend.load_messages_tail("s1") == tail
    state = {"checkpoint": {"round_idx": 3, "status": "in_progress"}}
    await backend.save_agent_state("s1", state)
    assert await backend.load_agent_state("s1") == state


async def test_backend_contract_automation_and_mcp_state(backend) -> None:
    tasks = [{"id": "atask_1", "name": "demo", "enabled": True}]
    await backend.save_automation_tasks(tasks)
    assert await backend.load_automation_tasks() == tasks
    state = {"last_connected": ["a"], "quarantined": {"b": 2}, "updated_at": 1.0}
    await backend.save_mcp_state(state)
    assert await backend.load_mcp_state() == state


async def test_backend_contract_ping(backend) -> None:
    assert await backend.ping() is True


# ── AC-3: redis key layout ──


async def test_redis_backend_key_layout() -> None:
    storage, fake = _make_redis()
    try:
        await storage.save_messages("s1", [{"role": "user", "content": "hi"}])
        await storage.save_agent_messages("s1", [{"role": "user", "content": "hi"}])
        await storage.save_messages_tail("s1", {"total_count": 1})
        await storage.save_agent_state("s1", {"round_idx": 1})
        await storage.save_automation_tasks([{"id": "t"}])
        await storage.save_mcp_state({"last_connected": []})
        keys = set(await fake.keys())
        assert "agenticx:sess:s1:messages" in keys
        assert "agenticx:sess:s1:agent_messages" in keys
        assert "agenticx:sess:s1:tail" in keys
        assert "agenticx:sess:s1:agent_state" in keys
        assert "agenticx:automation:tasks" in keys
        assert "agenticx:mcp:state" in keys
        raw = await fake.get("agenticx:sess:s1:messages")
        assert json.loads(raw) == [{"role": "user", "content": "hi"}]
    finally:
        storage.close()


async def test_redis_lazy_connect_no_deadlock() -> None:
    """First op triggers connect on the backend loop without deadlocking it.

    Regression: impl coroutines run on the storage loop; scheduling connect
    back onto the same loop and blocking on the future deadlocks until the
    8s timeout, degrading the first write.
    """
    fakeredis = pytest.importorskip("fakeredis.aioredis")
    from agenticx.server.redis_backend import RedisBackend

    rb = RedisBackend(url="redis://test/0")
    fake_client = fakeredis.FakeRedis(decode_responses=True)

    async def _fake_connect() -> bool:
        rb._client = fake_client
        rb._connected = True
        return True

    rb.connect = _fake_connect  # type: ignore[method-assign]
    storage = RedisSessionStorage(redis_backend=rb)
    try:
        assert storage._rb.connected is False
        await storage.save_messages("s1", [{"role": "user", "content": "hi"}])
        assert await storage.load_messages("s1") == [{"role": "user", "content": "hi"}]
    finally:
        storage.close()


# ── AC-4: factory resolution ──


@pytest.fixture(autouse=True)
def _reset_factory():
    reset_storage_backend_for_testing()
    yield
    reset_storage_backend_for_testing()


def test_factory_defaults_to_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_STORAGE_BACKEND", raising=False)
    monkeypatch.setattr(ConfigManager, "get_value", classmethod(lambda cls, key: None))
    assert isinstance(get_storage_backend(), LocalFileBackend)


def test_factory_env_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "local")
    assert isinstance(get_storage_backend(), LocalFileBackend)


def test_factory_env_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "redis")
    monkeypatch.setenv("AGX_REDIS_URL", "redis://127.0.0.1:6399/15")
    backend = get_storage_backend()
    assert isinstance(backend, RedisSessionStorage)


def test_factory_config_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_STORAGE_BACKEND", raising=False)

    def _fake_get_value(cls, key: str):
        if key == "runtime.storage_backend":
            return "redis"
        if key == "runtime.redis_url":
            return "redis://127.0.0.1:6399/15"
        return None

    monkeypatch.setattr(ConfigManager, "get_value", classmethod(_fake_get_value))
    assert isinstance(get_storage_backend(), RedisSessionStorage)


def test_factory_reset_allows_reresolution(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "local")
    first = get_storage_backend()
    assert isinstance(first, LocalFileBackend)
    reset_storage_backend_for_testing()
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "redis")
    monkeypatch.setenv("AGX_REDIS_URL", "redis://127.0.0.1:6399/15")
    second = get_storage_backend()
    assert isinstance(second, RedisSessionStorage)


def test_get_sync_storage_facade(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "local")
    monkeypatch.setattr(
        "agenticx.studio.storage.factory._default_sessions_root",
        lambda: tmp_path / "sessions",
    )
    monkeypatch.setattr(
        "agenticx.studio.storage.factory._default_config_dir",
        lambda: tmp_path / "cfg",
    )
    facade = get_sync_storage()
    assert isinstance(facade, SyncStorageFacade)
    facade.save_messages("sx", [{"role": "user", "content": "hi"}])
    assert facade.load_messages("sx") == [{"role": "user", "content": "hi"}]


# ── Byte-identical local formats ──


def test_local_backend_messages_byte_identical(tmp_path: Path) -> None:
    backend = _make_local(tmp_path)
    messages = [{"role": "user", "content": "你好"}]
    backend.save_messages_sync("s1", messages)
    raw = (tmp_path / "sessions" / "s1" / "messages.json").read_text("utf-8")
    assert raw == json.dumps(messages, ensure_ascii=False, indent=2)


def test_local_backend_mcp_state_byte_identical(tmp_path: Path) -> None:
    backend = _make_local(tmp_path)
    state = {"last_connected": ["a"], "quarantined": {}, "updated_at": 1.0}
    backend.save_mcp_state_sync(state)
    raw = (tmp_path / "cfg" / "mcp_state.json").read_text("utf-8")
    assert raw == json.dumps(state, ensure_ascii=False, indent=2) + "\n"


def test_local_backend_automation_tasks_byte_identical(tmp_path: Path) -> None:
    backend = _make_local(tmp_path)
    tasks = [{"id": "atask_1", "name": "demo"}]
    backend.save_automation_tasks_sync(tasks)
    raw = (tmp_path / "cfg" / "automation_tasks.json").read_text("utf-8")
    assert raw == json.dumps(tasks, indent=2, ensure_ascii=False)


def test_local_backend_agent_state_roundtrip(tmp_path: Path) -> None:
    backend = _make_local(tmp_path)
    backend.save_agent_state_sync("s1", {"round_idx": 2})
    raw = json.loads((tmp_path / "sessions" / "s1" / "agent_state.json").read_text("utf-8"))
    assert raw == {"round_idx": 2}
    assert backend.load_agent_state_sync("s1") == {"round_idx": 2}


# ── AC-2/AC-5: SessionManager wiring ──


def test_session_manager_persist_and_reload_via_storage(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    manager = SessionManager()
    manager._session_store = store
    manager._sessions_root = str(sessions_root)

    sid = "ha-storage-wiring"
    managed = manager.create(session_id=sid)
    managed.studio_session.chat_history = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "final answer"},
    ]
    managed.studio_session.agent_messages = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "final answer"},
    ]
    assert manager.persist(sid) is True

    messages = json.loads((sessions_root / sid / "messages.json").read_text("utf-8"))
    assert messages[-1]["content"] == "final answer"
    tail = json.loads((sessions_root / sid / "messages_tail.json").read_text("utf-8"))
    assert tail["total_count"] == 2
    agent_messages = json.loads(
        (sessions_root / sid / "agent_messages.json").read_text("utf-8")
    )
    assert agent_messages[-1]["content"] == "final answer"

    fresh = SessionManager()
    fresh._session_store = store
    fresh._sessions_root = str(sessions_root)
    restored = fresh.get(sid, touch=False)
    assert restored is not None
    history = restored.studio_session.chat_history
    assert history[-1]["content"] == "final answer"

    assert fresh.delete(sid) is True
    assert not (sessions_root / sid).exists()
