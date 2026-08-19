from __future__ import annotations

from collections import deque

from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app
from agenticx.studio.turn_limiter import SessionTurnBusy, TurnQueueFull


class _FakeResponse:
    content = "done"
    tool_calls: list[object] = []


class _TextLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse()

    def stream(self, *_args, **_kwargs):
        yield "done"


class _Lease:
    def __init__(self) -> None:
        self.release_calls = 0

    async def release(self) -> None:
        self.release_calls += 1


class _GrantingLimiter:
    def __init__(self) -> None:
        self.acquire_calls: list[tuple[str, str]] = []
        self.leases: list[_Lease] = []

    async def acquire(self, session_id: str, *, source: str):
        self.acquire_calls.append((session_id, source))
        lease = _Lease()
        self.leases.append(lease)
        return lease


class _RejectingLimiter:
    def __init__(self, error: Exception, *, max_active: int = 3) -> None:
        self.error = error
        self.max_active = max_active

    async def acquire(self, _session_id: str, *, source: str):
        del source
        raise self.error


def test_chat_releases_turn_lease_after_stream_is_consumed(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())
    app = create_studio_app()
    limiter = _GrantingLimiter()
    app.state.session_manager.turn_limiter = limiter
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    response = client.post(
        "/api/chat",
        json={"session_id": session_id, "user_input": "hello", "client_turn_id": "turn-1"},
    )

    assert response.status_code == 200
    assert limiter.acquire_calls == [(session_id, "desktop_chat")]
    assert limiter.leases[0].release_calls == 1


def test_busy_session_is_409_and_does_not_poison_client_turn_id() -> None:
    app = create_studio_app()
    app.state.session_manager.turn_limiter = _RejectingLimiter(SessionTurnBusy("busy"))
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    managed = app.state.session_manager.get(session_id, touch=False)
    assert managed is not None

    response = client.post(
        "/api/chat",
        json={"session_id": session_id, "user_input": "hello", "client_turn_id": "retry-me"},
    )

    assert response.status_code == 409
    assert "session_turn_in_progress" in response.text
    assert "retry-me" not in list(getattr(managed, "_recent_client_turn_ids", ()))


def test_full_desktop_capacity_returns_retryable_429() -> None:
    app = create_studio_app()
    app.state.session_manager.turn_limiter = _RejectingLimiter(TurnQueueFull("full"))
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    response = client.post(
        "/api/chat",
        json={"session_id": session_id, "user_input": "hello"},
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "3"
    assert "client_turn_limit_reached" in response.text


def test_duplicate_and_reattach_do_not_acquire_new_turn() -> None:
    app = create_studio_app()
    limiter = _GrantingLimiter()
    app.state.session_manager.turn_limiter = limiter
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    managed = app.state.session_manager.get(session_id, touch=False)
    assert managed is not None
    managed._recent_client_turn_ids = deque(["already-done"], maxlen=64)

    duplicate = client.post(
        "/api/chat",
        json={
            "session_id": session_id,
            "user_input": "hello",
            "client_turn_id": "already-done",
        },
    )
    reattach = client.get(f"/api/sessions/{session_id}/stream")

    assert duplicate.status_code == 200
    assert '"duplicate":true' in duplicate.text
    assert reattach.status_code == 200
    assert limiter.acquire_calls == []


def test_capacity_message_reports_the_configured_limit() -> None:
    """上限可通过 AGX_DESKTOP_MAX_CONCURRENT_TURNS 调小，提示语不能写死 3。"""
    app = create_studio_app()
    app.state.session_manager.turn_limiter = _RejectingLimiter(TurnQueueFull("full"), max_active=2)
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    response = client.post(
        "/api/chat",
        json={"session_id": session_id, "user_input": "hello"},
    )

    assert response.status_code == 429
    assert "已有 2 个任务" in response.text
    assert "已有 3 个任务" not in response.text


def test_stuck_running_session_does_not_hold_a_slot_forever(monkeypatch) -> None:
    """execution_state 卡在 running 时，并发位必须有上界地放回来。

    没有上界的话，一个没能收尾的运行态会永久吞掉一个并发位；攒够 max_active 次之后
    整个桌面端就再也发不出请求，而且只能重启才恢复。
    """
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: _TextLLM())
    monkeypatch.setattr(server_module, "_TURN_LEASE_MAX_HOLD_SECONDS", 0.2)

    app = create_studio_app()
    limiter = _GrantingLimiter()
    manager = app.state.session_manager
    manager.turn_limiter = limiter
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]

    # 让这个会话一直显示为 running：模拟运行态没能收尾。
    monkeypatch.setattr(manager, "set_execution_state", lambda *_args, **_kwargs: None)
    managed = manager.get(session_id, touch=False)
    assert managed is not None
    managed.execution_state = "running"

    response = client.post(
        "/api/chat",
        json={"session_id": session_id, "user_input": "hello", "client_turn_id": "stuck-1"},
    )

    assert response.status_code == 200
    assert limiter.leases[0].release_calls == 1
