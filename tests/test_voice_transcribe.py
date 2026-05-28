#!/usr/bin/env python3
"""Tests for chat dictation endpoint /api/voice/transcribe.

Author: Damon Li
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import pytest

from agenticx.studio.session_manager import SessionManager
from agenticx.studio.voice_endpoints import register_voice_endpoints

AGX_TEST_AUTH_VALUE = "agx-test-desktop-auth-not-real"


def _make_client() -> TestClient:
    app = FastAPI()
    manager = SessionManager()

    def check_token(x_agx_desktop_token: str | None) -> None:
        if x_agx_desktop_token != AGX_TEST_AUTH_VALUE:
            raise HTTPException(status_code=401, detail="invalid desktop token")

    register_voice_endpoints(app, manager=manager, check_token=check_token)
    return TestClient(app)


def test_voice_transcribe_requires_token() -> None:
    client = _make_client()
    resp = client.post(
        "/api/voice/transcribe",
        files={"file": ("audio.webm", b"fake-audio", "audio/webm")},
    )
    assert resp.status_code == 401


def test_voice_transcribe_requires_provider(monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._resolve_transcribe_provider",
        lambda: "",
    )
    client = _make_client()
    resp = client.post(
        "/api/voice/transcribe",
        headers={"x-agx-desktop-token": AGX_TEST_AUTH_VALUE},
        files={"file": ("audio.webm", b"fake-audio", "audio/webm")},
    )
    assert resp.status_code == 400
    assert "No transcription provider configured" in resp.json()["detail"]


def test_voice_transcribe_requires_openai_api_key(monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._resolve_transcribe_provider",
        lambda: "openai_whisper",
    )
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._openai_transcribe_credentials",
        lambda: ("", "https://api.openai.com"),
    )
    client = _make_client()
    resp = client.post(
        "/api/voice/transcribe",
        headers={"x-agx-desktop-token": AGX_TEST_AUTH_VALUE},
        files={"file": ("audio.webm", b"fake-audio", "audio/webm")},
    )
    assert resp.status_code == 400
    assert "OpenAI API key" in resp.json()["detail"]


def test_voice_transcribe_openai_success(monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._resolve_transcribe_provider",
        lambda: "openai_whisper",
    )
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._openai_transcribe_credentials",
        lambda: ("sk-fake-openai-test", "https://api.openai.com"),
    )

    class _FakeResponse:
        status_code = 200
        text = ""

        def json(self) -> dict[str, str]:
            return {"text": "  你好世界  "}

    class _FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            _ = args, kwargs

        async def __aenter__(self) -> "_FakeClient":
            return self

        async def __aexit__(self, *args) -> None:
            _ = args

        async def post(self, *args, **kwargs):
            _ = args, kwargs
            return _FakeResponse()

    monkeypatch.setattr("agenticx.studio.voice_endpoints.httpx.AsyncClient", _FakeClient)

    client = _make_client()
    resp = client.post(
        "/api/voice/transcribe",
        headers={"x-agx-desktop-token": AGX_TEST_AUTH_VALUE},
        files={"file": ("audio.webm", b"fake-audio", "audio/webm")},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "text": "你好世界", "provider": "openai_whisper"}


def test_voice_transcribe_doubao_success(monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._resolve_transcribe_provider",
        lambda: "doubao_flash",
    )
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._doubao_transcribe_credentials",
        lambda: ("app-123", "access-456"),
    )

    class _FakeResponse:
        text = ""

        @property
        def headers(self) -> dict[str, str]:
            return {
                "X-Api-Status-Code": "20000000",
                "X-Api-Message": "OK",
                "X-Tt-Logid": "log-abc",
            }

        def json(self) -> dict[str, object]:
            return {"result": {"text": "  豆包识别  "}}

    class _FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            _ = args, kwargs

        async def __aenter__(self) -> "_FakeClient":
            return self

        async def __aexit__(self, *args) -> None:
            _ = args

        async def post(self, *args, **kwargs):
            _ = args, kwargs
            return _FakeResponse()

    monkeypatch.setattr("agenticx.studio.voice_endpoints.httpx.AsyncClient", _FakeClient)

    client = _make_client()
    resp = client.post(
        "/api/voice/transcribe",
        headers={"x-agx-desktop-token": AGX_TEST_AUTH_VALUE},
        files={"file": ("dictation.ogg", b"fake-audio", "audio/ogg")},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "text": "豆包识别", "provider": "doubao_flash"}


def test_voice_transcribe_doubao_rejects_webm_without_openai(monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._resolve_transcribe_provider",
        lambda: "doubao_flash",
    )
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._voice_configured_flags",
        lambda _raw: {"openai_ready": False, "doubao_ready": True, "provider": "doubao_realtime"},
    )
    client = _make_client()
    resp = client.post(
        "/api/voice/transcribe",
        headers={"x-agx-desktop-token": AGX_TEST_AUTH_VALUE},
        files={"file": ("dictation.webm", b"fake-audio", "audio/webm")},
    )
    assert resp.status_code == 400
    assert "Doubao flash ASR requires" in resp.json()["detail"]


def test_voice_transcribe_rejects_empty_file(monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._resolve_transcribe_provider",
        lambda: "openai_whisper",
    )
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._openai_transcribe_credentials",
        lambda: ("sk-fake-openai-test", "https://api.openai.com"),
    )
    client = _make_client()
    resp = client.post(
        "/api/voice/transcribe",
        headers={"x-agx-desktop-token": AGX_TEST_AUTH_VALUE},
        files={"file": ("audio.webm", b"", "audio/webm")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "empty audio file"


def test_stream_transcribe_ws_requires_token() -> None:
    client = _make_client()
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/voice/stream-transcribe"):
            pass
    assert exc.value.code == 4401


def test_stream_transcribe_ws_rejects_missing_doubao_credentials(monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.voice_endpoints._voice_section",
        lambda: {"doubao_realtime": {"app_id": "", "access_key": ""}},
    )
    client = _make_client()
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(
            f"/ws/voice/stream-transcribe?x_agx_desktop_token={AGX_TEST_AUTH_VALUE}"
        ):
            pass
    assert exc.value.code == 4400

