#!/usr/bin/env python3
"""Voice focus mode endpoints: settings, realtime bridges, and tool-call proxy.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import copy
import json
import logging
import os
import time
import uuid
from typing import Any, Callable

import httpx
import websockets
from fastapi import FastAPI, File, Header, HTTPException, UploadFile, WebSocket
from fastapi.responses import Response

from agenticx.studio.doubao_sauc_asr import (
    DOUBAO_SAUC_RESOURCE_ID,
    DOUBAO_SAUC_WS,
    build_audio_only_request,
    build_default_start_payload,
    build_full_client_request,
    parse_server_frame,
)
from agenticx.cli.agent_tools import STUDIO_TOOLS, dispatch_tool_async
from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.confirm import ConfirmGate
from agenticx.studio.session_manager import SessionManager

logger = logging.getLogger(__name__)

DOUBAO_REALTIME_WS = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue"
DOUBAO_FLASH_RECOGNIZE_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"
DOUBAO_FLASH_RESOURCE_ID = "volc.bigasr.auc_turbo"
DEFAULT_DOUBAO_APP_KEY = "PlgvMymc7f3tQnJ6"
VOICE_DEFAULT_TOOL_ALLOWLIST = {
    "knowledge_search",
    "web_search",
    "liteparse",
    "file_read",
    "list_files",
    "session_search",
    "mcp_call",
}


class VoiceConfirmGate(ConfirmGate):
    """Deny interactive confirmations in phone mode to avoid blocked turns."""

    async def request_confirm(self, question: str, context: dict[str, Any] | None = None) -> bool:
        _ = question, context
        return False


def _read_u32_be(buf: bytes, offset: int) -> int:
    return int.from_bytes(buf[offset : offset + 4], "big", signed=False)


def _decode_doubao_event_for_log(data: bytes) -> tuple[int | None, dict[str, Any] | None]:
    """Best-effort decode for server-side observability only.

    The browser has the authoritative decoder. This helper is intentionally
    tolerant because some upstream events may omit the session id field even
    when they are listed as session events.
    """

    if len(data) < 8:
        return None, None
    header_size = (data[0] & 0x0F) * 4 or 4
    message_type = (data[1] >> 4) & 0x0F
    flags = data[1] & 0x0F
    serialization = (data[2] >> 4) & 0x0F
    offset = header_size

    if message_type == 0b1111:
        offset += 4
    if flags & 0b0001 or flags & 0b0010:
        offset += 4
    event: int | None = None
    if flags & 0b0100:
        if offset + 4 > len(data):
            return None, None
        event = _read_u32_be(data, offset)
        offset += 4

    candidate_offsets = [offset]
    if event is not None and offset + 8 <= len(data):
        size = _read_u32_be(data, offset)
        start = offset + 4
        end = start + size
        if 0 < size <= 128 and end + 4 <= len(data):
            try:
                marker = data[start:end].decode("utf-8")
            except UnicodeDecodeError:
                marker = ""
            if marker and all(ch.isalnum() or ch in "._:-" for ch in marker):
                candidate_offsets.insert(0, end)

    if serialization != 0b0001:
        return event, None
    for payload_offset in candidate_offsets:
        if payload_offset + 4 > len(data):
            continue
        payload_size = _read_u32_be(data, payload_offset)
        start = payload_offset + 4
        end = start + payload_size
        if payload_size < 0 or end > len(data):
            continue
        try:
            parsed = json.loads(data[start:end].decode("utf-8")) if payload_size else {}
        except Exception:
            continue
        if isinstance(parsed, dict):
            return event, parsed
    return event, None


def _looks_like_masked_secret(val: Any) -> bool:
    """True if value looks like ``ConfigManager._mask`` output or legacy ``***`` placeholder."""
    if not isinstance(val, str):
        return False
    s = val.strip()
    if not s:
        return False
    if s == "****":
        return True
    if "***" in s:
        return True
    parts = s.split("...", 1)
    # _mask produces ``{first4}...{last4}`` when len(value) > 8 (else ``****``)
    return len(parts) == 2 and len(parts[0]) == 4 and len(parts[1]) >= 4


def _sanitize_voice_overlay(overlay: dict[str, Any]) -> dict[str, Any]:
    """Strip destructive YAML merges: ``doubao_realtime: null`` / ``openai_realtime: null`` / nested ``null`` blobs."""

    cleaned = copy.deepcopy(overlay)

    doubao_any = cleaned.get("doubao_realtime")
    if doubao_any is None and "doubao_realtime" in cleaned:
        del cleaned["doubao_realtime"]
    elif isinstance(doubao_any, dict):
        for k, v in list(doubao_any.items()):
            if v is None:
                del doubao_any[k]

    openai_any = cleaned.get("openai_realtime")
    if openai_any is None and "openai_realtime" in cleaned:
        del cleaned["openai_realtime"]
    elif isinstance(openai_any, dict):
        for k, v in list(openai_any.items()):
            if v is None:
                del openai_any[k]

    return cleaned


def _voice_section() -> dict[str, Any]:
    """Read `voice:` from user-global config only.

    Electron spawns ``agx serve`` with ``cwd=os.homedir()`` so **project-relative**
    ``.agenticx/config.yaml`` often resolves to the same file — but CLI users may launch
    serve from a git checkout; a repo-local stub with ``voice:`` keys can incorrectly
    override (or wipe) saved credentials via :func:`ConfigManager._deep_merge`.
    Desktop 语音设置的读写因此必须锚定 ``~/.agenticx/config.yaml``。
    """

    parsed = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
    v = parsed.get("voice")
    return dict(v) if isinstance(v, dict) else {}


def _mask_voice(voice: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(voice)
    oa = out.get("openai_realtime")
    if isinstance(oa, dict) and oa.get("api_key"):
        oa["api_key"] = ConfigManager._mask(str(oa["api_key"]))
    db = out.get("doubao_realtime")
    if isinstance(db, dict):
        if db.get("access_key"):
            db["access_key"] = ConfigManager._mask(str(db["access_key"]))
        if db.get("secret_key"):
            db["secret_key"] = ConfigManager._mask(str(db["secret_key"]))
    return out


def _openai_transcribe_credentials() -> tuple[str, str]:
    """Resolve OpenAI-compatible API key and base URL for chat dictation STT."""

    voice = _voice_section()
    oa = voice.get("openai_realtime") if isinstance(voice.get("openai_realtime"), dict) else {}
    api_key = str(oa.get("api_key") or "").strip()
    if not api_key:
        api_key = str(os.environ.get("OPENAI_API_KEY", "") or "").strip()
    base = str(oa.get("base_url") or "https://api.openai.com").rstrip("/")
    return api_key, base


def _doubao_transcribe_credentials() -> tuple[str, str]:
    """Resolve Doubao/Volcano app id + access key for flash file ASR."""

    voice = _voice_section()
    db = voice.get("doubao_realtime") if isinstance(voice.get("doubao_realtime"), dict) else {}
    app_id = str(db.get("app_id") or "").strip()
    access_key = str(db.get("access_key") or "").strip()
    return app_id, access_key


def _resolve_transcribe_provider() -> str:
    """Pick chat dictation backend: openai_whisper | doubao_flash | empty."""

    voice = _voice_section()
    flags = _voice_configured_flags(voice)
    provider = flags["provider"]
    openai_ready = flags["openai_ready"]
    doubao_ready = flags["doubao_ready"]

    if provider in {"doubao", "doubao_realtime"}:
        if doubao_ready:
            return "doubao_flash"
        if openai_ready:
            return "openai_whisper"
        return ""

    if provider in {"openai", "openai_realtime"}:
        if openai_ready:
            return "openai_whisper"
        if doubao_ready:
            return "doubao_flash"
        return ""

    if openai_ready:
        return "openai_whisper"
    if doubao_ready:
        return "doubao_flash"
    return ""


def _doubao_compatible_audio(content_type: str, filename: str) -> bool:
    ct = content_type.lower()
    fn = filename.lower()
    if "ogg" in ct or fn.endswith(".ogg"):
        return True
    if "wav" in ct or fn.endswith(".wav"):
        return True
    if "mpeg" in ct or "mp3" in ct or fn.endswith(".mp3"):
        return True
    return False


async def _transcribe_openai_whisper(
    raw: bytes,
    *,
    filename: str,
    content_type: str,
    language: str | None,
) -> str:
    api_key, base = _openai_transcribe_credentials()
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured for transcription")

    url = f"{base}/v1/audio/transcriptions"
    form_data: dict[str, str] = {"model": "whisper-1"}
    lang = str(language or "zh").strip()
    if lang:
        form_data["language"] = lang

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (filename, raw, content_type)},
                data=form_data,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=(resp.text or "")[:2000])

    try:
        body = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"invalid transcription response: {exc}") from exc
    return str(body.get("text") or "").strip() if isinstance(body, dict) else ""


async def _transcribe_doubao_flash(raw: bytes) -> str:
    app_id, access_key = _doubao_transcribe_credentials()
    if not app_id or not access_key:
        raise HTTPException(
            status_code=400,
            detail="Doubao app_id / access_key not configured for transcription",
        )

    headers = {
        "X-Api-App-Key": app_id,
        "X-Api-Access-Key": access_key,
        "X-Api-Resource-Id": DOUBAO_FLASH_RESOURCE_ID,
        "X-Api-Request-Id": str(uuid.uuid4()),
        "X-Api-Sequence": "-1",
        "Content-Type": "application/json",
    }
    payload = {
        "user": {"uid": app_id},
        "audio": {"data": base64.b64encode(raw).decode("ascii")},
        "request": {"model_name": "bigmodel"},
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(DOUBAO_FLASH_RECOGNIZE_URL, headers=headers, json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    status_code = str(resp.headers.get("X-Api-Status-Code") or "").strip()
    message = str(resp.headers.get("X-Api-Message") or "").strip()
    logid = str(resp.headers.get("X-Tt-Logid") or "").strip()
    if status_code != "20000000":
        detail = f"Doubao ASR failed ({status_code or 'unknown'}): {message or resp.text[:500]}"
        if logid:
            detail += f" [logid={logid}]"
        http_status = 502 if status_code.startswith("550") else 400
        raise HTTPException(status_code=http_status, detail=detail)

    try:
        body = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"invalid doubao transcription response: {exc}") from exc
    result = body.get("result") if isinstance(body, dict) else None
    if not isinstance(result, dict):
        return ""
    return str(result.get("text") or "").strip()


def _voice_configured_flags(raw: dict[str, Any]) -> dict[str, bool]:
    oa = raw.get("openai_realtime") if isinstance(raw.get("openai_realtime"), dict) else {}
    db = raw.get("doubao_realtime") if isinstance(raw.get("doubao_realtime"), dict) else {}
    ak = str(oa.get("api_key") or "").strip()
    openai_ready = bool(ak) or bool(str(__import__("os").environ.get("OPENAI_API_KEY", "") or "").strip())
    doubao_ready = bool(str(db.get("app_id") or "").strip()) and bool(str(db.get("access_key") or "").strip())
    provider = str(raw.get("provider") or "").strip().lower()
    return {"openai_ready": openai_ready, "doubao_ready": doubao_ready, "provider": provider}


def _persist_voice(updates: dict[str, Any]) -> None:
    path = ConfigManager.GLOBAL_CONFIG_PATH
    doc = ConfigManager._load_yaml(path)
    cur = doc.get("voice")
    merged_prev = cur if isinstance(cur, dict) else {}
    merged = ConfigManager._deep_merge(merged_prev, updates)
    doc["voice"] = merged
    ConfigManager._dump_yaml(path, doc)


def _voice_tool_scope(raw: dict[str, Any]) -> str:
    scope = str(raw.get("tool_scope") or "default").strip().lower()
    return "advanced" if scope == "advanced" else "default"


def _tool_name_from_schema(schema: dict[str, Any]) -> str:
    fn = schema.get("function")
    if not isinstance(fn, dict):
        return ""
    return str(fn.get("name") or "").strip()


def _voice_tool_schemas(mode: str) -> list[dict[str, Any]]:
    if mode == "advanced":
        return copy.deepcopy([tool for tool in STUDIO_TOOLS if _tool_name_from_schema(tool)])
    filtered: list[dict[str, Any]] = []
    for tool in STUDIO_TOOLS:
        name = _tool_name_from_schema(tool)
        if name and name in VOICE_DEFAULT_TOOL_ALLOWLIST:
            filtered.append(copy.deepcopy(tool))
    return filtered


def register_voice_endpoints(
    app: FastAPI,
    *,
    manager: SessionManager,
    check_token: Callable[[str | None], None],
) -> None:
    @app.get("/api/voice/settings")
    async def voice_settings_get(x_agx_desktop_token: str | None = Header(default=None)) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        raw = _voice_section()
        return {"ok": True, "voice": _mask_voice(raw), "voice_flags": _voice_configured_flags(raw)}

    @app.put("/api/voice/settings")
    async def voice_settings_put(
        payload: dict[str, Any],
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        incoming = payload.get("voice")
        if not isinstance(incoming, dict):
            raise HTTPException(status_code=400, detail="voice must be an object")
        persisted = ConfigManager.GLOBAL_CONFIG_PATH
        disk = ConfigManager._load_yaml(persisted).get("voice")
        disk_voice = disk if isinstance(disk, dict) else {}
        merged: dict[str, Any] = copy.deepcopy(incoming)
        merged = _sanitize_voice_overlay(merged)

        def _preserve_secret_inplace(name: str, key: str) -> None:
            block = merged.get(name)
            if not isinstance(block, dict) or key not in block:
                return
            val = block[key]
            prev = disk_voice.get(name) if isinstance(disk_voice.get(name), dict) else {}
            pv = prev.get(key) if isinstance(prev, dict) else None
            restore = isinstance(pv, str) and bool(pv.strip())
            if not restore:
                return
            if not isinstance(val, str):
                return
            st = val.strip()
            # 用户未改密钥但输入框占位 / 回声遮罩串 / 空格 → 不覆盖磁盘明文
            if (
                not st
                or _looks_like_masked_secret(st)
                or "***" in st
                or st == "**"
                or st.startswith("••")
                or ("..." in st and len(st) <= 36 and not st.startswith(("http://", "https://")))
            ):
                block[key] = pv

        _preserve_secret_inplace("openai_realtime", "api_key")
        _preserve_secret_inplace("doubao_realtime", "access_key")
        _preserve_secret_inplace("doubao_realtime", "secret_key")
        _persist_voice(merged)
        raw = _voice_section()
        return {"ok": True, "voice": _mask_voice(raw), "voice_flags": _voice_configured_flags(raw)}

    @app.get("/api/voice/tool_schemas")
    async def voice_tool_schemas_get(
        mode: str | None = None,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        raw = _voice_section()
        chosen = str(mode or _voice_tool_scope(raw)).strip().lower()
        chosen = "advanced" if chosen == "advanced" else "default"
        tools = _voice_tool_schemas(chosen)
        return {"ok": True, "mode": chosen, "tools": tools}

    @app.post("/api/voice/transcribe")
    async def voice_transcribe(
        file: UploadFile = File(...),
        language: str | None = None,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        provider = _resolve_transcribe_provider()
        if not provider:
            raise HTTPException(
                status_code=400,
                detail="No transcription provider configured (OpenAI API key or Doubao app_id/access_key)",
            )

        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="empty audio file")
        max_bytes = 100 * 1024 * 1024 if provider == "doubao_flash" else 25 * 1024 * 1024
        if len(raw) > max_bytes:
            raise HTTPException(status_code=413, detail="audio file too large")

        filename = str(file.filename or "audio.webm").strip() or "audio.webm"
        content_type = str(file.content_type or "audio/webm").strip() or "audio/webm"

        if provider == "doubao_flash":
            if not _doubao_compatible_audio(content_type, filename):
                flags = _voice_configured_flags(_voice_section())
                if flags["openai_ready"]:
                    provider = "openai_whisper"
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Doubao flash ASR requires WAV, MP3, or OGG OPUS audio; "
                            "record with OGG OPUS or configure OpenAI for webm fallback"
                        ),
                    )

        if provider == "doubao_flash":
            text = await _transcribe_doubao_flash(raw)
            return {"ok": True, "text": text, "provider": "doubao_flash"}

        text = await _transcribe_openai_whisper(
            raw,
            filename=filename,
            content_type=content_type,
            language=language,
        )
        return {"ok": True, "text": text, "provider": "openai_whisper"}

    @app.post("/api/voice/tool_call")
    async def voice_tool_call(
        body: dict[str, Any],
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        session_id = str(body.get("session_id") or "").strip()
        call_id = str(body.get("call_id") or "").strip()
        name = str(body.get("name") or "").strip()
        raw_arguments = body.get("arguments")
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id required")
        if not call_id:
            raise HTTPException(status_code=400, detail="call_id required")
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        arguments: dict[str, Any]
        if isinstance(raw_arguments, str):
            try:
                parsed = json.loads(raw_arguments)
            except Exception as exc:
                return {"ok": False, "error": f"arguments json parse failed: {exc}"}
            arguments = parsed if isinstance(parsed, dict) else {}
        elif isinstance(raw_arguments, dict):
            arguments = raw_arguments
        else:
            arguments = {}

        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")
        try:
            result = await dispatch_tool_async(
                name,
                arguments,
                managed.studio_session,
                confirm_gate=VoiceConfirmGate(),
                team_manager=getattr(managed, "_team_manager", None),
            )
            return {"ok": True, "result": str(result)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}

    @app.post("/api/voice/realtime/openai_sdp")
    async def voice_openai_sdp_proxy(
        body: dict[str, Any],
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> Response:
        check_token(x_agx_desktop_token)
        sdp = str(body.get("sdp", "") or "")
        if not sdp.strip():
            raise HTTPException(status_code=400, detail="sdp is required")

        voice = _voice_section()
        oa = voice.get("openai_realtime") if isinstance(voice.get("openai_realtime"), dict) else {}
        api_key = str(oa.get("api_key") or "").strip()
        if not api_key:
            api_key = str(__import__("os").environ.get("OPENAI_API_KEY", "") or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="OpenAI API key not configured")

        base = str(oa.get("base_url") or "https://api.openai.com").rstrip("/")
        model = str(oa.get("model") or "gpt-4o-realtime-preview").strip()
        spk = str(oa.get("voice") or "alloy").strip()
        instructions = str(oa.get("instructions") or "").strip()

        # input.transcription is REQUIRED for the client DataChannel to receive
        # `conversation.item.input_audio_transcription.completed` events; without it
        # OpenAI Realtime never emits the user-side transcript, so voice turns can
        # not be persisted back to chat history.
        sess: dict[str, Any] = {
            "type": "realtime",
            "model": model,
            "audio": {
                "input": {"transcription": {"model": "whisper-1"}},
                "output": {"voice": spk},
            },
            "turn_detection": {"type": "server_vad"},
        }
        if instructions:
            sess["instructions"] = instructions

        session_json = json.dumps(sess, ensure_ascii=False)
        url = f"{base}/v1/realtime/calls"
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                files = {"sdp": ("offer.sdp", sdp.encode("utf-8"), "application/sdp")}
                data = {"session": session_json}
                resp = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {api_key}"},
                    files=files,
                    data=data,
                )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail=(resp.text or "")[:2000])

        return Response(content=resp.text, media_type="application/sdp")

    @app.post("/api/session/messages/append")
    async def append_session_messages_proxy(
        body: dict[str, Any],
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        session_id = str(body.get("session_id") or "").strip()
        messages = body.get("messages")
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id required")
        if not isinstance(messages, list) or not messages:
            raise HTTPException(status_code=400, detail="messages required")

        managed = manager.get(session_id, touch=False)
        if managed is None:
            raise HTTPException(status_code=404, detail="session not found")

        session = managed.studio_session
        base_ts_ms = int(time.time() * 1000)

        appended = 0
        for i, raw in enumerate(messages):
            if not isinstance(raw, dict):
                continue
            role = str(raw.get("role", "") or "").strip()
            content = str(raw.get("content") or "")
            meta = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else None
            agent_id_s = str(raw.get("agent_id") or "").strip()
            tool_call_id = str(raw.get("tool_call_id") or "").strip()
            tool_name = str(raw.get("tool_name") or "").strip()
            tool_status = str(raw.get("tool_status") or "").strip()
            tool_result_preview = str(raw.get("tool_result_preview") or "").strip()
            tool_args = raw.get("tool_args") if isinstance(raw.get("tool_args"), dict) else None
            # Voice user/assistant turns must both default to ``meta`` so that
            # ChatPane's visibility filter (which keeps only agentId in {"", "meta"})
            # renders them in the conversation. The voice-focus provenance is kept
            # in ``metadata.source = "voice-focus"`` and is not encoded into
            # agent_id. Tagging user turns with ``desktop-voice`` previously hid
            # every voice user message in the UI even though it was persisted.
            agent_id_final = agent_id_s or "meta"

            ok_role = role in {"user", "assistant", "tool"}
            if not ok_role or not content.strip():
                continue

            sid = str(raw.get("id") or "").strip() or uuid.uuid4().hex
            entry: dict[str, Any] = {
                "id": sid,
                "role": role,
                "content": content,
                "timestamp": base_ts_ms + appended * 16 + i,
                "agent_id": agent_id_final,
            }
            if meta:
                entry["metadata"] = copy.deepcopy(meta)
            if role == "tool":
                if tool_call_id:
                    entry["tool_call_id"] = tool_call_id
                if tool_name:
                    entry["tool_name"] = tool_name
                if tool_status in {"ok", "error", "running", "pending"}:
                    entry["tool_status"] = tool_status
                if tool_result_preview:
                    entry["tool_result_preview"] = tool_result_preview
                if tool_args:
                    entry["tool_args"] = copy.deepcopy(tool_args)
            session.chat_history.append(entry)
            session.agent_messages.append(copy.deepcopy(entry))
            appended += 1

        if appended:
            managed.updated_at = time.time()
            persisted = manager.persist(session_id)
            logger.warning(
                "[voice-focus] appended %s message(s) to session=%s persisted=%s chat_history=%s",
                appended,
                session_id,
                persisted,
                len(session.chat_history),
            )
        else:
            logger.warning(
                "[voice-focus] append requested for session=%s but no valid messages were accepted",
                session_id,
            )
        return {"ok": True, "appended": appended}

    @app.post("/api/voice/realtime/probe")
    async def voice_realtime_probe(
        payload: dict[str, Any],
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        provider = str(payload.get("provider") or "").strip().lower()
        if provider in {"openai", "openai_realtime"}:
            voice = _voice_section()
            oa = voice.get("openai_realtime") if isinstance(voice.get("openai_realtime"), dict) else {}
            api_key = str(oa.get("api_key") or "").strip() or str(
                __import__("os").environ.get("OPENAI_API_KEY", "") or ""
            ).strip()
            if not api_key:
                return {"ok": False, "error": "未配置 OpenAI API Key"}
            base = str(oa.get("base_url") or "https://api.openai.com").rstrip("/")
            url = f"{base}/v1/models"
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    r = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
            except httpx.RequestError as exc:
                return {"ok": False, "error": str(exc)}
            if r.status_code >= 400:
                return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:300]}"}
            return {"ok": True, "detail": "OpenAI reachable"}
        if provider in {"doubao", "doubao_realtime"}:
            raw = _voice_section()
            db = raw.get("doubao_realtime") if isinstance(raw.get("doubao_realtime"), dict) else {}
            app_id = str(db.get("app_id") or "").strip()
            access_key = str(db.get("access_key") or "").strip()
            secret_raw = str(db.get("secret_key") or "").strip()
            api_app_key = str(db.get("api_app_key") or DEFAULT_DOUBAO_APP_KEY).strip()
            resource_id = str(db.get("resource_id") or "volc.speech.dialog").strip()
            if not app_id or not access_key:
                return {"ok": False, "error": "请先填写 App ID 与 Access Key 再点测试"}
            extra_headers = [
                ("X-Api-App-Key", api_app_key),
                ("X-Api-Access-Key", access_key),
                ("X-Api-App-ID", app_id),
                ("X-Api-Resource-Id", resource_id),
                ("X-Api-Connect-Id", str(uuid.uuid4())),
            ]
            if secret_raw:
                extra_headers.append(("X-Api-Secret-Key", secret_raw))
            # 真握手：能升级到 wss 即视为凭据 + 网络全部 OK；超时/4xx 都透传给前端
            try:
                async with asyncio.timeout(8.0):
                    upstream = await websockets.connect(
                        DOUBAO_REALTIME_WS,
                        additional_headers=extra_headers,
                        max_size=None,
                    )
                logid = ""
                try:
                    raw_headers = getattr(upstream.response, "headers", None)
                    if raw_headers is not None:
                        logid = str(raw_headers.get("X-Tt-Logid", "") or "")
                except Exception:
                    pass
                with contextlib.suppress(Exception):
                    await upstream.close()
                detail = "WebSocket 握手成功（实际语音由灵巧模式胶囊建立会话）"
                if logid:
                    detail = f"{detail}；X-Tt-Logid={logid}"
                return {"ok": True, "detail": detail}
            except asyncio.TimeoutError:
                return {
                    "ok": False,
                    "error": "握手超时（8s）：网络可能被代理/防火墙拦截，或上游 openspeech.bytedance.com 暂不可达",
                }
            except Exception as exc:  # noqa: BLE001 — 网络与鉴权异常种类多，统一透传
                msg = str(exc) or exc.__class__.__name__
                # websockets 库握手失败常带 HTTP 状态码，截短即可
                return {"ok": False, "error": f"握手失败：{msg[:300]}"}
        raise HTTPException(status_code=400, detail="unknown provider")

    @app.websocket("/ws/voice/doubao")
    async def doubao_ws_bridge(websocket: WebSocket) -> None:
        token_q = websocket.query_params.get("x_agx_desktop_token") or ""
        token_h = websocket.headers.get("x-agx-desktop-token") or websocket.headers.get("X-Agx-Desktop-Token")
        header_tok = (token_q or token_h or "").strip()
        try:
            check_token(header_tok or None)
        except HTTPException:
            await websocket.close(code=4401)
            return

        voice = _voice_section()
        db = voice.get("doubao_realtime") if isinstance(voice.get("doubao_realtime"), dict) else {}
        app_id = str(db.get("app_id") or "").strip()
        access_key = str(db.get("access_key") or "").strip()
        secret_raw = str(db.get("secret_key") or "").strip()
        api_app_key = str(db.get("api_app_key") or DEFAULT_DOUBAO_APP_KEY).strip()
        resource_id = str(db.get("resource_id") or "volc.speech.dialog").strip()

        if not app_id or not access_key:
            await websocket.close(code=4400)
            return

        connect_id = str(uuid.uuid4())
        extra_headers = [
            ("X-Api-App-Key", api_app_key),
            ("X-Api-Access-Key", access_key),
            ("X-Api-App-ID", app_id),
            ("X-Api-Resource-Id", resource_id),
            ("X-Api-Connect-Id", connect_id),
        ]
        if secret_raw:
            extra_headers.append(("X-Api-Secret-Key", secret_raw))

        await websocket.accept()

        upstream: Any = None
        try:
            upstream = await websockets.connect(
                DOUBAO_REALTIME_WS,
                additional_headers=extra_headers,
                max_size=None,
            )
        except Exception as exc:
            logger.warning("doubao upstream connect failed: %s", exc)
            await websocket.close(code=1011)
            return

        async def c2u() -> None:
            assert upstream is not None
            try:
                while True:
                    msg = await websocket.receive_bytes()
                    await upstream.send(msg)
            except Exception:
                pass
            finally:
                with contextlib.suppress(Exception):
                    await upstream.close()

        async def u2c() -> None:
            assert upstream is not None
            try:
                async for msg in upstream:
                    if isinstance(msg, (bytes, bytearray)):
                        raw = bytes(msg)
                        event, payload = _decode_doubao_event_for_log(raw)
                        if event in {451, 459, 550, 559, 350, 359}:
                            logger.warning(
                                "[voice-focus:doubao] upstream event=%s payload=%s",
                                event,
                                json.dumps(payload, ensure_ascii=False)[:800] if payload is not None else None,
                            )
                        await websocket.send_bytes(raw)
            except Exception:
                pass

        try:
            await asyncio.gather(c2u(), u2c())
        finally:
            with contextlib.suppress(Exception):
                await upstream.close()

    @app.websocket("/ws/voice/stream-transcribe")
    async def doubao_stream_transcribe_ws(websocket: WebSocket) -> None:
        """Proxy Volcengine sauc/bigmodel streaming ASR for desktop push-to-talk."""

        token_q = websocket.query_params.get("x_agx_desktop_token") or ""
        token_h = websocket.headers.get("x-agx-desktop-token") or websocket.headers.get("X-Agx-Desktop-Token")
        header_tok = (token_q or token_h or "").strip()
        try:
            check_token(header_tok or None)
        except HTTPException:
            await websocket.close(code=4401)
            return

        voice = _voice_section()
        db = voice.get("doubao_realtime") if isinstance(voice.get("doubao_realtime"), dict) else {}
        app_id = str(db.get("app_id") or "").strip()
        access_key = str(db.get("access_key") or "").strip()
        secret_raw = str(db.get("secret_key") or "").strip()
        api_app_key = str(db.get("api_app_key") or DEFAULT_DOUBAO_APP_KEY).strip()

        if not app_id or not access_key:
            await websocket.close(code=4400)
            return

        await websocket.accept()

        upstream: Any = None
        stop_requested = asyncio.Event()
        latest_text = ""

        async def send_client(payload: dict[str, Any]) -> None:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))

        try:
            raw_start = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
            start_body = json.loads(raw_start)
            if str(start_body.get("type") or "").lower() != "start":
                await send_client({"type": "error", "message": "expected start message"})
                await websocket.close(code=4400)
                return
            language = str(start_body.get("language") or "zh-CN").strip() or "zh-CN"
            session_uid = str(uuid.uuid4())

            connect_id = str(uuid.uuid4())
            extra_headers = [
                ("X-Api-App-Key", api_app_key),
                ("X-Api-Access-Key", access_key),
                ("X-Api-App-ID", app_id),
                ("X-Api-Resource-Id", DOUBAO_SAUC_RESOURCE_ID),
                ("X-Api-Connect-Id", connect_id),
            ]
            if secret_raw:
                extra_headers.append(("X-Api-Secret-Key", secret_raw))

            upstream = await websockets.connect(
                DOUBAO_SAUC_WS,
                additional_headers=extra_headers,
                max_size=None,
            )
            start_payload = build_default_start_payload(uid=session_uid, language=language)
            await upstream.send(build_full_client_request(start_payload))
            await send_client({"type": "ready"})

            async def client_to_upstream() -> None:
                try:
                    while not stop_requested.is_set():
                        msg = await websocket.receive()
                        if msg.get("type") == "websocket.disconnect":
                            stop_requested.set()
                            break
                        if "text" in msg:
                            try:
                                body = json.loads(msg["text"])
                            except Exception:
                                continue
                            if str(body.get("type") or "").lower() == "stop":
                                stop_requested.set()
                                assert upstream is not None
                                await upstream.send(build_audio_only_request(b"", is_last=True))
                                break
                        elif "bytes" in msg:
                            pcm = msg["bytes"]
                            if pcm and upstream is not None:
                                await upstream.send(build_audio_only_request(pcm, is_last=False))
                except Exception:
                    stop_requested.set()
                    if upstream is not None:
                        with contextlib.suppress(Exception):
                            await upstream.send(build_audio_only_request(b"", is_last=True))

            async def upstream_to_client() -> None:
                nonlocal latest_text
                assert upstream is not None
                try:
                    async for raw in upstream:
                        if not isinstance(raw, (bytes, bytearray)):
                            continue
                        parsed = parse_server_frame(bytes(raw))
                        kind = parsed.get("kind")
                        if kind == "error":
                            await send_client(
                                {
                                    "type": "error",
                                    "message": str(parsed.get("message") or "豆包流式转写失败"),
                                }
                            )
                            break
                        if kind != "response":
                            continue
                        text = str(parsed.get("text") or "").strip()
                        if text:
                            latest_text = text
                        msg_type = "final" if parsed.get("is_last") else "interim"
                        await send_client({"type": msg_type, "text": text or latest_text})
                        if parsed.get("is_last"):
                            break
                except Exception:
                    pass

            await asyncio.gather(client_to_upstream(), upstream_to_client())
        except asyncio.TimeoutError:
            with contextlib.suppress(Exception):
                await send_client({"type": "error", "message": "等待 start 超时"})
        except json.JSONDecodeError:
            with contextlib.suppress(Exception):
                await send_client({"type": "error", "message": "invalid start payload"})
        except Exception as exc:
            logger.warning("stream-transcribe failed: %s", exc)
            with contextlib.suppress(Exception):
                await send_client({"type": "error", "message": str(exc)[:300]})
        finally:
            if upstream is not None:
                with contextlib.suppress(Exception):
                    await upstream.close()
            with contextlib.suppress(Exception):
                await websocket.close()
