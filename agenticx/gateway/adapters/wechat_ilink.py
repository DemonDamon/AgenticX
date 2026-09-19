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

from agenticx.branding import DEFAULT_META_PRODUCT_LABEL

import httpx

from agenticx.gateway.im_confirm import (
    PendingConfirm,
    PendingConfirmStore,
    format_pending_hint,
    parse_confirm_command,
)
from agenticx.gateway.im_group_speaker import (
    IM_CLARIFY_RELEASE_ANSWER,
    format_im_clarification,
    format_im_group_reply,
    im_clarify_agent_id,
    im_clarification_request_id,
    im_outbound_bubbles,
    latest_assistant_reply_after_user,
    latest_clarification_prompt,
    latest_unanswered_clarification,
    merge_im_group_chat_fields,
    register_human_member_best_effort,
    split_im_joined_bubbles,
)
from agenticx.gateway.im_wechat_files import (
    WeChatChatResult,
    append_sent_files_notice,
    build_sidecar_file_payload,
    coerce_chat_result,
    is_redundant_wechat_file_text,
    is_sendable_file,
    paths_from_sse_payload,
    select_outbound_files,
)
from agenticx.gateway.im_wechat_inbound import (
    UNSEEN_IMAGE_IM_REPLY,
    InboundCompanionHold,
    InboundMergeBatch,
    compose_wechat_user_input,
    is_inbound_media_item,
    looks_like_inbound_image,
    parse_sse_data_blocks,
    should_short_circuit_unseen_images,
    sniff_image_mime,
    split_inbound_media,
    suffix_for_mime,
)
from agenticx.llms.vision import is_vision_capable

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


_SPEAKER_LINE_RE = re.compile(r"^(?P<name>[^\n：:]{1,32})[：:]\s*\S")


def _leading_speaker_name(text: str) -> str:
    first = str(text or "").lstrip().split("\n", 1)[0]
    match = _SPEAKER_LINE_RE.match(first)
    if not match:
        return ""
    name = match.group("name").strip()
    if not name or name.isdigit():
        return ""
    return name


def _strip_redundant_meta_speaker(body: str, reply_name: str) -> str:
    name = str(reply_name or "").strip()
    if not name:
        return body
    stripped = body.lstrip()
    for sep in ("：", ":"):
        prefix = f"{name}{sep}"
        if not stripped.startswith(prefix):
            continue
        rest = stripped[len(prefix) :].lstrip()
        inner = _leading_speaker_name(rest)
        if inner and inner != name:
            return rest
    return body


def format_wechat_outbound_text(text: str, reply_name: str) -> str:
    """Plain-text WeChat body. Keep group speaker; do not wrap Meta around it."""
    body = _markdown_to_wechat_text(text)
    if not body:
        return ""
    body = _strip_redundant_meta_speaker(body, reply_name)
    if _leading_speaker_name(body):
        return body
    name = str(reply_name or "").strip()
    if not name:
        return body
    return f"{name}：\n{body}"


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


def build_wechat_chat_body(
    *,
    session_id: str = "",
    text: str,
    sender_name: str,
    sender_key: str = "",
    session_avatar_id: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    image_inputs: list[dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """Build /api/chat JSON. Keep runtime after SSE disconnect like Feishu IM."""
    display = sender_name or "微信用户"
    body: Dict[str, Any] = {
        "user_input": text,
        "user_display_name": display,
        "keep_runtime_after_disconnect": True,
    }
    if session_id:
        body["session_id"] = session_id
    if provider:
        body["provider"] = provider
    if model:
        body["model"] = model
    if image_inputs:
        body["image_inputs"] = list(image_inputs)
    try:
        return merge_im_group_chat_fields(
            body,
            platform="wechat",
            external_id=sender_key.rsplit(":", 1)[-1] if sender_key else "",
            display_name=display,
            session_avatar_id=session_avatar_id,
        )
    except ValueError:
        return body


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
        self._reply_name = os.getenv("AGX_WECHAT_REPLY_NAME", DEFAULT_META_PRODUCT_LABEL).strip()
        self._last_event_at: float = 0.0
        self._degraded: bool = False
        self._event_queue: asyncio.Queue[tuple[str, Dict[str, Any]]] = asyncio.Queue()
        self._pump_task: Optional[asyncio.Task[None]] = None
        self._companion = InboundCompanionHold()
        self._pending_batches: dict[str, InboundMergeBatch] = {}
        self._flush_tasks: dict[str, asyncio.Task[None]] = {}

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
        self._pump_task = asyncio.create_task(self._pump_events())
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
        if self._pump_task:
            self._pump_task.cancel()
            try:
                await self._pump_task
            except asyncio.CancelledError:
                pass
            self._pump_task = None
        for task in list(self._flush_tasks.values()):
            task.cancel()
        self._flush_tasks.clear()
        self._pending_batches.clear()
        logger.info("WeChatILinkAdapter stopped")

    async def _pump_events(self) -> None:
        """Handle inbound SSE off the read loop so /api/chat cannot stall WeChat."""
        while self._running:
            sidecar_url, evt = await self._event_queue.get()
            if not self._running:
                return
            try:
                await self._handle_event(sidecar_url, evt)
            except Exception:
                logger.exception("WeChat inbound event failed")

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
                delay = 15 if self._degraded else 5
                await asyncio.sleep(delay)

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
                    payloads, buf = parse_sse_data_blocks(buf)
                    for payload in payloads:
                        try:
                            evt = json.loads(payload)
                        except json.JSONDecodeError:
                            logger.warning(
                                "WeChat SSE JSON decode failed: %s", payload[:180]
                            )
                            continue
                        if not isinstance(evt, dict):
                            continue
                        await self._event_queue.put((sidecar_url, evt))

    async def _handle_event(
        self, sidecar_url: str, evt: Dict[str, Any]
    ) -> None:
        evt_type = evt.get("type", "")
        if evt_type == "status":
            st = evt.get("status")
            if st in ("session_expired", "stale"):
                logger.warning("WeChat iLink channel status: %s (degraded)", st)
                self._degraded = True
                self._last_event_at = time.time()
                return
            if st:
                self._last_event_at = time.time()
                return
        if evt_type == "error":
            logger.warning("WeChat iLink error event: %s", evt.get("status") or evt)
            self._degraded = True
            self._last_event_at = time.time()
            return
        if evt_type != "message":
            return

        text = evt.get("text", "")
        sender = str(evt.get("sender", "") or "").strip()
        session_id = str(evt.get("session_id", "") or "").strip()
        group_id = str(evt.get("group_id", "") or "").strip()
        context_token = str(evt.get("context_token", "") or "").strip()
        raw_items = evt.get("items") or []
        items = raw_items if isinstance(raw_items, list) else []
        self._persist_last_inbound(evt)

        media_paths: list[str] = []
        for item in items:
            if not is_inbound_media_item(item):
                continue
            dl_path = await self._download_media(
                sidecar_url,
                str(item.get("eqp") or ""),
                str(item.get("aes_key") or ""),
                str(item.get("url") or ""),
            )
            if dl_path:
                media_paths.append(dl_path)

        image_inputs, leftover_paths = split_inbound_media(media_paths)
        saw_image = any(looks_like_inbound_image(item) for item in items)
        item_summaries = [
            {
                "type": item.get("type") if isinstance(item, dict) else None,
                "has_eqp": bool(str((item or {}).get("eqp") or "").strip())
                if isinstance(item, dict)
                else False,
                "has_url": bool(str((item or {}).get("url") or "").strip())
                if isinstance(item, dict)
                else False,
                "has_aes": bool(str((item or {}).get("aes_key") or "").strip())
                if isinstance(item, dict)
                else False,
            }
            for item in items
        ]
        sender_key = f"wechat:{sender or group_id or session_id or 'unknown'}"
        action, request_id, deny_reason = parse_confirm_command(str(text or ""))
        if action != "none":
            self._degraded = False
            self._last_event_at = time.time()
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

        merge_key = sender or group_id or session_id or "unknown"
        incoming = InboundMergeBatch(
            sender=sender or merge_key,
            sidecar_url=sidecar_url,
            text=str(text or "").strip(),
            image_inputs=image_inputs,
            leftover_paths=leftover_paths,
            saw_image=saw_image,
            session_id=session_id,
            group_id=group_id,
            context_token=context_token,
            media_count=len(media_paths),
            item_summaries=item_summaries,
        )
        pending = self._pending_batches.get(merge_key)
        if pending is None:
            if not incoming.text:
                held_text = self._companion.take_text(incoming.sender)
                if held_text:
                    incoming.text = held_text
            if not incoming.image_inputs and not incoming.leftover_paths:
                held_images, held_left = self._companion.take_media(incoming.sender)
                incoming.image_inputs.extend(held_images)
                incoming.leftover_paths.extend(held_left)
            self._pending_batches[merge_key] = incoming
            pending = incoming
        else:
            pending.absorb(incoming)
        delay = pending.delay_sec()
        logger.info(
            "WeChat inbound buffered from=%s delay=%.2fs text=%s images=%d leftover=%d",
            incoming.sender[:24],
            delay,
            (pending.text or "")[:80],
            len(pending.image_inputs),
            len(pending.leftover_paths),
        )
        self._schedule_flush(merge_key, delay)

    def _schedule_flush(self, merge_key: str, delay: float) -> None:
        old = self._flush_tasks.pop(merge_key, None)
        if old and not old.done():
            old.cancel()

        async def _run() -> None:
            try:
                if delay > 0:
                    await asyncio.sleep(delay)
                await self._flush_sender(merge_key)
            except asyncio.CancelledError:
                return

        self._flush_tasks[merge_key] = asyncio.create_task(_run())

    async def _flush_all_pending(self) -> None:
        keys = list(self._pending_batches.keys())
        for key in keys:
            old = self._flush_tasks.pop(key, None)
            if old and not old.done():
                old.cancel()
                try:
                    await old
                except asyncio.CancelledError:
                    pass
            await self._flush_sender(key)

    async def _flush_sender(self, merge_key: str) -> None:
        batch = self._pending_batches.pop(merge_key, None)
        self._flush_tasks.pop(merge_key, None)
        if batch is None:
            return
        if batch.text:
            self._companion.remember_text(batch.sender, batch.text)
        if batch.image_inputs or batch.leftover_paths:
            self._companion.remember_media(
                batch.sender, batch.image_inputs, batch.leftover_paths
            )
        await self._dispatch_inbound_turn(batch)

    async def _dispatch_inbound_turn(self, batch: InboundMergeBatch) -> None:
        text = batch.text
        image_inputs = list(batch.image_inputs)
        leftover_paths = list(batch.leftover_paths)
        sidecar_url = batch.sidecar_url
        sender = batch.sender
        session_id = batch.session_id
        group_id = batch.group_id
        context_token = batch.context_token
        # Prefer Desktop-bound AGX session id. WeChat sidecar session_id is
        # transport/session metadata and may not exist in Studio session store.
        bound_session_id, bound_provider, bound_model = self._resolve_bound_session()
        model_can_see = self._model_can_see_images(bound_provider, bound_model)
        leftover_ok = any(str(p or "").strip() for p in leftover_paths)
        user_input = compose_wechat_user_input(
            text,
            leftover_paths,
            has_images=bool(image_inputs),
            image_failed=batch.saw_image and not image_inputs,
            images_unseen=bool(image_inputs) and leftover_ok and model_can_see is False,
        )
        if not user_input:
            return
        self._degraded = False
        self._last_event_at = time.time()

        logger.info(
            "WeChat message from=%s text=%s media=%d images=%d items=%s",
            sender,
            (text or "")[:80],
            batch.media_count,
            len(image_inputs),
            batch.item_summaries,
        )

        effective_session_id = bound_session_id or session_id
        sender_key = f"wechat:{sender or group_id or session_id or 'unknown'}"
        if should_short_circuit_unseen_images(
            has_images=bool(image_inputs),
            has_readable_files=leftover_ok,
            model_can_see=model_can_see,
        ):
            await self._send_reply(
                sidecar_url=sidecar_url,
                text=UNSEEN_IMAGE_IM_REPLY,
                context_token=context_token,
                sender=sender,
                session_id=session_id,
                group_id=group_id,
            )
            return

        chat_session_id = effective_session_id
        try:
            reply = await self._chat_turn(
                user_input,
                sender,
                session_id=effective_session_id,
                sender_key=sender_key,
                provider=bound_provider,
                model=bound_model,
                image_inputs=image_inputs,
            )
        except Exception as exc:
            recovered_session_id = ""
            if effective_session_id and self._is_session_not_found_error(exc):
                recovered_session_id = await self._recover_desktop_bound_session(
                    effective_session_id
                )
            if recovered_session_id:
                chat_session_id = recovered_session_id
                try:
                    reply = await self._chat_turn(
                        user_input,
                        sender,
                        session_id=recovered_session_id,
                        sender_key=sender_key,
                        provider=bound_provider,
                        model=bound_model,
                        image_inputs=image_inputs,
                    )
                except Exception:
                    logger.exception(
                        "chat_turn retry failed for recovered WeChat session"
                    )
                    persisted_q = await self._load_persisted_clarification(
                        chat_session_id
                    )
                    reply = persisted_q or "处理消息时出错，请稍后重试。"
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
                        image_inputs=image_inputs,
                    )
                    fallback = coerce_chat_result(fallback_reply)
                    notice = (
                        "⚠️ 当前模型不兼容，已自动回退到 "
                        f"`{_IM_FALLBACK_PROVIDER}/{_IM_FALLBACK_MODEL}`。"
                    )
                    reply = WeChatChatResult(
                        text=f"{notice}\n\n{fallback.text}" if fallback.text else notice,
                        file_paths=fallback.file_paths,
                    )
                except Exception:
                    logger.exception("chat_turn fallback failed for WeChat message")
                    reply = "处理消息时出错，请稍后重试。"
            else:
                logger.exception("chat_turn failed for WeChat message")
                persisted_q = ""
                if chat_session_id:
                    persisted_q = await self._load_persisted_clarification(
                        chat_session_id
                    )
                reply = persisted_q or "处理消息时出错，请稍后重试。"

        result = coerce_chat_result(reply)
        file_paths = [Path(p) for p in result.file_paths]
        bubbles = [str(item).strip() for item in result.bubbles if str(item).strip()]
        if not bubbles and str(result.text or "").strip():
            bubbles = [str(result.text).strip()]
        if not bubbles and chat_session_id:
            persisted = await self._load_persisted_im_reply(
                chat_session_id, user_input
            )
            if persisted:
                logger.info(
                    "WeChat outbound fallback to persisted assistant text session=%s",
                    chat_session_id[:8],
                )
                bubbles = split_im_joined_bubbles(persisted)
        if bubbles and file_paths:
            bubbles = [
                *bubbles[:-1],
                append_sent_files_notice(bubbles[-1], file_paths),
            ]
        outbound_text = "\n\n".join(bubbles)
        if outbound_text and is_redundant_wechat_file_text(outbound_text, file_paths):
            logger.info("WeChat text skipped: filename-only body with outbound file")
            bubbles = []
        if bubbles:
            for piece in bubbles:
                await self._send_reply(
                    sidecar_url=sidecar_url,
                    text=piece,
                    context_token=context_token,
                    sender=sender,
                    session_id=session_id,
                    group_id=group_id,
                )
        elif not file_paths:
            logger.info("WeChat send skipped: empty SSE text and no persisted assistant")
        for file_path in result.file_paths:
            await self._send_file(
                sidecar_url=sidecar_url,
                path=Path(file_path),
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

                payload = bytes(resp.content or b"")
                mime = sniff_image_mime(payload)
                suffix = suffix_for_mime(mime) if mime else ".bin"
                ct = str(resp.headers.get("content-type", "") or "").lower()
                if not mime:
                    if "video" in ct:
                        suffix = ".mp4"
                    elif "audio" in ct or "wav" in ct:
                        suffix = ".wav"
                    elif "silk" in ct:
                        suffix = ".silk"
                    else:
                        suffix = ".jpg"
                media_dir = _AGX_DIR / "wechat_media"
                media_dir.mkdir(parents=True, exist_ok=True)
                tmp = tempfile.NamedTemporaryFile(
                    delete=False, suffix=suffix, dir=str(media_dir)
                )
                tmp.write(payload)
                tmp.close()
                return tmp.name
        except Exception:
            logger.exception("media download error")
            return None

    def _persist_last_inbound(self, evt: Dict[str, Any]) -> None:
        """Write a redacted inbound snapshot for the next inbound-image debug."""
        try:
            items_out: list[dict[str, Any]] = []
            for raw in evt.get("items") or []:
                if not isinstance(raw, dict):
                    continue
                items_out.append(
                    {
                        "type": raw.get("type"),
                        "has_eqp": bool(str(raw.get("eqp") or "").strip()),
                        "has_url": bool(str(raw.get("url") or "").strip()),
                        "has_aes": bool(str(raw.get("aes_key") or "").strip()),
                        "name": str(raw.get("name") or "")[:80],
                        "url_prefix": str(raw.get("url") or "")[:48],
                    }
                )
            payload = {
                "type": evt.get("type"),
                "text": str(evt.get("text") or "")[:200],
                "sender": str(evt.get("sender") or "")[:32],
                "message_id": str(evt.get("message_id") or ""),
                "items": items_out,
            }
            path = _AGX_DIR / "wechat_last_inbound_sse.json"
            history: list[Any] = []
            try:
                prev = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(prev, dict) and isinstance(prev.get("events"), list):
                    history = list(prev["events"])
                elif isinstance(prev, dict) and prev.get("type"):
                    history = [prev]
            except Exception:
                history = []
            history.append(payload)
            path.write_text(
                json.dumps({"events": history[-8:]}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            logger.debug("persist last inbound WeChat event failed", exc_info=True)

    @staticmethod
    def _model_can_see_images(provider: str | None, model: str | None) -> bool | None:
        if not str(model or "").strip():
            return None
        return is_vision_capable(str(provider or ""), str(model or ""))

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

    def _resolve_bound_avatar_id(self) -> str:
        binding_file = _AGX_DIR / "wechat_binding.json"
        try:
            data = json.loads(binding_file.read_text("utf-8"))
            desk = data.get("_desktop")
            if isinstance(desk, dict):
                return str(desk.get("avatar_id") or "").strip()
        except (FileNotFoundError, ValueError, KeyError, OSError, TypeError):
            pass
        return ""

    async def _load_persisted_im_reply(self, session_id: str, user_text: str) -> str:
        """Read Studio messages when SSE closed before a sendable group_reply."""
        sid = str(session_id or "").strip()
        if not sid:
            return ""
        studio_base, headers = self._resolve_studio()
        try:
            async with httpx.AsyncClient(
                transport=httpx.AsyncHTTPTransport(),
                timeout=15.0,
            ) as client:
                for delay in (0.0, 0.4, 1.0, 2.0):
                    if delay:
                        await asyncio.sleep(delay)
                    try:
                        resp = await client.get(
                            f"{studio_base}/api/session/messages",
                            headers=headers,
                            params={"session_id": sid},
                        )
                    except Exception:
                        continue
                    if resp.status_code >= 400:
                        continue
                    try:
                        payload = resp.json()
                    except ValueError:
                        continue
                    messages = (
                        payload.get("messages") if isinstance(payload, dict) else None
                    )
                    text = latest_assistant_reply_after_user(messages, user_text)
                    if text:
                        return text
        except Exception:
            logger.exception("WeChat persisted reply lookup failed")
        return ""

    async def _load_persisted_clarification(self, session_id: str) -> str:
        """Reuse the Desktop clarification card as WeChat plain text."""
        sid = str(session_id or "").strip()
        if not sid:
            return ""
        studio_base, headers = self._resolve_studio()
        try:
            async with httpx.AsyncClient(
                transport=httpx.AsyncHTTPTransport(),
                timeout=15.0,
            ) as client:
                resp = await client.get(
                    f"{studio_base}/api/session/messages",
                    headers=headers,
                    params={"session_id": sid},
                )
                if resp.status_code >= 400:
                    return ""
                payload = resp.json()
                messages = (
                    payload.get("messages") if isinstance(payload, dict) else None
                )
                request_id, agent_id, text = latest_unanswered_clarification(messages)
                if request_id and text:
                    await self._submit_clarify(
                        session_id=sid,
                        request_id=request_id,
                        agent_id=agent_id,
                    )
                return text or latest_clarification_prompt(messages)
        except Exception:
            logger.exception("WeChat persisted clarification lookup failed")
        return ""

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

    async def _submit_clarify(
        self,
        *,
        session_id: str,
        request_id: str,
        agent_id: str,
        answer_text: str = IM_CLARIFY_RELEASE_ANSWER,
    ) -> tuple[bool, str]:
        sid = str(session_id or "").strip()
        rid = str(request_id or "").strip()
        if not sid or not rid:
            return False, "missing clarify ids"
        studio_base, headers = self._resolve_studio()
        timeout = httpx.Timeout(30.0, connect=10.0)
        try:
            async with httpx.AsyncClient(
                transport=httpx.AsyncHTTPTransport(), timeout=timeout
            ) as client:
                resp = await client.post(
                    f"{studio_base}/api/clarify",
                    headers=headers,
                    json={
                        "session_id": sid,
                        "request_id": rid,
                        "agent_id": im_clarify_agent_id({"agent_id": agent_id}),
                        "answer_text": answer_text,
                        "selected_options": [],
                    },
                )
                if resp.status_code >= 400:
                    logger.warning(
                        "WeChat clarify release failed: %s %s",
                        resp.status_code,
                        resp.text[:200],
                    )
                    return False, resp.text[:200]
        except Exception:
            logger.exception("WeChat clarify release error")
            return False, "clarify release error"
        return True, ""

    async def _release_im_clarification(
        self, session_id: str, data: dict[str, Any]
    ) -> None:
        request_id = im_clarification_request_id(data)
        if not request_id:
            return
        await self._submit_clarify(
            session_id=session_id,
            request_id=request_id,
            agent_id=im_clarify_agent_id(data),
        )

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
        image_inputs: list[dict[str, Any]] | None = None,
    ) -> WeChatChatResult:
        """Send message to agx serve /api/chat and collect reply plus files."""
        studio_base, headers = self._resolve_studio()
        timeout = httpx.Timeout(600.0, connect=30.0)
        transport = httpx.AsyncHTTPTransport()
        async with httpx.AsyncClient(
            transport=transport, timeout=timeout
        ) as client:
            session_avatar_id = self._resolve_bound_avatar_id()
            body = build_wechat_chat_body(
                session_id=session_id,
                text=text,
                sender_name=sender_name,
                sender_key=sender_key,
                session_avatar_id=session_avatar_id,
                provider=provider,
                model=model,
                image_inputs=image_inputs,
            )
            await register_human_member_best_effort(
                client=client,
                studio_base=studio_base,
                headers=headers,
                session_avatar_id=session_avatar_id,
                platform="wechat",
                external_id=sender_key.rsplit(":", 1)[-1] if sender_key else "",
                display_name=sender_name or "微信用户",
            )
            final_text = ""
            group_chunks: list[str] = []
            token_parts: list[str] = []
            token_name = ""
            progress_lines: list[str] = []
            produced_paths: list[str] = []
            referenced_paths: list[str] = []
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
                            produced, referenced = paths_from_sse_payload(et, data)
                            produced_paths.extend(produced)
                            referenced_paths.extend(referenced)
                            if et == "token":
                                final_text += str(data.get("text") or "")
                            elif et == "final":
                                t = str(data.get("text") or "")
                                if t:
                                    final_text = t
                                saw_final = True
                            elif et == "group_clarification":
                                card = format_im_clarification(data)
                                if card:
                                    await self._release_im_clarification(
                                        session_id, data
                                    )
                                    return WeChatChatResult(text=card)
                            elif et == "clarification_required":
                                card = format_im_clarification(data)
                                if card:
                                    await self._release_im_clarification(
                                        session_id, data
                                    )
                                    return WeChatChatResult(text=card)
                            elif et == "group_reply":
                                chunk = format_im_group_reply(data)
                                if chunk:
                                    group_chunks.append(chunk)
                            elif et == "group_token":
                                delta = str(data.get("content") or "")
                                if delta:
                                    token_parts.append(delta)
                                    name = str(
                                        data.get("avatar_name") or data.get("agent_id") or ""
                                    ).strip()
                                    if name:
                                        token_name = name
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
                                return WeChatChatResult(
                                    text=((prefix + "\n\n") if prefix else "") + hint,
                                )
                            elif et == "error":
                                err_code = str(data.get("error") or "")
                                if err_code == "session_busy_elsewhere":
                                    logger.info(
                                        "WeChat chat skipped: session busy elsewhere"
                                    )
                                    return WeChatChatResult(text="")
                                raise RuntimeError(
                                    str(data.get("text") or "chat error")
                                )
        token_text = "".join(token_parts).strip()
        if token_text and token_name and not token_text.startswith(f"{token_name}："):
            token_text = f"{token_name}：{token_text}"
        bubbles = im_outbound_bubbles(
            final_text=final_text,
            group_chunks=group_chunks,
            token_text=token_text,
        )
        if progress_lines:
            unique_progress = list(dict.fromkeys(progress_lines))
            progress_block = "执行进度：\n" + "\n".join(
                f"- {line}" for line in unique_progress[-6:]
            )
            if bubbles:
                bubbles[0] = f"{progress_block}\n\n{bubbles[0]}"
            elif saw_final:
                bubbles = [progress_block]
        text_out = "\n\n".join(bubbles).strip()
        files = select_outbound_files(
            user_input=text,
            produced_paths=produced_paths,
            referenced_paths=referenced_paths,
            reply_text=text_out,
            session_id=session_id,
        )
        return WeChatChatResult(
            text=text_out,
            file_paths=tuple(str(p) for p in files),
            bubbles=tuple(bubbles),
        )

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
        await self._post_sidecar_send(
            sidecar_url,
            extra={"text": text},
            context_token=context_token,
            sender=sender,
            session_id=session_id,
            group_id=group_id,
            timeout=30.0,
            kind="text",
        )

    async def _send_file(
        self,
        sidecar_url: str,
        path: Path,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        """Forward one workspace file to WeChat via sidecar /send file fields."""
        if not is_sendable_file(path):
            logger.warning("WeChat file send skipped: not sendable path=%s", path)
            return
        try:
            base = build_sidecar_file_payload(
                Path(path),
                recipient="",
                context_token="",
            )
        except OSError:
            logger.exception("WeChat file send skipped: cannot read path=%s", path)
            return
        extra = {
            "file": base["file"],
            "filename": base["filename"],
        }
        if base.get("caption"):
            extra["caption"] = base["caption"]
        await self._post_sidecar_send(
            sidecar_url,
            extra=extra,
            context_token=context_token,
            sender=sender,
            session_id=session_id,
            group_id=group_id,
            timeout=120.0,
            kind="file",
        )

    async def _post_sidecar_send(
        self,
        sidecar_url: str,
        extra: dict[str, Any],
        *,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
        timeout: float,
        kind: str,
    ) -> None:
        recipient_candidates = self._dedup_nonempty([group_id, session_id, sender])
        token_candidates = self._dedup_preserve(
            [context_token.strip(), ""]
            if context_token.strip()
            else [""]
        )

        logger.info(
            (
                "WeChat send route snapshot kind=%s sender=%s session_id=%s group_id=%s "
                "ctx_token=%s recipients=%d token_modes=%d"
            ),
            kind,
            self._mask_route_id(sender),
            self._mask_route_id(session_id),
            self._mask_route_id(group_id),
            self._mask_route_id(context_token),
            len(recipient_candidates),
            len(token_candidates),
        )

        if not recipient_candidates:
            logger.error("WeChat send skipped: no recipient candidates kind=%s", kind)
            return

        attempt_logs: list[str] = []
        last_error_snippet = ""

        try:
            async with httpx.AsyncClient(
                transport=httpx.AsyncHTTPTransport(),
                timeout=timeout,
            ) as client:
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
                            **extra,
                            "context_token": token,
                            "recipient": recipient,
                        }
                        combo_tag = (
                            f"{kind}:{recipient_kind}:{self._mask_route_id(recipient)}:"
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
                                    "WeChat send success kind=%s recipient_kind=%s "
                                    "used_context_token=%s status=%d non_json=true"
                                ),
                                kind,
                                recipient_kind,
                                used_context,
                                resp.status_code,
                            )
                            return

                        if isinstance(data, dict) and data.get("ok") is True:
                            logger.info(
                                (
                                    "WeChat send success kind=%s recipient_kind=%s "
                                    "used_context_token=%s status=%d"
                                ),
                                kind,
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
            logger.exception("Failed to send %s via sidecar", kind)
            return

        logger.error(
            "WeChat send failed kind=%s after attempts=%s last_error=%s",
            kind,
            " | ".join(attempt_logs)[:1200],
            last_error_snippet[:200],
        )

    def _format_outbound_text(self, text: str) -> str:
        """Format outbound content for readability in WeChat client."""
        return format_wechat_outbound_text(text, self._reply_name)

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
