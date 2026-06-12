#!/usr/bin/env python3
"""Tests for session chat image attachment helpers.

Author: Damon Li
"""

from __future__ import annotations

import base64
from pathlib import Path

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession
from agenticx.runtime.agent_runtime import _promote_user_image_attachments
from agenticx.studio.chat_attachments import (
    image_data_url_from_attachment,
    materialize_message_lists_image_uploads,
    materialize_session_image_uploads,
    resolve_session_chat_image,
    sync_agent_messages_attachments_from_chat_history,
)

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_DATA_URL = f"data:image/png;base64,{base64.b64encode(PNG_1X1).decode('ascii')}"


def test_materialize_message_lists_image_uploads_backfills_history(tmp_path, monkeypatch) -> None:
    sid = "sess-backfill"
    uploads = tmp_path / sid / "uploads"
    monkeypatch.setattr(
        "agenticx.studio.chat_attachments.session_uploads_dir",
        lambda _sid: uploads,
    )
    chat_history = [
        {
            "role": "user",
            "content": "看图",
            "attachments": [
                {"name": "image.png", "mime_type": "image/png", "data_url": _DATA_URL, "size": len(PNG_1X1)}
            ],
        }
    ]
    changed = materialize_message_lists_image_uploads(sid, [chat_history])
    assert changed is True
    sp = chat_history[0]["attachments"][0].get("storage_path")
    assert sp and Path(sp).is_file()


def test_materialize_session_image_uploads_writes_storage_path(tmp_path, monkeypatch) -> None:
    sid = "sess-materialize"
    uploads = tmp_path / sid / "uploads"
    monkeypatch.setattr(
        "agenticx.studio.chat_attachments.session_uploads_dir",
        lambda _sid: uploads,
    )
    atts = [{"name": "image.png", "mime_type": "image/png", "data_url": _DATA_URL, "size": len(PNG_1X1)}]
    out = materialize_session_image_uploads(sid, atts)
    assert len(out) == 1
    storage_path = str(out[0].get("storage_path", "") or "")
    assert storage_path
    assert Path(storage_path).is_file()
    assert Path(storage_path).read_bytes() == PNG_1X1


def test_sync_agent_messages_attachments_from_chat_history_by_content() -> None:
    chat_history = [
        {
            "role": "user",
            "content": "这是什么图？",
            "attachments": [{"name": "image.png", "mime_type": "image/png", "data_url": _DATA_URL}],
        }
    ]
    agent_messages = [{"role": "user", "content": "这是什么图？"}]
    sync_agent_messages_attachments_from_chat_history(agent_messages, chat_history)
    assert agent_messages[0]["attachments"][0]["data_url"] == _DATA_URL


def test_promote_user_image_attachments_from_storage_path_only(tmp_path) -> None:
    image_path = tmp_path / "saved.png"
    image_path.write_bytes(PNG_1X1)
    messages = [
        {
            "role": "user",
            "content": "看看这张图",
            "attachments": [
                {
                    "name": "image.png",
                    "mime_type": "image/png",
                    "storage_path": str(image_path),
                }
            ],
        }
    ]
    out = _promote_user_image_attachments(messages, "moonshot", "kimi-k2.6")
    content = out[0]["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "text"
    assert content[1]["type"] == "image_url"
    assert str(content[1]["image_url"]["url"]).startswith("data:image/png;base64,")


def test_image_data_url_from_attachment_prefers_inline_data_url() -> None:
    att = {"data_url": _DATA_URL, "storage_path": "/tmp/missing.png"}
    assert image_data_url_from_attachment(att) == _DATA_URL


def test_resolve_session_chat_image_by_basename() -> None:
    session = StudioSession()
    session.chat_history = [
        {
            "role": "user",
            "content": "upload",
            "attachments": [
                {
                    "name": "image.png",
                    "mime_type": "image/png",
                    "data_url": _DATA_URL,
                }
            ],
        }
    ]
    hit = resolve_session_chat_image(session, "image.png")
    assert hit is not None
    data, mime, name, _source = hit
    assert data == PNG_1X1
    assert mime == "image/png"
    assert name == "image.png"


@pytest.mark.asyncio
async def test_view_image_resolves_session_upload_by_basename(monkeypatch) -> None:
    session = StudioSession()
    session.provider_name = "moonshot"
    session.model_name = "kimi-k2.6"
    session.chat_history = [
        {
            "role": "user",
            "content": "upload",
            "attachments": [
                {
                    "name": "image.png",
                    "mime_type": "image/png",
                    "data_url": _DATA_URL,
                }
            ],
        }
    ]
    monkeypatch.setattr(agent_tools, "_desktop_unrestricted_fs_enabled", lambda: True)
    result = await agent_tools._tool_view_image({"target": "image.png"}, session)
    assert result.startswith("[image loaded:")
    pending = session.scratchpad[agent_tools.PENDING_VISUAL_ATTACHMENTS_KEY]
    assert pending[0]["name"] == "image.png"
