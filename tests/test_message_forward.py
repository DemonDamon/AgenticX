#!/usr/bin/env python3
"""Tests for merge-forward card construction.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.studio.message_forward import (
    build_forward_entry,
    build_forward_model_content,
    forward_note_already_on_tail,
    normalize_forward_items,
)


def test_normalize_forward_items_keeps_attachments() -> None:
    items = normalize_forward_items(
        [
            {
                "sender": "我",
                "role": "user",
                "content": "看这张图",
                "attachments": [
                    {
                        "name": "image.png",
                        "mime_type": "image/png",
                        "size": 12,
                        "data_url": "data:image/png;base64,aaa",
                    }
                ],
            }
        ]
    )
    assert len(items) == 1
    assert items[0]["content"] == "看这张图"
    assert items[0]["attachments"][0]["name"] == "image.png"
    assert items[0]["attachments"][0]["data_url"].startswith("data:image/png")


def test_normalize_forward_items_allows_attachment_only() -> None:
    items = normalize_forward_items(
        [
            {
                "sender": "我",
                "role": "user",
                "content": "",
                "attachments": [
                    {
                        "name": "report.pdf",
                        "mime_type": "application/pdf",
                        "size": 100,
                        "source_path": "/tmp/report.pdf",
                    }
                ],
            }
        ]
    )
    assert len(items) == 1
    assert "report.pdf" in items[0]["content"]
    assert items[0]["attachments"][0]["source_path"] == "/tmp/report.pdf"


def test_build_forward_model_content_includes_full_transcript_and_attachments() -> None:
    content = build_forward_model_content(
        source_name="会话A",
        items=[
            {
                "sender": "我",
                "role": "user",
                "content": "第一句",
                "attachments": [
                    {"name": "image.png", "mime_type": "image/png", "size": 1},
                ],
            },
            {
                "sender": "Near",
                "role": "assistant",
                "content": "第二句很长也不应被截断",
            },
        ],
        follow_up_note="请阅读刚转发的聊天记录并继续回复。",
    )
    assert "【转发的聊天记录 · 来自 会话A】" in content
    assert "我: 第一句" in content
    assert "[图片附件: image.png]" in content
    assert "Near: 第二句很长也不应被截断" in content
    assert "附加说明: 请阅读刚转发的聊天记录并继续回复。" in content


def test_build_forward_entry_mirrors_attachments_on_card() -> None:
    entry = build_forward_entry(
        source_session_id="src-1",
        source_name="源会话",
        items=[
            {
                "sender": "我",
                "role": "user",
                "content": "见图",
                "attachments": [
                    {
                        "name": "image.png",
                        "mime_type": "image/png",
                        "size": 3,
                        "data_url": "data:image/png;base64,abc",
                    }
                ],
            }
        ],
        follow_up_note="请继续",
        target_session_id="",  # skip materialize to disk in unit test
    )
    assert entry["role"] == "user"
    assert "见图" in entry["content"]
    assert entry["forwarded_history"]["note"] == "请继续"
    assert entry["attachments"][0]["data_url"].startswith("data:image/png")


def test_forward_note_already_on_tail() -> None:
    note = "请阅读刚转发的聊天记录并继续回复。"
    history = [
        {
            "role": "user",
            "content": f"我: hi\n附加说明: {note}",
            "forwarded_history": {"note": note, "items": []},
        }
    ]
    assert forward_note_already_on_tail(history, note) is True
    assert forward_note_already_on_tail(history, "别的说明") is False
    assert forward_note_already_on_tail([{"role": "user", "content": "普通消息"}], note) is False
