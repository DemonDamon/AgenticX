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
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

from agenticx.cli.config_manager import ConfigManager
from agenticx.gateway.im_confirm import (
    PendingConfirm,
    PendingConfirmStore,
    format_pending_hint,
    parse_confirm_command,
)
from agenticx.gateway.models import GatewayMessage, GatewayReply
from agenticx.gateway.user_device_map import UserDeviceMap

logger = logging.getLogger(__name__)
_CONFIRM_TTL_SEC = float(os.getenv("AGX_IM_CONFIRM_TIMEOUT_SEC", "300") or "300")
_PENDING_CONFIRMS = PendingConfirmStore(ttl_seconds=_CONFIRM_TTL_SEC)

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
        sender_key = f"{msg.source}:{msg.sender_id}"
        action, request_id, deny_reason = parse_confirm_command(text)
        if action != "none":
            return await self._handle_confirm_command(
                sender_key=sender_key,
                action=action,
                request_id=request_id,
                deny_reason=deny_reason,
            )
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
            progress_lines: list[str] = []
            saw_final = False
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
                                saw_final = True
                            elif et == "tool_call":
                                tname = str(data.get("tool_name") or data.get("name") or "tool")
                                progress_lines.append(f"开始：{tname}")
                            elif et == "tool_result":
                                tname = str(data.get("tool_name") or data.get("name") or "tool")
                                progress_lines.append(f"完成：{tname}")
                            elif et == "tool_progress":
                                tname = str(data.get("name") or "tool")
                                elapsed = data.get("elapsed_seconds")
                                if isinstance(elapsed, (int, float)):
                                    sec = int(float(elapsed))
                                    if sec in {1, 3, 5} or sec % 15 == 0:
                                        progress_lines.append(f"进行中：{tname} ({sec}s)")
                            elif et == "confirm_required":
                                request_id = str(data.get("id") or data.get("request_id") or "").strip()
                                if not request_id:
                                    continue
                                question = str(data.get("question") or "需要你确认后继续执行。").strip()
                                confirm_agent_id = str(data.get("agent_id") or "meta").strip() or "meta"
                                pending = PendingConfirm(
                                    request_id=request_id,
                                    agent_id=confirm_agent_id,
                                    session_id=session_id,
                                    question=question,
                                    created_at=time.time(),
                                )
                                _PENDING_CONFIRMS.upsert(sender_key, pending)
                                prefix = ""
                                if progress_lines:
                                    prefix = "执行进度：\n" + "\n".join(
                                        f"- {line}" for line in progress_lines[-6:]
                                    )
                                hint = format_pending_hint(pending)
                                return ((prefix + "\n\n") if prefix else "") + hint
                            elif et == "error":
                                raise RuntimeError(str(data.get("text") or "chat error"))
            out = final_text.strip()
            if progress_lines:
                unique_progress = list(dict.fromkeys(progress_lines))
                progress_block = "执行进度：\n" + "\n".join(f"- {line}" for line in unique_progress[-6:])
                if out:
                    out = f"{progress_block}\n\n{out}"
                elif saw_final:
                    out = progress_block
            return out or "（无文本回复）"

    async def _handle_confirm_command(
        self,
        *,
        sender_key: str,
        action: str,
        request_id: Optional[str],
        deny_reason: Optional[str],
    ) -> str:
        if action == "pending":
            rows = _PENDING_CONFIRMS.list_for_sender(sender_key)
            if not rows:
                return "当前没有待确认任务。"
            lines = ["待确认任务："]
            for row in rows[:5]:
                lines.append(f"- `{row.request_id}` ({row.agent_id}) {row.question[:80]}")
            return "\n".join(lines)

        pending = _PENDING_CONFIRMS.get(sender_key, request_id=request_id)
        if pending is None:
            if request_id:
                return f"未找到 request_id `{request_id}` 的待确认任务（可能已过期或已处理）。"
            return "当前没有待确认任务。先发 `/pending` 查看。"

        approved = action == "approve"
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            confirm_resp = await client.post(
                f"{self._settings.studio_base_url}/api/confirm",
                headers=headers,
                json={
                    "session_id": pending.session_id,
                    "request_id": pending.request_id,
                    "approved": approved,
                    "agent_id": pending.agent_id or "meta",
                },
            )
            if confirm_resp.status_code >= 400:
                err_body = confirm_resp.text[:200]
                return f"确认提交失败：{err_body}"
        _PENDING_CONFIRMS.remove(sender_key, pending.request_id)
        if approved:
            return f"已确认继续执行（request_id: `{pending.request_id}`）。"
        reason = deny_reason or "Denied from IM"
        return f"已拒绝执行（request_id: `{pending.request_id}`）。原因：{reason}"

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
