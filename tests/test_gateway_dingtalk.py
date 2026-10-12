"""DingTalk webhook parse and sessionWebhook reply.

Author: Damon Li
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import httpx
import pytest
from starlette.requests import Request

from agenticx.gateway.adapters.dingtalk import DingTalkAdapter
from agenticx.gateway.app import create_gateway_app
from agenticx.gateway.config import GatewayServerConfig
from agenticx.gateway.models import GatewayReply
from fastapi.testclient import TestClient


def _request(body: dict, headers: dict[str, str]) -> Request:
    raw = json.dumps(body).encode("utf-8")

    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}

    encoded = [(key.lower().encode(), value.encode()) for key, value in headers.items()]
    return Request(
        {"type": "http", "method": "POST", "headers": encoded, "query_string": b""},
        receive,
    )


def _sign(secret: str, timestamp: str) -> str:
    digest = hmac.new(secret.encode(), f"{timestamp}\n{secret}".encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


@pytest.mark.asyncio
async def test_dingtalk_parse_and_reject_bad_signature() -> None:
    adapter = DingTalkAdapter("top-secret")
    stamp = str(int(time.time() * 1000))
    body = {
        "msgId": "m1",
        "text": {"content": "hello"},
        "senderStaffId": "u1",
        "conversationId": "cid",
        "sessionWebhook": "https://example.test/session",
    }
    parsed = await adapter.parse_message(
        _request(body, {"timestamp": stamp, "sign": _sign("top-secret", stamp)})
    )
    assert parsed is not None
    assert parsed.content == "hello"
    assert parsed.chat_id == "cid"
    rejected = await adapter.parse_message(
        _request(body, {"timestamp": stamp, "sign": "bad"})
    )
    assert rejected is None


@pytest.mark.asyncio
async def test_dingtalk_send_reply_posts_text(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict]] = []

    class _Response:
        status_code = 200

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args) -> bool:
            return False

        async def post(self, url: str, json: dict) -> _Response:
            calls.append((url, json))
            return _Response()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    adapter = DingTalkAdapter("top-secret")
    ok = await adapter.send_reply(
        GatewayReply(content="pong", session_webhook="https://example.test/hook")
    )
    assert ok is True
    assert calls[0][0] == "https://example.test/hook"
    assert calls[0][1]["msgtype"] == "text"
    assert calls[0][1]["text"]["content"] == "pong"
    assert await adapter.send_reply(GatewayReply(content="x")) is False


def test_dingtalk_webhook_disabled() -> None:
    client = TestClient(create_gateway_app(GatewayServerConfig()))
    response = client.post("/webhook/dingtalk", json={"text": {"content": "hi"}})
    assert response.status_code == 404
