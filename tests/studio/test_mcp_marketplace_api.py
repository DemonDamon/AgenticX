from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from agenticx.studio import server as studio_server
from agenticx.studio.server import create_studio_app


class _FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def put(self, url: str, json: dict[str, Any], headers: dict[str, str]):
        assert "openapi/v1/mcp/servers" in url
        return _FakeResponse(
            {
                "success": True,
                "data": {
                    "total_count": 1,
                    "mcp_server_list": [
                        {
                            "id": "@modelcontextprotocol/fetch",
                            "name": "Fetch",
                            "is_verified": True,
                            "categories": ["browser-automation"],
                        }
                    ],
                },
            }
        )

    async def get(self, url: str, headers: dict[str, str]):
        assert "openapi/v1/mcp/servers/" in url
        return _FakeResponse(
            {
                "success": True,
                "data": {
                    "id": "@modelcontextprotocol/fetch",
                    "name": "Fetch",
                    "server_config": [
                        {
                            "mcpServers": {
                                "fetch": {
                                    "command": "uvx",
                                    "args": ["mcp-server-fetch"]
                                }
                            }
                        }
                    ],
                    "env_schema": {"type": "object"},
                },
            }
        )


def _headers() -> dict[str, str]:
    return {"x-agx-desktop-token": "test-token"}


def test_marketplace_list_and_detail(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "test-token")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(studio_server, "httpx", type("X", (), {"AsyncClient": _FakeAsyncClient}))

    app = create_studio_app()
    client = TestClient(app)

    listed = client.get("/api/mcp/marketplace?search=fetch&page=1&page_size=10", headers=_headers())
    assert listed.status_code == 200
    body = listed.json()
    assert body["ok"] is True
    assert body["items"][0]["id"] == "@modelcontextprotocol/fetch"

    detail = client.get("/api/mcp/marketplace/@modelcontextprotocol/fetch", headers=_headers())
    assert detail.status_code == 200
    assert detail.json()["item"]["id"] == "@modelcontextprotocol/fetch"


def test_marketplace_install_merges_into_agenticx_mcp(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "test-token")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(studio_server, "httpx", type("X", (), {"AsyncClient": _FakeAsyncClient}))

    target = tmp_path / ".agenticx" / "mcp.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text('{"mcpServers":{"old":{"command":"node","args":["old.js"]}}}', encoding="utf-8")

    app = create_studio_app()
    client = TestClient(app)
    resp = client.post(
        "/api/mcp/marketplace/install",
        headers=_headers(),
        json={"server_id": "@modelcontextprotocol/fetch"},
    )
    assert resp.status_code == 200
    content = json.loads(target.read_text(encoding="utf-8"))
    mcp_servers = content.get("mcpServers", {})
    assert "fetch" in mcp_servers
