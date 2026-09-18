#!/usr/bin/env python3
"""Select WeChat outbound files from a chat turn.

Author: Damon Li
"""

from __future__ import annotations

import base64
from pathlib import Path

import pytest

from agenticx.gateway.im_wechat_files import (
    MAX_FILE_BYTES,
    WeChatChatResult,
    append_sent_files_notice,
    build_sidecar_file_payload,
    coerce_chat_result,
    extract_absolute_paths,
    extract_mentioned_filenames,
    is_sendable_file,
    paths_from_sse_payload,
    resolve_filename,
    select_outbound_files,
    user_wants_file_delivery,
)


def test_user_wants_file_delivery() -> None:
    assert user_wants_file_delivery("把那个翻译文件发我")
    assert user_wants_file_delivery("发给我 pdf")
    assert user_wants_file_delivery("发文件到微信")
    assert user_wants_file_delivery("Please send me the file")
    assert not user_wants_file_delivery("总结一下这份 PDF 的要点")
    assert not user_wants_file_delivery("进度如何")


def test_extract_absolute_paths_and_filenames() -> None:
    text = (
        "文件在 /Users/damon/.agenticx/workspace/报告.pdf\n"
        "另见 《幻影旅团壁纸_翻译.md》 和 `notes.docx`"
    )
    paths = extract_absolute_paths(text)
    assert "/Users/damon/.agenticx/workspace/报告.pdf" in paths
    names = extract_mentioned_filenames(text)
    assert "幻影旅团壁纸_翻译.md" in names
    assert "notes.docx" in names


def test_paths_from_sse_payload_splits_produced_and_referenced() -> None:
    produced, referenced = paths_from_sse_payload(
        "group_reply",
        {
            "content": "好",
            "artifacts": [
                {
                    "name": "out.docx",
                    "source_path": "/tmp/out.docx",
                }
            ],
        },
    )
    assert produced == ["/tmp/out.docx"]
    assert referenced == []

    produced, referenced = paths_from_sse_payload(
        "tool_call",
        {"name": "file_read", "arguments": {"path": "/tmp/in.pdf"}},
    )
    assert produced == []
    assert referenced == ["/tmp/in.pdf"]

    produced, referenced = paths_from_sse_payload(
        "tool_result",
        {
            "name": "file_write",
            "result": "OK: wrote /tmp/out.xlsx (12 chars)",
        },
    )
    assert "/tmp/out.xlsx" in produced


def test_is_sendable_file_rejects_secrets_and_oversize(tmp_path: Path) -> None:
    ok = tmp_path / "brief.pdf"
    ok.write_bytes(b"%PDF-1.4")
    assert is_sendable_file(ok)

    secret = tmp_path / ".env"
    secret.write_text("KEY=1", encoding="utf-8")
    assert not is_sendable_file(secret)

    pem = tmp_path / "id_rsa"
    pem.write_text("x", encoding="utf-8")
    assert not is_sendable_file(pem)

    huge = tmp_path / "huge.pdf"
    huge.write_bytes(b"a" * (MAX_FILE_BYTES + 1))
    assert not is_sendable_file(huge)

    py = tmp_path / "main.py"
    py.write_text("print(1)\n", encoding="utf-8")
    assert not is_sendable_file(py)


def test_resolve_filename_under_workspace(tmp_path: Path) -> None:
    ws = tmp_path / "workspace"
    ws.mkdir()
    target = ws / "幻影旅团壁纸_翻译.md"
    target.write_text("# hi\n", encoding="utf-8")
    found = resolve_filename("幻影旅团壁纸_翻译.md", [ws])
    assert found == target.resolve()


def test_select_outbound_files_send_intent_finds_existing(
    tmp_path: Path,
) -> None:
    ws = tmp_path / "workspace"
    ws.mkdir()
    target = ws / "幻影旅团壁纸_翻译.md"
    target.write_text("# wallpaper\n", encoding="utf-8")

    none = select_outbound_files(
        user_input="总结一下这个翻译稿",
        produced_paths=[],
        referenced_paths=[str(target)],
        reply_text=f"文件在工作区：《{target.name}》",
        search_roots=[ws],
    )
    assert none == []

    sent = select_outbound_files(
        user_input="把翻译文件发我",
        produced_paths=[],
        referenced_paths=[],
        reply_text=f"文件在工作区：《{target.name}》",
        search_roots=[ws],
    )
    assert sent == [target.resolve()]


def test_select_outbound_files_sends_produced_without_intent(
    tmp_path: Path,
) -> None:
    doc = tmp_path / "交付.docx"
    doc.write_bytes(b"PK")
    sent = select_outbound_files(
        user_input="写一份合同摘要",
        produced_paths=[str(doc)],
        referenced_paths=[],
        reply_text="已保存到工作区",
        search_roots=[tmp_path],
    )
    assert sent == [doc.resolve()]


def test_build_sidecar_file_payload_and_notice(tmp_path: Path) -> None:
    path = tmp_path / "a.pdf"
    raw = b"%PDF-demo"
    path.write_bytes(raw)
    payload = build_sidecar_file_payload(
        path,
        recipient="wx-user",
        context_token="ctx",
        caption="",
    )
    assert payload["recipient"] == "wx-user"
    assert payload["context_token"] == "ctx"
    assert payload["filename"] == "a.pdf"
    assert payload["caption"] == "a.pdf"
    assert "text" not in payload
    assert base64.b64decode(payload["file"]) == raw

    notice = append_sent_files_notice("先看文字", [path])
    assert "已通过微信附件发送：a.pdf" in notice
    assert coerce_chat_result("hi") == WeChatChatResult(text="hi", file_paths=())
    wrapped = WeChatChatResult(text="x", file_paths=(str(path),))
    assert coerce_chat_result(wrapped) is wrapped


def test_select_caps_at_five(tmp_path: Path) -> None:
    paths = []
    for i in range(7):
        p = tmp_path / f"f{i}.pdf"
        p.write_bytes(b"%PDF")
        paths.append(str(p))
    sent = select_outbound_files(
        user_input="发我",
        produced_paths=paths,
        referenced_paths=[],
        reply_text="",
        search_roots=[tmp_path],
    )
    assert len(sent) == 5
