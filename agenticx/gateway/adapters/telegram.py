#!/usr/bin/env python3
"""Telegram bot webhook adapter.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import time
from typing import Optional

import httpx
from fastapi import Request

from agenticx.gateway.models import GatewayMessage, GatewayReply

logger = logging.getLogger(__name__)


class TelegramAdapter:
    platform = "telegram"

    def __init__(self, bot_token: str, webhook_secret: str = "") -> None:
        self._bot_token = (bot_token or "").strip()
        self._webhook_secret = (webhook_secret or "").strip()

    async def parse_message(self, request: Request) -> Optional[GatewayMessage]:
        if self._webhook_secret:
            given = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
            if given != self._webhook_secret:
                return None
        try:
            body = await request.json()
        except Exception:
            return None
        if not isinstance(body, dict):
            return None
        message = body.get("message")
        if not isinstance(message, dict):
            return None
        text = str(message.get("text") or "").strip()
        if not text:
            return None
        sender = message.get("from") if isinstance(message.get("from"), dict) else {}
        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
        return GatewayMessage(
            message_id=str(body.get("update_id") or ""),
            source=self.platform,
            sender_id=str(sender.get("id") or ""),
            sender_name=str(sender.get("username") or sender.get("id") or ""),
            content=text,
            content_type="text",
            timestamp=time.time(),
            raw=body,
            chat_id=str(chat.get("id") or ""),
        )

    async def send_reply(self, reply: GatewayReply) -> bool:
        chat_id = (reply.channel_id or reply.chat_id or "").strip()
        if not chat_id or not self._bot_token:
            logger.warning("Telegram reply skipped: missing chat or token")
            return False
        url = f"https://api.telegram.org/bot{self._bot_token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(url, json={"chat_id": chat_id, "text": reply.content})
        except Exception:
            logger.warning("Telegram reply request failed")
            return False
        if response.status_code < 200 or response.status_code >= 300:
            return False
        try:
            payload = response.json()
        except json.JSONDecodeError:
            return False
        return bool(isinstance(payload, dict) and payload.get("ok") is True)
