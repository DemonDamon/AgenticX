#!/usr/bin/env python3
"""Inbound WeChat media helpers.

Author: Damon Li
"""

from __future__ import annotations

import base64
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

IMAGE_ONLY_USER_PROMPT = "（见附件，请结合附件回答。）"
IMAGE_DOWNLOAD_FAILED_HINT = "[收到一张微信图片，但未能下载。请再发一次或改发文件。]"
UNSEEN_IMAGE_IM_REPLY = (
    "这轮已经收到图片附件，但当前会话的模型看不了图。"
    "请改发文件或链接，或在桌面把这个会话换成能看附件的模型后再发一次。"
)
UNSEEN_IMAGE_WITH_FILE_HINT = "（本轮图片当前模型看不了，请优先用上面的文件路径。）"
MAX_IMAGE_DATA_URL_CHARS = 8_000_000
MAX_INBOUND_IMAGES = 4
MERGE_WAIT_BOTH_SEC = 0.35
MERGE_WAIT_IMAGE_SEC = 2.2
MERGE_WAIT_CAPTION_SEC = 4.0
MERGE_WAIT_TEXT_SEC = 1.2
_CAPTION_RE = re.compile(
    r"(这个|这张|这幅|这些|这页|如图|附件|图片|照片|截图|上面那|刚才那|看看这|看一下这|发我看看)"
)

_ITEM_TEXT = 1
_ITEM_IMAGE = 2
_ITEM_VOICE = 3
_ITEM_FILE = 4
_ITEM_VIDEO = 5
_MEDIA_TYPES = frozenset({_ITEM_IMAGE, _ITEM_VOICE, _ITEM_FILE, _ITEM_VIDEO})

_JPEG_MAGIC = b"\xff\xd8\xff"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_GIF_MAGIC = b"GIF8"
_WEBP_MARK = b"WEBP"


def sniff_image_mime(data: bytes) -> str:
    raw = bytes(data or b"")
    if raw.startswith(_JPEG_MAGIC):
        return "image/jpeg"
    if raw.startswith(_PNG_MAGIC):
        return "image/png"
    if raw.startswith(_GIF_MAGIC):
        return "image/gif"
    if len(raw) >= 12 and raw[8:12] == _WEBP_MARK:
        return "image/webp"
    return ""


def suffix_for_mime(mime: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
        "audio/wav": ".wav",
        "audio/silk": ".silk",
    }.get(str(mime or "").strip().lower(), ".bin")


def inbound_item_type(item: Any) -> int:
    if not isinstance(item, dict):
        return 0
    try:
        return int(item.get("type", 0) or 0)
    except (TypeError, ValueError):
        return 0


def looks_like_inbound_image(item: Any) -> bool:
    return inbound_item_type(item) == _ITEM_IMAGE


def is_inbound_media_item(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    typ = inbound_item_type(item)
    if typ == _ITEM_TEXT:
        return False
    eqp = str(item.get("eqp") or "").strip()
    url = str(item.get("url") or "").strip()
    if eqp or url:
        return True
    return typ in _MEDIA_TYPES


def image_input_from_path(path: Path) -> dict[str, Any] | None:
    try:
        data = Path(path).read_bytes()
    except OSError:
        return None
    mime = sniff_image_mime(data)
    if not mime:
        return None
    data_url = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
    if len(data_url) > MAX_IMAGE_DATA_URL_CHARS:
        return None
    name = Path(path).name or "image"
    return {
        "name": name,
        "data_url": data_url,
        "mime_type": mime,
        "size": len(data),
    }


def split_inbound_media(paths: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    images: list[dict[str, Any]] = []
    leftover: list[str] = []
    for raw in paths:
        path = str(raw or "").strip()
        if not path:
            continue
        if len(images) >= MAX_INBOUND_IMAGES:
            leftover.append(path)
            continue
        item = image_input_from_path(Path(path))
        if item:
            images.append(item)
        else:
            leftover.append(path)
    return images, leftover


@dataclass
class _HeldText:
    text: str
    created_at: float


@dataclass
class _HeldMedia:
    image_inputs: list[dict[str, Any]]
    leftover_paths: list[str]
    created_at: float


@dataclass
class InboundCompanionHold:
    """Keep a recent caption or attachment so split WeChat events can rejoin."""

    ttl_sec: float = 30.0
    _texts: dict[str, _HeldText] = field(default_factory=dict)
    _media: dict[str, _HeldMedia] = field(default_factory=dict)

    def remember_text(self, sender: str, text: str, now: float | None = None) -> None:
        key = str(sender or "").strip()
        body = str(text or "").strip()
        if not key or not body:
            return
        self._texts[key] = _HeldText(body, float(now if now is not None else time.time()))

    def take_text(self, sender: str, now: float | None = None) -> str:
        key = str(sender or "").strip()
        item = self._texts.pop(key, None)
        if item is None:
            return ""
        ts = float(now if now is not None else time.time())
        if ts - item.created_at > self.ttl_sec:
            return ""
        return item.text

    def remember_media(
        self,
        sender: str,
        image_inputs: list[dict[str, Any]],
        leftover_paths: list[str],
        now: float | None = None,
    ) -> None:
        key = str(sender or "").strip()
        images = [dict(item) for item in image_inputs if isinstance(item, dict)]
        leftovers = [str(p) for p in leftover_paths if str(p or "").strip()]
        if not key or not (images or leftovers):
            return
        self._media[key] = _HeldMedia(
            images,
            leftovers,
            float(now if now is not None else time.time()),
        )

    def take_media(
        self, sender: str, now: float | None = None
    ) -> tuple[list[dict[str, Any]], list[str]]:
        key = str(sender or "").strip()
        item = self._media.pop(key, None)
        if item is None:
            return [], []
        ts = float(now if now is not None else time.time())
        if ts - item.created_at > self.ttl_sec:
            return [], []
        return list(item.image_inputs), list(item.leftover_paths)


def parse_sse_data_blocks(buf: str) -> tuple[list[str], str]:
    """Split an SSE buffer into `data:` payloads. Keep a partial tail."""
    raw = str(buf or "")
    events: list[str] = []
    while True:
        crlf_at = raw.find("\r\n\r\n")
        lf_at = raw.find("\n\n")
        if crlf_at < 0 and lf_at < 0:
            break
        if crlf_at >= 0 and (lf_at < 0 or crlf_at <= lf_at):
            block, raw = raw[:crlf_at], raw[crlf_at + 4 :]
        else:
            block, raw = raw[:lf_at], raw[lf_at + 2 :]
        data_lines: list[str] = []
        for line in block.replace("\r\n", "\n").split("\n"):
            if line.startswith("data: "):
                data_lines.append(line[6:])
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if data_lines:
            events.append("\n".join(data_lines))
    return events, raw


def looks_like_media_caption(text: str) -> bool:
    body = str(text or "").strip()
    if not body:
        return False
    return bool(_CAPTION_RE.search(body))


def should_short_circuit_unseen_images(
    *,
    has_images: bool,
    has_readable_files: bool,
    model_can_see: bool | None,
) -> bool:
    """True only when this turn is image-only and the bound model cannot see images."""
    if not has_images or has_readable_files:
        return False
    return model_can_see is False


def inbound_merge_delay_sec(
    *,
    has_text: bool,
    has_media: bool,
    caption_like: bool,
) -> float:
    if has_text and has_media:
        return MERGE_WAIT_BOTH_SEC
    if has_media:
        return MERGE_WAIT_IMAGE_SEC
    if has_text and caption_like:
        return MERGE_WAIT_CAPTION_SEC
    if has_text:
        return MERGE_WAIT_TEXT_SEC
    return 0.0


@dataclass
class InboundMergeBatch:
    """One sender's unflushed inbound turn, waiting for a companion event."""

    sender: str
    sidecar_url: str
    text: str = ""
    image_inputs: list[dict[str, Any]] = field(default_factory=list)
    leftover_paths: list[str] = field(default_factory=list)
    saw_image: bool = False
    session_id: str = ""
    group_id: str = ""
    context_token: str = ""
    media_count: int = 0
    item_summaries: list[dict[str, Any]] = field(default_factory=list)

    def absorb(self, incoming: "InboundMergeBatch") -> None:
        incoming_text = str(incoming.text or "").strip()
        self_text = str(self.text or "").strip()
        if incoming_text and not self_text:
            self.text = incoming_text
        elif incoming_text and self_text and incoming_text != self_text:
            self.text = f"{self_text}\n{incoming_text}"
        seen = {
            str(item.get("data_url") or "")
            for item in self.image_inputs
            if isinstance(item, dict)
        }
        for item in incoming.image_inputs:
            if not isinstance(item, dict):
                continue
            data_url = str(item.get("data_url") or "")
            if data_url and data_url in seen:
                continue
            self.image_inputs.append(dict(item))
            if data_url:
                seen.add(data_url)
        for path in incoming.leftover_paths:
            raw = str(path or "").strip()
            if raw and raw not in self.leftover_paths:
                self.leftover_paths.append(raw)
        self.saw_image = self.saw_image or incoming.saw_image
        if incoming.context_token:
            self.context_token = incoming.context_token
        if incoming.session_id:
            self.session_id = incoming.session_id
        if incoming.group_id:
            self.group_id = incoming.group_id
        if incoming.sidecar_url:
            self.sidecar_url = incoming.sidecar_url
        if incoming.sender:
            self.sender = incoming.sender
        self.media_count += incoming.media_count
        self.item_summaries.extend(incoming.item_summaries)

    def delay_sec(self) -> float:
        return inbound_merge_delay_sec(
            has_text=bool(str(self.text or "").strip()),
            has_media=bool(self.image_inputs or self.leftover_paths),
            caption_like=looks_like_media_caption(self.text),
        )


def compose_wechat_user_input(
    text: str,
    leftover_paths: list[str],
    *,
    has_images: bool,
    image_failed: bool = False,
    images_unseen: bool = False,
) -> str:
    body = str(text or "")
    extra = "\n".join(f"[附件] {p}" for p in leftover_paths if str(p or "").strip())
    if body and extra:
        body = f"{body}\n{extra}"
    elif extra:
        body = extra
    elif not body and has_images:
        body = IMAGE_ONLY_USER_PROMPT
    if image_failed and not has_images:
        if body:
            return f"{body}\n{IMAGE_DOWNLOAD_FAILED_HINT}"
        return IMAGE_DOWNLOAD_FAILED_HINT
    if images_unseen and extra:
        if body:
            return f"{body}\n{UNSEEN_IMAGE_WITH_FILE_HINT}"
        return UNSEEN_IMAGE_WITH_FILE_HINT
    return body
