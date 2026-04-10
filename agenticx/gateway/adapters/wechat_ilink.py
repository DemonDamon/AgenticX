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
import re
import time
from pathlib import Path
from typing import Any, Callable, Coroutine, Dict, Optional

import httpx

from agenticx.gateway.im_confirm import (
    PendingConfirm,
    PendingConfirmStore,
    format_pending_hint,
    parse_confirm_command,
)

logger = logging.getLogger(__name__)

_AGX_DIR = Path.home() / ".agenticx"
_CONFIRM_TTL_SEC = float(os.getenv("AGX_IM_CONFIRM_TIMEOUT_SEC", "300") or "300")
_PENDING_CONFIRMS = PendingConfirmStore(ttl_seconds=_CONFIRM_TTL_SEC)
_IM_FALLBACK_ENABLED = (
    os.getenv("AGX_IM_MODEL_FALLBACK_ENABLED", "1").strip().lower()
    not in {"0", "false", "off", "no"}
)
_IM_FALLBACK_PROVIDER = (
    os.getenv("AGX_IM_FALLBACK_PROVIDER", "openai").strip() or "openai"
)
_IM_FALLBACK_MODEL = (
    os.getenv("AGX_IM_FALLBACK_MODEL", "gpt-5-chat").strip() or "gpt-5-chat"
)

_RE_BOLD = re.compile(r"\*\*(.+?)\*\*")
_RE_ITALIC = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
_RE_ITALIC_UNDER = re.compile(r"(?<!_)_(?!_)(.+?)(?<!_)_(?!_)")
_RE_STRIKE = re.compile(r"~~(.+?)~~")
_RE_INLINE_CODE = re.compile(r"`([^`]+)`")
_RE_LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_RE_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
_RE_HEADING = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
_RE_HR = re.compile(r"^[-*_]{3,}\s*$", re.MULTILINE)
_RE_CODE_BLOCK = re.compile(r"```[\w]*\n(.*?)```", re.DOTALL)


def _markdown_to_wechat_text(md: str) -> str:
    """Convert markdown to WeChat-friendly plain text.

    WeChat does not render markdown, so we strip syntax while preserving
    readability: headings become prefixed lines, bold markers removed,
    code blocks indented, links shown inline, etc.
    """
    text = md

    text = _RE_CODE_BLOCK.sub(lambda m: _indent_code(m.group(1)), text)

    text = _RE_IMAGE.sub(lambda m: f"[图片: {m.group(1) or m.group(2)}]", text)
    text = _RE_LINK.sub(lambda m: f"{m.group(1)}({m.group(2)})", text)

    text = _RE_HEADING.sub(lambda m: f"{'━' * len(m.group(1))} {m.group(2)}", text)
    text = _RE_HR.sub("————————", text)

    text = _RE_BOLD.sub(r"【\1】", text)
    text = _RE_STRIKE.sub(r"\1", text)
    text = _RE_INLINE_CODE.sub(r"\1", text)
    text = _RE_ITALIC.sub(r"\1", text)
    text = _RE_ITALIC_UNDER.sub(r"\1", text)

    lines = text.split("\n")
    result: list[str] = []
    for line in lines:
        stripped = line.strip()
        if re.match(r"^[-*+]\s", stripped):
            result.append("  • " + stripped[2:])
        elif re.match(r"^\d+\.\s", stripped):
            result.append("  " + stripped)
        else:
            result.append(line)

    text = "\n".join(result)
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()


def _is_model_param_compat_error(exc: Exception) -> bool:
    text = str(exc or "").lower()
    return (
        "invalid chat setting" in text
        or "invalid params" in text
        or "unsupportedparamserror" in text
        or "unsupported params" in text
        or "tool_choice" in text
    )


def _indent_code(code: str) -> str:
    """Indent code block lines for readability in plain text."""
    lines = code.strip().split("\n")
    indented = "\n".join(f"  {line}" for line in lines)
    return f"┌──────\n{indented}\n└──────"


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
        self._reply_name = os.getenv("AGX_WECHAT_REPLY_NAME", "Machi").strip()

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
            headers["x-agx-desktop-token"] = token
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
        sender = str(evt.get("sender", "") or "").strip()
        session_id = str(evt.get("session_id", "") or "").strip()
        group_id = str(evt.get("group_id", "") or "").strip()
        context_token = str(evt.get("context_token", "") or "").strip()
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

        # Prefer Desktop-bound AGX session id. WeChat sidecar session_id is
        # transport/session metadata and may not exist in Studio session store.
        bound_session_id, bound_provider, bound_model = self._resolve_bound_session()
        effective_session_id = bound_session_id or session_id
        sender_key = f"wechat:{sender or group_id or session_id or 'unknown'}"

        action, request_id, deny_reason = parse_confirm_command(text)
        if action != "none":
            try:
                cmd_reply = await self._handle_confirm_command(
                    sender_key=sender_key,
                    action=action,
                    request_id=request_id,
                    deny_reason=deny_reason,
                )
            except Exception:
                logger.exception("WeChat confirm command failed")
                cmd_reply = "确认指令处理失败，请稍后重试。"
            if cmd_reply:
                await self._send_reply(
                    sidecar_url=sidecar_url,
                    text=cmd_reply,
                    context_token=context_token,
                    sender=sender,
                    session_id=session_id,
                    group_id=group_id,
                )
            return

        try:
            reply = await self._chat_turn(
                user_input,
                sender,
                session_id=effective_session_id,
                sender_key=sender_key,
                provider=bound_provider,
                model=bound_model,
            )
        except Exception as exc:
            recovered_session_id = ""
            if effective_session_id and self._is_session_not_found_error(exc):
                recovered_session_id = await self._recover_desktop_bound_session(
                    effective_session_id
                )
            if recovered_session_id:
                try:
                    reply = await self._chat_turn(
                        user_input,
                        sender,
                        session_id=recovered_session_id,
                        sender_key=sender_key,
                        provider=bound_provider,
                        model=bound_model,
                    )
                except Exception:
                    logger.exception(
                        "chat_turn retry failed for recovered WeChat session"
                    )
                    reply = "处理消息时出错，请稍后重试。"
            elif (
                _IM_FALLBACK_ENABLED
                and _is_model_param_compat_error(exc)
                and not (
                    (bound_provider or "").lower() == _IM_FALLBACK_PROVIDER.lower()
                    and (bound_model or "").lower() == _IM_FALLBACK_MODEL.lower()
                )
            ):
                try:
                    logger.warning(
                        "WeChat IM model incompatible (%s/%s): %s; fallback to %s/%s",
                        bound_provider or "-",
                        bound_model or "-",
                        str(exc)[:200],
                        _IM_FALLBACK_PROVIDER,
                        _IM_FALLBACK_MODEL,
                    )
                    fallback_reply = await self._chat_turn(
                        user_input,
                        sender,
                        session_id=effective_session_id,
                        sender_key=sender_key,
                        provider=_IM_FALLBACK_PROVIDER,
                        model=_IM_FALLBACK_MODEL,
                    )
                    notice = (
                        "⚠️ 当前模型不兼容，已自动回退到 "
                        f"`{_IM_FALLBACK_PROVIDER}/{_IM_FALLBACK_MODEL}`。"
                    )
                    reply = f"{notice}\n\n{fallback_reply}" if fallback_reply else notice
                except Exception:
                    logger.exception("chat_turn fallback failed for WeChat message")
                    reply = "处理消息时出错，请稍后重试。"
            else:
                logger.exception("chat_turn failed for WeChat message")
                reply = "处理消息时出错，请稍后重试。"

        if reply:
            await self._send_reply(
                sidecar_url=sidecar_url,
                text=reply,
                context_token=context_token,
                sender=sender,
                session_id=session_id,
                group_id=group_id,
            )

    async def _download_media(
        self, sidecar_url: str, eqp: str, aes_key: str, url: str
    ) -> Optional[str]:
        """Download media via sidecar and save to temp directory."""
        try:
            async with httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(), timeout=60.0) as client:
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

    def _resolve_bound_session(self) -> tuple[str, Optional[str], Optional[str]]:
        """Read wechat_binding.json _desktop session/model binding."""
        binding_file = _AGX_DIR / "wechat_binding.json"
        try:
            import json as _json

            data = _json.loads(binding_file.read_text("utf-8"))
            desk = data.get("_desktop")
            if isinstance(desk, dict):
                return (
                    str(desk.get("session_id") or "").strip(),
                    (str(desk.get("provider") or "").strip() or None),
                    (str(desk.get("model") or "").strip() or None),
                )
        except (FileNotFoundError, ValueError, KeyError):
            pass
        return "", None, None

    async def _submit_confirm(
        self,
        *,
        session_id: str,
        request_id: str,
        approved: bool,
        agent_id: str,
    ) -> tuple[bool, str]:
        studio_base, headers = self._resolve_studio()
        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(
            transport=httpx.AsyncHTTPTransport(), timeout=timeout
        ) as client:
            resp = await client.post(
                f"{studio_base}/api/confirm",
                headers=headers,
                json={
                    "session_id": session_id,
                    "request_id": request_id,
                    "approved": approved,
                    "agent_id": agent_id or "meta",
                },
            )
            if resp.status_code >= 400:
                return False, resp.text[:200]
        return True, ""

    async def _handle_confirm_command(
        self,
        *,
        sender_key: str,
        action: str,
        request_id: str | None,
        deny_reason: str | None,
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
        ok, err = await self._submit_confirm(
            session_id=pending.session_id,
            request_id=pending.request_id,
            approved=approved,
            agent_id=pending.agent_id,
        )
        if not ok:
            return f"确认提交失败：{err}"
        _PENDING_CONFIRMS.remove(sender_key, pending.request_id)
        if approved:
            return f"已确认继续执行（request_id: `{pending.request_id}`）。"
        reason = deny_reason or "Denied from IM"
        return f"已拒绝执行（request_id: `{pending.request_id}`）。原因：{reason}"

    @staticmethod
    def _is_session_not_found_error(exc: Exception) -> bool:
        text = str(exc).lower()
        return "404" in text or "session not found" in text

    async def _recover_desktop_bound_session(self, old_session_id: str) -> str:
        """Create a new Studio session and rebind _desktop when bound session is stale."""
        binding_file = _AGX_DIR / "wechat_binding.json"
        try:
            data = json.loads(binding_file.read_text("utf-8"))
            desk = data.get("_desktop")
            if not isinstance(desk, dict):
                return ""
            current = str(desk.get("session_id") or "").strip()
            if current != old_session_id:
                return ""
        except (FileNotFoundError, ValueError, OSError):
            return ""

        studio_base, headers = self._resolve_studio()
        try:
            timeout = httpx.Timeout(30.0, connect=10.0)
            async with httpx.AsyncClient(
                transport=httpx.AsyncHTTPTransport(), timeout=timeout
            ) as client:
                resp = await client.post(
                    f"{studio_base}/api/sessions",
                    headers=headers,
                    json={},
                )
                if resp.status_code >= 400:
                    logger.warning(
                        "recover session create failed: %s %s",
                        resp.status_code,
                        resp.text[:200],
                    )
                    return ""
                payload = resp.json()
                new_session_id = str(payload.get("session_id") or "").strip()
                if not new_session_id:
                    return ""
                desk["session_id"] = new_session_id
                binding_file.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                logger.info(
                    "Recovered stale WeChat bound session %s -> %s",
                    old_session_id[:8],
                    new_session_id[:8],
                )
                return new_session_id
        except Exception:
            logger.exception("recover desktop-bound WeChat session failed")
            return ""

    async def _chat_turn(
        self,
        text: str,
        sender_name: str,
        *,
        session_id: str = "",
        sender_key: str = "",
        provider: str | None = None,
        model: str | None = None,
    ) -> str:
        """Send message to agx serve /api/chat and collect reply."""
        studio_base, headers = self._resolve_studio()
        timeout = httpx.Timeout(600.0, connect=30.0)
        transport = httpx.AsyncHTTPTransport()
        async with httpx.AsyncClient(
            transport=transport, timeout=timeout
        ) as client:
            body: Dict[str, Any] = {
                "user_input": text,
                "user_display_name": sender_name or "微信用户",
            }
            if session_id:
                body["session_id"] = session_id
            if provider:
                body["provider"] = provider
            if model:
                body["model"] = model
            final_text = ""
            progress_lines: list[str] = []
            saw_final = False
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
                                raise RuntimeError(
                                    str(data.get("text") or "chat error")
                                )
        out = final_text.strip()
        if progress_lines:
            unique_progress = list(dict.fromkeys(progress_lines))
            progress_block = "执行进度：\n" + "\n".join(f"- {line}" for line in unique_progress[-6:])
            if out:
                out = f"{progress_block}\n\n{out}"
            elif saw_final:
                out = progress_block
        return out.strip() or ""

    async def _send_reply(
        self,
        sidecar_url: str,
        text: str,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        """Forward agent reply to WeChat via sidecar /send with route fallback."""
        text = self._format_outbound_text(text)
        if not text.strip():
            logger.info("WeChat send skipped: empty formatted text")
            return
        recipient_candidates = self._dedup_nonempty([group_id, session_id, sender])
        token_candidates = self._dedup_preserve(
            [context_token.strip(), ""]
            if context_token.strip()
            else [""]
        )

        logger.info(
            (
                "WeChat send route snapshot sender=%s session_id=%s group_id=%s "
                "ctx_token=%s recipients=%d token_modes=%d"
            ),
            self._mask_route_id(sender),
            self._mask_route_id(session_id),
            self._mask_route_id(group_id),
            self._mask_route_id(context_token),
            len(recipient_candidates),
            len(token_candidates),
        )

        if not recipient_candidates:
            logger.error("WeChat send skipped: no recipient candidates")
            return

        attempt_logs: list[str] = []
        last_error_snippet = ""

        try:
            async with httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(), timeout=30.0) as client:
                for recipient in recipient_candidates:
                    recipient_kind = self._recipient_kind(
                        recipient=recipient,
                        sender=sender,
                        session_id=session_id,
                        group_id=group_id,
                    )
                    for token in token_candidates:
                        used_context = bool(token)
                        payload = {
                            "text": text,
                            "context_token": token,
                            "recipient": recipient,
                        }
                        combo_tag = (
                            f"{recipient_kind}:{self._mask_route_id(recipient)}:"
                            f"ctx={'1' if used_context else '0'}"
                        )
                        try:
                            resp = await client.post(
                                f"{sidecar_url}/send",
                                json=payload,
                            )
                        except Exception as exc:
                            err_msg = str(exc)[:120]
                            last_error_snippet = err_msg
                            attempt_logs.append(f"{combo_tag}=EXC({err_msg})")
                            continue

                        body_snippet = resp.text[:160]
                        if resp.status_code >= 400:
                            last_error_snippet = body_snippet
                            attempt_logs.append(f"{combo_tag}=HTTP{resp.status_code}")
                            continue

                        try:
                            data = resp.json()
                        except ValueError:
                            logger.info(
                                (
                                    "WeChat send success recipient_kind=%s "
                                    "used_context_token=%s status=%d non_json=true"
                                ),
                                recipient_kind,
                                used_context,
                                resp.status_code,
                            )
                            return

                        if isinstance(data, dict) and data.get("ok") is True:
                            logger.info(
                                (
                                    "WeChat send success recipient_kind=%s "
                                    "used_context_token=%s status=%d"
                                ),
                                recipient_kind,
                                used_context,
                                resp.status_code,
                            )
                            return

                        last_error_snippet = body_snippet
                        attempt_logs.append(
                            f"{combo_tag}=JSON_OK_FALSE(status={resp.status_code})"
                        )
        except Exception:
            logger.exception("Failed to send reply via sidecar")
            return

        logger.error(
            "WeChat send failed after attempts=%s last_error=%s",
            " | ".join(attempt_logs)[:1200],
            last_error_snippet[:200],
        )

    def _format_outbound_text(self, text: str) -> str:
        """Format outbound content for readability in WeChat client."""
        body = _markdown_to_wechat_text(text)
        if not body:
            return ""
        if not self._reply_name:
            return body
        prefixed = f"{self._reply_name}："
        if body.lstrip().startswith(prefixed):
            return body
        return f"{self._reply_name}：\n{body}"

    @staticmethod
    def _dedup_nonempty(values: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for value in values:
            v = (value or "").strip()
            if not v or v in seen:
                continue
            seen.add(v)
            out.append(v)
        return out

    @staticmethod
    def _dedup_preserve(values: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            out.append(value)
        return out

    @staticmethod
    def _mask_route_id(value: str) -> str:
        v = (value or "").strip()
        if not v:
            return "none"
        prefix = v[:6]
        return f"set:{prefix}***"

    @staticmethod
    def _recipient_kind(
        *, recipient: str, sender: str, session_id: str, group_id: str
    ) -> str:
        if recipient == group_id and group_id:
            return "group_id"
        if recipient == session_id and session_id:
            return "session_id"
        if recipient == sender and sender:
            return "sender"
        return "unknown"
