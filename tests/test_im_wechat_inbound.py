#!/usr/bin/env python3
"""Inbound WeChat image helpers."""

from __future__ import annotations

from pathlib import Path

from agenticx.gateway.im_wechat_inbound import (
    IMAGE_DOWNLOAD_FAILED_HINT,
    IMAGE_ONLY_USER_PROMPT,
    MERGE_WAIT_BOTH_SEC,
    MERGE_WAIT_CAPTION_SEC,
    MERGE_WAIT_IMAGE_SEC,
    MERGE_WAIT_TEXT_SEC,
    UNSEEN_IMAGE_IM_REPLY,
    UNSEEN_IMAGE_WITH_FILE_HINT,
    InboundCompanionHold,
    InboundMergeBatch,
    compose_wechat_user_input,
    image_input_from_path,
    inbound_merge_delay_sec,
    is_inbound_media_item,
    looks_like_media_caption,
    parse_sse_data_blocks,
    should_short_circuit_unseen_images,
    sniff_image_mime,
    split_inbound_media,
)


def test_is_inbound_media_item_skips_text() -> None:
    assert not is_inbound_media_item({"type": 1, "eqp": "x", "text": "hi"})
    assert is_inbound_media_item({"type": 2})
    assert is_inbound_media_item({"type": 2, "eqp": "eqp1"})
    assert is_inbound_media_item({"type": 2, "url": "https://cdn.example/full"})


def test_sniff_image_mime() -> None:
    assert sniff_image_mime(b"\xff\xd8\xff\xdbabc") == "image/jpeg"
    assert sniff_image_mime(b"\x89PNG\r\n\x1a\nrest") == "image/png"
    assert sniff_image_mime(b"not-an-image") == ""


def test_image_input_from_path(tmp_path: Path) -> None:
    img = tmp_path / "paper.jpg"
    raw = b"\xff\xd8\xff" + b"jpeg-bytes"
    img.write_bytes(raw)
    item = image_input_from_path(img)
    assert item is not None
    assert item["mime_type"] == "image/jpeg"
    assert item["name"] == "paper.jpg"
    assert item["size"] == len(raw)
    assert item["data_url"].startswith("data:image/jpeg;base64,")


def test_split_inbound_media_keeps_non_images(tmp_path: Path) -> None:
    img = tmp_path / "a.jpg"
    img.write_bytes(b"\xff\xd8\xff" + b"x")
    doc = tmp_path / "a.pdf"
    doc.write_bytes(b"%PDF-1.4")
    images, leftover = split_inbound_media([str(img), str(doc)])
    assert len(images) == 1
    assert leftover == [str(doc)]


def test_compose_wechat_user_input_keeps_user_text_clean() -> None:
    image_only = compose_wechat_user_input("", [], has_images=True)
    assert image_only == IMAGE_ONLY_USER_PROMPT
    with_caption = compose_wechat_user_input("把这个发给我", [], has_images=True)
    assert with_caption == "把这个发给我"
    with_file = compose_wechat_user_input("", ["/tmp/a.pdf"], has_images=False)
    assert with_file == "[附件] /tmp/a.pdf"
    mixed = compose_wechat_user_input(
        "看看这个",
        ["/tmp/a.pdf"],
        has_images=True,
        images_unseen=True,
    )
    assert mixed.startswith("看看这个\n[附件] /tmp/a.pdf")
    assert UNSEEN_IMAGE_WITH_FILE_HINT in mixed
    assert compose_wechat_user_input("只是问一句", [], has_images=False) == "只是问一句"
    assert compose_wechat_user_input(
        "把这个发给我", [], has_images=False, image_failed=True
    ) == f"把这个发给我\n{IMAGE_DOWNLOAD_FAILED_HINT}"


def test_compose_wechat_user_input_does_not_name_a_specific_task() -> None:
    text = compose_wechat_user_input("看看这个", [], has_images=True)
    assert text == "看看这个"
    assert "论文" not in text
    assert "壁纸" not in UNSEEN_IMAGE_IM_REPLY
    assert "论文" not in UNSEEN_IMAGE_IM_REPLY


def test_should_short_circuit_unseen_images_only_when_model_cannot_see() -> None:
    assert should_short_circuit_unseen_images(
        has_images=True, has_readable_files=False, model_can_see=False
    )
    assert not should_short_circuit_unseen_images(
        has_images=True, has_readable_files=False, model_can_see=True
    )
    assert not should_short_circuit_unseen_images(
        has_images=True, has_readable_files=False, model_can_see=None
    )
    assert not should_short_circuit_unseen_images(
        has_images=True, has_readable_files=True, model_can_see=False
    )
    assert not should_short_circuit_unseen_images(
        has_images=False, has_readable_files=False, model_can_see=False
    )


def test_companion_hold_returns_recent_text_to_late_image() -> None:
    hold = InboundCompanionHold(ttl_sec=30.0)
    hold.remember_text("wx-user", "把这个论文发给我", now=100.0)
    assert hold.take_text("wx-user", now=111.0) == "把这个论文发给我"
    assert hold.take_text("wx-user", now=112.0) == ""


def test_companion_hold_returns_recent_media_to_late_text() -> None:
    hold = InboundCompanionHold(ttl_sec=30.0)
    images = [{"name": "paper.jpg", "data_url": "data:image/jpeg;base64,Zg=="}]
    hold.remember_media("wx-user", images, ["/tmp/a.pdf"], now=100.0)
    got_images, leftover = hold.take_media("wx-user", now=105.0)
    assert got_images == images
    assert leftover == ["/tmp/a.pdf"]
    assert hold.take_media("wx-user", now=106.0) == ([], [])


def test_companion_hold_expires() -> None:
    hold = InboundCompanionHold(ttl_sec=10.0)
    hold.remember_text("wx-user", "把这个论文发给我", now=100.0)
    hold.remember_media("wx-user", [{"name": "a.jpg"}], [], now=100.0)
    assert hold.take_text("wx-user", now=111.0) == ""
    assert hold.take_media("wx-user", now=111.0) == ([], [])


def test_parse_sse_data_blocks_handles_crlf_and_multiline() -> None:
    buf = (
        'data: {"type":"message","text":"a"}\r\n\r\n'
        'data: {"type":"message","text":"b"}\n\n'
        "data: {\"type\":\"message\",\"text\":\"c"
    )
    events, rest = parse_sse_data_blocks(buf)
    assert events == [
        '{"type":"message","text":"a"}',
        '{"type":"message","text":"b"}',
    ]
    assert rest.startswith("data: ")


def test_looks_like_media_caption() -> None:
    assert looks_like_media_caption("把这个论文发给我")
    assert looks_like_media_caption("如图，帮我看看")
    assert looks_like_media_caption("这张截图是什么")
    assert not looks_like_media_caption("明天天气怎么样")
    assert not looks_like_media_caption("hello")


def test_inbound_merge_delay_waits_for_companion() -> None:
    assert inbound_merge_delay_sec(
        has_text=True, has_media=True, caption_like=True
    ) == MERGE_WAIT_BOTH_SEC
    assert inbound_merge_delay_sec(
        has_text=False, has_media=True, caption_like=False
    ) == MERGE_WAIT_IMAGE_SEC
    assert inbound_merge_delay_sec(
        has_text=True, has_media=False, caption_like=True
    ) == MERGE_WAIT_CAPTION_SEC
    assert inbound_merge_delay_sec(
        has_text=True, has_media=False, caption_like=False
    ) == MERGE_WAIT_TEXT_SEC


def test_merge_batch_absorbs_text_then_image() -> None:
    first = InboundMergeBatch(sender="wx-user", sidecar_url="http://s", text="把这个论文发给我")
    second = InboundMergeBatch(
        sender="wx-user",
        sidecar_url="http://s",
        image_inputs=[{"name": "a.jpg", "data_url": "data:image/jpeg;base64,Zg=="}],
        context_token="ctx-2",
    )
    first.absorb(second)
    assert first.text == "把这个论文发给我"
    assert len(first.image_inputs) == 1
    assert first.context_token == "ctx-2"
    assert first.delay_sec() == MERGE_WAIT_BOTH_SEC
