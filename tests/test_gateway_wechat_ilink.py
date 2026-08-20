#!/usr/bin/env python3
"""Tests for WeChat iLink adapter routing behavior."""

from __future__ import annotations

import pytest

from agenticx.gateway.adapters.wechat_ilink import WeChatILinkAdapter


@pytest.mark.asyncio
async def test_handle_event_prefers_bound_session_id(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = WeChatILinkAdapter(sidecar_url="http://127.0.0.1:9999")
    captured: dict[str, str] = {}

    # _chat_turn 后来加了 sender_key / provider / model 三个关键字参数。桩不收的话
    # 调用会以 TypeError 失败，而 _handle_event 的 except Exception 会把它当成"这一轮
    # 聊天挂了"接住，用例看到的就是 captured 里什么都没有——错因完全被盖住。
    async def _fake_chat_turn(
        text: str,
        sender_name: str,
        *,
        session_id: str = "",
        sender_key: str = "",
        provider: str | None = None,
        model: str | None = None,
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

    # _resolve_bound_session 返回的是 (session_id, provider, model) 三元组：
    # 绑定里加上 provider/model 之后就是这个签名了，桩还停在只返回 session_id 的
    # 年代，于是调用方 `a, b, c = ...` 把字符串拆成了 16 个字符。
    monkeypatch.setattr(
        adapter, "_resolve_bound_session", lambda: ("agx-session-123", None, None)
    )
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

    async def _fake_chat_turn(
        text: str,
        sender_name: str,
        *,
        session_id: str = "",
        sender_key: str = "",
        provider: str | None = None,
        model: str | None = None,
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
