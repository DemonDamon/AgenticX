#!/usr/bin/env python3
"""WeCom (Enterprise WeChat) application message callback and send API.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import logging
import time
import xml.etree.ElementTree as ET
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs

import httpx
from fastapi import Request, Response
from fastapi.responses import PlainTextResponse

from agenticx.gateway.crypto_utils import decrypt_wecom_message
from agenticx.gateway.models import GatewayMessage, GatewayReply

logger = logging.getLogger(__name__)


def _sha1_signature(token: str, timestamp: str, nonce: str, body: str) -> str:
    parts = sorted([token, timestamp, nonce, body])
    raw = "".join(parts).encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


class WeComAdapter:
    platform = "wecom"

    def __init__(
        self,
        corp_id: str,
        agent_id: int,
        secret: str,
        token: str,
        encoding_aes_key: str,
    ) -> None:
        self._corp_id = (corp_id or "").strip()
        self._agent_id = int(agent_id or 0)
        self._secret = (secret or "").strip()
        self._token = (token or "").strip()
        self._aes_key = (encoding_aes_key or "").strip()
        self._access_token: str = ""
        self._access_token_expires: float = 0.0

    async def verify_webhook(self, request: Request) -> Optional[Response]:
        return None

    def verify_get_url(self, query: Dict[str, str]) -> Optional[Response]:
        """URL verification (echostr)."""
        msg_sig = query.get("msg_signature", "")
        ts = query.get("timestamp", "")
        nonce = query.get("nonce", "")
        echostr = query.get("echostr", "")
        if not echostr or not self._token or not self._aes_key:
            return PlainTextResponse("missing params", status_code=400)
        if _sha1_signature(self._token, ts, nonce, echostr) != msg_sig:
            return PlainTextResponse("signature mismatch", status_code=403)
        try:
            plain = decrypt_wecom_message(self._aes_key, echostr)
        except Exception as exc:
            logger.warning("WeCom echostr decrypt failed: %s", exc)
            return PlainTextResponse("decrypt failed", status_code=400)
        return PlainTextResponse(plain)

    async def parse_post(self, body_text: str, query: Dict[str, str]) -> Optional[GatewayMessage]:
        msg_sig = query.get("msg_signature", "")
        ts = query.get("timestamp", "")
        nonce = query.get("nonce", "")
        root = ET.fromstring(body_text)
        encrypt_el = root.find("Encrypt")
        if encrypt_el is None or encrypt_el.text is None:
            return None
        enc = encrypt_el.text.strip()
        if _sha1_signature(self._token, ts, nonce, enc) != msg_sig:
            logger.warning("WeCom POST signature mismatch")
            return None
        try:
            xml_plain = decrypt_wecom_message(self._aes_key, enc)
        except Exception as exc:
            logger.warning("WeCom decrypt failed: %s", exc)
            return None
        inner = ET.fromstring(xml_plain)
        msg_type = (inner.findtext("MsgType") or "").strip()
        if msg_type != "text":
            return None
        from_user = (inner.findtext("FromUserName") or "").strip()
        content = (inner.findtext("Content") or "").strip()
        msg_id = (inner.findtext("MsgId") or "").strip()
        create_time = inner.findtext("CreateTime") or "0"
        try:
            ts_val = float(create_time)
        except ValueError:
            ts_val = time.time()
        return GatewayMessage(
            message_id=msg_id,
            source=self.platform,
            sender_id=from_user,
            sender_name=from_user,
            content=content,
            content_type="text",
            attachments=[],
            timestamp=ts_val,
            raw={"xml": xml_plain},
            device_id="",
            chat_id="",
        )

    async def parse_message(self, request: Request) -> Optional[GatewayMessage]:
        q = {k: v for k, v in request.query_params.items()}
        body = (await request.body()).decode("utf-8")
        return await self.parse_post(body, q)

    async def send_reply(self, reply: GatewayReply) -> bool:
        token = await self._ensure_access_token()
        if not token:
            return False
        user_id = (reply.reply_to_sender_id or "").strip()
        if not user_id:
            return False
        url = f"https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={token}"
        content = reply.content or ""
        msg_type = "text"
        if len(content) > 2048:
            content = content[:2040] + "..."
            msg_type = "markdown"
        payload: Dict[str, Any] = {
            "touser": user_id,
            "msgtype": msg_type,
            "agentid": self._agent_id,
        }
        if msg_type == "markdown":
            payload["markdown"] = {"content": content}
        else:
            payload["text"] = {"content": content}
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(url, json=payload)
            data = r.json()
            if data.get("errcode", 0) != 0:
                logger.warning("WeCom send_reply err: %s", data)
                return False
            return True
        except Exception as exc:
            logger.warning("WeCom send_reply error: %s", exc)
            return False

    async def _ensure_access_token(self) -> str:
        now = time.time()
        if self._access_token and now < self._access_token_expires - 60:
            return self._access_token
        if not self._corp_id or not self._secret:
            return ""
        url = "https://qyapi.weixin.qq.com/cgi-bin/gettoken"
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.get(url, params={"corpid": self._corp_id, "corpsecret": self._secret})
            data = r.json()
            if data.get("errcode", 0) != 0:
                logger.warning("WeCom gettoken err: %s", data)
                return ""
            self._access_token = str(data.get("access_token") or "")
            self._access_token_expires = now + int(data.get("expires_in") or 7200)
            return self._access_token
        except Exception as exc:
            logger.warning("WeCom gettoken failed: %s", exc)
            return ""


def query_dict_from_request(request: Request) -> Dict[str, str]:
    return {k: v for k, v in request.query_params.items()}
