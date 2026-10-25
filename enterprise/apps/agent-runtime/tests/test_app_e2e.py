#!/usr/bin/env python3
"""End-to-end host assembly: fake control plane, fake gateway, SQLite store.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine, select

from agenticx.managed.ids import new_ulid

from fakes import DEFAULT_MANIFEST, FakeAdminConsole, FakeGateway, agent_record, version_record
from ma_agent_runtime.app import build_app
from ma_agent_runtime.config import Settings
from ma_agent_runtime.db import split_database_url
from ma_agent_runtime.tables import ma_session_usage, metadata


def _settings(tmp_path: Path, gateway: FakeGateway, *, worker: bool = False) -> Settings:
    home = (tmp_path / "home").resolve()
    database = tmp_path / "ma.db"
    return Settings(
        database_url=f"sqlite:///{database}",
        internal_token="it",
        admin_url="http://admin.test",
        gateway_url=gateway.base_url + "/v1",
        gateway_token="agx-pat-gw", # gitleaks:allow
        home=home,
        command_sandbox="best_effort",
        allow_sqlite=True,
        desktop_worker_enabled=worker,
        implicit_local_env=True,
    )


def _prepare_db(settings: Settings) -> None:
    urls = split_database_url(settings.database_url)
    engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(engine)
    engine.dispose()


def _agent_bundle(agent_id: str, tenant_id: str, *, effective: int = 2, versions: list[int] | None = None) -> dict[str, Any]:
    numbers = versions or [effective]
    return {
        "runtime": "cloud",
        "effective": effective,
        "agent": agent_record(agent_id, tenant_id, max(numbers)),
        "versions": {number: version_record(agent_id, number, DEFAULT_MANIFEST) for number in numbers},
    }


async def _boot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    script: list[dict[str, Any]],
    fake: FakeAdminConsole,
    worker: bool = False,
) -> tuple[Any, httpx.AsyncClient, FakeGateway]:
    gateway = FakeGateway(script)
    gateway.start()
    home = (tmp_path / "home").resolve()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("MA_RUNTIME_HOME", str(home))
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    settings = _settings(tmp_path, gateway, worker=worker)
    _prepare_db(settings)
    app = build_app(settings, admin_transport=fake.transport, scrub_env=False)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    await app.state.ma.startup()
    return app, client, gateway


async def _shutdown(app: Any, client: httpx.AsyncClient, gateway: FakeGateway) -> None:
    await client.aclose()
    await app.state.ma.shutdown()
    gateway.close()


async def _wait_idle(client: httpx.AsyncClient, sid: str, headers: dict[str, str]) -> dict[str, Any]:
    record: dict[str, Any] = {}
    for _ in range(75):
        response = await client.get(f"/ma/v1/sessions/{sid}", headers=headers)
        record = response.json()
        stop = record.get("stop_reason") or {}
        if record.get("status") == "idle" and stop.get("type") == "end_turn":
            return record
        await asyncio.sleep(0.2)
    events = await client.get(f"/ma/v1/sessions/{sid}/events", headers=headers)
    raise AssertionError({"session": record, "events": events.json(), "gateway_note": "turn did not end"})


def _texts(events: list[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for event in events:
        if event.get("type") != "agent.message":
            continue
        for block in event.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "text":
                found.append(str(block.get("text") or ""))
    return found


async def test_portal_style_session_end_turn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tenant = "T"
    user_id = new_ulid()
    agent_id = new_ulid()
    script_text = "hello-from-gateway"
    fake = FakeAdminConsole(
        agents={agent_id: _agent_bundle(agent_id, tenant)},
        pats={
            "agx-pat-svc": {
                "active": True,
                "tenant_id": tenant,
                "user_id": "SVCUSER000000000000000000",
                "scopes": [
                    "ma:sessions:read",
                    "ma:sessions:write",
                    "ma:sessions:on_behalf",
                    "ma:agents:read",
                ],
                "token_id": "1",
            }
        },
    )
    app, client, gateway = await _boot(
        tmp_path,
        monkeypatch,
        script=[{"text": script_text}],
        fake=fake,
    )
    headers = {
        "Authorization": "Bearer agx-pat-svc",
        "X-AgenticX-On-Behalf-Of": user_id,
    }
    try:
        created = await client.post(
            "/ma/v1/sessions",
            headers=headers,
            json={"agent_id": agent_id, "source": "portal"},
        )
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["agent_version"] == 2
        assert body["environment_id"] == "local"
        assert body["created_by_user_id"] == user_id
        sid = body["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{sid}/events",
            headers=headers,
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "你好"}]}]},
        )
        assert posted.status_code == 200, posted.text
        await _wait_idle(client, sid, headers)
        events = (await client.get(f"/ma/v1/sessions/{sid}/events", headers=headers)).json()["data"]
        assert script_text in _texts(events)
        calls = [call for call in gateway.calls if call["headers"].get("x-agenticx-session-id") == sid]
        assert calls
        headers_seen = calls[0]["headers"]
        assert headers_seen["authorization"] == "Bearer agx-pat-gw"
        assert headers_seen["x-agenticx-provider"] == "demo"
        assert headers_seen["x-agenticx-trace-id"] == sid.lower()
        assert headers_seen["x-agenticx-trace-stage"] == "ma.session"
        assert headers_seen["x-agenticx-agent-id"] == agent_id
        assert headers_seen["x-agenticx-deployment-id"] == f"ma-{agent_id}-v2"
        assert calls[0]["body"]["model"] == "reply-model"
        model_ends = [event for event in events if event["type"] == "span.model_request_end"]
        async with app.state.ma.store._engine.connect() as conn:  # noqa: SLF001
            rows = (
                await conn.execute(
                    select(ma_session_usage).where(ma_session_usage.c.session_id == sid)
                )
            ).mappings().all()
        assert len(rows) == len(model_ends)
        assert {row["user_id"] for row in rows} == {user_id}
    finally:
        await _shutdown(app, client, gateway)


async def test_bash_runs_in_session_workdir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tenant = "T"
    user_id = new_ulid()
    agent_id = new_ulid()
    fake = FakeAdminConsole(
        agents={agent_id: _agent_bundle(agent_id, tenant)},
        pats={
            "agx-pat-svc": {
                "active": True,
                "tenant_id": tenant,
                "user_id": user_id,
                "scopes": ["ma:sessions:read", "ma:sessions:write", "ma:sessions:on_behalf"],
                "token_id": "1",
            }
        },
    )
    app, client, gateway = await _boot(
        tmp_path,
        monkeypatch,
        script=[
            {"tool": "bash_exec", "arguments": {"command": "echo e3-ok > out.txt"}},
            {"text": "bash-done"},
        ],
        fake=fake,
    )
    headers = {"Authorization": "Bearer agx-pat-svc", "X-AgenticX-On-Behalf-Of": user_id}
    try:
        created = await client.post(
            "/ma/v1/sessions",
            headers=headers,
            json={"agent_id": agent_id, "source": "api"},
        )
        assert created.status_code == 201, created.text
        sid = created.json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{sid}/events",
            headers=headers,
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "run"}]}]},
        )
        assert posted.status_code == 200, posted.text
        await _wait_idle(client, sid, headers)
        outfile = tmp_path / "home" / ".agenticx" / "sessions" / sid / "work" / "out.txt"
        assert outfile.read_text(encoding="utf-8") == "e3-ok\n"
        events = (await client.get(f"/ma/v1/sessions/{sid}/events", headers=headers)).json()["data"]
        tool_uses = [event for event in events if event["type"] == "agent.tool_use" and event["name"] == "bash_exec"]
        assert tool_uses
        assert tool_uses[0]["evaluated_policy"] == "always_allow"
        results = [event for event in events if event["type"] == "agent.tool_result"]
        assert results
        assert results[0]["is_error"] is False
    finally:
        await _shutdown(app, client, gateway)


async def test_pinned_routing_selects_effective_version(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant = "T"
    agent_id = new_ulid()
    fake = FakeAdminConsole(
        agents={agent_id: _agent_bundle(agent_id, tenant, effective=1, versions=[1, 2])},
        pats={
            "agx-pat-svc": {
                "active": True,
                "tenant_id": tenant,
                "user_id": new_ulid(),
                "scopes": ["ma:sessions:write"],
                "token_id": "1",
            }
        },
    )
    app, client, gateway = await _boot(tmp_path, monkeypatch, script=[{"text": "v1"}], fake=fake)
    try:
        created = await client.post(
            "/ma/v1/sessions",
            headers={"Authorization": "Bearer agx-pat-svc"},
            json={"agent_id": agent_id, "source": "api"},
        )
        assert created.status_code == 201, created.text
        assert created.json()["agent_version"] == 1
    finally:
        await _shutdown(app, client, gateway)


async def test_auth_failures(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tenant = "T"
    agent_id = new_ulid()
    remote_id = new_ulid()
    user_id = new_ulid()
    fake = FakeAdminConsole(
        agents={agent_id: _agent_bundle(agent_id, tenant)},
        environments={
            remote_id: {
                "id": remote_id,
                "tenant_id": tenant,
                "name": "remote",
                "type": "cloud",
                "config": {"type": "cloud", "sandbox_backend": "remote"},
                "status": "active",
            }
        },
        pats={
            "agx-pat-inactive": {"active": False},
            "agx-pat-read": {
                "active": True,
                "tenant_id": tenant,
                "user_id": "reader",
                "scopes": ["ma:sessions:read"],
                "token_id": "2",
            },
            "agx-pat-svc": {
                "active": True,
                "tenant_id": tenant,
                "user_id": "svc",
                "scopes": ["ma:sessions:write"],
                "token_id": "3",
            },
        },
    )
    app, client, gateway = await _boot(tmp_path, monkeypatch, script=[{"text": "nope"}], fake=fake)
    try:
        missing = await client.post("/ma/v1/sessions", json={"agent_id": agent_id, "source": "api"})
        assert missing.status_code == 401
        inactive = await client.post(
            "/ma/v1/sessions",
            headers={"Authorization": "Bearer agx-pat-inactive"},
            json={"agent_id": agent_id, "source": "api"},
        )
        assert inactive.status_code == 401
        forbidden = await client.post(
            "/ma/v1/sessions",
            headers={"Authorization": "Bearer agx-pat-read", "X-AgenticX-On-Behalf-Of": user_id},
            json={"agent_id": agent_id, "source": "api"},
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "forbidden_scope"
        remote = await client.post(
            "/ma/v1/sessions",
            headers={"Authorization": "Bearer agx-pat-svc"},
            json={"agent_id": agent_id, "environment_id": remote_id, "source": "api"},
        )
        assert remote.status_code == 400, remote.text
        assert remote.json()["error"]["code"] == "invalid_request"
    finally:
        await _shutdown(app, client, gateway)


async def test_desktop_worker_disabled_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_id = new_ulid()
    fake = FakeAdminConsole(
        pats={
            "agx-pat-worker": {
                "active": True,
                "tenant_id": "T",
                "user_id": "worker-user",
                "scopes": ["ma:worker"],
                "token_id": "9",
            }
        }
    )
    app, client, gateway = await _boot(tmp_path, monkeypatch, script=[{"text": "idle"}], fake=fake)
    try:
        missing = await client.post(
            f"/ma/v1/environments/{env_id}/work/poll",
            headers={"Authorization": "Bearer agx-pat-worker"},
            json={"device_id": "device-aaa", "max_wait_seconds": 0},
        )
        assert missing.status_code == 404
        assert "environment_not_found" not in missing.text
    finally:
        await _shutdown(app, client, gateway)

    enabled_root = tmp_path / "enabled"
    enabled_root.mkdir()
    app2, client2, gateway2 = await _boot(
        enabled_root,
        monkeypatch,
        script=[{"text": "idle"}],
        fake=fake,
        worker=True,
    )
    try:
        found = await client2.post(
            f"/ma/v1/environments/{env_id}/work/poll",
            headers={"Authorization": "Bearer agx-pat-worker"},
            json={"device_id": "device-aaa", "max_wait_seconds": 0},
        )
        assert found.status_code == 404
        assert found.json()["error"]["code"] == "environment_not_found"
    finally:
        await _shutdown(app2, client2, gateway2)


async def test_health_endpoints(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeAdminConsole()
    app, client, gateway = await _boot(tmp_path, monkeypatch, script=[{"text": "idle"}], fake=fake)
    try:
        health = await client.get("/healthz")
        assert health.status_code == 200
        assert health.json() == {"ok": True}
        ready = await client.get("/readyz")
        assert ready.status_code == 200
        assert ready.json() == {"ok": True}
    finally:
        await _shutdown(app, client, gateway)
