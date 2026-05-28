#!/usr/bin/env python3
"""Volcengine bigmodel streaming ASR (sauc/bigmodel) binary wire helpers.

Reference: https://www.volcengine.com/docs/6561/1354869

Author: Damon Li
"""

from __future__ import annotations

import gzip
import json
import struct
from typing import Any

PROTOCOL_VERSION = 0b0001
DEFAULT_HEADER_SIZE = 0b0001

CLIENT_FULL_REQUEST = 0b0001
CLIENT_AUDIO_ONLY_REQUEST = 0b0010
SERVER_FULL_RESPONSE = 0b1001
SERVER_ERROR_RESPONSE = 0b1111

NO_SEQUENCE = 0b0000
NEG_SEQUENCE = 0b0010

NO_SERIALIZATION = 0b0000
JSON_SERIALIZATION = 0b0001

NO_COMPRESSION = 0b0000
GZIP_COMPRESSION = 0b0001

DOUBAO_SAUC_WS = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
DOUBAO_SAUC_RESOURCE_ID = "volc.bigasr.sauc.duration"


def _generate_header(
    *,
    message_type: int,
    message_type_specific_flags: int = NO_SEQUENCE,
    serial_method: int = JSON_SERIALIZATION,
    compression_type: int = GZIP_COMPRESSION,
) -> bytes:
    header = bytearray()
    header.append((PROTOCOL_VERSION << 4) | DEFAULT_HEADER_SIZE)
    header.append((message_type << 4) | (message_type_specific_flags & 0x0F))
    header.append((serial_method << 4) | (compression_type & 0x0F))
    header.append(0x00)
    return bytes(header)


def build_full_client_request(payload: dict[str, Any]) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(raw)
    header = _generate_header(
        message_type=CLIENT_FULL_REQUEST,
        serial_method=JSON_SERIALIZATION,
        compression_type=GZIP_COMPRESSION,
    )
    return header + struct.pack(">I", len(compressed)) + compressed


def build_default_start_payload(*, uid: str, language: str = "zh-CN") -> dict[str, Any]:
    audio: dict[str, Any] = {
        "format": "pcm",
        "codec": "raw",
        "rate": 16000,
        "bits": 16,
        "channel": 1,
    }
    if language.strip():
        audio["language"] = language.strip()
    return {
        "user": {"uid": uid or "agx"},
        "audio": audio,
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
        },
    }


def build_audio_only_request(pcm: bytes, *, is_last: bool = False) -> bytes:
    compressed = gzip.compress(pcm or b"")
    flags = NEG_SEQUENCE if is_last else NO_SEQUENCE
    header = _generate_header(
        message_type=CLIENT_AUDIO_ONLY_REQUEST,
        message_type_specific_flags=flags,
        serial_method=NO_SERIALIZATION,
        compression_type=GZIP_COMPRESSION,
    )
    return header + struct.pack(">I", len(compressed)) + compressed


def _decompress_payload(payload: bytes, compression: int) -> bytes:
    if compression == GZIP_COMPRESSION:
        return gzip.decompress(payload)
    return payload


def parse_server_frame(data: bytes) -> dict[str, Any]:
    if len(data) < 4:
        return {"kind": "invalid"}

    header_size = (data[0] & 0x0F) * 4 or 4
    message_type = (data[1] >> 4) & 0x0F
    flags = data[1] & 0x0F
    serialization = (data[2] >> 4) & 0x0F
    compression = data[2] & 0x0F
    offset = header_size

    if message_type == SERVER_ERROR_RESPONSE:
        if offset + 8 > len(data):
            return {"kind": "error", "code": None, "message": "invalid error frame"}
        code = struct.unpack(">I", data[offset : offset + 4])[0]
        offset += 4
        size = struct.unpack(">I", data[offset : offset + 4])[0]
        offset += 4
        msg = data[offset : offset + size].decode("utf-8", errors="replace")
        return {"kind": "error", "code": code, "message": msg}

    if flags & 0b0001 or flags & 0b0011:
        if offset + 4 > len(data):
            return {"kind": "invalid"}
        offset += 4

    if offset + 4 > len(data):
        return {"kind": "invalid"}
    payload_size = struct.unpack(">I", data[offset : offset + 4])[0]
    offset += 4
    if payload_size < 0 or offset + payload_size > len(data):
        return {"kind": "invalid"}
    payload = data[offset : offset + payload_size]
    payload = _decompress_payload(payload, compression)

    if message_type != SERVER_FULL_RESPONSE:
        return {"kind": "ignore"}

    text = ""
    raw: dict[str, Any] | None = None
    if serialization == JSON_SERIALIZATION and payload:
        try:
            parsed = json.loads(payload.decode("utf-8"))
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            raw = parsed
            result = parsed.get("result")
            if isinstance(result, dict):
                text = str(result.get("text") or "").strip()
            elif isinstance(result, list):
                parts: list[str] = []
                for item in result:
                    if isinstance(item, dict):
                        chunk = str(item.get("text") or "").strip()
                        if chunk:
                            parts.append(chunk)
                text = " ".join(parts).strip()

    is_last = bool(flags & 0b0010 or flags & 0b0011)
    return {
        "kind": "response",
        "text": text,
        "is_last": is_last,
        "raw": raw,
    }


def extract_transcript_text(raw: dict[str, Any] | None) -> str:
    if not isinstance(raw, dict):
        return ""
    result = raw.get("result")
    if isinstance(result, dict):
        return str(result.get("text") or "").strip()
    return ""
