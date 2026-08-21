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
_MAX_URL_LEN = 2048
_MAX_ALT_LEN = 80
# Listing-page thumbs such as `.thumb.400_0.jpeg` / `.thumb.100_100_c.jpg`.
_THUMB_SUFFIX_RE = re.compile(
    r"\.thumb\.\d+_\d+(?:_[A-Za-z0-9]+)?\.(jpe?g|png|webp|gif)$",
    re.IGNORECASE,
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


def normalize_http_url(raw: Any) -> str:
    url = str(raw or "").strip()
    if len(url) > _MAX_URL_LEN:
        return ""
    if url.startswith("data:"):
        return ""
    if not (url.startswith("http://") or url.startswith("https://")):
        return ""
    return upgrade_remote_image_url(url)


def preview_show_images_items(items: Any) -> List[dict[str, str]]:
    """Same cleaning as show_images(), without JSON wrapping."""
    cleaned: List[dict[str, str]] = []
    raw_items: Iterable[Any] = items if isinstance(items, list) else []
    for item in list(raw_items)[:_MAX_ITEMS]:
        if not isinstance(item, dict):
            continue
        url = normalize_http_url(item.get("url"))
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
