#!/usr/bin/env python3
"""Tests for mobile true-streaming: MobileStreamHub, TurnProgressForwarder,
and the /ws/mobile end-to-end routing (device WS turn_progress → mobile WS).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import pytest
import uvicorn
import websockets

from agenticx.gateway.app import create_gateway_app
from agenticx.gateway.client import TurnProgressForwarder
from agenticx.gateway.config import DeviceAuthEntry, DevicesConfig, GatewayServerConfig
from agenticx.gateway.device_manager import DeviceManager
from agenticx.gateway.mobile_stream import MobileStreamHub

DEVICE_ID = "d1"
DEVICE_TOKEN = "tok1"
BINDING_CODE = "111222"
INSTALL_ID = "install-1"
SESSION_ID = "sess-stream-1"


@pytest.fixture()
def token_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    p = tmp_path / "mobile_tokens.json"
    monkeypatch.setenv("AGX_MOBILE_TOKEN_FILE", str(p))
    return p


def _gw_cfg() -> GatewayServerConfig:
    return GatewayServerConfig(
        devices=DevicesConfig(
            auth_tokens=[
                DeviceAuthEntry(
                    device_id=DEVICE_ID, token=DEVICE_TOKEN, binding_code=BINDING_CODE
                ),
            ],
        ),
    )


# --------------------------------------------------------------------------
# fakes
# --------------------------------------------------------------------------


class FakeMobileWs:
    """MobileStreamHub 单测用的最小 WS 桩：只需 send_text。"""

    def __init__(self) -> None:
        self.sent: List[str] = []
        self.dead = False

    async def send_text(self, frame: str) -> None:
        if self.dead:
            raise RuntimeError("connection closed")
        self.sent.append(frame)


class FakeDesktopWs:
    """TurnProgressForwarder 单测用的最小 device WS 桩：只需 send。"""

    def __init__(self) -> None:
        self.sent: List[str] = []

    async def send(self, payload: str) -> None:
        self.sent.append(payload)


# --------------------------------------------------------------------------
# MobileStreamHub 单测
# --------------------------------------------------------------------------


class TestMobileStreamHub:
    async def test_broadcast_reaches_all_subscribers(self) -> None:
        hub = MobileStreamHub()
        a, b = FakeMobileWs(), FakeMobileWs()
        hub.subscribe(SESSION_ID, a)  # type: ignore[arg-type]
        hub.subscribe(SESSION_ID, b)  # type: ignore[arg-type]
        await hub.broadcast(SESSION_ID, {"type": "turn_delta", "delta": "x"})
        assert len(a.sent) == 1
        assert len(b.sent) == 1
        assert json.loads(a.sent[0])["delta"] == "x"

    async def test_unsubscribe_stops_delivery(self) -> None:
        hub = MobileStreamHub()
        a = FakeMobileWs()
        hub.subscribe(SESSION_ID, a)  # type: ignore[arg-type]
        hub.unsubscribe(SESSION_ID, a)  # type: ignore[arg-type]
        await hub.broadcast(SESSION_ID, {"type": "turn_delta", "delta": "x"})
        assert a.sent == []
        assert hub.subscriber_count(SESSION_ID) == 0

    async def test_dead_connections_are_pruned(self) -> None:
        hub = MobileStreamHub()
        alive, dead = FakeMobileWs(), FakeMobileWs()
        dead.dead = True
        hub.subscribe(SESSION_ID, alive)  # type: ignore[arg-type]
        hub.subscribe(SESSION_ID, dead)  # type: ignore[arg-type]
        await hub.broadcast(SESSION_ID, {"type": "turn_delta", "delta": "x"})
        assert len(alive.sent) == 1
        assert hub.subscriber_count(SESSION_ID) == 1

    async def test_broadcast_without_subscribers_is_noop(self) -> None:
        hub = MobileStreamHub()
        await hub.broadcast("nobody", {"type": "turn_delta"})


# --------------------------------------------------------------------------
# TurnProgressForwarder 单测
# --------------------------------------------------------------------------


class TestTurnProgressForwarder:
    async def test_tokens_within_interval_are_batched(self) -> None:
        ws = FakeDesktopWs()
        fwd = TurnProgressForwarder(ws, SESSION_ID, min_interval=0.5)
        await fwd.add("a")  # 冷启动立即下发
        await fwd.add("b")  # 攒批
        await fwd.add("c")  # 攒批
        frames = [json.loads(s) for s in ws.sent]
        progresses = [f for f in frames if f["type"] == "turn_progress"]
        assert len(progresses) == 1
        assert progresses[0]["payload"] == {
            "session_id": SESSION_ID,
            "delta": "a",
        }
        await fwd.close()  # flush 余量 + end
        frames = [json.loads(s) for s in ws.sent]
        progresses = [f for f in frames if f["type"] == "turn_progress"]
        assert len(progresses) == 2
        assert progresses[1]["payload"]["delta"] == "bc"
        ends = [f for f in frames if f["type"] == "turn_progress_end"]
        assert len(ends) == 1
        assert ends[0]["payload"] == {"session_id": SESSION_ID}

    async def test_pending_batch_flushes_after_interval(self) -> None:
        ws = FakeDesktopWs()
        fwd = TurnProgressForwarder(ws, SESSION_ID, min_interval=0.05)
        await fwd.add("hello")  # 立即 flush
        await fwd.add("world")  # 攒批，靠兜底 timer flush
        await asyncio.sleep(0.25)
        frames = [json.loads(s) for s in ws.sent]
        progresses = [f for f in frames if f["type"] == "turn_progress"]
        deltas = [p["payload"]["delta"] for p in progresses]
        assert deltas == ["hello", "world"]

    async def test_send_failure_is_silent(self) -> None:
        class BrokenWs(FakeDesktopWs):
            async def send(self, payload: str) -> None:
                raise RuntimeError("ws closed")

        fwd = TurnProgressForwarder(BrokenWs(), SESSION_ID, min_interval=0.5)
        await fwd.add("x")  # 不抛
        await fwd.close()  # 不抛

    async def test_empty_text_is_ignored(self) -> None:
        ws = FakeDesktopWs()
        fwd = TurnProgressForwarder(ws, SESSION_ID)
        await fwd.add("")
        await fwd.close()
        assert all(
            json.loads(s)["type"] != "turn_progress" for s in ws.sent
        )


# --------------------------------------------------------------------------
# /ws/mobile 端到端：device WS turn_progress → 手机 WS turn_delta
# --------------------------------------------------------------------------


class _Gateway:
    def __init__(self, app: Any, server: uvicorn.Server, task: "asyncio.Task[None]", port: int):
        self.app = app
        self.server = server
        self.task = task
        self.port = port
        self.desktop_ws: Optional[Any] = None

    async def stop(self) -> None:
        if self.desktop_ws is not None:
            await self.desktop_ws.close()
        self.server.should_exit = True
        await self.task


@pytest.fixture()
async def gateway(token_file: Path):
    app = create_gateway_app(_gw_cfg())
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
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


async def _bind_mobile(gw: _Gateway) -> Dict[str, str]:
    async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{gw.port}", timeout=30.0) as c:
        r = await c.post(
            "/api/connect/session", json={"device_id": DEVICE_ID, "token": DEVICE_TOKEN}
        )
        assert r.status_code == 200, r.text
        connect_session_id = r.json()["session_id"]
        r = await c.post(
            "/api/mobile/bind",
            json={"connect_session_id": connect_session_id, "install_id": INSTALL_ID},
        )
        assert r.status_code == 200, r.text
        payload = r.json()
        return {
            "install_id": INSTALL_ID,
            "token": str(payload["mobile_token"]),
        }


async def _recv_until(ws: Any, predicate, timeout: float = 5.0) -> Dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic())
        except asyncio.TimeoutError:
            break
        data = json.loads(raw)
        if predicate(data):
            return data
    raise TimeoutError("expected frame not received")


class TestWsMobileEndToEnd:
    async def test_turn_progress_routed_to_subscribed_mobile(self, gateway: _Gateway) -> None:
        creds = await _bind_mobile(gateway)
        # desktop 连上 device WS
        gateway.desktop_ws = await websockets.connect(
            f"ws://127.0.0.1:{gateway.port}/ws/device/{DEVICE_ID}?token={DEVICE_TOKEN}"
        )
        dm: DeviceManager = gateway.app.state.device_manager
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline and not dm.is_online(DEVICE_ID):
            await asyncio.sleep(0.05)
        # mobile 订阅会话
        mobile_ws = await websockets.connect(
            f"ws://127.0.0.1:{gateway.port}/ws/mobile"
            f"?install_id={creds['install_id']}&token={creds['token']}"
        )
        await mobile_ws.send(json.dumps({"type": "subscribe", "session_id": SESSION_ID}))
        ack = json.loads(await mobile_ws.recv())
        assert ack == {"type": "subscribed", "session_id": SESSION_ID}
        # desktop 发 token 增量 → 手机应收到 turn_delta
        await gateway.desktop_ws.send(
            json.dumps(
                {
                    "type": "turn_progress",
                    "payload": {"session_id": SESSION_ID, "delta": "你好"},
                },
                ensure_ascii=False,
            )
        )
        frame = await _recv_until(mobile_ws, lambda d: d.get("type") == "turn_delta")
        assert frame["session_id"] == SESSION_ID
        assert frame["delta"] == "你好"
        # 回合结束
        await gateway.desktop_ws.send(
            json.dumps(
                {"type": "turn_progress_end", "payload": {"session_id": SESSION_ID}}
            )
        )
        done = await _recv_until(mobile_ws, lambda d: d.get("type") == "turn_done")
        assert done["session_id"] == SESSION_ID
        await mobile_ws.close()

    async def test_unsubscribed_session_gets_nothing(self, gateway: _Gateway) -> None:
        creds = await _bind_mobile(gateway)
        gateway.desktop_ws = await websockets.connect(
            f"ws://127.0.0.1:{gateway.port}/ws/device/{DEVICE_ID}?token={DEVICE_TOKEN}"
        )
        mobile_ws = await websockets.connect(
            f"ws://127.0.0.1:{gateway.port}/ws/mobile"
            f"?install_id={creds['install_id']}&token={creds['token']}"
        )
        await gateway.desktop_ws.send(
            json.dumps(
                {
                    "type": "turn_progress",
                    "payload": {"session_id": "other-session", "delta": "x"},
                }
            )
        )
        # 未订阅：短暂等待后应无 turn_delta 帧
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(mobile_ws.recv(), timeout=0.5)
        await mobile_ws.close()

    async def test_bad_token_is_rejected(self, gateway: _Gateway) -> None:
        await _bind_mobile(gateway)
        ws = await websockets.connect(
            f"ws://127.0.0.1:{gateway.port}/ws/mobile"
            f"?install_id={INSTALL_ID}&token=wrong-token"
        )
        # 鉴权失败：连接被服务端关闭（code 4401 → 收到 eof）
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            raise AssertionError(f"expected close, got frame: {raw}")
        except (websockets.exceptions.ConnectionClosed, asyncio.TimeoutError):
            pass
