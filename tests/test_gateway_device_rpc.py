#!/usr/bin/env python3
"""Contract tests for the device RPC channel (device_rpc / rpc_reply over /ws/device).

Covers SP-M1: gateway-side waiter registry, ws_device rpc_reply dispatch, desktop
GatewayClient method table (sessions.list / session.messages / session.send /
confirm.pending / confirm.respond), and the byte-exact IM turn formatting after
the _execute_turn refactor.

No real network beyond 127.0.0.1: the "studio" is an httpx.MockTransport, the
gateway is a real uvicorn server on an ephemeral port, the desktop side is the
real GatewayClient over a real websocket.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import secrets
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest
import uvicorn

from agenticx.gateway.app import create_gateway_app
from agenticx.gateway.client import GatewayClient, GatewayClientSettings
from agenticx.gateway.config import DeviceAuthEntry, DevicesConfig, GatewayServerConfig
from agenticx.gateway.device_manager import DeviceManager
from agenticx.gateway.models import GatewayMessage

DEVICE_ID = "d1"
DEVICE_TOKEN = "tok1"
INSTALL_ID = "install-1"


# --------------------------------------------------------------------------
# fake studio（httpx.MockTransport 注入，替换所有 httpx.AsyncClient 的真实传输）
# --------------------------------------------------------------------------


class FakeStudio:
    """Programmable stand-in for the local studio REST API."""

    def __init__(self) -> None:
        self.sessions_payload: Any = [{"session_id": "s1", "title": "会话一"}]
        self.messages_payload: Any = [
            {"role": "user", "content": "你好"},
            {"role": "assistant", "content": "在的"},
        ]
        self.chat_events: List[Dict[str, Any]] = []
        self.chat_bodies: List[Dict[str, Any]] = []
        self.confirm_calls: List[Dict[str, Any]] = []
        self.requests: List[Tuple[str, str]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append((request.method, path))
        if request.method == "GET" and path == "/api/sessions":
            return httpx.Response(200, json=self.sessions_payload)
        if request.method == "GET" and path == "/api/session/messages":
            return httpx.Response(200, json=self.messages_payload)
        if request.method == "GET" and path == "/api/session":
            return httpx.Response(
                200,
                json={"session_id": request.url.params.get("session_id"), "avatar_id": ""},
            )
        if request.method == "POST" and path == "/api/chat":
            self.chat_bodies.append(json.loads(request.content.decode("utf-8")))
            sse = "".join(
                f"data: {json.dumps(evt, ensure_ascii=False)}\n\n" for evt in self.chat_events
            )
            return httpx.Response(
                200,
                text=sse,
                headers={"content-type": "text/event-stream"},
            )
        if request.method == "POST" and path == "/api/confirm":
            self.confirm_calls.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"detail": f"no fake for {path}"})


@pytest.fixture()
def fake_studio(monkeypatch: pytest.MonkeyPatch) -> FakeStudio:
    fake = FakeStudio()
    transport = httpx.MockTransport(fake.handler)
    real_async_client = httpx.AsyncClient

    def _factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", _factory)
    return fake


@pytest.fixture(autouse=True)
def _clean_pending_store() -> None:
    # _PENDING_CONFIRMS 是模块级全局，用例间必须清空避免串扰
    from agenticx.gateway import client as client_mod

    client_mod._PENDING_CONFIRMS._by_sender.clear()


# --------------------------------------------------------------------------
# gateway（真实 uvicorn，随机端口）+ 桌面端（真实 GatewayClient）
# --------------------------------------------------------------------------


def _gw_cfg() -> GatewayServerConfig:
    return GatewayServerConfig(
        devices=DevicesConfig(
            auth_tokens=[DeviceAuthEntry(device_id=DEVICE_ID, token=DEVICE_TOKEN)],
        ),
    )


def _client_settings(port: int) -> GatewayClientSettings:
    return GatewayClientSettings(
        enabled=True,
        gateway_ws_url=f"ws://127.0.0.1:{port}/ws/device/{DEVICE_ID}?token={DEVICE_TOKEN}",
        device_id=DEVICE_ID,
        token=DEVICE_TOKEN,
        studio_base_url="http://studio.fake",
        desktop_token="dtok",
    )


class _Gateway:
    def __init__(self, app: Any, server: uvicorn.Server, task: "asyncio.Task[None]", port: int):
        self.app = app
        self.server = server
        self.task = task
        self.port = port
        self.client: Optional[GatewayClient] = None
        self.client_task: Optional["asyncio.Task[None]"] = None

    async def start_desktop(self) -> None:
        self.client = GatewayClient(_client_settings(self.port))
        self.client_task = asyncio.create_task(self.client.run_forever())
        dm: DeviceManager = self.app.state.device_manager
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            if dm.is_online(DEVICE_ID):
                return
            await asyncio.sleep(0.05)
        raise TimeoutError("desktop client did not come online")

    async def rpc(self, method: str, params: Dict[str, Any], timeout: float = 15.0) -> Optional[dict]:
        dm: DeviceManager = self.app.state.device_manager
        cid = secrets.token_hex(8)
        sent = await dm.send_to_device(
            DEVICE_ID,
            {"type": "device_rpc", "correlation_id": cid, "method": method, "params": params},
        )
        assert sent, "device offline"
        return await dm.wait_for_rpc_reply(cid, timeout=timeout)

    async def stop(self) -> None:
        if self.client_task is not None:
            self.client_task.cancel()
            try:
                await self.client_task
            except asyncio.CancelledError:
                pass
        self.server.should_exit = True
        await self.task


@pytest.fixture()
async def gateway() -> _Gateway:
    app = create_gateway_app(_gw_cfg())
    config = uvicorn.Config(
        app, host="127.0.0.1", port=0, log_level="warning", lifespan="off"
    )
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if server.started and server.servers:
            break
        await asyncio.sleep(0.05)
    else:
        server.should_exit = True
        raise TimeoutError("gateway server did not start")
    port = server.servers[0].sockets[0].getsockname()[1]
    gw = _Gateway(app, server, task, port)
    try:
        yield gw
    finally:
        await gw.stop()


# --------------------------------------------------------------------------
# DeviceManager 单测
# --------------------------------------------------------------------------


async def test_wait_for_rpc_reply_timeout_returns_none() -> None:
    dm = DeviceManager()
    assert await dm.wait_for_rpc_reply("nope", timeout=0.05) is None


async def test_rpc_waiter_resolve_roundtrip() -> None:
    dm = DeviceManager()

    async def _resolve_later() -> None:
        await asyncio.sleep(0.01)
        assert dm.resolve_rpc_reply("c1", {"ok": True, "data": [1, 2]}) is True
        # 二次 resolve（已 done）应返回 False
        assert dm.resolve_rpc_reply("c1", {"ok": True}) is False

    t = asyncio.create_task(_resolve_later())
    assert await dm.wait_for_rpc_reply("c1", timeout=2.0) == {"ok": True, "data": [1, 2]}
    await t
    # 超时清理后，同 cid 再 resolve 也是 False（等待器已移除）
    assert dm.resolve_rpc_reply("c1", {"ok": True}) is False


async def test_rpc_waiters_isolated_from_reply_waiters() -> None:
    dm = DeviceManager()
    from agenticx.gateway.models import GatewayReply

    async def _poke_later() -> None:
        await asyncio.sleep(0.01)
        # 用 IM 的 resolve_reply 去戳 rpc 等待器：必须无效（c2 上只有 rpc waiter）
        assert dm.resolve_reply("c2", GatewayReply(content="x")) is False

    t = asyncio.create_task(_poke_later())
    # IM 侧的 resolve 无法唤醒 rpc 等待器 → 超时返回 None
    assert await dm.wait_for_rpc_reply("c2", timeout=0.2) is None
    await t


# --------------------------------------------------------------------------
# e2e：gateway ↔ desktop ↔ fake studio
# --------------------------------------------------------------------------


async def test_rpc_sessions_list_pass_through(gateway: _Gateway, fake_studio: FakeStudio) -> None:
    await gateway.start_desktop()
    fake_studio.sessions_payload = [{"session_id": "s1"}, {"session_id": "s2"}]
    reply = await gateway.rpc("sessions.list", {})
    assert reply == {"ok": True, "data": [{"session_id": "s1"}, {"session_id": "s2"}]}


async def test_rpc_session_messages_pass_through(gateway: _Gateway, fake_studio: FakeStudio) -> None:
    await gateway.start_desktop()
    fake_studio.messages_payload = [{"role": "user", "content": "hi"}]
    reply = await gateway.rpc("session.messages", {"session_id": "s1"})
    assert reply == {"ok": True, "data": [{"role": "user", "content": "hi"}]}
    assert ("GET", "/api/session/messages") in fake_studio.requests


async def test_rpc_sessions_and_messages_unwrap_studio_envelope(
    gateway: _Gateway, fake_studio: FakeStudio
) -> None:
    """真实 studio 返回 {"ok": true, "sessions"/"messages": [...]}；设备 RPC 只透传数组。"""
    await gateway.start_desktop()
    fake_studio.sessions_payload = {"ok": True, "sessions": [{"session_id": "s9"}]}
    reply = await gateway.rpc("sessions.list", {})
    assert reply == {"ok": True, "data": [{"session_id": "s9"}]}

    fake_studio.messages_payload = {
        "ok": True,
        "messages": [{"role": "user", "content": "x"}],
    }
    reply2 = await gateway.rpc("session.messages", {"session_id": "s9"})
    assert reply2 == {"ok": True, "data": [{"role": "user", "content": "x"}]}


async def test_rpc_session_send_normal_turn(gateway: _Gateway, fake_studio: FakeStudio) -> None:
    await gateway.start_desktop()
    fake_studio.chat_events = [
        {"type": "tool_call", "data": {"tool_name": "web_search"}},
        {"type": "final", "data": {"text": "结果 OK"}},
    ]
    reply = await gateway.rpc(
        "session.send",
        {"session_id": "s1", "text": "查一下", "sender_name": "Mobile User", "install_id": INSTALL_ID},
    )
    assert reply is not None and reply["ok"] is True
    data = reply["data"]
    assert data["reply"] == "结果 OK"
    assert data["progress"] == ["开始：web_search"]
    assert data["pending_confirm"] is None
    # RPC 路径的 chat body：不 merge IM group 字段、不带 speaker 信息
    assert fake_studio.chat_bodies[-1] == {
        "session_id": "s1",
        "user_input": "查一下",
        "user_display_name": "Mobile User",
    }


async def test_rpc_session_send_confirm_roundtrip(gateway: _Gateway, fake_studio: FakeStudio) -> None:
    await gateway.start_desktop()
    fake_studio.chat_events = [
        {"type": "tool_call", "data": {"tool_name": "bash"}},
        {"type": "confirm_required", "data": {"id": "req-9", "question": "允许执行？", "agent_id": "meta"}},
    ]
    reply = await gateway.rpc(
        "session.send",
        {"session_id": "s1", "text": "跑个命令", "sender_name": "", "install_id": INSTALL_ID},
    )
    assert reply is not None and reply["ok"] is True
    pend = reply["data"]["pending_confirm"]
    assert pend is not None
    assert pend["request_id"] == "req-9"
    assert pend["agent_id"] == "meta"
    assert pend["session_id"] == "s1"
    assert pend["question"] == "允许执行？"
    assert isinstance(pend["created_at"], float)

    # confirm.pending 能查到（sender_key = mobile:{install_id}）
    r2 = await gateway.rpc("confirm.pending", {"install_id": INSTALL_ID})
    assert r2 == {"ok": True, "data": [pend]}

    # confirm.respond approve → POST /api/confirm + store 清空
    r3 = await gateway.rpc(
        "confirm.respond",
        {"install_id": INSTALL_ID, "request_id": "req-9", "approved": True},
    )
    assert r3 == {"ok": True, "data": {"ok": True, "message": "已确认继续执行（request_id: `req-9`）。"}}
    assert len(fake_studio.confirm_calls) == 1
    assert fake_studio.confirm_calls[0] == {
        "session_id": "s1",
        "request_id": "req-9",
        "approved": True,
        "agent_id": "meta",
    }

    r4 = await gateway.rpc("confirm.pending", {"install_id": INSTALL_ID})
    assert r4 == {"ok": True, "data": []}

    # 已处理过的 request_id 再 respond → ok:false + error
    r5 = await gateway.rpc(
        "confirm.respond",
        {"install_id": INSTALL_ID, "request_id": "req-9", "approved": False, "reason": "算了"},
    )
    assert r5 is not None and r5["ok"] is False
    assert "req-9" in r5["error"]


async def test_rpc_unknown_method_error_keeps_connection(gateway: _Gateway, fake_studio: FakeStudio) -> None:
    await gateway.start_desktop()
    reply = await gateway.rpc("no.such.method", {})
    assert reply is not None and reply["ok"] is False
    assert "no.such.method" in reply["error"]

    # WS 连接不断：随后的正常 RPC 仍然成功
    fake_studio.sessions_payload = [{"session_id": "s1"}]
    reply2 = await gateway.rpc("sessions.list", {})
    assert reply2 == {"ok": True, "data": [{"session_id": "s1"}]}


# --------------------------------------------------------------------------
# 桌面端单元：RPC 不经过 IM 的串行信号量
# --------------------------------------------------------------------------


class _FakeWS:
    def __init__(self) -> None:
        self.sent: List[Dict[str, Any]] = []

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))


async def test_device_rpc_readonly_methods_run_concurrently(
    fake_studio: FakeStudio, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = GatewayClient(_client_settings(1))
    events: List[str] = []
    orig = client._rpc_sessions_list

    async def _slow_sessions() -> Any:
        events.append("start")
        await asyncio.sleep(0.1)
        events.append("end")
        return await orig()

    monkeypatch.setattr(client, "_rpc_sessions_list", _slow_sessions)
    ws = _FakeWS()
    t0 = time.monotonic()
    await asyncio.gather(
        client._handle_device_rpc(ws, "c1", "sessions.list", {}),
        client._handle_device_rpc(ws, "c2", "sessions.list", {}),
    )
    elapsed = time.monotonic() - t0
    # 两个只读 RPC 并发执行（若被 sem 串行化则需要 >= 0.2s）
    assert elapsed < 0.19, f"RPC serialized by semaphore? elapsed={elapsed:.3f}"
    assert events[0] == "start" and events[1] == "start"
    assert [m["ok"] for m in ws.sent] == [True, True]
    assert [m["correlation_id"] for m in ws.sent] == ["c1", "c2"]


async def test_device_rpc_exception_replies_error(fake_studio: FakeStudio) -> None:
    client = GatewayClient(_client_settings(1))
    ws = _FakeWS()
    await client._handle_device_rpc(ws, "c1", "session.messages", {})
    assert ws.sent == [
        {"type": "rpc_reply", "correlation_id": "c1", "ok": False, "error": "session_id required"}
    ]


# --------------------------------------------------------------------------
# IM 文本格式对照（重构后 _execute_turn 输出必须与重构前逐字节一致）
# --------------------------------------------------------------------------


def _im_msg(content: str) -> GatewayMessage:
    return GatewayMessage(
        message_id="m1",
        source="feishu",
        sender_id="ou_1",
        sender_name="Tester",
        content=content,
    )


async def test_im_turn_normal_reply_with_progress(fake_studio: FakeStudio) -> None:
    fake_studio.chat_events = [
        {"type": "tool_call", "data": {"tool_name": "web_search"}},
        {"type": "tool_result", "data": {"tool_name": "web_search"}},
        {"type": "final", "data": {"text": "搜索完成，结论是 42。"}},
    ]
    client = GatewayClient(_client_settings(1))
    out = await client._execute_turn(_im_msg("搜索一下"))
    assert out == "执行进度：\n- 开始：web_search\n- 完成：web_search\n\n搜索完成，结论是 42。"


async def test_im_turn_progress_dedupe_and_truncate(fake_studio: FakeStudio) -> None:
    # 6 个不同名 tool_call + 1 个重名（去重）+ 1 个新名 → 去重后 7 条，截断留最后 6 条
    fake_studio.chat_events = [
        {"type": "tool_call", "data": {"tool_name": f"t{i}"}}
        for i in range(6)
    ] + [
        {"type": "tool_call", "data": {"tool_name": "t0"}},  # 重名 → 去重
        {"type": "tool_call", "data": {"tool_name": "t6"}},  # 第 7 个不同名 → 截断后 t0 掉队
        {"type": "final", "data": {"text": "done"}},
    ]
    client = GatewayClient(_client_settings(1))
    out = await client._execute_turn(_im_msg("跑任务"))
    assert out == (
        "执行进度：\n"
        "- 开始：t1\n"
        "- 开始：t2\n"
        "- 开始：t3\n"
        "- 开始：t4\n"
        "- 开始：t5\n"
        "- 开始：t6\n"
        "\ndone"
    )


async def test_im_turn_confirm_required_hint(fake_studio: FakeStudio) -> None:
    fake_studio.chat_events = [
        {"type": "tool_call", "data": {"tool_name": "bash"}},
        {"type": "confirm_required", "data": {"id": "req-1", "question": "确认执行 rm -rf？"}},
    ]
    client = GatewayClient(_client_settings(1))
    out = await client._execute_turn(_im_msg("跑个危险命令"))
    assert out == (
        "执行进度：\n"
        "- 开始：bash\n"
        "\n"
        "⏸ 当前任务等待确认\n"
        "- request_id: `req-1`\n"
        "- 问题: 确认执行 rm -rf？\n"
        "\n"
        "回复 `/approve req-1` 继续，或 `/deny req-1` 拒绝。"
    )


async def test_im_turn_empty_reply_fallback(fake_studio: FakeStudio) -> None:
    fake_studio.chat_events = [
        {"type": "token", "data": {"text": ""}},
        {"type": "final", "data": {"text": ""}},
    ]
    client = GatewayClient(_client_settings(1))
    out = await client._execute_turn(_im_msg("你好"))
    assert out == "（无文本回复）"


async def test_im_turn_progress_only_when_final_empty(fake_studio: FakeStudio) -> None:
    # final 为空文本但事件存在（saw_final=True）→ 只有进度块
    fake_studio.chat_events = [
        {"type": "tool_call", "data": {"tool_name": "bash"}},
        {"type": "final", "data": {"text": ""}},
    ]
    client = GatewayClient(_client_settings(1))
    out = await client._execute_turn(_im_msg("跑"))
    assert out == "执行进度：\n- 开始：bash"
