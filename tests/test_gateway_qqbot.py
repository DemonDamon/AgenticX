"""QQ official bot webhook signature and dispatch parsing.

Author: Damon Li
"""

from __future__ import annotations

import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from starlette.requests import Request

from agenticx.gateway.adapters.qqbot import QQBotAdapter, _seed_bytes
from agenticx.gateway.app import create_gateway_app
from agenticx.gateway.config import GatewayServerConfig

_SECRET = "qq-bot-secret-value-32b-pad!!"


def _request(body: bytes, headers: dict[str, str]) -> Request:
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    encoded = [(key.lower().encode(), value.encode()) for key, value in headers.items()]
    return Request(
        {"type": "http", "method": "POST", "headers": encoded, "query_string": b""},
        receive,
    )


def _signed(body: dict) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode()
    stamp = "1710000000"
    private = Ed25519PrivateKey.from_private_bytes(_seed_bytes(_SECRET))
    signature = private.sign(stamp.encode() + raw).hex()
    return raw, {"X-Signature-Timestamp": stamp, "X-Signature-Ed25519": signature}


@pytest.mark.asyncio
async def test_qqbot_accepts_signed_at_message() -> None:
    adapter = QQBotAdapter("app", _SECRET)
    raw, headers = _signed(
        {
            "op": 0,
            "t": "AT_MESSAGE_CREATE",
            "d": {
                "id": "m1",
                "content": " hello ",
                "channel_id": "c1",
                "author": {"id": "u1", "username": "ada"},
            },
        }
    )
    parsed = await adapter.parse_message(_request(raw, headers))
    assert parsed is not None
    assert parsed.content == "hello"
    assert parsed.sender_id == "u1"
    assert parsed.chat_id == "c1"


@pytest.mark.asyncio
async def test_qqbot_rejects_bad_signature_and_other_op() -> None:
    adapter = QQBotAdapter("app", _SECRET)
    raw, headers = _signed({"op": 0, "t": "AT_MESSAGE_CREATE", "d": {"id": "m", "content": "x", "channel_id": "c", "author": {"id": "u"}}})
    headers["X-Signature-Ed25519"] = "00" * 64
    assert await adapter.parse_message(_request(raw, headers)) is None
    other, other_headers = _signed({"op": 13, "d": {}})
    assert await adapter.parse_message(_request(other, other_headers)) is None


def test_qqbot_webhook_disabled() -> None:
    client = TestClient(create_gateway_app(GatewayServerConfig()))
    assert client.post("/webhook/qqbot", json={"op": 0}).status_code == 404
