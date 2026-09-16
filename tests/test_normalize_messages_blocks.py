#!/usr/bin/env python3
"""Tests that _normalize_messages keeps sanitized assistant blocks.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.studio.session_manager import SessionManager


def test_normalize_keeps_image_block_id_and_path() -> None:
    manager = SessionManager()
    rows = manager._normalize_messages(
        [
            {
                "id": "a1",
                "role": "assistant",
                "content": "这是一只猫",
                "blocks": [
                    {
                        "type": "image",
                        "id": "img-call1",
                        "status": "ready",
                        "path": "/Users/me/.agenticx/sessions/s1/generated/a.png",
                        "mime": "image/png",
                        "alt": "cat",
                    }
                ],
            }
        ]
    )
    blocks = rows[0]["blocks"]
    assert blocks[0]["id"] == "img-call1"
    assert blocks[0]["path"] == "/Users/me/.agenticx/sessions/s1/generated/a.png"
    assert blocks[0]["type"] == "image"


def test_normalize_strips_data_url_from_image_block() -> None:
    manager = SessionManager()
    rows = manager._normalize_messages(
        [
            {
                "role": "assistant",
                "content": "图",
                "blocks": [
                    {
                        "type": "image",
                        "id": "img-x",
                        "status": "ready",
                        "path": "/tmp/ok.png",
                        "url": "data:image/png;base64," + ("A" * 200),
                    }
                ],
            }
        ]
    )
    dumped = str(rows[0])
    assert "data:image" not in dumped
    assert rows[0]["blocks"][0]["path"] == "/tmp/ok.png"


def test_normalize_keeps_https_url_and_source_url() -> None:
    manager = SessionManager()
    rows = manager._normalize_messages(
        [
            {
                "role": "assistant",
                "content": "搜到了",
                "blocks": [
                    {
                        "type": "image",
                        "id": "img-call1-0",
                        "status": "ready",
                        "url": "https://cdn.example/a.jpg",
                        "source_url": "https://example.com/gallery",
                        "kind": "remote",
                    }
                ],
            }
        ]
    )
    block = rows[0]["blocks"][0]
    assert block["url"] == "https://cdn.example/a.jpg"
    assert block["source_url"] == "https://example.com/gallery"
    assert block["kind"] == "remote"


def test_normalize_drops_file_url_from_image_block() -> None:
    manager = SessionManager()
    rows = manager._normalize_messages(
        [
            {
                "role": "assistant",
                "content": "图",
                "blocks": [
                    {
                        "type": "image",
                        "id": "img-x",
                        "status": "ready",
                        "path": "/tmp/ok.png",
                        "url": "file:///tmp/x.png",
                    }
                ],
            }
        ]
    )
    block = rows[0]["blocks"][0]
    assert "url" not in block
    assert block["path"] == "/tmp/ok.png"


def test_normalize_legacy_message_field_set_unchanged() -> None:
    manager = SessionManager()
    rows = manager._normalize_messages(
        [{"id": "old", "role": "assistant", "content": "hello"}]
    )
    assert "blocks" not in rows[0]
    assert rows[0]["content"] == "hello"
    assert rows[0]["role"] == "assistant"
