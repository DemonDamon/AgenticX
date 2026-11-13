"""Smoke: /api/codebuddy/resolve-model."""

from __future__ import annotations

from fastapi.testclient import TestClient

from agenticx.studio.server import create_studio_app


def test_resolve_codebuddy_model_custom_local(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("AGX_DESKTOP_TOKEN", "test-token")
    models = tmp_path / ".codebuddy" / "models.json"
    models.parent.mkdir(parents=True)
    models.write_text(
        '{"models":[{"id":"glm-5.3-flash","url":"http://127.0.0.1:1","apiKey":"k"}]}',
        encoding="utf-8",
    )
    monkeypatch.setenv("HOME", str(tmp_path))
    app = create_studio_app()
    client = TestClient(app)
    resp = client.get(
        "/api/codebuddy/resolve-model",
        params={"model": "glm-5.3-flash"},
        headers={"x-agx-desktop-token": "test-token"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True
    assert body.get("uses_custom_local") is True
    assert body.get("resolved") == "custom-local:glm-5.3-flash"
