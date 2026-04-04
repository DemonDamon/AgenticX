#!/usr/bin/env python3
"""Tests for WeChat iLink adapter routing behavior."""

from __future__ import annotations

import pytest

from agenticx.gateway.adapters.wechat_ilink import WeChatILinkAdapter


@pytest.mark.asyncio
async def test_handle_event_prefers_bound_session_id(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    captured: dict[str, str] = {}

    async def _fake_chat_turn(text: str, sender_name: str, *, session_id: str = "") -> str:
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

    monkeypatch.setattr(adapter, "_resolve_bound_session", lambda: "agx-session-123")
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)

    evt = {
        "type": "message",
        "text": "hello",
        "sender": "wx-user",
        "session_id": "wechat-session-xyz",
        "group_id": "",
        "context_token": "ctx",
        "items": [],
    }

    await adapter._handle_event("http://127.0.0.1:9999", evt)

    assert captured["session_id"] == "agx-session-123"
