#!/usr/bin/env python3
"""Feishu long-connection bot runner (lark-oapi WebSocket mode).

Connects to Feishu server via persistent WebSocket — no public IP required.
Receives im.message.receive_v1 events, forwards them to the local agx serve
/api/chat endpoint, and replies with the result via Feishu OpenAPI.

Usage:
    agx feishu --app-id cli_xxx --app-secret yyy
    FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy agx feishu

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_PORT_FILE = os.path.expanduser("~/.agenticx/serve.port")
_TOKEN_FILE = os.path.expanduser("~/.agenticx/serve.token")


def _read_serve_info() -> tuple[str, str]:
    """Read (port, token) written by agx serve on startup.

    Returns ('', '') if not found.
    """
    port = ""
    token = ""
    try:
        raw = open(_PORT_FILE).read().strip()
        if raw.isdigit():
            port = raw
    except OSError:
        pass
    try:
        token = open(_TOKEN_FILE).read().strip()
    except OSError:
        pass
    return port, token


def _resolve_studio_base(configured: str) -> str:
    """Return studio base URL, auto-detecting port from ~/.agenticx/serve.port if needed."""
    if configured and configured != "http://127.0.0.1:8000":
        return configured
    port, _ = _read_serve_info()
    if port:
        host = "127.0.0.1"
        return f"http://{host}:{port}"
    return configured or "http://127.0.0.1:8000"


def _resolve_desktop_token(configured: str) -> str:
    """Return desktop token, falling back to ~/.agenticx/serve.token."""
    if configured:
        return configured
    _, token = _read_serve_info()
    return token


try:
    import lark_oapi as lark
    from lark_oapi.api.im.v1 import (
        CreateMessageRequest,
        CreateMessageRequestBody,
        ReplyMessageRequest,
        ReplyMessageRequestBody,
    )
    from lark_oapi.api.im.v1.model.p2_im_message_receive_v1 import P2ImMessageReceiveV1
except ImportError:
    lark = None  # type: ignore
    P2ImMessageReceiveV1 = None  # type: ignore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _session_id(app_id: str, sender_open_id: str) -> str:
    raw = f"feishu-lc:{app_id}:{sender_open_id}".encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()[:20]
    return f"im-feishu-lc-{digest}"


def _is_new_chat(text: str) -> bool:
    t = text.strip().lower()
    return t in ("新对话", "new chat", "/new", "/reset", "重置", "清空上下文")


def _is_status(text: str) -> bool:
    t = text.strip().lower()
    return t in ("状态", "status", "/status", "/ping", "ping")


# ---------------------------------------------------------------------------
# Local agx serve calls
# ---------------------------------------------------------------------------

def _no_proxy_client(**kwargs: Any) -> httpx.AsyncClient:
    """Build an AsyncClient that bypasses all system proxies (http_proxy / all_proxy etc).

    Passing an explicit AsyncHTTPTransport instance prevents httpx from reading
    proxy environment variables (http_proxy / all_proxy / SOCKS etc).
    """
    transport = httpx.AsyncHTTPTransport()
    return httpx.AsyncClient(transport=transport, **kwargs)


async def _delete_session(studio_base: str, session_id: str,
                           headers: Dict[str, str]) -> None:
    async with _no_proxy_client(timeout=30.0) as client:
        try:
            await client.delete(
                f"{studio_base}/api/session",
                params={"session_id": session_id},
                headers=headers,
            )
        except Exception as exc:
            logger.warning("delete session failed: %s", exc)


async def _chat_turn(studio_base: str, session_id: str, text: str,
                     sender_name: str, headers: Dict[str, str]) -> str:
    """Send one message to local agx serve and collect the final reply."""
    timeout = httpx.Timeout(600.0, connect=30.0)
    async with _no_proxy_client(timeout=timeout) as client:
        r = await client.get(
            f"{studio_base}/api/session",
            params={"session_id": session_id},
            headers=headers,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"session bootstrap failed: {r.status_code} {r.text[:200]}")

        body = {
            "session_id": session_id,
            "user_input": text,
            "user_display_name": sender_name,
        }
        final_text = ""
        async with client.stream(
            "POST",
            f"{studio_base}/api/chat",
            headers=headers,
            json=body,
        ) as stream:
            if stream.status_code >= 400:
                err = (await stream.aread()).decode("utf-8", errors="replace")
                raise RuntimeError(f"chat failed: {stream.status_code} {err[:300]}")
            buf = ""
            async for chunk in stream.aiter_text():
                buf += chunk
                while "\n\n" in buf:
                    line, buf = buf.split("\n\n", 1)
                    for part in line.split("\n"):
                        if not part.startswith("data: "):
                            continue
                        try:
                            evt = json.loads(part[6:])
                        except json.JSONDecodeError:
                            continue
                        et = str(evt.get("type") or "")
                        data = evt.get("data") if isinstance(evt.get("data"), dict) else {}
                        if et == "token":
                            final_text += str(data.get("text") or "")
                        elif et == "final":
                            t = str(data.get("text") or "")
                            if t:
                                final_text = t
                        elif et == "error":
                            raise RuntimeError(str(data.get("text") or "chat error"))
    return final_text.strip() or "（无文本回复）"


# ---------------------------------------------------------------------------
# Feishu OpenAPI reply
# ---------------------------------------------------------------------------

async def _send_reply(
    lark_client: Any,
    receive_id: str,
    receive_id_type: str,
    text: str,
    message_id: Optional[str] = None,
) -> None:
    """Reply via Feishu OpenAPI (reply-in-thread preferred, fallback to direct send)."""
    content = json.dumps({"text": text[:4000]}, ensure_ascii=False)
    loop = asyncio.get_event_loop()
    try:
        if message_id:
            req = (
                ReplyMessageRequest.builder()
                .message_id(message_id)
                .request_body(
                    ReplyMessageRequestBody.builder()
                    .content(content)
                    .msg_type("text")
                    .build()
                )
                .build()
            )
            resp = await loop.run_in_executor(
                None, lambda: lark_client.im.v1.message.reply(req)
            )
        else:
            req = (
                CreateMessageRequest.builder()
                .receive_id_type(receive_id_type)
                .request_body(
                    CreateMessageRequestBody.builder()
                    .receive_id(receive_id)
                    .content(content)
                    .msg_type("text")
                    .build()
                )
                .build()
            )
            resp = await loop.run_in_executor(
                None, lambda: lark_client.im.v1.message.create(req)
            )
        if not resp.success():
            logger.warning("Feishu send failed code=%s msg=%s", resp.code, resp.msg)
    except Exception as exc:
        logger.warning("Feishu send error: %s", exc)


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

class FeishuLongConnRunner:
    """Runs a Feishu bot via long-connection WebSocket (lark-oapi SDK)."""

    def __init__(
        self,
        app_id: str,
        app_secret: str,
        studio_base_url: str = "http://127.0.0.1:8000",
        desktop_token: str = "",
        log_level: str = "INFO",
    ) -> None:
        if lark is None:
            raise ImportError("lark-oapi is required: pip install lark-oapi")
        self._app_id = app_id
        self._app_secret = app_secret
        self._studio_base = _resolve_studio_base(studio_base_url.rstrip("/"))
        self._desktop_token = _resolve_desktop_token(desktop_token)
        self._log_level = log_level
        self._sem = asyncio.Semaphore(3)

        self._lark_client = (
            lark.Client.builder()
            .app_id(app_id)
            .app_secret(app_secret)
            .log_level(
                lark.LogLevel.DEBUG if log_level == "DEBUG" else lark.LogLevel.INFO
            )
            .build()
        )

    def _headers(self) -> Dict[str, str]:
        h: Dict[str, str] = {}
        if self._desktop_token:
            h["x-agx-desktop-token"] = self._desktop_token
        return h

    def _build_event_handler(self) -> Any:
        # verification_token is only needed for HTTP callback mode; pass empty for long-conn.
        dispatcher = (
            lark.EventDispatcherHandler.builder("", "")
            .register_p2_im_message_receive_v1(self._on_message_sync)
            .build()
        )
        return dispatcher

    def _on_message_sync(self, data: P2ImMessageReceiveV1) -> None:
        """Sync callback called by lark-oapi; spawn async task."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self._handle(data))
            else:
                loop.run_until_complete(self._handle(data))
        except RuntimeError:
            # No event loop in this thread — create one
            asyncio.run(self._handle(data))

    async def _handle(self, data: P2ImMessageReceiveV1) -> None:
        async with self._sem:
            try:
                await self._process(data)
            except Exception as exc:
                logger.exception("handle error: %s", exc)

    async def _process(self, data: P2ImMessageReceiveV1) -> None:
        event = data.event
        if event is None:
            return

        message = event.message
        sender = event.sender
        if message is None:
            return

        # Only handle text messages
        msg_type = str(message.message_type or "")
        if msg_type != "text":
            logger.debug("Skipping message_type=%s", msg_type)
            return

        # Extract text content
        content_raw = message.content or "{}"
        try:
            text = str(json.loads(content_raw).get("text", "")).strip()
        except (json.JSONDecodeError, AttributeError):
            text = content_raw.strip()

        if not text:
            return

        # Extract sender open_id
        open_id = ""
        if sender and sender.sender_id:
            open_id = str(sender.sender_id.open_id or "")

        chat_id = str(message.chat_id or "")
        message_id = str(message.message_id or "")
        sender_name = open_id

        logger.info("Feishu msg from=%s chat=%s text=%s", open_id, chat_id, text[:80])

        session_id = _session_id(self._app_id, open_id)
        headers = self._headers()

        if _is_new_chat(text):
            await _delete_session(self._studio_base, session_id, headers)
            reply = "已开始新对话。"
        elif _is_status(text):
            reply = "Machi 在线，飞书长连接正常。"
        else:
            try:
                reply = await _chat_turn(
                    self._studio_base, session_id, text, sender_name, headers
                )
            except Exception as exc:
                logger.exception("chat_turn failed: %s", exc)
                reply = f"[Machi] 执行出错：{exc}"

        # Prefer reply-in-thread; for group chats use chat_id
        receive_id = open_id
        receive_id_type = "open_id"
        if chat_id and chat_id.startswith("oc_"):
            receive_id = chat_id
            receive_id_type = "chat_id"

        await _send_reply(
            self._lark_client,
            receive_id=receive_id,
            receive_id_type=receive_id_type,
            text=reply,
            message_id=message_id or None,
        )

    def run(self) -> None:
        """Start the Feishu long-connection listener (blocking)."""
        if lark is None:
            raise ImportError("lark-oapi is required: pip install lark-oapi")

        logger.info(
            "Feishu long-connection starting | app_id=%s studio=%s",
            self._app_id,
            self._studio_base,
        )

        ws_client = lark.ws.Client(
            self._app_id,
            self._app_secret,
            event_handler=self._build_event_handler(),
            log_level=(
                lark.LogLevel.DEBUG if self._log_level == "DEBUG" else lark.LogLevel.INFO
            ),
        )
        ws_client.start()
