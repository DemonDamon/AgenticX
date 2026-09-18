#!/usr/bin/env python3
"""Tests for WeChat iLink adapter routing behavior."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest

from agenticx.gateway.adapters.wechat_ilink import (
    WeChatILinkAdapter,
    format_wechat_outbound_text,
)
from agenticx.gateway.im_wechat_files import WeChatChatResult


def _message_event() -> dict:
    return {
        "type": "message",
        "text": "hello",
        "sender": "wx-user",
        "session_id": "wechat-session-xyz",
        "group_id": "",
        "context_token": "ctx",
        "items": [],
    }


@pytest.mark.asyncio
async def test_handle_event_prefers_bound_session_id(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    captured: dict[str, str] = {}

    async def _fake_chat_turn(
        text: str, sender_name: str, *, session_id: str = "", **_kwargs: object
    ) -> str:
        captured["session_id"] = session_id
        return "ok"

    async def _fake_send_reply(
        sidecar_url: str,
        text: str,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        return None

    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    await adapter._handle_event("http://127.0.0.1:9999", _message_event())

    assert captured["session_id"] == "agx-session-123"


@pytest.mark.asyncio
async def test_handle_event_sends_persisted_group_reply_when_sse_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    replies: list[str] = []

    async def _fake_chat_turn(
        text: str, sender_name: str, *, session_id: str = "", **_kwargs: object
    ) -> WeChatChatResult:
        return WeChatChatResult(text="", file_paths=())

    async def _fake_persisted(session_id: str, user_text: str) -> str:
        assert session_id == "agx-session-123"
        assert user_text == "hello"
        return "后端·北辰：南沙明天多云转晴"

    async def _fake_send_reply(
        sidecar_url: str,
        text: str,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        replies.append(text)

    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_load_persisted_im_reply", _fake_persisted)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    await adapter._handle_event("http://127.0.0.1:9999", _message_event())

    assert replies == ["后端·北辰：南沙明天多云转晴"]


@pytest.mark.asyncio
async def test_handle_event_recovers_stale_bound_session(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    calls: list[str] = []

    async def _fake_chat_turn(
        text: str, sender_name: str, *, session_id: str = "", **_kwargs: object
    ) -> str:
        calls.append(session_id)
        if len(calls) == 1:
            raise RuntimeError("chat failed: 404 {\"detail\":\"session not found\"}")
        return "ok"

    async def _fake_send_reply(
        sidecar_url: str,
        text: str,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        return None

    async def _fake_recover(old_session_id: str) -> str:
        assert old_session_id == "agx-session-stale"
        return "agx-session-new"

    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-stale", None, None)
    )
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)
    monkeypatch.setattr(adapter, "_recover_desktop_bound_session", _fake_recover)

    await adapter._handle_event("http://127.0.0.1:9999", _message_event())

    assert calls == ["agx-session-stale", "agx-session-new"]


@pytest.mark.asyncio
async def test_handle_event_sends_text_then_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    doc = tmp_path / "报告.pdf"
    doc.write_bytes(b"%PDF-1.4 demo")
    replies: list[str] = []
    files: list[str] = []

    async def _fake_chat_turn(
        text: str, sender_name: str, *, session_id: str = "", **_kwargs: object
    ) -> WeChatChatResult:
        return WeChatChatResult(text="文件在工作区", file_paths=(str(doc),))

    async def _fake_send_reply(
        sidecar_url: str,
        text: str,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        replies.append(text)

    async def _fake_send_file(
        sidecar_url: str,
        path: Path,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        files.append(str(path))

    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)
    monkeypatch.setattr(adapter, "_send_file", _fake_send_file)

    await adapter._handle_event("http://127.0.0.1:9999", _message_event())

    assert replies and "已通过微信附件发送：报告.pdf" in replies[0]
    assert files == [str(doc)]


@pytest.mark.asyncio
async def test_send_file_posts_base64_payload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    doc = tmp_path / "合同.docx"
    raw = b"PK\x03\x04word"
    doc.write_bytes(raw)
    captured: dict[str, object] = {}

    class _Resp:
        status_code = 200
        text = '{"ok":true}'

        def json(self) -> dict:
            return {"ok": True}

    class _Client:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, url: str, json: dict) -> _Resp:
            captured["url"] = url
            captured["json"] = json
            return _Resp()

    monkeypatch.setattr(
        "agenticx.gateway.adapters.wechat_ilink.httpx.AsyncClient",
        _Client,
    )

    await adapter._send_file(
        sidecar_url="http://127.0.0.1:9999",
        path=doc,
        context_token="ctx",
        sender="wx-user",
        session_id="",
        group_id="",
    )

    assert captured["url"] == "http://127.0.0.1:9999/send"
    payload = captured["json"]
    assert isinstance(payload, dict)
    assert payload["filename"] == "合同.docx"
    assert payload["recipient"] == "wx-user"
    assert payload["context_token"] == "ctx"
    assert "text" not in payload
    assert "caption" not in payload
    assert base64.b64decode(payload["file"]) == raw


@pytest.mark.asyncio
async def test_handle_event_skips_filename_only_text_when_sending_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    doc = tmp_path / "幻影旅团壁纸_翻译_v2.docx"
    doc.write_bytes(b"PK\x03\x04word")
    replies: list[str] = []
    files: list[str] = []

    async def _fake_chat_turn(
        text: str, sender_name: str, *, session_id: str = "", **_kwargs: object
    ) -> WeChatChatResult:
        return WeChatChatResult(text=doc.name, file_paths=(str(doc),))

    async def _fake_send_reply(
        sidecar_url: str,
        text: str,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        replies.append(text)

    async def _fake_send_file(
        sidecar_url: str,
        path: Path,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        files.append(str(path))

    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)
    monkeypatch.setattr(adapter, "_send_file", _fake_send_file)

    await adapter._handle_event("http://127.0.0.1:9999", _message_event())

    assert replies == []
    assert files == [str(doc)]


def test_format_wechat_outbound_keeps_group_speaker_without_meta() -> None:
    out = format_wechat_outbound_text(
        "后端·北辰：南沙明天雷阵雨",
        "Nearer",
    )
    assert out == "后端·北辰：南沙明天雷阵雨"
    assert not out.startswith("Nearer")


def test_format_wechat_outbound_strips_meta_wrapper_around_member() -> None:
    out = format_wechat_outbound_text(
        "Nearer：\n后端·北辰：南沙明天雷阵雨",
        "Nearer",
    )
    assert out == "后端·北辰：南沙明天雷阵雨"


def test_format_wechat_outbound_keeps_meta_when_meta_answered() -> None:
    out = format_wechat_outbound_text("今晚别出门", "Nearer")
    assert out == "Nearer：\n今晚别出门"
