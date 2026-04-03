#!/usr/bin/env python3
"""WeChat iLink sidecar adapter.

Connects to the local agx-wechat-sidecar HTTP/SSE service and relays messages
between WeChat (via iLink protocol) and the AgenticX agent runtime.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Callable, Coroutine, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_AGX_DIR = Path.home() / ".agenticx"


def _read_sidecar_port() -> int:
    """Read the sidecar port from the well-known file."""
    port_file = _AGX_DIR / "wechat_sidecar.port"
    try:
        return int(port_file.read_text().strip())
    except (FileNotFoundError, ValueError):
        return 0


class WeChatILinkAdapter:
    """Bridge agx-wechat-sidecar to AgenticX gateway."""

    platform = "wechat_ilink"

    def __init__(
        self,
        sidecar_url: str = "",
        studio_base_url: str = "",
        studio_token: str = "",
    ) -> None:
        self._sidecar_url = sidecar_url.rstrip("/") if sidecar_url else ""
        self._studio_base = studio_base_url.rstrip("/") if studio_base_url else ""
        self._studio_token = studio_token
        self._running = False
        self._task: Optional[asyncio.Task[None]] = None

    def _resolve_sidecar_url(self) -> str:
        if self._sidecar_url:
            return self._sidecar_url
        port = _read_sidecar_port()
        if port:
            return f"http://127.0.0.1:{port}"
        return ""

    def _resolve_studio(self) -> tuple[str, dict[str, str]]:
        base = self._studio_base
        if not base:
            port_file = _AGX_DIR / "serve.port"
            try:
                port = int(port_file.read_text().strip())
                base = f"http://127.0.0.1:{port}"
            except (FileNotFoundError, ValueError):
                base = "http://127.0.0.1:8000"
        token = self._studio_token
        if not token:
            token_file = _AGX_DIR / "serve.token"
            try:
                token = token_file.read_text().strip()
            except FileNotFoundError:
                pass
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return base, headers

    async def start(self) -> None:
        """Start listening for SSE events from the sidecar."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._event_loop())
        logger.info("WeChatILinkAdapter started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("WeChatILinkAdapter stopped")

    async def _event_loop(self) -> None:
        """Connect to sidecar SSE /events and process messages."""
        while self._running:
            sidecar = self._resolve_sidecar_url()
            if not sidecar:
                await asyncio.sleep(5)
                continue
            try:
                await self._consume_sse(sidecar)
            except httpx.ConnectError:
                logger.debug("sidecar not reachable, retrying in 5s")
            except Exception:
                logger.exception("SSE consumer error, retrying in 5s")
            if self._running:
                await asyncio.sleep(5)

    async def _consume_sse(self, sidecar_url: str) -> None:
        transport = httpx.AsyncHTTPTransport()
        timeout = httpx.Timeout(None, connect=10.0)
        async with httpx.AsyncClient(
            transport=transport, timeout=timeout
        ) as client:
            async with client.stream("GET", f"{sidecar_url}/events") as resp:
                resp.raise_for_status()
                buf = ""
                async for chunk in resp.aiter_text():
                    buf += chunk
                    while "\n\n" in buf:
                        block, buf = buf.split("\n\n", 1)
                        for line in block.split("\n"):
                            if not line.startswith("data: "):
                                continue
                            try:
                                evt = json.loads(line[6:])
                            except json.JSONDecodeError:
                                continue
                            await self._handle_event(sidecar_url, evt)

    async def _handle_event(
        self, sidecar_url: str, evt: Dict[str, Any]
    ) -> None:
        evt_type = evt.get("type", "")
        if evt_type == "status" and evt.get("status") == "session_expired":
            logger.warning("WeChat iLink session expired")
            return
        if evt_type != "message":
            return

        text = evt.get("text", "")
        sender = evt.get("sender", "")
        context_token = evt.get("context_token", "")
        items: list[dict[str, Any]] = evt.get("items", [])

        media_paths: list[str] = []
        for item in items:
            eqp = item.get("eqp", "")
            if eqp and item.get("type", 0) != 1:
                dl_path = await self._download_media(
                    sidecar_url, eqp, item.get("aes_key", ""), item.get("url", "")
                )
                if dl_path:
                    media_paths.append(dl_path)

        if not text and not media_paths:
            return

        user_input = text
        if media_paths:
            user_input = (text + "\n" if text else "") + "\n".join(
                f"[附件] {p}" for p in media_paths
            )

        logger.info(
            "WeChat message from=%s text=%s media=%d",
            sender,
            (text or "")[:80],
            len(media_paths),
        )

        try:
            reply = await self._chat_turn(user_input, sender)
        except Exception:
            logger.exception("chat_turn failed for WeChat message")
            reply = "处理消息时出错，请稍后重试。"

        if reply:
            await self._send_reply(sidecar_url, reply, context_token, sender)

    async def _download_media(
        self, sidecar_url: str, eqp: str, aes_key: str, url: str
    ) -> Optional[str]:
        """Download media via sidecar and save to temp directory."""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{sidecar_url}/media/download",
                    json={"eqp": eqp, "aes_key": aes_key, "url": url},
                )
                if resp.status_code >= 400:
                    logger.warning("media download failed: %d", resp.status_code)
                    return None
                import tempfile

                suffix = ".jpg"
                ct = resp.headers.get("content-type", "")
                if "video" in ct:
                    suffix = ".mp4"
                elif "audio" in ct:
                    suffix = ".wav"
                tmp = tempfile.NamedTemporaryFile(
                    delete=False, suffix=suffix, dir=str(_AGX_DIR / "wechat_media")
                )
                os.makedirs(os.path.dirname(tmp.name), exist_ok=True)
                tmp.write(resp.content)
                tmp.close()
                return tmp.name
        except Exception:
            logger.exception("media download error")
            return None

    async def _chat_turn(self, text: str, sender_name: str) -> str:
        """Send message to agx serve /api/chat and collect reply."""
        studio_base, headers = self._resolve_studio()
        timeout = httpx.Timeout(600.0, connect=30.0)
        transport = httpx.AsyncHTTPTransport()
        async with httpx.AsyncClient(
            transport=transport, timeout=timeout
        ) as client:
            body = {
                "user_input": text,
                "user_display_name": sender_name or "微信用户",
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
                    raise RuntimeError(
                        f"chat failed: {stream.status_code} {err[:300]}"
                    )
                buf = ""
                async for chunk in stream.aiter_text():
                    buf += chunk
                    while "\n\n" in buf:
                        line, buf = buf.split("\n\n", 1)
                        for part in line.split("\n"):
                            if not part.startswith("data: "):
                                continue
                            try:
                                msg = json.loads(part[6:])
                            except json.JSONDecodeError:
                                continue
                            et = str(msg.get("type") or "")
                            data = (
                                msg.get("data")
                                if isinstance(msg.get("data"), dict)
                                else {}
                            )
                            if et == "token":
                                final_text += str(data.get("text") or "")
                            elif et == "final":
                                t = str(data.get("text") or "")
                                if t:
                                    final_text = t
                            elif et == "error":
                                raise RuntimeError(
                                    str(data.get("text") or "chat error")
                                )
        return final_text.strip() or ""

    async def _send_reply(
        self,
        sidecar_url: str,
        text: str,
        context_token: str,
        recipient: str,
    ) -> None:
        """Forward agent reply to WeChat via sidecar /send."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{sidecar_url}/send",
                    json={
                        "text": text,
                        "context_token": context_token,
                        "recipient": recipient,
                    },
                )
                if resp.status_code >= 400:
                    logger.error(
                        "sidecar /send error: %d %s",
                        resp.status_code,
                        resp.text[:200],
                    )
        except Exception:
            logger.exception("Failed to send reply via sidecar")
