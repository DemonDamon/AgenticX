#!/usr/bin/env python3
"""Smoke tests for Volcengine sauc/bigmodel wire helpers."""

from __future__ import annotations

import gzip
import json
import struct

from agenticx.studio.doubao_sauc_asr import (
    build_audio_only_request,
    build_default_start_payload,
    build_full_client_request,
    extract_transcript_text,
    parse_server_frame,
)


def _build_server_response(payload: dict, *, is_last: bool = False) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(raw)
    flags = 0b0010 if is_last else 0b0000
    header = bytes(
        [
            0x11,
            (0b1001 << 4) | (flags & 0x0F),
            (0b0001 << 4) | 0b0001,
            0x00,
        ]
    )
    seq = struct.pack(">I", 1) if flags else b""
    size = struct.pack(">I", len(compressed))
    return header + seq + size + compressed


def test_build_full_client_request_roundtrip_shape() -> None:
    payload = build_default_start_payload(uid="agx-test", language="zh-CN")
    frame = build_full_client_request(payload)
    assert len(frame) > 12
    assert frame[0] >> 4 == 0b0001
    assert (frame[1] >> 4) & 0x0F == 0b0001


def test_build_audio_only_request_last_flag() -> None:
    normal = build_audio_only_request(b"\x00\x01", is_last=False)
    last = build_audio_only_request(b"", is_last=True)
    assert (normal[1] & 0x0F) != (last[1] & 0x0F)


def test_parse_server_frame_extracts_text_and_final() -> None:
    payload = {"result": {"text": "你好世界"}}
    frame = _build_server_response(payload, is_last=False)
    parsed = parse_server_frame(frame)
    assert parsed["kind"] == "response"
    assert parsed["text"] == "你好世界"
    assert parsed["is_last"] is False

    final_frame = _build_server_response(payload, is_last=True)
    final_parsed = parse_server_frame(final_frame)
    assert final_parsed["is_last"] is True


def test_extract_transcript_text_from_raw() -> None:
    raw = {"result": {"text": "测试"}}
    assert extract_transcript_text(raw) == "测试"
    assert extract_transcript_text(None) == ""
