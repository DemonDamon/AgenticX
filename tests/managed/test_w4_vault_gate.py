#!/usr/bin/env python3
"""W4 credential gate: placeholder env, egress block, and redaction.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml

from agenticx.cli.agent_tools import _managed_command_environ
from agenticx.managed.credential_extension import install_credential_broker
from agenticx.managed.credentials import LocalCredentialProvider
from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import build_dev_config
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep, tool_call
from agenticx.runtime.command_sandbox import CommandSandboxUnavailable, build_command_sandbox_plan
from agenticx.runtime.credential_store import CredentialStore
from agenticx.tools.remote_v2 import MCPToolInfo

_MCP_TOKEN = "w4-mcp-token-123456" # gitleaks:allow
_ENV_SECRET = "w4-env-secret-abcdef" # gitleaks:allow
_PLACEHOLDER = re.compile(r"agxsec_[0-9a-f]{32}")


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
        text = json.dumps({"arguments": arguments, "authorization": auth})
        block = type("Block", (), {"type": "text", "text": text})()
        return type("Result", (), {"content": [block], "isError": False})()

    async def close(self) -> None:
        return None


def _sandbox_can_confine(root: Path) -> bool:
    try:
        build_command_sandbox_plan(
            ["/bin/echo", "ok"],
            writable_roots=[root],
            network="deny",
        )
        return True
    except CommandSandboxUnavailable:
        return False


def _document() -> dict[str, Any]:
    return {
        "tenant_id": "dev",
        "environments": [
            {
                "id": "cloud",
                "name": "Cloud",
                "type": "cloud",
                "config": {
                    "type": "cloud",
                    "sandbox_backend": "subprocess",
                    "egress_allow_domains": ["mcp.test", "api.example.com"],
                },
            }
        ],
        "agents": [
            {
                "id": "demo",
                "default_environment_id": "cloud",
                "manifest": {
                    "schema": "agx.agent/v1",
                    "model": "fake/scripted",
                    "system": "Use the tools, then answer.",
                    "mcp_servers": [
                        {"name": "srv", "url": "https://mcp.test/mcp", "transport": "http"}
                    ],
                    "tools": [
                        {"type": "mcp", "server": "srv", "default_policy": "always_allow"},
                        {
                            "type": "agx_builtin",
                            "default_policy": "always_allow",
                            "configs": [
                                {"name": "bash_exec", "policy": "always_allow"},
                                {"name": "web_fetch", "policy": "always_allow"},
                            ],
                        },
                    ],
                    "runtime": {"max_tool_rounds": 8},
                },
            }
        ],
        "vaults": [
            {
                "id": "dev-vault",
                "credentials": [
                    {
                        "id": "mcp",
                        "type": "static_bearer",
                        "mcp_server_url": "https://mcp.test/mcp",
                        "secret_ref": "${cred:MCP_TOKEN}",
                    },
                    {
                        "id": "env",
                        "type": "environment_variable",
                        "secret_name": "EXAMPLE_API_KEY",
                        "secret_ref": "${cred:EXAMPLE_KEY}",
                        "networking": {"type": "limited", "allowed_hosts": ["api.example.com"]},
                    },
                ],
            }
        ],
    }


async def _wait(client: httpx.AsyncClient, session_id: str) -> None:
    deadline = time.monotonic() + 20
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = await client.get(f"/ma/v1/sessions/{session_id}")
        last = response.json()
        stop = last.get("stop_reason") or {}
        if last.get("status") == "idle" and stop.get("type") == "end_turn":
            return
        await asyncio.sleep(0.05)
    events = await client.get(f"/ma/v1/sessions/{session_id}/events")
    raise AssertionError({"session": last, "events": events.text})


async def test_w4_vault_gate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    caplog.set_level(logging.DEBUG)
    store = CredentialStore()
    store.set("MCP_TOKEN", _MCP_TOKEN)
    store.set("EXAMPLE_KEY", _ENV_SECRET)
    probe = tmp_path / "sandbox-root"
    probe.mkdir()
    sandbox_ok = _sandbox_can_confine(probe)
    overlay = _managed_command_environ(
        type("Session", (), {"managed_command_env": {"EXAMPLE_API_KEY": "agxsec_x"}})()
    )
    assert overlay is not None
    assert overlay["EXAMPLE_API_KEY"] == "agxsec_x"
    if not sandbox_ok:
        pytest.skip("command sandbox cannot confine network on this platform")

    agents = tmp_path / "agents.yaml"
    agents.write_text(yaml.safe_dump(_document()), encoding="utf-8")
    config = build_dev_config(agents_file=agents, data_dir=tmp_path / "ma", token="test-token") # gitleaks:allow
    _EchoClient.created = []
    app = create_ma_app(
        config,
        llm_factory=PerSessionScriptFactory(
            [
                ScriptStep("1", [tool_call("mcp__srv__echo", {"text": "hi"}, "c1")]),
                ScriptStep(
                    "2",
                    [tool_call("bash_exec", {"command": "printenv EXAMPLE_API_KEY"}, "c2")],
                ),
                ScriptStep(
                    "3",
                    [tool_call("web_fetch", {"url": "https://evil.example.net/"}, "c3")],
                ),
                ScriptStep(f"token is {_MCP_TOKEN}"),
            ]
        ),
    )
    install_credential_broker(
        app.state.ma,
        LocalCredentialProvider(config.vaults),
        mcp_client_factory=_EchoClient,
    )
    await app.state.ma.startup()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer test-token"},
            timeout=30,
            trust_env=False,
        ) as client:
            created = await client.post(
                "/ma/v1/sessions",
                json={"agent_id": "demo", "vault_ids": ["dev-vault"]},
            )
            assert created.status_code == 201, created.text
            session_id = created.json()["id"]
            posted = await client.post(
                f"/ma/v1/sessions/{session_id}/events",
                json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "go"}]}]},
            )
            assert posted.status_code == 200, posted.text
            await _wait(client, session_id)
            rows = (await client.get(f"/ma/v1/sessions/{session_id}/events", params={"limit": 200})).json()[
                "data"
            ]
    finally:
        await app.state.ma.shutdown()

    auths = [call["authorization"] for client in _EchoClient.created for call in client.calls]
    assert auths == [f"Bearer {_MCP_TOKEN}"]
    tool_uses = {row["id"]: row for row in rows if row["type"] == "agent.tool_use"}
    bash_result = next(
        row
        for row in rows
        if row["type"] == "agent.tool_result"
        and tool_uses.get(row.get("tool_use_id"), {}).get("name") == "bash_exec"
    )
    bash_text = "\n".join(
        block.get("text", "")
        for block in bash_result.get("content") or []
        if isinstance(block, dict)
    )
    assert _PLACEHOLDER.search(bash_text), bash_text
    assert _ENV_SECRET not in bash_text
    web = next(
        row
        for row in rows
        if row["type"] == "agent.tool_result"
        and tool_uses.get(row.get("tool_use_id"), {}).get("name") == "web_fetch"
    )
    web_text = "\n".join(
        block.get("text", "")
        for block in web.get("content") or []
        if isinstance(block, dict)
    )
    assert web_text.startswith("ERROR: egress blocked")
    assert any(
        row["type"] == "session.error" and row["error"]["type"] == "egress_blocked" for row in rows
    )
    message = next(row for row in rows if row["type"] == "agent.message" and "token is" in str(row))
    assert "[REDACTED:" in json.dumps(message)
    blob = "\n".join(
        row[0]
        for row in sqlite3.connect(config.db_path).execute("select payload from ma_session_events")
    )
    assert _MCP_TOKEN not in blob
    assert _ENV_SECRET not in blob
    assert _MCP_TOKEN not in caplog.text
    assert _ENV_SECRET not in caplog.text
