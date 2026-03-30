#!/usr/bin/env python3
"""DingTalk stream/outgoing robot webhook (minimal JSON handler).

Author: Damon Li
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any, Dict, Optional

from fastapi import Request, Response

from agenticx.gateway.models import GatewayMessage, GatewayReply

logger = logging.getLogger(__name__)


class DingTalkAdapter:
    platform = "dingtalk"

    def __init__(self, app_secret: str) -> None:
        self._secret = (app_secret or "").strip().encode("utf-8")

    def _verify_sign(self, timestamp: str, sign_b64: str) -> bool:
        if not self._secret or not timestamp or not sign_b64:
            return False
        string_to_sign = f"{timestamp}\n{self._secret.decode()}".encode("utf-8")
        digest = hmac.new(self._secret, string_to_sign, hashlib.sha256).digest()
        expected = base64.b64encode(digest).decode("utf-8")
        return hmac.compare_digest(expected, sign_b64)

    async def verify_webhook(self, request: Request) -> Optional[Response]:
        return None

    async def parse_message(self, request: Request) -> Optional[GatewayMessage]:
        ts = request.headers.get("timestamp", "")
        sign = request.headers.get("sign", "")
        if self._secret and not self._verify_sign(ts, sign):
            logger.warning("DingTalk signature verification failed")
            return None
        try:
            body = await request.json()
        except Exception:
            return None
        if not isinstance(body, dict):
            return None
        text = ""
        sender = ""
        msg_id = str(body.get("msgId") or body.get("msg_id") or "")
        if "text" in body and isinstance(body["text"], dict):
            text = str(body["text"].get("content") or "")
        if "senderStaffId" in body:
            sender = str(body.get("senderStaffId") or "")
        if "senderNick" in body and not sender:
            sender = str(body.get("senderNick") or "")
        if not text and "content" in body:
            text = str(body.get("content") or "")
        text = text.strip()
        if not text:
            return None
        return GatewayMessage(
            message_id=msg_id,
            source=self.platform,
            sender_id=sender or "unknown",
            sender_name=sender or "unknown",
            content=text,
            content_type="text",
            attachments=[],
            timestamp=time.time(),
            raw=body,
            device_id="",
            chat_id=str(body.get("conversationId") or body.get("chatId") or ""),
        )

    async def send_reply(self, reply: GatewayReply) -> bool:
        logger.info("DingTalk send_reply stub: would deliver to %s", reply.reply_to_sender_id)
        return True
