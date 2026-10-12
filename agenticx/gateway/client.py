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
from agenticx.gateway.im_group_speaker import (
    format_im_group_reply,
    merge_im_group_chat_fields,
    merge_im_sse_reply_text,
    register_human_member_best_effort,
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


@dataclass
class TurnResult:
    """一个 chat 回合的结构化结果（IM 文本格式化与设备 RPC 共用）。"""

    text: str
    progress_lines: list[str]
    saw_final: bool = False
    pending_confirm: Optional[PendingConfirm] = None


class TurnProgressForwarder:
    """SSE token → 节流聚合 → device WS `turn_progress` 帧（手机真流式）。

    token 逐帧转发会在 WS 上产生洪泛，这里按 ``min_interval`` 聚合批量下发；
    转发失败静默（best-effort 增强，绝不影响回合本身）。
    """

    def __init__(
        self,
        ws: "WebSocketClientProtocol",
        session_id: str,
        *,
        min_interval: float = 0.12,
    ) -> None:
        self._ws = ws
        self._session_id = session_id
        self._min_interval = min_interval
        self._buf: list[str] = []
        self._last_flush = 0.0
        self._flush_handle: Optional[asyncio.TimerHandle] = None

    async def add(self, text: str) -> None:
        if not text:
            return
        self._buf.append(text)
        loop = asyncio.get_event_loop()
        now = loop.time()
        if now - self._last_flush >= self._min_interval:
            await self.flush()
        elif self._flush_handle is None:
            # 攒批期间安排一次兜底 flush，保证最后一段文字不滞留
            self._flush_handle = loop.call_later(
                self._min_interval, lambda: asyncio.create_task(self._guarded_flush())
            )

    async def _guarded_flush(self) -> None:
        try:
            await self.flush()
        except Exception:  # pragma: no cover - 防御性兜底
            pass

    async def flush(self) -> None:
        self._cancel_pending_flush()
        if not self._buf:
            return
        delta = "".join(self._buf)
        self._buf.clear()
        self._last_flush = asyncio.get_event_loop().time()
        try:
            await self._ws.send(
                json.dumps(
                    {
                        "type": "turn_progress",
                        "payload": {"session_id": self._session_id, "delta": delta},
                    },
                    ensure_ascii=False,
                )
            )
        except Exception:
            pass

    async def close(self) -> None:
        """回合结束：flush 余量 + 发 turn_progress_end（手机据此收尾流式态）。"""
        await self.flush()
        try:
            await self._ws.send(
                json.dumps(
                    {
                        "type": "turn_progress_end",
                        "payload": {"session_id": self._session_id},
                    },
                    ensure_ascii=False,
                )
            )
        except Exception:
            pass

    def _cancel_pending_flush(self) -> None:
        if self._flush_handle is not None:
            self._flush_handle.cancel()
            self._flush_handle = None


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


def _pending_confirm_dict(pending: Optional[PendingConfirm]) -> Optional[Dict[str, Any]]:
    if pending is None:
        return None
    return {
        "request_id": pending.request_id,
        "agent_id": pending.agent_id,
        "session_id": pending.session_id,
        "question": pending.question,
        "created_at": pending.created_at,
    }


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
            elif msg_type == "device_rpc":
                # 设备 RPC 通道：不经 self._sem（IM 回合串行信号量），只读方法直接并发；
                # session.send 与 IM 回合在本地 studio 侧自然串行。
                cid = str(data.get("correlation_id") or "")
                method = str(data.get("method") or "")
                params = data.get("params") if isinstance(data.get("params"), dict) else {}
                if cid and method:
                    asyncio.create_task(self._handle_device_rpc(ws, cid, method, params))

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
                    content=f"[Near] 执行出错: {exc}",
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
            return "状态正常（本机 Near 已连接网关）。"
        if UserDeviceMap.is_cancel_command(text):
            return "当前版本请在本机 Near 取消进行中的任务。"

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
            session_avatar_id = ""
            try:
                sess_json = r.json()
                if isinstance(sess_json, dict):
                    session_avatar_id = str(sess_json.get("avatar_id") or "").strip()
            except Exception:
                session_avatar_id = ""

            body = {
                "session_id": session_id,
                "user_input": text,
                "user_display_name": msg.sender_name or msg.sender_id,
            }
            try:
                body = merge_im_group_chat_fields(
                    body,
                    platform=str(msg.source or "").strip().lower(),
                    external_id=msg.sender_id,
                    display_name=msg.sender_name or msg.sender_id,
                    session_avatar_id=session_avatar_id,
                )
            except ValueError:
                pass
            await register_human_member_best_effort(
                client=client,
                studio_base=self._settings.studio_base_url,
                headers=headers,
                session_avatar_id=session_avatar_id,
                platform=str(msg.source or "").strip().lower(),
                external_id=msg.sender_id,
                display_name=msg.sender_name or msg.sender_id,
            )
            result = await self._execute_chat_turn_core(
                client, body, session_id, sender_key=sender_key
            )
        if result.pending_confirm is not None:
            prefix = ""
            if result.progress_lines:
                prefix = "执行进度：\n" + "\n".join(
                    f"- {line}" for line in result.progress_lines[-6:]
                )
            hint = format_pending_hint(result.pending_confirm)
            return ((prefix + "\n\n") if prefix else "") + hint
        out = result.text
        if result.progress_lines:
            unique_progress = list(dict.fromkeys(result.progress_lines))
            progress_block = "执行进度：\n" + "\n".join(f"- {line}" for line in unique_progress[-6:])
            if out:
                out = f"{progress_block}\n\n{out}"
            elif result.saw_final:
                out = progress_block
        return out or "（无文本回复）"

    async def _execute_chat_turn_core(
        self,
        client: httpx.AsyncClient,
        body: dict,
        session_id: str,
        *,
        sender_key: str = "",
        token_sink: Optional[object] = None,
    ) -> TurnResult:
        """POST /api/chat（stream）→ SSE 采集 → TurnResult。

        IM 回合与设备 RPC 的 session.send 共用；事件语义与 SSE 解析保持不变。
        confirm_required 事件到达即提前结束（与原 _execute_turn 行为一致），
        PendingConfirm 以 sender_key 写入 store（IM 用 "{source}:{sender_id}"，
        mobile 用 "mobile:{install_id}"）。

        token_sink：``await token_sink.add(text)``（TurnProgressForwarder）——
        供手机真流式把 token 增量实时转发到网关。
        """
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        final_text = ""
        group_chunks: list[str] = []
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
                            piece = str(data.get("text") or "")
                            final_text += piece
                            if token_sink is not None and piece:
                                await token_sink.add(piece)
                        elif et == "final":
                            t = str(data.get("text") or "")
                            if t:
                                final_text = t
                            saw_final = True
                        elif et in {"group_reply", "group_clarification"}:
                            chunk = format_im_group_reply(data)
                            if chunk:
                                group_chunks.append(chunk)
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
                            if sender_key:
                                _PENDING_CONFIRMS.upsert(sender_key, pending)
                            return TurnResult(
                                text=merge_im_sse_reply_text(final_text, group_chunks),
                                progress_lines=progress_lines,
                                saw_final=saw_final,
                                pending_confirm=pending,
                            )
                        elif et == "error":
                            raise RuntimeError(str(data.get("text") or "chat error"))
        return TurnResult(
            text=merge_im_sse_reply_text(final_text, group_chunks),
            progress_lines=progress_lines,
            saw_final=saw_final,
        )

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
        try:
            await self._submit_confirm_and_remove(sender_key, pending, approved)
        except RuntimeError as exc:
            return f"确认提交失败：{exc}"
        if approved:
            return f"已确认继续执行（request_id: `{pending.request_id}`）。"
        reason = deny_reason or "Denied from IM"
        return f"已拒绝执行（request_id: `{pending.request_id}`）。原因：{reason}"

    async def _submit_confirm_and_remove(
        self,
        sender_key: str,
        pending: PendingConfirm,
        approved: bool,
    ) -> None:
        """POST /api/confirm 提交审批结果，成功后从 store 移除（IM 与设备 RPC 共用）。

        提交失败（>=400）抛 RuntimeError，携带响应体前 200 字符。
        """
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
                raise RuntimeError(confirm_resp.text[:200])
        _PENDING_CONFIRMS.remove(sender_key, pending.request_id)

    async def _handle_device_rpc(
        self,
        ws: WebSocketClientProtocol,
        correlation_id: str,
        method: str,
        params: Dict[str, Any],
    ) -> None:
        """设备 RPC 分发：任何异常/未知 method 都回 ok:false，绝不让异常炸掉 WS 连接。"""
        try:
            data = await self._dispatch_device_rpc(method, params, ws=ws)
            reply = {
                "type": "rpc_reply",
                "correlation_id": correlation_id,
                "ok": True,
                "data": data,
            }
        except Exception as exc:
            logger.warning("device_rpc %s failed: %s", method, exc)
            reply = {
                "type": "rpc_reply",
                "correlation_id": correlation_id,
                "ok": False,
                "error": str(exc) or exc.__class__.__name__,
            }
        try:
            await ws.send(json.dumps(reply, ensure_ascii=False))
        except Exception as exc:
            logger.warning("rpc_reply send failed (cid=%s): %s", correlation_id, exc)

    async def _dispatch_device_rpc(
        self,
        method: str,
        params: Dict[str, Any],
        *,
        ws: Optional["WebSocketClientProtocol"] = None,
    ) -> Any:
        if method == "sessions.list":
            return await self._rpc_sessions_list()
        if method == "session.messages":
            return await self._rpc_session_messages(params)
        if method == "session.send":
            return await self._rpc_session_send(params, ws=ws)
        if method == "confirm.pending":
            return await self._rpc_confirm_pending(params)
        if method == "confirm.respond":
            return await self._rpc_confirm_respond(params)
        if method == "sessions.create":
            return await self._rpc_sessions_create(params)
        if method == "tools.registry":
            return await self._rpc_tools_registry()
        if method == "mcp.servers":
            return await self._rpc_mcp_servers(params)
        raise ValueError(f"unknown rpc method: {method}")

    async def _rpc_sessions_list(self) -> Any:
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/sessions",
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"sessions list failed: {r.status_code} {r.text[:200]}")
            # studio 返回 {"ok": true, "sessions": [...]}；设备 RPC 契约只透传数组，
            # gateway 路由负责再包成 {"sessions": [...]}。兼容直接返回数组的形态
            payload = r.json()
            rows = payload.get("sessions") if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                raise RuntimeError("sessions list reply missing 'sessions' array")
            return rows

    async def _rpc_sessions_create(self, params: Dict[str, Any]) -> Any:
        """POST /api/sessions 创建会话；body 透传（手机端懒创建用，默认空 dict）。"""
        body = params if isinstance(params, dict) else {}
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{self._settings.studio_base_url}/api/sessions",
                headers=headers,
                json=body,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"session create failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            if not isinstance(payload, dict) or not str(payload.get("session_id") or "").strip():
                raise RuntimeError("session create reply missing 'session_id'")
            return payload

    async def _rpc_tools_registry(self) -> Any:
        """GET /api/tools/registry 工具注册表（手机端「Near 会什么」只读展示）。"""
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/tools/registry",
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"tools registry failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            rows = payload.get("tools") if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                raise RuntimeError("tools registry reply missing 'tools' array")
            return rows

    async def _rpc_mcp_servers(self, params: Dict[str, Any]) -> Any:
        """GET /api/mcp/servers MCP 连接状态（只读；session_id 可选）。"""
        session_id = str(params.get("session_id") or "").strip()
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/mcp/servers",
                params={"session_id": session_id} if session_id else None,
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"mcp servers failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            rows = payload.get("servers") if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                raise RuntimeError("mcp servers reply missing 'servers' array")
            return rows

    async def _rpc_session_messages(self, params: Dict[str, Any]) -> Any:
        session_id = str(params.get("session_id") or "").strip()
        if not session_id:
            raise ValueError("session_id required")
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/session/messages",
                params={"session_id": session_id},
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"session messages failed: {r.status_code} {r.text[:200]}")
            # studio 返回 {"ok": true, "messages": [...]}；同样只透传数组，兼容裸数组
            payload = r.json()
            rows = payload.get("messages") if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                raise RuntimeError("session messages reply missing 'messages' array")
            return rows

    async def _rpc_session_send(
        self, params: Dict[str, Any], ws: Optional["WebSocketClientProtocol"] = None
    ) -> Dict[str, Any]:
        session_id = str(params.get("session_id") or "").strip()
        text = str(params.get("text") or "")
        sender_name = str(params.get("sender_name") or "").strip()
        install_id = str(params.get("install_id") or "").strip()
        if not session_id:
            raise ValueError("session_id required")
        if not install_id:
            raise ValueError("install_id required")
        if not text.strip():
            raise ValueError("text required")
        body = {
            "session_id": session_id,
            "user_input": text,
            "user_display_name": sender_name or install_id,
        }
        timeout = httpx.Timeout(600.0, connect=30.0)
        # 手机真流式：token 增量经 WS 实时转发到网关 → 订阅该会话的手机端
        forwarder = TurnProgressForwarder(ws, session_id) if ws is not None else None
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                result = await self._execute_chat_turn_core(
                    client,
                    body,
                    session_id,
                    sender_key=f"mobile:{install_id}",
                    token_sink=forwarder,
                )
        finally:
            if forwarder is not None:
                await forwarder.close()
        return {
            "reply": result.text,
            "progress": list(dict.fromkeys(result.progress_lines)),
            "pending_confirm": _pending_confirm_dict(result.pending_confirm),
        }

    async def _fetch_parked_approvals(self) -> list[Dict[str, Any]]:
        """Read unattended parked approvals from the local studio. Never raises."""
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(10.0, connect=5.0),
                transport=httpx.AsyncHTTPTransport(),
            ) as client:
                resp = await client.get(
                    f"{self._settings.studio_base_url}/api/approvals/pending",
                    headers=headers,
                )
            if resp.status_code != 200:
                return []
            items = resp.json().get("items")
            if not isinstance(items, list):
                return []
            return [i for i in items if isinstance(i, dict)]
        except Exception:
            logger.debug("fetch parked approvals failed", exc_info=True)
            return []

    async def _rpc_confirm_pending(self, params: Dict[str, Any]) -> list:
        install_id = str(params.get("install_id") or "").strip()
        sender_key = f"mobile:{install_id}"
        rows: list = [
            _pending_confirm_dict(row)
            for row in _PENDING_CONFIRMS.list_for_sender(sender_key)
        ]
        seen = {
            row["request_id"]
            for row in rows
            if isinstance(row, dict) and row.get("request_id")
        }
        for item in await self._fetch_parked_approvals():
            request_id = item.get("request_id")
            session_id = item.get("session_id")
            if not request_id or request_id in seen or not session_id:
                continue
            rows.append(
                {
                    "request_id": request_id,
                    "agent_id": item.get("agent_id") or "meta",
                    "session_id": session_id,
                    "question": item.get("question") or "",
                    "created_at": item.get("created_at") or 0,
                    "source": "parked",
                    "expires_at": item.get("expires_at"),
                }
            )
            seen.add(request_id)
        return rows

    async def _rpc_confirm_respond(self, params: Dict[str, Any]) -> Dict[str, Any]:
        install_id = str(params.get("install_id") or "").strip()
        request_id = str(params.get("request_id") or "").strip()
        approved = bool(params.get("approved"))
        reason = str(params.get("reason") or "").strip()
        if not install_id:
            raise ValueError("install_id required")
        sender_key = f"mobile:{install_id}"
        pending = _PENDING_CONFIRMS.get(sender_key, request_id=request_id or None)
        # Blank request_id stays on the store "latest" path.
        if pending is None and request_id:
            for item in await self._fetch_parked_approvals():
                if item.get("request_id") != request_id:
                    continue
                session_id = item.get("session_id")
                if not session_id:
                    continue
                pending = PendingConfirm(
                    request_id=str(item["request_id"]),
                    agent_id=str(item.get("agent_id") or "meta"),
                    session_id=str(session_id),
                    question=str(item.get("question") or ""),
                    created_at=float(item.get("created_at") or 0),
                )
                break
        if pending is None:
            raise LookupError(f"pending confirm not found: {request_id or '(latest)'}")
        await self._submit_confirm_and_remove(sender_key, pending, approved)
        if approved:
            message = f"已确认继续执行（request_id: `{pending.request_id}`）。"
        else:
            message = f"已拒绝执行（request_id: `{pending.request_id}`）。原因：{reason or 'Denied from mobile'}"
        return {"ok": True, "message": message}

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
