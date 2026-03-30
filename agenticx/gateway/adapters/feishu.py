#!/usr/bin/env python3
"""Feishu (Lark) bot webhook and OpenAPI reply sender.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, Optional, Tuple

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.responses import Response

from agenticx.gateway.crypto_utils import decrypt_feishu_event
from agenticx.gateway.models import GatewayMessage, GatewayReply

logger = logging.getLogger(__name__)


class FeishuAdapter:
    platform = "feishu"

    def __init__(
        self,
        app_id: str,
        app_secret: str,
        encrypt_key: str = "",
        verification_token: str = "",
    ) -> None:
        self._app_id = (app_id or "").strip()
        self._app_secret = (app_secret or "").strip()
        self._encrypt_key = (encrypt_key or "").strip()
        self._verification_token = (verification_token or "").strip()
        self._tenant_token: str = ""
        self._tenant_token_expires: float = 0.0

    async def verify_webhook(self, request: Request) -> Optional[Response]:
        return None

    def _normalize_body(self, body: Any) -> Dict[str, Any]:
        if not isinstance(body, dict):
            return {}
        if "encrypt" in body and self._encrypt_key:
            try:
                decrypted = decrypt_feishu_event(self._encrypt_key, str(body["encrypt"]))
                return decrypted if isinstance(decrypted, dict) else {}
            except Exception as exc:
                logger.warning("Feishu decrypt failed: %s", exc)
                return {}
        return body

    def process_json(
        self, body: Dict[str, Any]
    ) -> Tuple[Optional[Dict[str, Any]], Optional[GatewayMessage]]:
        """Return (immediate_json_response, message). One of them is set."""
        if body.get("type") == "url_verification":
            ch = body.get("challenge")
            if ch is not None:
                return {"challenge": ch}, None
            return {"challenge": ""}, None

        normalized = self._normalize_body(body)
        header = normalized.get("header") if isinstance(normalized, dict) else None
        if not isinstance(header, dict):
            return None, None
        event_type = str(header.get("event_type") or "")
        if event_type != "im.message.receive_v1":
            return None, None

        event = normalized.get("event") or {}
        if not isinstance(event, dict):
            return None, None
        message = event.get("message") or {}
        if not isinstance(message, dict):
            return None, None
        sender_block = event.get("sender") or {}
        sender_id_obj = sender_block.get("sender_id") if isinstance(sender_block, dict) else None
        open_id = ""
        if isinstance(sender_id_obj, dict):
            open_id = str(sender_id_obj.get("open_id") or sender_id_obj.get("user_id") or "")
        elif isinstance(sender_id_obj, str):
            open_id = sender_id_obj

        content_raw = message.get("content")
        text = ""
        if isinstance(content_raw, str):
            try:
                cj = json.loads(content_raw)
                text = str(cj.get("text", ""))
            except json.JSONDecodeError:
                text = content_raw
        msg_type = str(message.get("message_type") or "text")
        chat_id = str(message.get("chat_id") or "")
        create_time = message.get("create_time")
        ts = 0.0
        if create_time is not None:
            try:
                ts = float(create_time) / 1000.0
            except (TypeError, ValueError):
                ts = time.time()

        msg = GatewayMessage(
            message_id=str(message.get("message_id") or ""),
            source=self.platform,
            sender_id=open_id,
            sender_name=open_id,
            content=text.strip(),
            content_type=msg_type,
            attachments=[],
            timestamp=ts,
            raw=normalized,
            device_id="",
            chat_id=chat_id,
        )
        return None, msg

    async def parse_message(self, request: Request) -> Optional[GatewayMessage]:
        body = await request.json()
        _, msg = self.process_json(body if isinstance(body, dict) else {})
        return msg

    async def send_reply(self, reply: GatewayReply) -> bool:
        if not self._app_id or not self._app_secret:
            logger.error("Feishu app_id/app_secret not configured")
            return False
        token = await self._ensure_tenant_token()
        if not token:
            return False
        receive_id = (reply.reply_to_sender_id or "").strip()
        if not receive_id:
            return False
        url = "https://open.feishu.cn/open-apis/im/v1/messages"
        text = reply.content or ""
        if len(text) <= 500:
            payload: Dict[str, Any] = {
                "receive_id": receive_id,
                "msg_type": "text",
                "content": json.dumps({"text": text}, ensure_ascii=False),
            }
        else:
            payload = {
                "receive_id": receive_id,
                "msg_type": "text",
                "content": json.dumps({"text": text[: 4500]}, ensure_ascii=False),
            }
        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(
                    url,
                    params={"receive_id_type": "open_id"},
                    headers=headers,
                    json=payload,
                )
            if r.status_code >= 400:
                logger.warning("Feishu send_reply HTTP %s: %s", r.status_code, r.text[:500])
            return r.status_code < 400
        except Exception as exc:
            logger.warning("Feishu send_reply error: %s", exc)
            return False

    async def _ensure_tenant_token(self) -> str:
        now = time.time()
        if self._tenant_token and now < self._tenant_token_expires - 60:
            return self._tenant_token
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.post(
                    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                    json={"app_id": self._app_id, "app_secret": self._app_secret},
                )
            data = r.json()
            if data.get("code") != 0:
                logger.warning("Feishu tenant token error: %s", data)
                return ""
            self._tenant_token = str(data.get("tenant_access_token") or "")
            expire = int(data.get("expire") or 7200)
            self._tenant_token_expires = now + expire
            return self._tenant_token
        except Exception as exc:
            logger.warning("Feishu token fetch failed: %s", exc)
            return ""
