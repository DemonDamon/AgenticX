#!/usr/bin/env python3
"""Feishu reply client against a mock transport.

Author: Damon Li
"""

from __future__ import annotations

import json

import httpx
import pytest

from ma_agent_runtime.channels.feishu_api import FeishuOpenApi

BASE = "https://open.feishu.cn"


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_reply_posts_rich_text() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/tenant_access_token/internal"):
            body = json.loads(request.content)
            assert body["app_id"] == "cli_a1b2c3"
            return httpx.Response(200, json={"code": 0, "tenant_access_token": "tok", "expire": 7200})
        return httpx.Response(200, json={"code": 0})

    api = FeishuOpenApi(app_id="cli_a1b2c3", app_secret="sec", base_url=BASE, http=_client(handler))
    assert await api.reply(message_id="om_1", text="你好")
    reply = seen[1]
    assert reply.url.path == "/open-apis/im/v1/messages/om_1/reply"
    body = json.loads(reply.content)
    assert body["msg_type"] == "post"
    assert "zh_cn" in json.loads(body["content"])


@pytest.mark.asyncio
async def test_falls_back_to_text() -> None:
    kinds: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/tenant_access_token/internal"):
            return httpx.Response(200, json={"code": 0, "tenant_access_token": "tok", "expire": 7200})
        body = json.loads(request.content)
        kinds.append(body["msg_type"])
        if body["msg_type"] == "post":
            return httpx.Response(200, json={"code": 230001})
        return httpx.Response(200, json={"code": 0})

    api = FeishuOpenApi(app_id="cli_a1b2c3", app_secret="sec", base_url=BASE, http=_client(handler))
    assert await api.reply(message_id="om_1", text="你好")
    assert kinds == ["post", "text"]


@pytest.mark.asyncio
async def test_token_cached() -> None:
    token_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal token_calls
        if request.url.path.endswith("/tenant_access_token/internal"):
            token_calls += 1
            return httpx.Response(200, json={"code": 0, "tenant_access_token": "tok", "expire": 7200})
        return httpx.Response(200, json={"code": 0})

    api = FeishuOpenApi(app_id="cli_a1b2c3", app_secret="sec", base_url=BASE, http=_client(handler))
    assert await api.reply(message_id="om_1", text="a")
    assert await api.reply(message_id="om_2", text="b")
    assert token_calls == 1


def test_repr_hides_secret() -> None:
    api = FeishuOpenApi(app_id="cli_a1b2c3", app_secret="sec", base_url=BASE, http=httpx.AsyncClient())
    assert "sec" not in repr(api)
