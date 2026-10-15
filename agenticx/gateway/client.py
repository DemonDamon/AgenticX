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


# ---------------------------------------------------------------------------
# 飞书连接器（lark-cli）辅助：手机端「添加到对话 → 飞书文档」数据源。
# 只使用 AgenticX 自管（~/.agenticx/connectors/feishu/*/bin）或系统固定路径
# 安装的 lark-cli，并剥离外部注入的 LARKSUITE_* 环境凭证，确保读取的是
# 桌面端连接器的用户登录态；查 PATH 的做法会命中宿主环境自带凭证的副本，
# 属于错误身份，禁止。
# ---------------------------------------------------------------------------

_LARK_CONNECTORS_DIR = os.path.expanduser("~/.agenticx/connectors/feishu")
_LARK_DOC_MAX_CHARS = 80_000


def _lark_cli_binary() -> Optional[str]:
    try:
        versions = os.listdir(_LARK_CONNECTORS_DIR)
    except OSError:
        versions = []
    candidates: list[tuple[tuple[int, ...], str]] = []
    for ver in versions:
        binary = os.path.join(_LARK_CONNECTORS_DIR, ver, "bin", "lark-cli")
        if not os.path.isfile(binary):
            continue
        try:
            key = tuple(int(p) for p in ver.split(".") if p.isdigit())
        except ValueError:
            continue
        candidates.append((key, binary))
    if candidates:
        return max(candidates, key=lambda item: item[0])[1]
    home = os.path.expanduser("~")
    for path in (
        "/opt/homebrew/bin/lark-cli",
        "/usr/local/bin/lark-cli",
        "/usr/bin/lark-cli",
        os.path.join(home, ".npm-global", "bin", "lark-cli"),
    ):
        if os.path.isfile(path):
            return path
    return None


def _lark_env() -> Dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("LARKSUITE_")}
    env["NO_COLOR"] = "1"
    return env


async def _run_lark_cli(args: list[str], timeout_sec: float) -> str:
    binary = _lark_cli_binary()
    if not binary:
        raise RuntimeError("飞书连接器未安装：请先在桌面端「设置 → 连接器 → 飞书」完成连接")
    try:
        proc = await asyncio.create_subprocess_exec(
            binary,
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_lark_env(),
        )
        out, _err = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
    except (OSError, asyncio.TimeoutError) as exc:
        raise RuntimeError(f"飞书连接器执行失败：{exc}") from exc
    return (out or b"").decode("utf-8", "replace").strip()


def _parse_lark_json(output: str) -> Dict[str, Any]:
    try:
        payload = json.loads(output)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"飞书连接器返回异常：{output[:160]}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("飞书连接器返回结构异常")
    return payload


def _strip_lark_highlight(text: str) -> str:
    """搜索接口的 <h>…</h> 高亮标记转纯文本。"""
    return text.replace("<h>", "").replace("</h>", "").strip()


async def _lark_require_user_identity() -> None:
    """确保 lark-cli 用户身份可用（文档搜索/读取仅支持 user 身份）。"""
    payload = _parse_lark_json(await _run_lark_cli(["auth", "status"], timeout_sec=15.0))
    identities = payload.get("identities")
    user = identities.get("user") if isinstance(identities, dict) else None
    if not (isinstance(user, dict) and user.get("available") is True):
        raise RuntimeError(
            "飞书连接器未登录用户身份：请先在桌面端「设置 → 连接器 → 飞书」完成授权"
        )


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
        if method == "session.context_usage":
            return await self._rpc_session_context_usage(params)
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
        if method == "models.list":
            return await self._rpc_models_list()
        if method == "model.set_active":
            return await self._rpc_model_set_active(params)
        if method == "workspaces.list":
            return await self._rpc_workspaces_list()
        if method == "skills.list":
            return await self._rpc_skills_list()
        if method == "docs.search":
            return await self._rpc_docs_search(params)
        raise ValueError(f"unknown rpc method: {method}")

    async def _rpc_session_context_usage(self, params: Dict[str, Any]) -> Any:
        """GET /api/session/context_usage 会话上下文/Token 用量（手机端会话信息卡）。"""
        session_id = str((params or {}).get("session_id") or "")
        if not session_id:
            raise RuntimeError("session.context_usage requires session_id")
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/session/context_usage",
                params={"session_id": session_id},
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"context usage failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            if not isinstance(payload, dict) or "used_tokens" not in payload:
                raise RuntimeError("context usage reply missing usage fields")
            return payload

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

    async def _rpc_models_list(self) -> Any:
        """GET /api/config/providers 模型清单（手机端模型选择器数据源）。

        仅透传展示所需字段——``api_key`` / ``base_url`` 等凭据绝不离开桌面端。
        """
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/config/providers",
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"models list failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("providers"), dict):
                raise RuntimeError("models reply missing 'providers' map")
            providers: dict[str, Any] = {}
            for name, entry in payload["providers"].items():
                if not isinstance(entry, dict):
                    continue
                safe: dict[str, Any] = {}
                for key in ("displayName", "display_name", "enabled", "models", "model"):
                    if key in entry:
                        safe[key] = entry[key]
                providers[str(name)] = safe
            return {
                "ok": bool(payload.get("ok", True)),
                "defaultProvider": payload.get("defaultProvider", ""),
                "providers": providers,
                "activeProvider": payload.get("activeProvider", ""),
                "activeModel": payload.get("activeModel", ""),
            }

    async def _rpc_model_set_active(self, params: Dict[str, Any]) -> Any:
        """PUT /api/config/active-model 切换全局活动模型（手机端模型选择器写入）。"""
        provider = str((params or {}).get("provider") or "").strip()
        model = str((params or {}).get("model") or "").strip()
        if not model:
            raise ValueError("model required")
        body: Dict[str, Any] = {"model": model}
        if provider:
            body["provider"] = provider
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.put(
                f"{self._settings.studio_base_url}/api/config/active-model",
                headers=headers,
                json=body,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"model set failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            if not isinstance(payload, dict) or payload.get("ok") is not True:
                raise RuntimeError("model set reply not ok")
            return {"provider": provider, "model": model}

    async def _rpc_workspaces_list(self) -> Any:
        """GET /api/sessions → 去重 workspace_dir，手机端「当前活跃项目」列表。

        AgenticX 的项目是会话级概念，没有全局项目注册表；这里用最近会话用过的
        工作目录去重成候选列表（名称取目录 basename + 完整绝对路径）。
        """
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/sessions",
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"workspaces list failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
            rows = payload.get("sessions") if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                raise RuntimeError("workspaces reply missing 'sessions' array")
        seen: set[str] = set()
        out: list[Dict[str, str]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            path = str(row.get("workspace_dir") or "").strip()
            if not path or path in seen:
                continue
            seen.add(path)
            label = os.path.basename(path.rstrip("/")) or path
            # 桌面端的默认 taskspace 目录名恒为 default / 会话 uuid，用会话名更可读
            if "/.agenticx/taskspaces/" in path:
                session_name = str(row.get("session_name") or "").strip()
                if session_name:
                    label = session_name
            out.append({"name": label, "path": path})
        return out

    async def _rpc_skills_list(self) -> Any:
        """GET /api/skills 可用技能清单（手机端「添加到对话 → 技能」数据源）。

        仅透传展示所需字段（name/description/source），并剔除全局禁用技能；
        location/base_dir 等桌面端内部路径不下发。
        """
        headers = {"x-agx-desktop-token": self._settings.desktop_token}
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{self._settings.studio_base_url}/api/skills",
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"skills list failed: {r.status_code} {r.text[:200]}")
            payload = r.json()
        rows = payload.get("items") if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            raise RuntimeError("skills reply missing 'items' array")
        out: list[Dict[str, str]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if row.get("globally_disabled") is True:
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            out.append(
                {
                    "name": name,
                    "description": str(row.get("description") or ""),
                    "source": str(row.get("source") or ""),
                }
            )
        out.sort(key=lambda item: item["name"])
        return out

    async def _rpc_docs_search(self, params: Dict[str, Any]) -> Any:
        """飞书文档搜索（手机端「添加到对话 → 飞书文档」数据源）。

        走桌面端飞书连接器（lark-cli）的用户身份；只透传展示与回传所需的
        字段（token/title/url 等），不下发 owner_id 等内部标识。
        """
        query = str(params.get("query") or "").strip()
        if not query:
            return []
        await _lark_require_user_identity()
        payload = _parse_lark_json(
            await _run_lark_cli(
                [
                    "docs",
                    "+search",
                    "--as",
                    "user",
                    "--query",
                    query,
                    "--page-size",
                    "20",
                    "--format",
                    "json",
                ],
                timeout_sec=30.0,
            )
        )
        if payload.get("ok") is not True:
            error = payload.get("error")
            message = error.get("message") if isinstance(error, dict) else None
            raise RuntimeError(f"飞书文档搜索失败：{str(message or '未知错误')[:160]}")
        results = (payload.get("data") or {}).get("results") or []
        if not isinstance(results, list):
            return []
        docs: list[Dict[str, str]] = []
        for item in results:
            if not isinstance(item, dict):
                continue
            meta = item.get("result_meta") if isinstance(item.get("result_meta"), dict) else {}
            token = str(meta.get("token") or "").strip()
            title = _strip_lark_highlight(str(item.get("title_highlighted") or ""))
            if not token or not title:
                continue
            docs.append(
                {
                    "token": token,
                    "title": title,
                    "entity_type": str(item.get("entity_type") or ""),
                    "doc_types": str(meta.get("doc_types") or ""),
                    "url": str(meta.get("url") or ""),
                    "owner_name": str(meta.get("owner_name") or ""),
                    "update_time_iso": str(meta.get("update_time_iso") or ""),
                }
            )
        return docs

    async def _lark_fetch_doc_markdown(self, token: str) -> str:
        """拉取一篇飞书文档的 Markdown 正文（发送时注入 context_files）。"""
        await _lark_require_user_identity()
        payload = _parse_lark_json(
            await _run_lark_cli(
                [
                    "docs",
                    "+fetch",
                    "--as",
                    "user",
                    "--doc",
                    token,
                    "--doc-format",
                    "markdown",
                    "--scope",
                    "full",
                    "--format",
                    "json",
                ],
                timeout_sec=60.0,
            )
        )
        if payload.get("ok") is not True:
            error = payload.get("error")
            message = error.get("message") if isinstance(error, dict) else None
            raise RuntimeError(f"飞书文档读取失败：{str(message or '未知错误')[:160]}")
        content = str(
            ((payload.get("data") or {}).get("document") or {}).get("content") or ""
        ).strip()
        if not content:
            raise RuntimeError("飞书文档内容为空")
        if len(content) > _LARK_DOC_MAX_CHARS:
            content = content[:_LARK_DOC_MAX_CHARS] + "\n\n（内容过长，已截断）"
        return content

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
        images = params.get("image_inputs")
        has_images = isinstance(images, list) and len(images) > 0
        skill_slugs = params.get("skill_slugs")
        has_skills = isinstance(skill_slugs, list) and len(skill_slugs) > 0
        doc_refs = params.get("doc_refs")
        has_docs = isinstance(doc_refs, list) and len(doc_refs) > 0
        if not session_id:
            raise ValueError("session_id required")
        if not install_id:
            raise ValueError("install_id required")
        if not text.strip() and not has_images and not has_docs:
            raise ValueError("text required")
        body: Dict[str, Any] = {
            "session_id": session_id,
            "user_input": text,
            "user_display_name": sender_name or install_id,
        }
        if has_images:
            body["image_inputs"] = images
        if has_skills:
            body["skill_slugs"] = skill_slugs
        if not text.strip():
            # studio /api/chat 要求 user_input 至少 1 字符，纯附件消息补占位文案
            if has_images:
                body["user_input"] = "（图片）"
            elif has_docs:
                body["user_input"] = "（文档）"
        if has_docs:
            # 飞书文档：发送前经连接器拉取 Markdown 正文，注入为本回合 context_files，
            # 与技能注入共用同一落盘/摘要管线（context_files_refs.json 可追溯）。
            refs: list[Dict[str, str]] = []
            for raw in doc_refs[:3]:
                if not isinstance(raw, dict):
                    continue
                token = str(raw.get("token") or "").strip()
                title = str(raw.get("title") or "").strip() or token
                if token:
                    refs.append({"token": token, "title": title})
            context_files: Dict[str, str] = {}
            for ref in refs:
                context_files[f"feishu-doc:{ref['title']}"] = await self._lark_fetch_doc_markdown(
                    ref["token"]
                )
            if context_files:
                body["context_files"] = context_files
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
