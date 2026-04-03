#!/usr/bin/env python3
"""WebSocket client: connects a local agx serve instance to the IM gateway.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

from agenticx.cli.config_manager import ConfigManager
from agenticx.gateway.models import GatewayMessage, GatewayReply
from agenticx.gateway.user_device_map import UserDeviceMap

logger = logging.getLogger(__name__)

try:
    import websockets
    from websockets.client import WebSocketClientProtocol
except ImportError:
    websockets = None  # type: ignore
    WebSocketClientProtocol = Any  # type: ignore


@dataclass
class GatewayClientSettings:
    enabled: bool
    gateway_ws_url: str
    device_id: str
    token: str
    studio_base_url: str
    desktop_token: str


def _merged_raw_config() -> Dict[str, Any]:
    global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
    project_data = ConfigManager._load_yaml(ConfigManager.PROJECT_CONFIG_PATH)
    return ConfigManager._deep_merge(global_data, project_data)


def load_gateway_client_settings() -> Optional[GatewayClientSettings]:
    env_on = os.getenv("AGX_GATEWAY_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")
    merged = _merged_raw_config()
    gw = merged.get("gateway") if isinstance(merged.get("gateway"), dict) else {}
    enabled = env_on or bool(gw.get("enabled"))
    if not enabled:
        return None
    base_url = str(gw.get("url") or os.getenv("AGX_GATEWAY_URL") or "").strip().rstrip("/")
    if not base_url:
        logger.warning("gateway.enabled but gateway.url is empty")
        return None
    if base_url.startswith("https://"):
        ws_base = "wss://" + base_url[len("https://") :]
    elif base_url.startswith("http://"):
        ws_base = "ws://" + base_url[len("http://") :]
    elif base_url.startswith("wss://") or base_url.startswith("ws://"):
        ws_base = base_url
    else:
        ws_base = "wss://" + base_url
    device_id = str(gw.get("device_id") or os.getenv("AGX_GATEWAY_DEVICE_ID") or "").strip()
    if not device_id:
        logger.warning("gateway.enabled but device_id is empty")
        return None
    token = str(gw.get("token") or os.getenv("AGX_GATEWAY_TOKEN") or "").strip()
    host = os.getenv("AGX_SERVE_HOST", "127.0.0.1").strip()
    port = os.getenv("AGX_SERVE_PORT", "8000").strip()
    studio = str(gw.get("studio_base_url") or os.getenv("AGX_STUDIO_BASE_URL") or "").strip()
    if not studio:
        studio = f"http://{host}:{port}"
    desktop_token = os.getenv("AGX_DESKTOP_TOKEN", "").strip()
    ws_path = f"{ws_base.rstrip('/')}/ws/device/{device_id}"
    if token:
        sep = "&" if "?" in ws_path else "?"
        ws_url = f"{ws_path}{sep}token={token}"
    else:
        ws_url = ws_path
    return GatewayClientSettings(
        enabled=True,
        gateway_ws_url=ws_url,
        device_id=device_id,
        token=token,
        studio_base_url=studio.rstrip("/"),
        desktop_token=desktop_token,
    )


def _session_id_for_im(msg: GatewayMessage) -> str:
    raw = f"{msg.source}:{msg.sender_id}".encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()[:20]
    return f"im-{msg.source}-{digest}"


class GatewayClient:
    """Maintains a WebSocket to the cloud gateway and executes chat turns locally."""

    def __init__(self, settings: GatewayClientSettings) -> None:
        self._settings = settings
        self._stop = asyncio.Event()
        self._sem = asyncio.Semaphore(1)

    def request_stop(self) -> None:
        self._stop.set()

    async def run_forever(self) -> None:
        if websockets is None:
            logger.error("websockets package required for gateway client; pip install websockets")
            return
        backoff = 5.0
        while not self._stop.is_set():
            try:
                async with websockets.connect(
                    self._settings.gateway_ws_url,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    backoff = 5.0
                    await self._consume_loop(ws)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("gateway websocket error: %s", exc)
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=backoff)
                    break
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 2.0, 60.0)

    async def _consume_loop(self, ws: WebSocketClientProtocol) -> None:
        if self._settings.token:
            await ws.send(
                json.dumps({"type": "auth", "token": self._settings.token}, ensure_ascii=False)
            )
        async for raw in ws:
            if self._stop.is_set():
                break
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg_type = str(data.get("type") or "")
            if msg_type == "auth_ok":
                continue
            if msg_type == "im_message":
                cid = str(data.get("correlation_id") or "")
                payload = data.get("message")
                if cid and isinstance(payload, dict):
                    asyncio.create_task(self._handle_im_message(ws, cid, payload))

    async def _handle_im_message(
        self,
        ws: WebSocketClientProtocol,
        correlation_id: str,
        payload: Dict[str, Any],
    ) -> None:
        async with self._sem:
            try:
                msg = GatewayMessage.model_validate(payload)
                reply = await self._execute_turn(msg)
                out = GatewayReply(
                    message_id=msg.message_id,
                    source=msg.source,
                    reply_to_sender_id=msg.sender_id,
                    chat_id=msg.chat_id,
                    content=reply,
                    content_type="text",
                )
                await ws.send(
                    json.dumps(
                        {
                            "type": "im_reply",
                            "correlation_id": correlation_id,
                            "payload": out.model_dump(mode="json"),
                        },
                        ensure_ascii=False,
                    )
                )
            except Exception as exc:
                logger.exception("gateway im_message failed: %s", exc)
                err = GatewayReply(
                    message_id=str(payload.get("message_id") or ""),
                    source=str(payload.get("source") or ""),
                    reply_to_sender_id=str(payload.get("sender_id") or ""),
                    chat_id=str(payload.get("chat_id") or ""),
                    content=f"[Machi] 执行出错: {exc}",
                    content_type="text",
                )
                await ws.send(
                    json.dumps(
                        {
                            "type": "im_reply",
                            "correlation_id": correlation_id,
                            "payload": err.model_dump(mode="json"),
                        },
                        ensure_ascii=False,
                    )
                )

    async def _execute_turn(self, msg: GatewayMessage) -> str:
        text = (msg.content or "").strip()
        if UserDeviceMap.is_new_chat_command(text):
            sid = _session_id_for_im(msg)
            await self._delete_session(sid)
            return "已开始新对话。"
        if UserDeviceMap.is_status_command(text):
            return "状态正常（本机 Machi 已连接网关）。"
        if UserDeviceMap.is_cancel_command(text):
            return "当前版本请在本机 Machi 取消进行中的任务。"

        session_id = _session_id_for_im(msg)
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(600.0, connect=30.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/session",
                params={"session_id": session_id},
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"session bootstrap failed: {r.status_code} {r.text[:200]}")

            body = {
                "session_id": session_id,
                "user_input": text,
                "user_display_name": msg.sender_name or msg.sender_id,
            }
            final_text = ""
            confirmed_request_ids: set[str] = set()
            async with client.stream(
                "POST",
                f"{self._settings.studio_base_url}/api/chat",
                headers=headers,
                json=body,
            ) as stream:
                if stream.status_code >= 400:
                    err_body = (await stream.aread()).decode("utf-8", errors="replace")
                    raise RuntimeError(f"chat failed: {stream.status_code} {err_body[:300]}")
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
                            elif et == "confirm_required":
                                request_id = str(data.get("id") or data.get("request_id") or "").strip()
                                if not request_id:
                                    continue
                                if request_id in confirmed_request_ids:
                                    continue
                                confirm_agent_id = str(data.get("agent_id") or "meta").strip() or "meta"
                                confirm_resp = await client.post(
                                    f"{self._settings.studio_base_url}/api/confirm",
                                    headers=headers,
                                    json={
                                        "session_id": session_id,
                                        "request_id": request_id,
                                        "approved": True,
                                        "agent_id": confirm_agent_id,
                                    },
                                )
                                if confirm_resp.status_code >= 400:
                                    err_body = confirm_resp.text[:200]
                                    raise RuntimeError(
                                        "confirm submit failed: "
                                        f"{confirm_resp.status_code} {err_body}"
                                    )
                                confirmed_request_ids.add(request_id)
                            elif et == "error":
                                raise RuntimeError(str(data.get("text") or "chat error"))
            out = final_text.strip()
            return out or "（无文本回复）"

    async def _delete_session(self, session_id: str) -> None:
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.delete(
                f"{self._settings.studio_base_url}/api/session",
                params={"session_id": session_id},
                headers=headers,
            )
            if r.status_code not in (200, 404):
                logger.warning("delete session %s: %s %s", session_id, r.status_code, r.text[:200])


async def run_gateway_client_background(settings: GatewayClientSettings) -> None:
    client = GatewayClient(settings)
    await client.run_forever()
