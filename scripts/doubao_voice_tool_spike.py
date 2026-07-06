#!/usr/bin/env python3
"""Spike script for Doubao realtime function/tool calling capability.

Author: Damon Li
"""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from typing import Any

import websockets

DOUBAO_REALTIME_WS = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue"


def _read_u32_be(buf: bytes, offset: int) -> int:
    return int.from_bytes(buf[offset : offset + 4], "big", signed=False)


def _write_u32_be(val: int) -> bytes:
    return int(val).to_bytes(4, "big", signed=False)


def _header(message_type: int, serialization: int) -> bytes:
    return bytes([(0b0001 << 4) | 0b0001, ((message_type & 0x0F) << 4) | 0b0100, ((serialization & 0x0F) << 4), 0x00])


def _build_frame(event: int, payload: dict[str, Any], *, session_id: str | None = None) -> bytes:
    msg_type = 0b0001
    ser = 0b0001
    payload_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    frame = bytearray()
    frame.extend(_header(msg_type, ser))
    frame.extend(_write_u32_be(event))
    if session_id:
        sid = session_id.encode("utf-8")
        frame.extend(_write_u32_be(len(sid)))
        frame.extend(sid)
    frame.extend(_write_u32_be(len(payload_bytes)))
    frame.extend(payload_bytes)
    return bytes(frame)


def _decode_event(raw: bytes) -> tuple[int | None, dict[str, Any] | None]:
    if len(raw) < 8:
        return None, None
    header_size = (raw[0] & 0x0F) * 4 or 4
    offset = header_size
    flags = raw[1] & 0x0F
    ser = (raw[2] >> 4) & 0x0F
    if flags & 0b0001 or flags & 0b0010:
        offset += 4
    event = None
    if flags & 0b0100 and offset + 4 <= len(raw):
        event = _read_u32_be(raw, offset)
        offset += 4
    if ser != 0b0001:
        return event, None
    # best effort optional session id skip
    if offset + 8 <= len(raw):
        size = _read_u32_be(raw, offset)
        s = offset + 4
        e = s + size
        if 0 < size <= 128 and e + 4 <= len(raw):
            try:
                marker = raw[s:e].decode("utf-8")
            except UnicodeDecodeError:
                marker = ""
            if marker and all(ch.isalnum() or ch in "._:-" for ch in marker):
                offset = e
    if offset + 4 > len(raw):
        return event, None
    payload_size = _read_u32_be(raw, offset)
    start = offset + 4
    end = start + payload_size
    if payload_size < 0 or end > len(raw):
        return event, None
    if payload_size == 0:
        return event, {}
    try:
        payload = json.loads(raw[start:end].decode("utf-8"))
    except Exception:
        payload = None
    return event, payload if isinstance(payload, dict) else None


async def run_spike(args: argparse.Namespace) -> int:
    session_id = str(uuid.uuid4())
    headers = [
        ("X-Api-App-Key", args.api_app_key),
        ("X-Api-Access-Key", args.access_key),
        ("X-Api-App-ID", args.app_id),
        ("X-Api-Resource-Id", args.resource_id),
        ("X-Api-Connect-Id", str(uuid.uuid4())),
    ]
    if args.secret_key:
        headers.append(("X-Api-Secret-Key", args.secret_key))

    async with websockets.connect(DOUBAO_REALTIME_WS, additional_headers=headers, max_size=None) as ws:
        await ws.send(_build_frame(1, {}))
        start_session = {
            "asr": {"audio_info": {"format": "pcm", "sample_rate": 16000, "channel": 1}, "extra": {}},
            "tts": {
                "speaker": args.voice_type,
                "audio_config": {"channel": 1, "format": "pcm_s16le", "sample_rate": 24000},
                "extra": {},
            },
            "dialog": {
                "bot_name": "Machi",
                "extra": {"strict_audit": False, "model": args.model},
                "system_role": (
                    "You are testing tool/function calling support. "
                    "If tool calls are supported, call weather_lookup with city=Beijing."
                ),
            },
            # Speculative field for protocol probing.
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "weather_lookup",
                        "description": "Look up weather for a city",
                        "parameters": {
                            "type": "object",
                            "properties": {"city": {"type": "string"}},
                            "required": ["city"],
                            "additionalProperties": False,
                        },
                    },
                }
            ],
        }
        await ws.send(_build_frame(100, start_session, session_id=session_id))
        print("sent StartConnection + StartSession with synthetic tools schema")
        print("listening for 15 seconds...")
        deadline = asyncio.get_running_loop().time() + 15.0
        saw_tool_shape = False
        while asyncio.get_running_loop().time() < deadline:
            timeout = max(0.1, deadline - asyncio.get_running_loop().time())
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=timeout)
            except asyncio.TimeoutError:
                continue
            if not isinstance(msg, (bytes, bytearray)):
                continue
            event, payload = _decode_event(bytes(msg))
            print(f"event={event} payload={json.dumps(payload, ensure_ascii=False)[:320] if payload else None}")
            text = json.dumps(payload or {}, ensure_ascii=False).lower()
            if "tool" in text or "function" in text or "call_id" in text:
                saw_tool_shape = True
        await ws.send(_build_frame(102, {}, session_id=session_id))
        await ws.send(_build_frame(2, {}))
        if saw_tool_shape:
            print("tool-like payload detected in upstream responses")
            return 0
        print("no tool/function payload observed")
        return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe Doubao realtime tool calling capability")
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--access-key", required=True)
    parser.add_argument("--secret-key", default="")
    parser.add_argument("--api-app-key", default="PlgvMymc7f3tQnJ6")
    parser.add_argument("--resource-id", default="volc.speech.dialog")
    parser.add_argument("--model", default="1.2.1.1")
    parser.add_argument("--voice-type", default="zh_female_vv_jupiter_bigtts")
    args = parser.parse_args()
    return asyncio.run(run_spike(args))


if __name__ == "__main__":
    raise SystemExit(main())
