#!/usr/bin/env python3
"""HTTP tests for the local credential routes.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.credential_store import credentials_path, default_store
from agenticx.studio.credentials_routes import register_credentials_routes

SECRET = "route-secret-value-0123456789"
GITHUB = "ghp_route_value_0123456789"
QIANFAN = "qf-route-secret-0123456789"


def _sandbox_home(tmp_path: Path) -> None:
    assert Path.home().is_relative_to(tmp_path)


def _write_refs() -> None:
    home = Path.home() / ".agenticx"
    home.mkdir(parents=True, exist_ok=True)
    (home / "mcp.json").write_text(
        json.dumps(
            {
                "mcpServers": {
                    "github": {
                        "env": {"GITHUB_TOKEN": "${cred:GITHUB_TOKEN}"},
                        "headers": {"Authorization": "Bearer ${cred:GITHUB_TOKEN}"},
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    ConfigManager.GLOBAL_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    ConfigManager.GLOBAL_CONFIG_PATH.write_text(
        "\n".join(
            [
                "providers:",
                "  openai:",
                '    api_key: "${cred:OPENAI_KEY}"',
                '    secret_key: "${cred:QIANFAN_SK}"',
                "",
            ]
        ),
        encoding="utf-8",
    )


def _client(check=None) -> TestClient:
    app = FastAPI()
    register_credentials_routes(app, check or (lambda _token: None))
    return TestClient(app)


def test_credentials_routes_hide_values_and_report_references(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    _write_refs()
    client = _client()
    created = client.put(
        "/api/credentials/OPENAI_KEY",
        json={"value": SECRET, "description": "openai"},
    )
    assert created.status_code == 200
    assert SECRET not in created.text
    assert created.json()["credential"]["name"] == "OPENAI_KEY"
    assert created.json()["credential"]["description"] == "openai"
    assert "value" not in created.json()["credential"]

    github = client.put(
        "/api/credentials/GITHUB_TOKEN",
        json={"value": GITHUB, "description": "github"},
    )
    assert github.status_code == 200
    assert GITHUB not in github.text
    qianfan = client.put(
        "/api/credentials/QIANFAN_SK",
        json={"value": QIANFAN, "description": "qianfan"},
    )
    assert qianfan.status_code == 200
    assert QIANFAN not in qianfan.text

    listed = client.get("/api/credentials")
    assert listed.status_code == 200
    body = listed.text
    assert SECRET not in body
    assert GITHUB not in body
    assert QIANFAN not in body
    rows = {item["name"]: item for item in listed.json()["credentials"]}
    assert rows["OPENAI_KEY"]["referenced_by"] == ["provider:openai"]
    assert rows["GITHUB_TOKEN"]["referenced_by"] == ["mcp:github"]
    assert rows["QIANFAN_SK"]["referenced_by"] == ["provider:openai"]
    assert "value" not in rows["OPENAI_KEY"]

    renamed = client.put(
        "/api/credentials/OPENAI_KEY",
        json={"description": "renamed"},
    )
    assert renamed.status_code == 200
    assert SECRET not in renamed.text
    assert renamed.json()["credential"]["description"] == "renamed"
    assert default_store().get("OPENAI_KEY") == SECRET

    removed = client.delete("/api/credentials/GITHUB_TOKEN")
    assert removed.status_code == 200
    assert removed.json()["referenced_by"] == ["mcp:github"]
    assert GITHUB not in removed.text
    assert default_store().get("GITHUB_TOKEN") is None

    after = client.get("/api/credentials")
    names = [item["name"] for item in after.json()["credentials"]]
    assert "GITHUB_TOKEN" not in names
    assert credentials_path().is_file()


def test_put_rejects_bad_name_and_missing_value(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    client = _client()
    bad = client.put("/api/credentials/not-a-name", json={"value": SECRET})
    assert bad.status_code == 400
    assert SECRET not in bad.text
    missing = client.put("/api/credentials/NEW_TOKEN", json={"description": "x"})
    assert missing.status_code == 400
    gone = client.delete("/api/credentials/NEW_TOKEN")
    assert gone.status_code == 404


def test_routes_call_check_token(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)

    def _deny(_token: str | None) -> None:
        raise HTTPException(status_code=401, detail="invalid desktop token")

    client = _client(_deny)
    assert client.get("/api/credentials").status_code == 401
