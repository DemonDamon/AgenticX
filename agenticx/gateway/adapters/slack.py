#!/usr/bin/env python3
"""Slack Events API adapter.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from typing import Optional

import httpx
from fastapi import Request, Response
from fastapi.responses import JSONResponse

from agenticx.gateway.models import GatewayMessage, GatewayReply

logger = logging.getLogger(__name__)


class SlackAdapter:
    platform = "slack"

    def __init__(self, bot_token: str, signing_secret: str) -> None:
        self._bot_token = (bot_token or "").strip()
        self._signing_secret = (signing_secret or "").strip()

    def _signature_ok(self, timestamp: str, body: bytes, signature: str) -> bool:
        if not self._signing_secret or not timestamp or not signature:
            return False
        try:
            ts = int(timestamp)
        except ValueError:
            return False
        if abs(int(time.time()) - ts) > 300:
            return False
        base = b"v0:" + timestamp.encode("utf-8") + b":" + body
        digest = hmac.new(self._signing_secret.encode("utf-8"), base, hashlib.sha256).hexdigest()
        expected = f"v0={digest}"
        return hmac.compare_digest(expected, signature)

    async def early_response(self, request: Request) -> Optional[Response]:
        raw = await request.body()
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return None
        if isinstance(body, dict) and body.get("type") == "url_verification":
            return JSONResponse({"challenge": body.get("challenge", "")})
        return None

    async def parse_message(self, request: Request) -> Optional[GatewayMessage]:
        raw = await request.body()
        if not self._signature_ok(
            request.headers.get("X-Slack-Request-Timestamp", ""),
            raw,
            request.headers.get("X-Slack-Signature", ""),
        ):
            return None
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return None
        event = body.get("event") if isinstance(body, dict) else None
        if not isinstance(event, dict):
            return None
        if event.get("type") != "message" or event.get("subtype"):
            return None
        text = str(event.get("text") or "").strip()
        if not text:
            return None
        return GatewayMessage(
            message_id=str(event.get("client_msg_id") or event.get("ts") or ""),
            source=self.platform,
            sender_id=str(event.get("user") or ""),
            sender_name=str(event.get("user") or ""),
            content=text,
            content_type="text",
            timestamp=time.time(),
            raw=body,
            chat_id=str(event.get("channel") or ""),
        )

    async def send_reply(self, reply: GatewayReply) -> bool:
        channel = (reply.channel_id or reply.chat_id or "").strip()
        if not channel or not self._bot_token:
            logger.warning("Slack reply skipped: missing channel or token")
            return False
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    "https://slack.com/api/chat.postMessage",
                    headers={"Authorization": f"Bearer {self._bot_token}"},
                    json={"channel": channel, "text": reply.content},
                )
        except Exception:
            logger.warning("Slack reply request failed")
            return False
        if response.status_code < 200 or response.status_code >= 300:
            return False
        try:
            payload = response.json()
        except json.JSONDecodeError:
            return False
        return bool(isinstance(payload, dict) and payload.get("ok") is True)
