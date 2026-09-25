#!/usr/bin/env python3
"""QQ official bot webhook adapter.

Author: Damon Li

Inbound verify uses Ed25519 via the already-installed ``cryptography`` package.
This adapter does not send messages. Active replies need a later access-token plan.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import Request

from agenticx.gateway.models import GatewayMessage, GatewayReply

logger = logging.getLogger(__name__)

_MESSAGE_EVENTS = {"MESSAGE_CREATE", "AT_MESSAGE_CREATE"}


def _seed_bytes(secret: str) -> bytes:
    raw = (secret or "").encode("utf-8")
    if not raw:
        return b""
    while len(raw) < 32:
        raw = raw + raw
    return raw[:32]


class QQBotAdapter:
    platform = "qqbot"

    def __init__(self, app_id: str, app_secret: str) -> None:
        self._app_id = (app_id or "").strip()
        self._app_secret = (app_secret or "").strip()

    def _signature_ok(self, timestamp: str, body: bytes, signature_hex: str) -> bool:
        seed = _seed_bytes(self._app_secret)
        if not seed or not timestamp or not signature_hex:
            return False
        try:
            signature = bytes.fromhex(signature_hex)
        except ValueError:
            return False
        private = Ed25519PrivateKey.from_private_bytes(seed)
        public = private.public_key()
        try:
            public.verify(signature, timestamp.encode("utf-8") + body)
        except InvalidSignature:
            return False
        return True

    async def parse_message(self, request: Request) -> Optional[GatewayMessage]:
        raw = await request.body()
        if not self._signature_ok(
            request.headers.get("X-Signature-Timestamp", ""),
            raw,
            request.headers.get("X-Signature-Ed25519", ""),
        ):
            return None
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return None
        if not isinstance(body, dict) or body.get("op") != 0:
            return None
        if body.get("t") not in _MESSAGE_EVENTS:
            return None
        data = body.get("d")
        if not isinstance(data, dict):
            return None
        text = str(data.get("content") or "").strip()
        if not text:
            return None
        author = data.get("author") if isinstance(data.get("author"), dict) else {}
        return GatewayMessage(
            message_id=str(data.get("id") or ""),
            source=self.platform,
            sender_id=str(author.get("id") or ""),
            sender_name=str(author.get("username") or author.get("id") or ""),
            content=text,
            content_type="text",
            timestamp=time.time(),
            raw=body,
            chat_id=str(data.get("channel_id") or ""),
        )

    async def send_reply(self, reply: GatewayReply) -> bool:
        logger.warning("QQ bot reply is not connected yet")
        return False
