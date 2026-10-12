#!/usr/bin/env python3
"""Tests for WeChat iLink adapter routing behavior."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest

from agenticx.gateway.adapters import wechat_ilink as wechat_ilink_mod
from agenticx.gateway.adapters.wechat_ilink import (
    WeChatILinkAdapter,
    build_wechat_chat_body,
    format_wechat_outbound_text,
)
from agenticx.gateway.im_wechat_files import WeChatChatResult
from agenticx.gateway.im_wechat_inbound import (
    IMAGE_ONLY_USER_PROMPT,
    UNSEEN_IMAGE_IM_REPLY,
)


async def _handle_and_flush(
    adapter: WeChatILinkAdapter,
    evt: dict,
    sidecar: str = "http://127.0.0.1:9999",
) -> None:
    await adapter._handle_event(sidecar, evt)
    await adapter._flush_all_pending()


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

    await _handle_and_flush(adapter, _message_event())

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

    await _handle_and_flush(adapter, _message_event())

    assert replies == ["后端·北辰：南沙明天多云转晴"]


@pytest.mark.asyncio
async def test_handle_event_sends_each_group_speaker_as_own_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    replies: list[str] = []

    async def _fake_chat_turn(
        text: str, sender_name: str, *, session_id: str = "", **_kwargs: object
    ) -> WeChatChatResult:
        return WeChatChatResult(
            text="架构师·阿析：论文找到了\n\n后端·北辰：点链接下载",
            file_paths=(),
            bubbles=(
                "架构师·阿析：论文找到了",
                "后端·北辰：点链接下载",
            ),
        )

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
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    await _handle_and_flush(adapter, _message_event())

    assert replies == ["架构师·阿析：论文找到了", "后端·北辰：点链接下载"]


@pytest.mark.asyncio
async def test_handle_event_splits_persisted_two_speaker_blob(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    replies: list[str] = []

    async def _fake_chat_turn(
        text: str, sender_name: str, *, session_id: str = "", **_kwargs: object
    ) -> WeChatChatResult:
        return WeChatChatResult(text="", file_paths=())

    async def _fake_persisted(session_id: str, user_text: str) -> str:
        return "架构师·阿析：论文找到了\n\n后端·北辰：点链接下载"

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

    await _handle_and_flush(adapter, _message_event())

    assert replies == ["架构师·阿析：论文找到了", "后端·北辰：点链接下载"]


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

    await _handle_and_flush(adapter, _message_event())

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

    await _handle_and_flush(adapter, _message_event())

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

    await _handle_and_flush(adapter, _message_event())

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


def test_build_wechat_chat_body_includes_image_inputs() -> None:
    images = [
        {
            "name": "paper.jpg",
            "data_url": "data:image/jpeg;base64,Zm9v",
            "mime_type": "image/jpeg",
            "size": 3,
        }
    ]
    body = build_wechat_chat_body(
        session_id="agx-session-123",
        text="把这个论文发给我",
        sender_name="wx-user",
        image_inputs=images,
    )
    assert body["user_input"] == "把这个论文发给我"
    assert body["image_inputs"] == images


@pytest.mark.asyncio
async def test_handle_event_forwards_inbound_image_as_image_inputs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    img = tmp_path / "paper.jpg"
    img.write_bytes(b"\xff\xd8\xff" + b"jpeg")
    captured: dict[str, object] = {}

    async def _fake_download(
        sidecar_url: str, eqp: str, aes_key: str, url: str
    ) -> str:
        captured["eqp"] = eqp
        return str(img)

    async def _fake_chat_turn(
        text: str,
        sender_name: str,
        *,
        session_id: str = "",
        image_inputs: object = None,
        **_kwargs: object,
    ) -> str:
        captured["text"] = text
        captured["image_inputs"] = image_inputs
        return "ok"

    async def _fake_send_reply(*_args: object, **_kwargs: object) -> None:
        return None

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
    monkeypatch.setattr(adapter, "_download_media", _fake_download)
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    evt = _message_event()
    evt["text"] = "把这个论文发给我"
    evt["items"] = [{"type": 2, "eqp": "eqp1", "aes_key": "k", "url": ""}]
    await _handle_and_flush(adapter, evt)

    assert captured["eqp"] == "eqp1"
    assert captured["text"] == "把这个论文发给我"
    images = captured["image_inputs"]
    assert isinstance(images, list) and len(images) == 1
    assert images[0]["data_url"].startswith("data:image/jpeg;base64,")


@pytest.mark.asyncio
async def test_handle_event_downloads_image_with_url_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    img = tmp_path / "paper.jpg"
    img.write_bytes(b"\xff\xd8\xff" + b"jpeg")
    captured: dict[str, object] = {}

    async def _fake_download(
        sidecar_url: str, eqp: str, aes_key: str, url: str
    ) -> str:
        captured["url"] = url
        captured["eqp"] = eqp
        return str(img)

    async def _fake_chat_turn(
        text: str, sender_name: str, *, image_inputs: object = None, **_kwargs: object
    ) -> str:
        captured["text"] = text
        captured["image_inputs"] = image_inputs
        return "ok"

    async def _fake_send_reply(*_args: object, **_kwargs: object) -> None:
        return None

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
    monkeypatch.setattr(adapter, "_download_media", _fake_download)
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    evt = _message_event()
    evt["text"] = ""
    evt["items"] = [{"type": 2, "eqp": "", "aes_key": "k", "url": "https://cdn.example/full"}]
    await _handle_and_flush(adapter, evt)

    assert captured["url"] == "https://cdn.example/full"
    assert str(captured["text"]) == IMAGE_ONLY_USER_PROMPT
    images = captured["image_inputs"]
    assert isinstance(images, list) and images


@pytest.mark.asyncio
async def test_download_media_creates_wechat_media_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(wechat_ilink_mod, "_AGX_DIR", tmp_path / "agx")
    jpeg = b"\xff\xd8\xff" + b"jpeg-bytes"

    class _Resp:
        status_code = 200
        headers = {"content-type": "application/octet-stream"}
        content = jpeg

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

    captured: dict[str, object] = {}
    monkeypatch.setattr(wechat_ilink_mod.httpx, "AsyncClient", _Client)

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    path = await adapter._download_media(
        "http://127.0.0.1:9999", "eqp1", "aes", "https://cdn.example/full"
    )
    assert path
    saved = Path(path)
    assert saved.is_file()
    assert saved.read_bytes() == jpeg
    assert (tmp_path / "agx" / "wechat_media").is_dir()
    assert captured["url"] == "http://127.0.0.1:9999/media/download"
    assert captured["json"] == {"eqp": "eqp1", "aes_key": "aes", "url": "https://cdn.example/full"}


@pytest.mark.asyncio
async def test_handle_event_late_image_reuses_recent_caption(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    img = tmp_path / "paper.jpg"
    img.write_bytes(b"\xff\xd8\xff" + b"jpeg")
    turns: list[dict[str, object]] = []

    async def _fake_download(*_args: object, **_kwargs: object) -> str:
        return str(img)

    async def _fake_chat_turn(
        text: str, sender_name: str, *, image_inputs: object = None, **_kwargs: object
    ) -> str:
        turns.append({"text": text, "image_inputs": image_inputs})
        return "ok"

    async def _fake_send_reply(*_args: object, **_kwargs: object) -> None:
        return None

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
    monkeypatch.setattr(adapter, "_download_media", _fake_download)
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    text_evt = _message_event()
    text_evt["text"] = "把这个论文发给我"
    text_evt["items"] = [{"type": 1}]
    await adapter._handle_event("http://127.0.0.1:9999", text_evt)
    assert turns == []

    image_evt = _message_event()
    image_evt["text"] = ""
    image_evt["items"] = [{"type": 2, "eqp": "eqp1", "aes_key": "k", "url": ""}]
    await adapter._handle_event("http://127.0.0.1:9999", image_evt)
    assert turns == []

    await adapter._flush_all_pending()

    assert len(turns) == 1
    assert turns[0]["text"] == "把这个论文发给我"
    images = turns[0]["image_inputs"]
    assert isinstance(images, list) and images
    assert images[0]["data_url"].startswith("data:image/jpeg;base64,")


@pytest.mark.asyncio
async def test_handle_event_late_text_reuses_recent_image(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    img = tmp_path / "paper.jpg"
    img.write_bytes(b"\xff\xd8\xff" + b"jpeg")
    turns: list[dict[str, object]] = []

    async def _fake_download(*_args: object, **_kwargs: object) -> str:
        return str(img)

    async def _fake_chat_turn(
        text: str, sender_name: str, *, image_inputs: object = None, **_kwargs: object
    ) -> str:
        turns.append({"text": text, "image_inputs": image_inputs})
        return "ok"

    async def _fake_send_reply(*_args: object, **_kwargs: object) -> None:
        return None

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
    monkeypatch.setattr(adapter, "_download_media", _fake_download)
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    image_evt = _message_event()
    image_evt["text"] = ""
    image_evt["items"] = [{"type": 2, "eqp": "eqp1", "aes_key": "k", "url": ""}]
    await adapter._handle_event("http://127.0.0.1:9999", image_evt)
    assert turns == []

    text_evt = _message_event()
    text_evt["text"] = "把这个论文发给我"
    text_evt["items"] = [{"type": 1}]
    await adapter._handle_event("http://127.0.0.1:9999", text_evt)
    assert turns == []

    await adapter._flush_all_pending()

    assert len(turns) == 1
    assert turns[0]["text"] == "把这个论文发给我"
    images = turns[0]["image_inputs"]
    assert isinstance(images, list) and images


@pytest.mark.asyncio
async def test_chat_turn_sends_skipped_clarification_card_as_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sse = (
        'data: {"type":"group_clarification","data":{'
        '"content":"你说的「这个」是指哪一份？",'
        '"avatar_name":"架构师·阿析","skipped":true,'
        '"agent_id":"__meta__",'
        '"confirm_request_id":"req-clarify-1",'
        '"clarify_options":["发文件","发链接"]}}\n\n'
        'data: {"type":"error","data":{"text":"chat error"}}\n\n'
    )
    posts: list[tuple[str, dict]] = []

    class _Stream:
        status_code = 200

        async def aiter_text(self):
            yield sse

    class _StreamCtx:
        async def __aenter__(self) -> _Stream:
            return _Stream()

        async def __aexit__(self, *_args: object) -> None:
            return None

    class _Client:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        def stream(self, *_args: object, **_kwargs: object) -> _StreamCtx:
            return _StreamCtx()

        async def post(self, url: str, **kwargs: object) -> object:
            body = kwargs.get("json")
            if isinstance(body, dict):
                posts.append((str(url), body))

            class _Resp:
                status_code = 200

            return _Resp()

    monkeypatch.setattr(wechat_ilink_mod.httpx, "AsyncClient", _Client)
    adapter = WeChatILinkAdapter(
        sidecar_url="http://127.0.0.1:9999",
        studio_base_url="http://127.0.0.1:8000",
        studio_token="t",
    )
    result = await adapter._chat_turn(
        "把这个发给我",
        "wx-user",
        session_id="agx-session-123",
        sender_key="wechat:wx-user",
    )
    assert "你说的「这个」是指哪一份？" in result.text
    assert "处理消息时出错" not in result.text
    assert "1. 发文件" in result.text
    clarify_posts = [item for item in posts if item[0].endswith("/api/clarify")]
    assert len(clarify_posts) == 1
    assert clarify_posts[0][1]["request_id"] == "req-clarify-1"
    assert clarify_posts[0][1]["agent_id"] == "meta"
    assert clarify_posts[0][1]["session_id"] == "agx-session-123"
    assert clarify_posts[0][1]["answer_text"]


@pytest.mark.asyncio
async def test_chat_turn_busy_elsewhere_is_not_generic_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sse = (
        'data: {"type":"error","data":{"error":"session_busy_elsewhere",'
        '"text":"会话正在其他窗口处理"}}\n\n'
    )

    class _Stream:
        status_code = 200

        async def aiter_text(self):
            yield sse

    class _StreamCtx:
        async def __aenter__(self) -> _Stream:
            return _Stream()

        async def __aexit__(self, *_args: object) -> None:
            return None

    class _Client:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        def stream(self, *_args: object, **_kwargs: object) -> _StreamCtx:
            return _StreamCtx()

        async def post(self, *_args: object, **_kwargs: object) -> object:
            class _Resp:
                status_code = 200

            return _Resp()

    monkeypatch.setattr(wechat_ilink_mod.httpx, "AsyncClient", _Client)
    adapter = WeChatILinkAdapter(
        sidecar_url="http://127.0.0.1:9999",
        studio_base_url="http://127.0.0.1:8000",
        studio_token="t",
    )
    result = await adapter._chat_turn(
        "把这个论文发给我",
        "wx-user",
        session_id="agx-session-123",
        sender_key="wechat:wx-user",
    )
    assert result.text == ""


@pytest.mark.asyncio
async def test_dispatch_uses_persisted_clarification_instead_of_generic_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.gateway.im_wechat_inbound import InboundMergeBatch

    replies: list[str] = []

    async def _boom(*_args: object, **_kwargs: object) -> str:
        raise RuntimeError("chat error")

    async def _fake_clarify(session_id: str) -> str:
        assert session_id == "agx-session-123"
        return "架构师·阿析：你说的「这个论文」是指哪一篇？"

    async def _fake_send_reply(
        sidecar_url: str,
        text: str,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        replies.append(text)

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
    monkeypatch.setattr(adapter, "_chat_turn", _boom)
    monkeypatch.setattr(adapter, "_load_persisted_clarification", _fake_clarify)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    await adapter._dispatch_inbound_turn(
        InboundMergeBatch(
            sender="wx-user",
            sidecar_url="http://127.0.0.1:9999",
            text="把这个论文发给我",
            session_id="wechat-session-xyz",
            context_token="ctx",
        )
    )
    assert replies == ["架构师·阿析：你说的「这个论文」是指哪一篇？"]


@pytest.mark.asyncio
async def test_dispatch_short_circuits_unseen_images_without_chat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.gateway.im_wechat_inbound import InboundMergeBatch

    replies: list[str] = []
    chats: list[str] = []

    async def _chat(*_args: object, **_kwargs: object) -> str:
        chats.append("called")
        return "should-not-run"

    async def _fake_send_reply(
        sidecar_url: str,
        text: str,
        context_token: str,
        sender: str,
        session_id: str,
        group_id: str,
    ) -> None:
        replies.append(text)

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", "zhipu", "glm-4.5-air")
    )
    monkeypatch.setattr(adapter, "_chat_turn", _chat)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    await adapter._dispatch_inbound_turn(
        InboundMergeBatch(
            sender="wx-user",
            sidecar_url="http://127.0.0.1:9999",
            text="把这个发给我",
            image_inputs=[
                {
                    "name": "a.jpg",
                    "data_url": "data:image/jpeg;base64,Zg==",
                    "mime_type": "image/jpeg",
                    "size": 1,
                }
            ],
            session_id="wechat-session-xyz",
            context_token="ctx",
        )
    )
    assert chats == []
    assert replies == [UNSEEN_IMAGE_IM_REPLY]
    assert "论文" not in replies[0]


@pytest.mark.asyncio
async def test_dispatch_still_chats_when_model_can_see_images(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.gateway.im_wechat_inbound import InboundMergeBatch

    captured: dict[str, object] = {}

    async def _chat(
        text: str, sender_name: str, *, image_inputs: object = None, **_kwargs: object
    ) -> str:
        captured["text"] = text
        captured["image_inputs"] = image_inputs
        return "ok"

    async def _fake_send_reply(*_args: object, **_kwargs: object) -> None:
        return None

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    monkeypatch.setattr(
        adapter,
        "_resolve_bound_session",
        lambda: ("agx-session-123", "zhipu", "glm-5.3-flash"),
    )
    monkeypatch.setattr(adapter, "_chat_turn", _chat)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    images = [
        {
            "name": "a.jpg",
            "data_url": "data:image/jpeg;base64,Zg==",
            "mime_type": "image/jpeg",
            "size": 1,
        }
    ]
    await adapter._dispatch_inbound_turn(
        InboundMergeBatch(
            sender="wx-user",
            sidecar_url="http://127.0.0.1:9999",
            text="把这个发给我",
            image_inputs=images,
            session_id="wechat-session-xyz",
            context_token="ctx",
        )
    )
    assert captured["text"] == "把这个发给我"
    assert captured["image_inputs"] == images


@pytest.mark.asyncio
async def test_dispatch_still_chats_non_vision_when_file_path_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.gateway.im_wechat_inbound import InboundMergeBatch

    chats: list[str] = []

    async def _chat(text: str, *_args: object, **_kwargs: object) -> str:
        chats.append(text)
        return "ok"

    async def _fake_send_reply(*_args: object, **_kwargs: object) -> None:
        return None

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", "zhipu", "glm-4.5-air")
    )
    monkeypatch.setattr(adapter, "_chat_turn", _chat)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    await adapter._dispatch_inbound_turn(
        InboundMergeBatch(
            sender="wx-user",
            sidecar_url="http://127.0.0.1:9999",
            text="把这个发给我",
            leftover_paths=["/tmp/a.pdf"],
            session_id="wechat-session-xyz",
            context_token="ctx",
        )
    )
    assert len(chats) == 1
    assert "[附件] /tmp/a.pdf" in chats[0]


@pytest.mark.asyncio
async def test_consume_sse_keeps_reading_while_handler_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio
    import time

    chunks = [
        'data: {"type":"message","text":"a","sender":"s","items":[]}\n\n',
        'data: {"type":"message","text":"b","sender":"s","items":[]}\n\n',
    ]
    handle_started: list[float] = []

    class _Stream:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        async def aiter_text(self):
            for chunk in chunks:
                yield chunk

    class _StreamCtx:
        async def __aenter__(self) -> _Stream:
            return _Stream()

        async def __aexit__(self, *_args: object) -> None:
            return None

    class _Client:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        def stream(self, *_args: object, **_kwargs: object) -> _StreamCtx:
            return _StreamCtx()

    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    adapter._running = True

    async def _slow_handle(_sidecar_url: str, evt: dict) -> None:
        handle_started.append(time.monotonic())
        await asyncio.sleep(0.4)

    monkeypatch.setattr(wechat_ilink_mod.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(adapter, "_handle_event", _slow_handle)

    started = time.monotonic()
    await adapter._consume_sse("http://127.0.0.1:9999")
    elapsed = time.monotonic() - started
    assert elapsed < 0.3
    assert adapter._event_queue.qsize() == 2

    pump = asyncio.create_task(adapter._pump_events())
    await asyncio.sleep(0.1)
    assert len(handle_started) == 1
    adapter._running = False
    await adapter._event_queue.put(("", {"type": "status"}))
    await asyncio.wait_for(pump, timeout=1.0)
