#!/usr/bin/env python3
"""Credential broker wired into the managed host.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import httpx
import yaml

from agenticx.managed.credential_extension import install_credential_broker
from agenticx.managed.credentials import (
    CredentialBundle,
    CredentialResolutionError,
    ResolvedCredential,
    normalize_mcp_url,
)
from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import Principal, build_dev_config
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep, tool_call
from agenticx.tools.remote_v2 import MCPToolInfo
from tests.managed.conftest import make_config

_MCP_URL = "https://mcp.test/mcp"


def _agents_yaml(path: Path, *, manifest: dict[str, Any] | None = None, vaults: bool = True) -> None:
    document: dict[str, Any] = {
        "tenant_id": "dev",
        "agents": [
            {
                "id": "demo",
                "default_environment_id": "local",
                "manifest": manifest
                or {
                    "schema": "agx.agent/v1",
                    "model": "fake/scripted",
                    "system": "Reply briefly.",
                },
            }
        ],
    }
    if vaults:
        document["vaults"] = [
            {
                "id": "dev-vault",
                "credentials": [
                    {
                        "id": "gh",
                        "type": "static_bearer",
                        "mcp_server_url": "https://mcp.example.com/mcp",
                        "secret_ref": "${cred:GITHUB_MCP_TOKEN}",
                    }
                ],
            }
        ]
    path.write_text(yaml.safe_dump(document), encoding="utf-8")


class _Client:
    def __init__(self, app: Any, token: str) -> None:
        self._app = app
        self._token = token
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> httpx.AsyncClient:
        await self._app.state.ma.startup()
        self._client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self._app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {self._token}"},
            timeout=30,
            trust_env=False,
        )
        return self._client

    async def __aexit__(self, *args: object) -> None:
        if self._client is not None:
            await self._client.aclose()
        await self._app.state.ma.shutdown()


def _user(text: str) -> dict[str, Any]:
    return {"type": "user.message", "content": [{"type": "text", "text": text}]}


async def _wait(client: httpx.AsyncClient, session_id: str, stop_type: str) -> dict[str, Any]:
    deadline = time.monotonic() + 15
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = await client.get(f"/ma/v1/sessions/{session_id}")
        last = response.json()
        stop = last.get("stop_reason") or {}
        if last.get("status") == "idle" and stop.get("type") == stop_type:
            return last
        await asyncio.sleep(0.05)
    events = await client.get(f"/ma/v1/sessions/{session_id}/events")
    raise AssertionError({"session": last, "events": events.text})


async def _events(client: httpx.AsyncClient, session_id: str) -> list[dict[str, Any]]:
    response = await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 200})
    return list(response.json()["data"])


class _EchoClient:
    created: list[_EchoClient] = []

    def __init__(self, config: Any) -> None:
        self.config = config
        self.calls: list[dict[str, Any]] = []
        _EchoClient.created.append(self)

    async def discover_tools(self) -> list[MCPToolInfo]:
        return [
            MCPToolInfo(
                name="echo",
                description="echo",
                inputSchema={"type": "object", "properties": {"text": {"type": "string"}}},
            )
        ]

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        auth = dict(self.config.headers).get("Authorization", "")
        self.calls.append({"name": name, "arguments": arguments, "authorization": auth})
        block = type("Block", (), {"type": "text", "text": "echo-ok"})()
        return type("Result", (), {"content": [block], "isError": False})()

    async def close(self) -> None:
        return None


def _mcp_manifest(policy: str) -> dict[str, Any]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "Use the tools.",
        "mcp_servers": [{"name": "srv", "url": _MCP_URL, "transport": "http"}],
        "tools": [
            {"type": "mcp", "server": "srv", "default_policy": policy},
            {"type": "agx_builtin", "default_policy": "always_allow"},
        ],
        "runtime": {"max_tool_rounds": 8},
    }


async def test_create_session_vault_validation(tmp_path: Path) -> None:
    agents = tmp_path / "agents.yaml"
    _agents_yaml(agents)
    config = build_dev_config(agents_file=agents, data_dir=tmp_path / "data", token="test-token") # gitleaks:allow
    limited = Principal(
        tenant_id="dev",
        user_id="limited-user",
        scopes=frozenset({"ma:sessions:read", "ma:sessions:write"}),
    )
    config.tokens = {**dict(config.tokens), "limited": limited}
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi")]))
    async with _Client(app, "test-token") as client:
        plain = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
        assert plain.status_code == 201, plain.text
        assert plain.json()["vault_ids"] == []
        assert plain.json()["status"] == "idle"

        ok = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "demo", "vault_ids": ["dev-vault"]},
        )
        assert ok.status_code == 201, ok.text
        assert ok.json()["vault_ids"] == ["dev-vault"]

        missing = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "demo", "vault_ids": ["missing-vault"]},
        )
        assert missing.status_code == 400
        assert "vault not found" in missing.json()["error"]["message"]

        too_many = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "demo", "vault_ids": [f"v{index}" for index in range(21)]},
        )
        assert too_many.status_code == 400
        assert "at most 20" in too_many.json()["error"]["message"]

        duplicate = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "demo", "vault_ids": ["dev-vault", "dev-vault"]},
        )
        assert duplicate.status_code == 400

        worker = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "demo", "environment_id": "worker", "vault_ids": ["dev-vault"]},
        )
        assert worker.status_code == 400
        assert worker.json()["error"]["message"] == (
            "vault_ids are not supported for desktop_worker environments"
        )
        forbidden = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "demo", "vault_ids": ["dev-vault"]},
            headers={"Authorization": "Bearer limited"},
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "forbidden_scope"


class _Boom:
    async def validate_vault_ids(self, tenant_id: str, vault_ids: list[str]) -> list[tuple[str, str]]:
        del tenant_id
        return [(vault_id, "active") for vault_id in vault_ids]

    async def resolve(self, tenant_id: str, session_id: str, vault_ids: list[str]) -> CredentialBundle:
        del tenant_id, session_id, vault_ids
        raise CredentialResolutionError("vault service unavailable")

    async def aclose(self) -> None:
        return None


async def test_vault_resolution_failure_ends_turn(tmp_path: Path) -> None:
    factory = PerSessionScriptFactory([ScriptStep("should-not-run")])
    config = make_config(tmp_path)
    app = create_ma_app(config, llm_factory=factory)
    install_credential_broker(app.state.ma, _Boom())
    async with _Client(app, "test-token") as client:
        created = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "demo", "vault_ids": ["v1"]},
        )
        assert created.status_code == 201, created.text
        session_id = created.json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user("hello")]},
        )
        assert posted.status_code == 200, posted.text
        await _wait(client, session_id, "retries_exhausted")
        rows = await _events(client, session_id)
        errors = [row for row in rows if row["type"] == "session.error"]
        assert any(row["error"]["type"] == "vault_resolution_failed" for row in errors)
        assert factory.by_session == {} or all(not llm.calls for llm in factory.by_session.values())
        assert "should-not-run" not in str(rows)


async def test_mcp_always_ask_requires_action(tmp_path: Path) -> None:
    _EchoClient.created = []
    config = make_config(tmp_path, manifest=_mcp_manifest("always_ask"))
    app = create_ma_app(
        config,
        llm_factory=PerSessionScriptFactory(
            [
                ScriptStep("calling", [tool_call("mcp__srv__echo", {"text": "hi"}, "c1")]),
                ScriptStep("done"),
            ]
        ),
    )
    install_credential_broker(app.state.ma, None, mcp_client_factory=_EchoClient)
    async with _Client(app, "test-token") as client:
        created = await client.post("/ma/v1/sessions", json={"agent_id": "demo"})
        session_id = created.json()["id"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user("go")]},
        )
        waiting = await _wait(client, session_id, "requires_action")
        rows = await _events(client, session_id)
        tool_use = next(row for row in rows if row["type"] == "agent.mcp_tool_use")
        assert tool_use["name"] == "echo"
        assert tool_use["mcp_server"] == "srv"
        assert tool_use["evaluated_policy"] == "always_ask"
        assert tool_use["id"] in (waiting.get("stop_reason") or {}).get("event_ids", [])
        confirmed = await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={
                "events": [
                    {
                        "type": "user.tool_confirmation",
                        "tool_use_id": tool_use["id"],
                        "result": "allow",
                    }
                ]
            },
        )
        assert confirmed.status_code == 200, confirmed.text
        await _wait(client, session_id, "end_turn")
        rows = await _events(client, session_id)
        result = next(row for row in rows if row["type"] == "agent.mcp_tool_result")
        assert result["mcp_tool_use_id"] == tool_use["id"]


class _Rotating:
    def __init__(self) -> None:
        self.calls = 0

    async def validate_vault_ids(self, tenant_id: str, vault_ids: list[str]) -> list[tuple[str, str]]:
        del tenant_id
        return [(vault_id, "active") for vault_id in vault_ids]

    async def resolve(self, tenant_id: str, session_id: str, vault_ids: list[str]) -> CredentialBundle:
        del tenant_id, session_id, vault_ids
        self.calls += 1
        token = "tok-1-aaaaaaaa" if self.calls == 1 else "tok-2-bbbbbbbb" # gitleaks:allow
        return CredentialBundle(
            credentials=(
                ResolvedCredential(
                    credential_id="mcp",
                    vault_id="v",
                    vault_index=0,
                    type="static_bearer",
                    display_name=None,
                    secret=token,
                    mcp_server_url=normalize_mcp_url(_MCP_URL),
                ),
                ResolvedCredential(
                    credential_id="env",
                    vault_id="v",
                    vault_index=0,
                    type="environment_variable",
                    display_name=None,
                    secret="env-secret-abcdefgh", # gitleaks:allow
                    secret_name="EXAMPLE_API_KEY",
                    networking="limited",
                    allowed_hosts=("api.example.com",),
                ),
            )
        )

    async def aclose(self) -> None:
        return None


async def test_rotation_applies_next_turn(tmp_path: Path) -> None:
    _EchoClient.created = []
    provider = _Rotating()
    config = make_config(tmp_path, manifest=_mcp_manifest("always_allow"))
    app = create_ma_app(
        config,
        llm_factory=PerSessionScriptFactory(
            [
                ScriptStep("one", [tool_call("mcp__srv__echo", {"text": "one"}, "c1")]),
                ScriptStep("after-one"),
                ScriptStep("two", [tool_call("mcp__srv__echo", {"text": "two"}, "c2")]),
                ScriptStep("after-two"),
            ]
        ),
    )
    install_credential_broker(app.state.ma, provider, mcp_client_factory=_EchoClient)
    async with _Client(app, "test-token") as client:
        created = await client.post(
            "/ma/v1/sessions",
            json={"agent_id": "demo", "vault_ids": ["v"]},
        )
        assert created.status_code == 201, created.text
        session_id = created.json()["id"]
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user("first")]},
        )
        await _wait(client, session_id, "end_turn")
        actor = app.state.ma.service._actors[("dev", session_id)]
        extension = actor.extensions[0]
        first_placeholders = dict(extension._placeholders)
        assert first_placeholders
        await client.post(
            f"/ma/v1/sessions/{session_id}/events",
            json={"events": [_user("second")]},
        )
        await _wait(client, session_id, "end_turn")
        assert extension._placeholders == first_placeholders
    auths = [call["authorization"] for client in _EchoClient.created for call in client.calls]
    assert auths == ["Bearer tok-1-aaaaaaaa", "Bearer tok-2-bbbbbbbb"]
    rendered = str(auths)
    assert "env-secret-abcdefgh" not in rendered
