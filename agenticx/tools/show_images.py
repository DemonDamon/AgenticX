#!/usr/bin/env python3
"""Display-only remote image URLs for inline chat bubbles.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, List


UNCONFIGURED_TOOL_TEXT = "ERROR: show_images requires at least one http(s) image URL"
_MAX_ITEMS = 6
_MAX_SCAN_ITEMS = 24
_MAX_URL_LEN = 2048
_MAX_ALT_LEN = 80
# Listing-page thumbs such as `.thumb.400_0.jpeg` / `.thumb.100_100_c.jpg`.
_THUMB_SUFFIX_RE = re.compile(
    r"\.thumb\.\d+_\d+(?:_[A-Za-z0-9]+)?\.(jpe?g|png|webp|gif)$",
    re.IGNORECASE,
)
_TINY_THUMB_RE = re.compile(r"\.thumb\.(\d+)_\d+", re.IGNORECASE)
_JUNK_NAME_RE = re.compile(
    r"(?:favicon|sprite|pixel|spacer|1x1|qrcode|qr[-_]code|app[-_]download)",
    re.IGNORECASE,
)
# Site chrome / ads / avatars. Duitang app banner lives under /uploads/ops/.
_JUNK_PATH_MARKERS = (
    "/uploads/ops/",
    "/uploads/avatar/",
    "/uploads/people/",
    "/avatar/",
    "/avatars/",
    "/banner/",
    "/banners/",
    "/promo/",
    "/advert",
    "/ads/",
    "/favicon",
    "/sprite",
    "/qrcode",
    "/qr-code",
    "/qr_code",
)


def upgrade_remote_image_url(url: str) -> str:
    """Rewrite known listing thumbs to the original filename. No-op otherwise."""
    text = str(url or "").strip()
    if not text:
        return ""
    upgraded = _THUMB_SUFFIX_RE.sub(r".\1", text)
    if len(upgraded) > _MAX_URL_LEN:
        return text
    return upgraded


def is_junk_remote_image_url(url: str) -> bool:
    """True for site chrome, ads, avatars, QR, and icon-sized thumbs."""
    text = str(url or "").strip()
    if not text:
        return True
    lower = text.lower()
    if any(marker in lower for marker in _JUNK_PATH_MARKERS):
        return True
    if _JUNK_NAME_RE.search(lower):
        return True
    tiny = _TINY_THUMB_RE.search(lower)
    if tiny and int(tiny.group(1)) <= 160:
        return True
    return False


def normalize_http_url(raw: Any) -> str:
    url = str(raw or "").strip()
    if len(url) > _MAX_URL_LEN:
        return ""
    if url.startswith("data:"):
        return ""
    if not (url.startswith("http://") or url.startswith("https://")):
        return ""
    return upgrade_remote_image_url(url)


def normalize_content_image_url(raw: Any) -> str:
    """http(s) image URL after thumb upgrade; empty when it is site chrome."""
    url = normalize_http_url(raw)
    if not url or is_junk_remote_image_url(str(raw or "").strip()) or is_junk_remote_image_url(url):
        return ""
    return url


def preview_show_images_items(items: Any) -> List[dict[str, str]]:
    """Same cleaning as show_images(), without JSON wrapping."""
    cleaned: List[dict[str, str]] = []
    raw_items: Iterable[Any] = items if isinstance(items, list) else []
    for item in list(raw_items)[:_MAX_SCAN_ITEMS]:
        if len(cleaned) >= _MAX_ITEMS:
            break
        if not isinstance(item, dict):
            continue
        url = normalize_content_image_url(item.get("url"))
        if not url:
            continue
        row: dict[str, str] = {"type": "image", "url": url}
        alt = str(item.get("alt") or "").strip()[:_MAX_ALT_LEN]
        if alt:
            row["alt"] = alt
        src = normalize_http_url(item.get("source_url"))
        if src:
            row["source_url"] = src
        cleaned.append(row)
    return cleaned


def show_images(items: Any) -> str:
    """Return image_gallery JSON, or ERROR: when no valid http(s) URL remains."""
    cleaned = preview_show_images_items(items)
    if not cleaned:
        return UNCONFIGURED_TOOL_TEXT
    return json.dumps({"type": "image_gallery", "images": cleaned}, ensure_ascii=False)
