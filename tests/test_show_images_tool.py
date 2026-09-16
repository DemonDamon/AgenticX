#!/usr/bin/env python3
"""Tests for show_images studio tool.

Author: Damon Li
"""

from __future__ import annotations

import json

from agenticx.tools.show_images import show_images


def test_two_https_urls_return_gallery_json() -> None:
    raw = show_images(
        [
            {
                "url": "https://example.com/a.jpg",
                "alt": "西装背头造型",
                "source_url": "https://example.com/gallery",
            },
            {
                "url": "https://cdn.example.com/b.png",
                "alt": "舞台造型",
            },
        ]
    )
    payload = json.loads(raw)
    assert payload["type"] == "image_gallery"
    assert len(payload["images"]) == 2
    assert payload["images"][0]["url"] == "https://example.com/a.jpg"
    assert payload["images"][0]["alt"] == "西装背头造型"
    assert payload["images"][0]["source_url"] == "https://example.com/gallery"
    assert payload["images"][1]["url"] == "https://cdn.example.com/b.png"
    assert "base64" not in raw


def test_data_url_dropped_and_all_invalid_errors() -> None:
    raw = show_images(
        [
            {"url": "data:image/png;base64,AAAA"},
            {"url": "file:///tmp/x.png"},
            {"url": "   "},
        ]
    )
    assert raw.startswith("ERROR:")
    assert "http(s) image URL" in raw
    assert "AAAA" not in raw or raw.startswith("ERROR:")
    assert "base64" not in raw.split("ERROR:", 1)[-1] or "base64" not in json.dumps(
        {"type": "image_gallery"}
    )


def test_listing_thumb_url_upgraded_to_original() -> None:
    raw = show_images(
        [
            {
                "url": "https://c-ssl.dtstatic.com/uploads/blog/202410/15/gVS3yGBiQdnmeE.thumb.400_0.jpeg",
                "source_url": "https://www.duitang.com/blogs/tag/?name=x",
            },
            {
                "url": "https://c-ssl.dtstatic.com/uploads/blog/202110/07/20211007114523_fbd7f.thumb.400_0.jpg",
            },
        ]
    )
    payload = json.loads(raw)
    assert payload["images"][0]["url"] == (
        "https://c-ssl.dtstatic.com/uploads/blog/202410/15/gVS3yGBiQdnmeE.jpeg"
    )
    assert payload["images"][0]["source_url"] == "https://www.duitang.com/blogs/tag/?name=x"
    assert payload["images"][1]["url"] == (
        "https://c-ssl.dtstatic.com/uploads/blog/202110/07/20211007114523_fbd7f.jpg"
    )
    assert "thumb" not in payload["images"][0]["url"]
    assert "thumb" not in payload["images"][1]["url"]


def test_ops_banner_and_avatar_urls_dropped() -> None:
    raw = show_images(
        [
            {
                "url": "https://a-ssl.dtstatic.com/uploads/ops/202411/06/WXS7Bx1OfQDJYVX.jpeg",
                "alt": "运营位",
            },
            {
                "url": "https://c-ssl.dtstatic.com/uploads/avatar/202303/15/x.thumb.100_100_c.jpeg",
            },
            {
                "url": "https://c-ssl.dtstatic.com/uploads/blog/202410/15/gVS3yGBiQdnmeE.thumb.400_0.jpeg",
                "alt": "写真",
            },
        ]
    )
    payload = json.loads(raw)
    assert len(payload["images"]) == 1
    assert payload["images"][0]["url"] == (
        "https://c-ssl.dtstatic.com/uploads/blog/202410/15/gVS3yGBiQdnmeE.jpeg"
    )
    assert payload["images"][0]["alt"] == "写真"
    assert all("/ops/" not in img["url"] for img in payload["images"])
    assert all("/avatar/" not in img["url"] for img in payload["images"])


def test_junk_first_items_do_not_block_later_photos() -> None:
    items = [{"url": f"https://cdn.example.com/uploads/ops/{i}.jpg"} for i in range(6)]
    items.append({"url": "https://cdn.example.com/uploads/blog/keep.jpg"})
    raw = show_images(items)
    payload = json.loads(raw)
    assert len(payload["images"]) == 1
    assert payload["images"][0]["url"] == "https://cdn.example.com/uploads/blog/keep.jpg"


def test_seventh_item_truncated() -> None:
    items = [{"url": f"https://example.com/{i}.jpg"} for i in range(7)]
    raw = show_images(items)
    payload = json.loads(raw)
    assert payload["type"] == "image_gallery"
    assert len(payload["images"]) == 6
    assert payload["images"][-1]["url"] == "https://example.com/5.jpg"
    assert "base64" not in raw
