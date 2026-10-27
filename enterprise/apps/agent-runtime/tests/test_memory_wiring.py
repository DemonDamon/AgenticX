#!/usr/bin/env python3
"""agent-runtime wires memory validation and per-turn snapshots.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine

from agenticx.managed.ids import new_ulid

from fakes import (
    DEFAULT_MANIFEST,
    FakeAdminConsole,
    FakeGateway,
    agent_record,
    version_record,
)
from ma_agent_runtime.app import build_app
from ma_agent_runtime.config import Settings
from ma_agent_runtime.db import split_database_url
from ma_agent_runtime.tables import metadata


class MemoryAdmin(FakeAdminConsole):
    """Admin console fake that also serves the memory internal routes."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.validations: list[dict[str, Any]] = []
        self.snapshots: list[dict[str, str]] = []
        self.writes: list[dict[str, Any]] = []

    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/memory-stores/validate"):
            body = json.loads(request.content.decode("utf-8") or "{}")
            self.validations.append(body)
            return httpx.Response(
                200,
                json={
                    "memory_stores": [
                        {"id": store_id, "status": "active", "name": "Notes"}
                        for store_id in body["memory_store_ids"]
                    ]
                },
            )
        if path.endswith("/snapshot"):
            self.snapshots.append(
                {
                    "session_id": request.url.params.get("session_id") or "",
                    "tenant_id": request.url.params.get("tenant_id") or "",
                }
            )
            store_id = path.rstrip("/").split("/")[-2]
            return httpx.Response(
                200,
                json={
                    "memory_store": {
                        "id": store_id,
                        "name": "Notes",
                        "status": "active",
                    },
                    "memories": [],
                },
            )
        if path.endswith("/writes"):
            body = json.loads(request.content.decode("utf-8") or "{}")
            self.writes.append(body)
            ops = body.get("ops") or []
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "index": index,
                            "ok": True,
                            "memory": {
                                "id": f"M{index:025d}",
                                "path": op.get("path", "/x"),
                                "version": 1,
                                "content_sha256": "abc",
                            },
                        }
                        for index, op in enumerate(ops)
                    ]
                },
            )
        return super()._handle(request)


def _settings(
    tmp_path: Path, gateway: FakeGateway, *, memory_enabled: bool = True
) -> Settings:
    home = (tmp_path / "home").resolve()
    return Settings(
        database_url=f"sqlite:///{tmp_path / 'ma.db'}",
        internal_token="it",
        admin_url="http://admin.test",
        gateway_url=gateway.base_url + "/v1",
        gateway_token="agx-pat-gw", # gitleaks:allow
        home=home,
        command_sandbox="best_effort",
        allow_sqlite=True,
        memory_enabled=memory_enabled,
    )


def _prepare(settings: Settings) -> None:
    db_path = Path(settings.database_url.removeprefix("sqlite:///"))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    settings.home.mkdir(parents=True, exist_ok=True)
    urls = split_database_url(settings.database_url)
    engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(engine)
    engine.dispose()


def _bundle(agent_id: str, tenant: str) -> dict[str, Any]:
    return {
        "runtime": "cloud",
        "effective": 1,
        "agent": agent_record(agent_id, tenant, 1),
        "versions": {1: version_record(agent_id, 1, DEFAULT_MANIFEST)},
    }


def _pat(tenant: str) -> dict[str, Any]:
    return {
        "agx-pat-svc": {
            "active": True,
            "tenant_id": tenant,
            "user_id": "SVCUSER000000000000000000",
            "scopes": [
                "ma:sessions:read",
                "ma:sessions:write",
                "ma:memory:read",
                "ma:memory:write",
                "ma:agents:read",
            ],
            "token_id": "1",
        }
    }


async def _wait_idle(
    client: httpx.AsyncClient, session_id: str, headers: dict[str, str]
) -> None:
    for _ in range(75):
        response = await client.get(f"/ma/v1/sessions/{session_id}", headers=headers)
        record = response.json()
        stop = record.get("stop_reason") or {}
        if record.get("status") == "idle" and stop.get("type") == "end_turn":
            return
        await asyncio.sleep(0.05)
    events = await client.get(f"/ma/v1/sessions/{session_id}/events", headers=headers)
    raise AssertionError(events.text)


async def test_resources_snapshot_via_admin_console(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = FakeGateway([{"text": "hello-from-gateway"}])
    gateway.start()
    home = (tmp_path / "home").resolve()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("MA_RUNTIME_HOME", str(home))
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    tenant = "T"
    agent_id = new_ulid()
    fake = MemoryAdmin(agents={agent_id: _bundle(agent_id, tenant)}, pats=_pat(tenant))
    settings = _settings(tmp_path, gateway)
    _prepare(settings)
    app = build_app(settings, admin_transport=fake.transport, scrub_env=False)
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://rt"
    )
    await app.state.ma.startup()
    headers = {"Authorization": "Bearer agx-pat-svc"}
    try:
        created = await client.post(
            "/ma/v1/sessions",
            headers=headers,
            json={
                "agent_id": agent_id,
                "resources": [{"type": "memory_store", "memory_store_id": "store-1"}],
            },
        )
        assert created.status_code == 201, created.text
        session_id = created.json()["id"]
        assert created.json()["resources"][0]["memory_store_id"] == "store-1"
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            headers=headers,
            json={
                "events": [
                    {
                        "type": "user.message",
                        "content": [{"type": "text", "text": "hi"}],
                    }
                ]
            },
        )
        assert posted.status_code == 200, posted.text
        await _wait_idle(client, session_id, headers)
        assert len(fake.snapshots) == 1
        assert fake.snapshots[0]["session_id"] == session_id
    finally:
        await client.aclose()
        await app.state.ma.shutdown()
        gateway.close()

    disabled_gateway = FakeGateway([{"text": "unused"}])
    disabled_gateway.start()
    disabled_home = (tmp_path / "disabled-home").resolve()
    monkeypatch.setenv("HOME", str(disabled_home))
    monkeypatch.setenv("MA_RUNTIME_HOME", str(disabled_home))
    monkeypatch.delenv("DATABASE_DIALECT", raising=False)
    monkeypatch.setenv("MA_RUNTIME_ALLOW_SQLITE", "1")
    monkeypatch.setenv("MA_RUNTIME_MEMORY_ENABLED", "0")
    monkeypatch.setenv("MA_RUNTIME_COMMAND_SANDBOX", "best_effort")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'disabled' / 'ma.db'}")
    monkeypatch.setenv("MA_INTERNAL_TOKEN", "it")
    monkeypatch.setenv("MA_RUNTIME_GATEWAY_TOKEN", "agx-pat-gw")
    monkeypatch.setenv("MA_RUNTIME_GATEWAY_URL", disabled_gateway.base_url + "/v1")
    monkeypatch.setenv("MA_RUNTIME_ADMIN_URL", "http://admin.test")
    disabled_settings = Settings.from_env()
    assert disabled_settings.memory_enabled is False
    _prepare(disabled_settings)
    disabled_fake = MemoryAdmin(
        agents={agent_id: _bundle(agent_id, tenant)}, pats=_pat(tenant)
    )
    disabled_app = build_app(
        disabled_settings,
        admin_transport=disabled_fake.transport,
        scrub_env=False,
    )
    disabled_client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=disabled_app),
        base_url="http://rt",
    )
    await disabled_app.state.ma.startup()
    try:
        rejected = await disabled_client.post(
            "/ma/v1/sessions",
            headers=headers,
            json={
                "agent_id": agent_id,
                "resources": [{"type": "memory_store", "memory_store_id": "store-1"}],
            },
        )
        assert rejected.status_code == 400, rejected.text
        assert "not supported" in rejected.json()["error"]["message"]
    finally:
        await disabled_client.aclose()
        await disabled_app.state.ma.shutdown()
        disabled_gateway.close()
