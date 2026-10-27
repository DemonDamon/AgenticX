#!/usr/bin/env python3
"""agent-runtime wires vault validation and per-turn resolution.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine

from agenticx.managed.ids import new_ulid

from fakes import DEFAULT_MANIFEST, FakeAdminConsole, FakeGateway, agent_record, version_record
from ma_agent_runtime.app import build_app
from ma_agent_runtime.config import Settings
from ma_agent_runtime.db import split_database_url
from ma_agent_runtime.tables import metadata

_SECRET = "resolved-token-value-123" # gitleaks:allow


class VaultAdmin(FakeAdminConsole):
    """Admin console fake that also serves the vault internal routes."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.validate_bodies: list[dict[str, Any]] = []
        self.resolve_bodies: list[dict[str, Any]] = []

    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/vaults/validate"):
            body = json.loads(request.content.decode("utf-8") or "{}")
            self.validate_bodies.append(body)
            return httpx.Response(
                200,
                json={"vaults": [{"id": vault_id, "status": "active"} for vault_id in body["vault_ids"]]},
            )
        if path.endswith("/vault-resolve"):
            body = json.loads(request.content.decode("utf-8") or "{}")
            self.resolve_bodies.append(body)
            return httpx.Response(
                200,
                json={
                    "session_id": body["session_id"],
                    "resolved_at": "2026-10-25T08:00:00.000Z",
                    "credentials": [
                        {
                            "credential_id": "c1",
                            "vault_id": body["vault_ids"][0],
                            "vault_index": 0,
                            "type": "bearer",
                            "display_name": None,
                            "host": "api.example.com",
                            "token": _SECRET,
                        }
                    ],
                    "skipped": [],
                },
            )
        return super()._handle(request)


def _settings(tmp_path: Path, gateway: FakeGateway, *, credentials_enabled: bool = True) -> Settings:
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
        credentials_enabled=credentials_enabled,
    )


def _prepare(settings: Settings) -> None:
    db_path = Path(settings.database_url.removeprefix("sqlite:///"))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    settings.home.mkdir(parents=True, exist_ok=True)
    urls = split_database_url(settings.database_url)
    engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(engine)
    engine.dispose()


async def _wait_idle(client: httpx.AsyncClient, session_id: str, headers: dict[str, str]) -> None:
    for _ in range(75):
        response = await client.get(f"/ma/v1/sessions/{session_id}", headers=headers)
        record = response.json()
        stop = record.get("stop_reason") or {}
        if record.get("status") == "idle" and stop.get("type") == "end_turn":
            return
        await asyncio.sleep(0.05)
    events = await client.get(f"/ma/v1/sessions/{session_id}/events", headers=headers)
    raise AssertionError(events.text)


async def test_vault_ids_resolved_via_admin_console(
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
    fake = VaultAdmin(
        agents={
            agent_id: {
                "runtime": "cloud",
                "effective": 1,
                "agent": agent_record(agent_id, tenant, 1),
                "versions": {1: version_record(agent_id, 1, DEFAULT_MANIFEST)},
            }
        },
        pats={
            "agx-pat-svc": {
                "active": True,
                "tenant_id": tenant,
                "user_id": "SVCUSER000000000000000000",
                "scopes": ["ma:sessions:read", "ma:sessions:write", "ma:vaults:read", "ma:agents:read"],
                "token_id": "1",
            }
        },
    )
    settings = _settings(tmp_path, gateway)
    _prepare(settings)
    app = build_app(settings, admin_transport=fake.transport, scrub_env=False)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    await app.state.ma.startup()
    headers = {"Authorization": "Bearer agx-pat-svc"}
    try:
        created = await client.post(
            "/ma/v1/sessions",
            headers=headers,
            json={"agent_id": agent_id, "vault_ids": ["vault-1"]},
        )
        assert created.status_code == 201, created.text
        session_id = created.json()["id"]
        assert created.json()["vault_ids"] == ["vault-1"]
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            headers=headers,
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "hi"}]}]},
        )
        assert posted.status_code == 200, posted.text
        await _wait_idle(client, session_id, headers)
        assert fake.resolve_bodies
        assert fake.resolve_bodies[0]["session_id"] == session_id
        events = await client.get(f"/ma/v1/sessions/{session_id}/events", headers=headers)
        assert _SECRET not in events.text
    finally:
        await client.aclose()
        await app.state.ma.shutdown()
        gateway.close()

    disabled_gateway = FakeGateway([{"text": "unused"}])
    disabled_gateway.start()
    disabled_settings = replace(
        _settings(tmp_path / "disabled", disabled_gateway),
        credentials_enabled=False,
    )
    monkeypatch.setenv("HOME", str(disabled_settings.home))
    monkeypatch.setenv("MA_RUNTIME_HOME", str(disabled_settings.home))
    _prepare(disabled_settings)
    disabled_fake = VaultAdmin(
        agents={
            agent_id: {
                "runtime": "cloud",
                "effective": 1,
                "agent": agent_record(agent_id, tenant, 1),
                "versions": {1: version_record(agent_id, 1, DEFAULT_MANIFEST)},
            }
        },
        pats={
            "agx-pat-svc": {
                "active": True,
                "tenant_id": tenant,
                "user_id": "SVCUSER000000000000000000",
                "scopes": ["ma:sessions:read", "ma:sessions:write", "ma:vaults:read"],
                "token_id": "1",
            }
        },
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
            json={"agent_id": agent_id, "vault_ids": ["vault-1"]},
        )
        assert rejected.status_code == 400, rejected.text
        assert rejected.json()["error"]["message"] == "vault_ids are not supported by this host yet"
        assert _SECRET not in rejected.text
    finally:
        await disabled_client.aclose()
        await disabled_app.state.ma.shutdown()
        disabled_gateway.close()
