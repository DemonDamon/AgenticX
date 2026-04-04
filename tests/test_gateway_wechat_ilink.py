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


@pytest.mark.asyncio
async def test_handle_event_recovers_stale_bound_session(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    calls: list[str] = []

    async def _fake_chat_turn(text: str, sender_name: str, *, session_id: str = "") -> str:
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

    monkeypatch.setattr(adapter, "_resolve_bound_session", lambda: "agx-session-stale")
    monkeypatch.setattr(adapter, "_chat_turn", _fake_chat_turn)
    monkeypatch.setattr(adapter, "_send_reply", _fake_send_reply)
    monkeypatch.setattr(adapter, "_recover_desktop_bound_session", _fake_recover)

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

    assert calls == ["agx-session-stale", "agx-session-new"]
