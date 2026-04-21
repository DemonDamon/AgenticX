from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


def _headers() -> dict[str, str]:
    return {"x-agx-desktop-token": "test-token"}


def test_get_mcp_raw_and_put_success(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "test-token")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    mcp_file = tmp_path / ".agenticx" / "mcp.json"
    mcp_file.parent.mkdir(parents=True, exist_ok=True)
    mcp_file.write_text('{"mcpServers":{"fetch":{"command":"uvx","args":["mcp-server-fetch"]}}}', encoding="utf-8")

    app = create_studio_app()
    client = TestClient(app)

    got = client.get("/api/mcp/raw", headers=_headers())
    assert got.status_code == 200
    payload = got.json()
    assert payload["ok"] is True
    assert payload["format"] == "json"
    assert payload["parse_ok"] is True

    new_text = json.dumps({"mcpServers": {"demo": {"command": "node", "args": ["server.js"]}}}, ensure_ascii=False)
    put = client.put("/api/mcp/raw", headers=_headers(), json={"path": str(mcp_file), "text": new_text})
    assert put.status_code == 200
    saved = json.loads(mcp_file.read_text(encoding="utf-8"))
    assert "demo" in saved["mcpServers"]


def test_put_mcp_raw_invalid_json_returns_line_column(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "test-token")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    mcp_file = tmp_path / ".agenticx" / "mcp.json"
    mcp_file.parent.mkdir(parents=True, exist_ok=True)
    mcp_file.write_text('{"mcpServers":{"ok":{"command":"uvx"}}}', encoding="utf-8")

    app = create_studio_app()
    client = TestClient(app)
    before = mcp_file.read_text(encoding="utf-8")

    put = client.put(
        "/api/mcp/raw",
        headers=_headers(),
        json={"path": str(mcp_file), "text": '{"mcpServers":{"bad":{"command":"uvx",}}'},
    )
    assert put.status_code == 400
    detail = put.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["line"] >= 1
    assert detail["column"] >= 1
    assert mcp_file.read_text(encoding="utf-8") == before
