from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


def _auth_headers() -> dict[str, str]:
    return {"x-agx-desktop-token": "test-token"}


def test_mcp_discover_api_returns_brand_hits(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "test-token")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    (tmp_path / ".agenticx").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".agenticx" / "mcp.json").write_text(
        '{"mcpServers":{"fetch":{"command":"uvx","args":["mcp-server-fetch"]}}}',
        encoding="utf-8",
    )
    app = create_studio_app()
    client = TestClient(app)

    resp = client.get("/api/mcp/discover", headers=_auth_headers())
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["count"] >= 1
    brands = {item["brand"] for item in data["hits"]}
    assert "agenticx" in brands
