from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from agenticx.studio import server as studio_server
from agenticx.studio.server import create_studio_app


def _headers() -> dict[str, str]:
    return {"x-agx-desktop-token": "test-token"}


def _create_session(client: TestClient) -> str:
    created = client.get("/api/session", headers=_headers())
    assert created.status_code == 200
    return str(created.json()["session_id"])


def test_mcp_servers_includes_operation_status_fields(monkeypatch) -> None:
    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "test-token")
    monkeypatch.setattr(studio_server, "load_available_servers", lambda: {})
    app = create_studio_app()
    client = TestClient(app)
    sid = _create_session(client)

    managed = app.state.session_manager.get(sid, touch=False)
    assert managed is not None
    sess = managed.studio_session
    sess.mcp_configs = {
        "github": SimpleNamespace(command="docker"),
    }
    sess.connected_servers = set()
    sess.mcp_server_ops = {
        "github": {
            "phase": "connecting",
            "message": "连接中：等待 Docker Daemon 响应…",
            "updated_at": 123.0,
        }
    }

    resp = client.get(
        "/api/mcp/servers",
        params={"session_id": sid, "reload": "false"},
        headers=_headers(),
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["ok"] is True
    row = next(item for item in payload["servers"] if item["name"] == "github")
    assert row["op_phase"] == "connecting"
    assert "Docker" in row["op_message"]
    assert row["op_updated_at"] == 123.0


def test_connect_mcp_failure_persists_failed_status(monkeypatch) -> None:
    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "test-token")
    monkeypatch.setattr(studio_server, "load_available_servers", lambda: {})

    async def _fake_connect(*_args, **_kwargs):
        return False, "docker daemon unavailable"

    monkeypatch.setattr(studio_server, "mcp_connect_async", _fake_connect)

    app = create_studio_app()
    client = TestClient(app)
    sid = _create_session(client)
    managed = app.state.session_manager.get(sid, touch=False)
    assert managed is not None
    managed.studio_session.mcp_configs = {"github": SimpleNamespace(command="docker")}

    connect_resp = client.post(
        "/api/mcp/connect",
        json={"session_id": sid, "name": "github"},
        headers=_headers(),
    )
    assert connect_resp.status_code == 400
    assert "docker daemon unavailable" in str(connect_resp.json().get("detail", ""))

    status_resp = client.get(
        "/api/mcp/servers",
        params={"session_id": sid, "reload": "false"},
        headers=_headers(),
    )
    assert status_resp.status_code == 200
    row = next(item for item in status_resp.json()["servers"] if item["name"] == "github")
    assert row["op_phase"] == "failed"
    assert "docker daemon unavailable" in row["op_message"]
