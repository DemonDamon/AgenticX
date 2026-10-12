"""Slack and Telegram webhook adapters.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from agenticx.gateway.adapters.slack import SlackAdapter
from agenticx.gateway.adapters.telegram import TelegramAdapter
from agenticx.gateway.app import create_gateway_app
from agenticx.gateway.config import GatewayServerConfig
from agenticx.gateway.models import GatewayReply


def _request(body: bytes, headers: dict[str, str]) -> Request:
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    encoded = [(key.lower().encode(), value.encode()) for key, value in headers.items()]
    return Request(
        {"type": "http", "method": "POST", "headers": encoded, "query_string": b""},
        receive,
    )


def _slack_headers(secret: str, body: bytes) -> dict[str, str]:
    stamp = str(int(time.time()))
    digest = hmac.new(secret.encode(), f"v0:{stamp}:".encode() + body, hashlib.sha256).hexdigest()
    return {"X-Slack-Request-Timestamp": stamp, "X-Slack-Signature": f"v0={digest}"}


@pytest.mark.asyncio
async def test_slack_url_verification_and_message() -> None:
    adapter = SlackAdapter("xoxb-test", "sign-secret")
    challenge = await adapter.early_response(
        _request(json.dumps({"type": "url_verification", "challenge": "abc"}).encode(), {})
    )
    assert challenge is not None
    body = json.dumps(
        {"event": {"type": "message", "user": "U1", "channel": "C1", "text": "hi", "ts": "1"}}
    ).encode()
    parsed = await adapter.parse_message(_request(body, _slack_headers("sign-secret", body)))
    assert parsed is not None
    assert parsed.content == "hi"
    assert parsed.chat_id == "C1"
    assert await adapter.parse_message(_request(body, {"X-Slack-Signature": "v0=nope", "X-Slack-Request-Timestamp": "1"})) is None


@pytest.mark.asyncio
async def test_slack_send_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict]] = []

    class _Response:
        status_code = 200

        def json(self) -> dict:
            return {"ok": True}

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args) -> bool:
            return False

        async def post(self, url: str, headers: dict, json: dict) -> _Response:
            calls.append((url, json))
            return _Response()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    adapter = SlackAdapter("xoxb-test", "sign-secret")
    ok = await adapter.send_reply(GatewayReply(content="yo", channel_id="C1"))
    assert ok is True
    assert calls[0][0] == "https://slack.com/api/chat.postMessage"
    assert calls[0][1]["channel"] == "C1"


@pytest.mark.asyncio
async def test_telegram_text_image_and_secret() -> None:
    adapter = TelegramAdapter("123:abc", "sek")
    text_body = {
        "update_id": 7,
        "message": {"text": "hello", "from": {"id": 9}, "chat": {"id": 42}},
    }
    parsed = await adapter.parse_message(
        _request(json.dumps(text_body).encode(), {"X-Telegram-Bot-Api-Secret-Token": "sek"})
    )
    assert parsed is not None
    assert parsed.chat_id == "42"
    photo = {"update_id": 8, "message": {"photo": [], "from": {"id": 9}, "chat": {"id": 42}}}
    assert await adapter.parse_message(
        _request(json.dumps(photo).encode(), {"X-Telegram-Bot-Api-Secret-Token": "sek"})
    ) is None
    assert await adapter.parse_message(
        _request(json.dumps(text_body).encode(), {"X-Telegram-Bot-Api-Secret-Token": "nope"})
    ) is None


@pytest.mark.asyncio
async def test_telegram_send_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    class _Response:
        status_code = 200

        def json(self) -> dict:
            return {"ok": True}

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args) -> bool:
            return False

        async def post(self, url: str, json: dict) -> _Response:
            calls.append(url)
            assert json["chat_id"] == "42"
            return _Response()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    adapter = TelegramAdapter("123:abc", "")
    assert await adapter.send_reply(GatewayReply(content="hi", chat_id="42")) is True
    assert calls[0].endswith("/sendMessage")


def test_slack_and_telegram_disabled() -> None:
    client = TestClient(create_gateway_app(GatewayServerConfig()))
    assert client.post("/webhook/slack", json={}).status_code == 404
    assert client.post("/webhook/telegram", json={}).status_code == 404
