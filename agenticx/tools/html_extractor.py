#!/usr/bin/env python3
"""Lightweight HTML text and image URL extraction using stdlib html.parser.

Author: Damon Li
"""

from __future__ import annotations

from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse


class _HtmlExtractParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.title = ""
        self.og_title = ""
        self.description = ""
        self.images: list[str] = []
        self._seen_images: set[str] = set()
        self._text_parts: list[str] = []
        self._skip_depth = 0
        self._in_title = False
        self._title_buf: list[str] = []
        self._current_meta: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if tag_l in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag_l == "title":
            self._in_title = True
            self._title_buf = []
        elif tag_l == "meta":
            self._handle_meta(attr_map)
        elif tag_l == "img":
            src = attr_map.get("src", "").strip()
            if src:
                self._add_image(src)
        elif tag_l == "source":
            srcset = attr_map.get("srcset", "").strip()
            if srcset:
                first = srcset.split(",")[0].strip().split()[0]
                if first:
                    self._add_image(first)

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        if tag_l in {"script", "style", "noscript"}:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag_l == "title" and self._in_title:
            self._in_title = False
            if not self.title:
                self.title = "".join(self._title_buf).strip()
        elif tag_l in {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr"}:
            self._text_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = data.strip()
        if not text:
            return
        if self._in_title:
            self._title_buf.append(text)
            return
        self._text_parts.append(text)

    def _handle_meta(self, attr_map: dict[str, str]) -> None:
        prop = attr_map.get("property", "").strip().lower()
        name = attr_map.get("name", "").strip().lower()
        content = attr_map.get("content", "").strip()
        if not content:
            return
        if prop == "og:title" and not self.og_title:
            self.og_title = content
        elif prop == "og:image":
            self._add_image(content)
        elif name == "description" and not self.description:
            self.description = content

    def _add_image(self, raw_src: str) -> None:
        src = raw_src.strip()
        if not src or src.startswith("data:"):
            return
        absolute = urljoin(self.base_url, src)
        parsed = urlparse(absolute)
        if parsed.scheme not in {"http", "https"}:
            return
        if absolute in self._seen_images:
            return
        self._seen_images.add(absolute)
        self.images.append(absolute)


def extract_readable_text(html: str, base_url: str) -> dict[str, Any]:
    """Extract title, plain text, image URLs, and canonical URL from HTML."""
    parser = _HtmlExtractParser(base_url)
    parser.feed(html or "")
    parser.close()
    title = parser.og_title or parser.title
    text = "\n".join(part for part in parser._text_parts if part).strip()
    text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    canonical_url = base_url
    return {
        "title": title,
        "text": text,
        "images": list(parser.images),
        "canonical_url": canonical_url,
        "description": parser.description,
    }
