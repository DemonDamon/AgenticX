#!/usr/bin/env python3
"""Contract tests for the /api/mobile/* surface (SP-M2).

Real uvicorn gateway on an ephemeral port + a fake desktop connected over the
real device WS (/ws/device) that records device_rpc frames and replies with
scripted rpc_reply payloads. Covers bind flow, mobile token auth, RPC bridging
for every endpoint, offline/timeout semantics, and unbind.

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
from agenticx.gateway.config import DeviceAuthEntry, DevicesConfig, GatewayServerConfig
from agenticx.gateway.device_manager import DeviceManager

DEVICE_ID = "d1"
DEVICE_TOKEN = "tok1"
BINDING_CODE = "111222"
INSTALL_ID = "install-1"


@pytest.fixture()
def token_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolate the mobile token store per test (env overrides all default paths)."""
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
# fake desktop：连上 /ws/device 扮演桌面，记录 device_rpc 帧并按脚本回复
# --------------------------------------------------------------------------


class FakeDesktop:
    def __init__(self, port: int) -> None:
        self._url = f"ws://127.0.0.1:{port}/ws/device/{DEVICE_ID}?token={DEVICE_TOKEN}"
        self._ws: Optional[Any] = None
        self._task: Optional["asyncio.Task[None]"] = None
        self.received: List[Dict[str, Any]] = []
        # method -> rpc_reply payload（不含 type/correlation_id）
        self.replies: Dict[str, Dict[str, Any]] = {}
        # 收到但不回复的 method（模拟桌面挂起，触发 504 路径）
        self.silent_methods: set[str] = set()

    async def start(self) -> None:
        self._ws = await websockets.connect(self._url)
        self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                data = json.loads(raw)
                if data.get("type") != "device_rpc":
                    continue
                self.received.append(data)
                method = str(data.get("method") or "")
                if method in self.silent_methods:
                    continue
                payload = self.replies.get(method, {"ok": True, "data": None})
                await self._ws.send(
                    json.dumps(
                        {
                            "type": "rpc_reply",
                            "correlation_id": data.get("correlation_id"),
                            **payload,
                        },
                        ensure_ascii=False,
                    )
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            pass

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._ws is not None:
            await self._ws.close()


class _Gateway:
    def __init__(self, app: Any, server: uvicorn.Server, task: "asyncio.Task[None]", port: int):
        self.app = app
        self.server = server
        self.task = task
        self.port = port
        self.desktop: Optional[FakeDesktop] = None

    async def start_desktop(self) -> FakeDesktop:
        self.desktop = FakeDesktop(self.port)
        await self.desktop.start()
        dm: DeviceManager = self.app.state.device_manager
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            if dm.is_online(DEVICE_ID):
                return self.desktop
            await asyncio.sleep(0.05)
        raise TimeoutError("fake desktop did not come online")

    async def stop(self) -> None:
        if self.desktop is not None:
            await self.desktop.stop()
        self.server.should_exit = True
        await self.task


@pytest.fixture()
async def gateway(token_file: Path) -> _Gateway:
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


@pytest.fixture()
async def http(gateway: _Gateway):
    async with httpx.AsyncClient(
        base_url=f"http://127.0.0.1:{gateway.port}", timeout=30.0
    ) as c:
        yield c


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _mobile_headers(install_id: str, token: str) -> Dict[str, str]:
    return {"x-agx-install-id": install_id, "x-agx-mobile-token": token}


async def _create_connect_session(c: httpx.AsyncClient) -> str:
    r = await c.post(
        "/api/connect/session", json={"device_id": DEVICE_ID, "token": DEVICE_TOKEN}
    )
    assert r.status_code == 200, r.text
    return r.json()["session_id"]


async def _bind(
    c: httpx.AsyncClient, install_id: str, connect_session_id: str
) -> httpx.Response:
    return await c.post(
        "/api/mobile/bind",
        json={"connect_session_id": connect_session_id, "install_id": install_id},
    )


async def _bind_ok(
    c: httpx.AsyncClient, install_id: str = INSTALL_ID
) -> Dict[str, Any]:
    sid = await _create_connect_session(c)
    r = await _bind(c, install_id, sid)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------
# bind
# --------------------------------------------------------------------------


async def test_connect_session_qr_url_uses_request_host_by_default(
    http: httpx.AsyncClient,
) -> None:
    """未配置 public_base_url 时，二维码 URL 跟随请求 Host（现网反向代理同域场景）。"""
    r = await http.post(
        "/api/connect/session", json={"device_id": DEVICE_ID, "token": DEVICE_TOKEN}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["qr_url"] == f"http://127.0.0.1:{http.base_url.port}/connect/{body['session_id']}"


async def test_connect_session_qr_url_public_base_override(token_file: Path) -> None:
    """配置 public_base_url 后二维码 URL 强制用它（桌面端经 localhost 访问的真机联调场景）。"""
    cfg = _gw_cfg()
    cfg.server.public_base_url = "http://192.168.10.10:8787/"
    app = create_gateway_app(cfg)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://127.0.0.1:9999", timeout=30.0
    ) as c:
        r = await c.post(
            "/api/connect/session", json={"device_id": DEVICE_ID, "token": DEVICE_TOKEN}
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # 末尾斜杠被规整；不携带请求 Host（127.0.0.1:9999）
        assert body["qr_url"] == f"http://192.168.10.10:8787/connect/{body['session_id']}"


async def test_bind_success_roundtrip(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    sid = await _create_connect_session(http)
    r = await _bind(http, INSTALL_ID, sid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["device_id"] == DEVICE_ID
    assert body["desktop_name"] is None
    token = body["mobile_token"]
    assert isinstance(token, str) and len(token) == 64

    # user_map 登记 + connect session 标记 bound + token store 落盘
    assert gateway.app.state.user_map.get_device("mobile", INSTALL_ID) == DEVICE_ID
    assert gateway.app.state.connect_sessions.get(sid).status == "bound"
    assert gateway.app.state.mobile_tokens.get_device(INSTALL_ID) == DEVICE_ID
    stored = json.loads((gateway.app.state.mobile_tokens._path).read_text(encoding="utf-8"))
    assert stored[INSTALL_ID]["device_id"] == DEVICE_ID


async def test_bind_idempotent_reissue(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    body1 = await _bind_ok(http)
    headers1 = _mobile_headers(INSTALL_ID, body1["mobile_token"])
    r = await http.get("/api/mobile/status", headers=headers1)
    assert r.status_code == 200

    # 同 install_id + 同设备重复 bind：幂等成功，返回新 token，旧 token 立即失效
    sid = await _create_connect_session(http)
    r2 = await _bind(http, INSTALL_ID, sid)
    assert r2.status_code == 200, r2.text
    token2 = r2.json()["mobile_token"]
    assert token2 != body1["mobile_token"]

    r_old = await http.get("/api/mobile/status", headers=headers1)
    assert r_old.status_code == 401
    r_new = await http.get(
        "/api/mobile/status", headers=_mobile_headers(INSTALL_ID, token2)
    )
    assert r_new.status_code == 200


async def test_bind_invalid_connect_session(http: httpx.AsyncClient) -> None:
    r = await _bind(http, INSTALL_ID, "not-a-session")
    assert r.status_code == 404
    assert r.json()["detail"] == "connect session 无效或已过期"


async def test_bind_conflict_other_device(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    gateway.app.state.user_map.set_binding("mobile", INSTALL_ID, "other-dev")
    sid = await _create_connect_session(http)
    r = await _bind(http, INSTALL_ID, sid)
    assert r.status_code == 409
    assert "other-dev" in r.json()["detail"]


# --------------------------------------------------------------------------
# 鉴权负路径
# --------------------------------------------------------------------------


async def test_mobile_auth_negative_paths(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    # 无头
    r = await http.get("/api/mobile/status")
    assert r.status_code == 401
    # 未绑定的 install_id
    r = await http.get("/api/mobile/status", headers=_mobile_headers("ghost", "tok"))
    assert r.status_code == 401
    # 已绑定但错 token
    body = await _bind_ok(http)
    r = await http.get(
        "/api/mobile/status", headers=_mobile_headers(INSTALL_ID, "wrong-token")
    )
    assert r.status_code == 401


# --------------------------------------------------------------------------
# status / sessions / messages 透传 + device_rpc 帧断言
# --------------------------------------------------------------------------


async def test_status_and_sessions_messages_passthrough(
    gateway: _Gateway, http: httpx.AsyncClient
) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    desktop = await gateway.start_desktop()

    r = await http.get("/api/mobile/status", headers=h)
    assert r.status_code == 200
    assert r.json() == {"online": True, "device_id": DEVICE_ID, "desktop_name": None}

    desktop.replies["sessions.list"] = {"ok": True, "data": [{"session_id": "s1", "title": "T"}]}
    r = await http.get("/api/mobile/sessions", headers=h)
    assert r.status_code == 200
    assert r.json() == {"sessions": [{"session_id": "s1", "title": "T"}]}
    frame = desktop.received[-1]
    assert frame["type"] == "device_rpc"
    assert frame["method"] == "sessions.list"
    assert frame["params"] == {}
    assert frame["correlation_id"]

    desktop.replies["session.messages"] = {"ok": True, "data": [{"role": "user", "content": "hi"}]}
    r = await http.get("/api/mobile/sessions/s1/messages", headers=h)
    assert r.status_code == 200
    assert r.json() == {"messages": [{"role": "user", "content": "hi"}]}
    frame = desktop.received[-1]
    assert frame["method"] == "session.messages"
    assert frame["params"] == {"session_id": "s1"}


async def test_sessions_rpc_error_maps_502(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    desktop = await gateway.start_desktop()
    desktop.replies["sessions.list"] = {"ok": False, "error": "studio down"}
    r = await http.get("/api/mobile/sessions", headers=h)
    assert r.status_code == 502
    assert r.json()["detail"] == "studio down"


# --------------------------------------------------------------------------
# send：正常往返 / 桌面离线 503 / 桌面不回 504
# --------------------------------------------------------------------------


async def test_send_roundtrip_and_params(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    desktop = await gateway.start_desktop()
    rpc_data = {"reply": "结果 OK", "progress": ["开始：bash"], "pending_confirm": None}
    desktop.replies["session.send"] = {"ok": True, "data": rpc_data}

    r = await http.post(
        "/api/mobile/sessions/s9/send",
        json={"text": "你好", "sender_name": "手机用户"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json() == rpc_data
    frame = desktop.received[-1]
    assert frame["method"] == "session.send"
    assert frame["params"] == {
        "session_id": "s9",
        "text": "你好",
        "sender_name": "手机用户",
        "install_id": INSTALL_ID,
    }


async def test_send_requires_text(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    r = await http.post("/api/mobile/sessions/s1/send", json={"text": "  "}, headers=h)
    assert r.status_code == 400


async def test_send_offline_503(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    # 不启动 fake desktop → 设备离线
    r = await http.post("/api/mobile/sessions/s1/send", json={"text": "hi"}, headers=h)
    assert r.status_code == 503
    assert r.json()["detail"] == "device offline"


async def test_send_no_reply_504(
    gateway: _Gateway,
    http: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    desktop = await gateway.start_desktop()
    desktop.silent_methods.add("session.send")

    # 压缩超时：模块下限常量 + cfg.reply_timeout 一起降，否则要等 600s
    monkeypatch.setattr("agenticx.gateway.app.MOBILE_RPC_TIMEOUT_FLOOR_SECONDS", 0.3)
    gateway.app.state.config.reply_timeout_seconds = 0.3

    r = await http.post("/api/mobile/sessions/s1/send", json={"text": "hi"}, headers=h)
    assert r.status_code == 504
    assert r.json()["detail"] == "device reply timeout"


# --------------------------------------------------------------------------
# confirms GET/POST
# --------------------------------------------------------------------------


async def test_confirms_roundtrip(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])
    desktop = await gateway.start_desktop()

    pend = [{"request_id": "req-9", "agent_id": "meta", "question": "允许？"}]
    desktop.replies["confirm.pending"] = {"ok": True, "data": pend}
    r = await http.get("/api/mobile/confirms", headers=h)
    assert r.status_code == 200
    assert r.json() == {"confirms": pend}
    assert desktop.received[-1]["method"] == "confirm.pending"
    assert desktop.received[-1]["params"] == {"install_id": INSTALL_ID}

    desktop.replies["confirm.respond"] = {
        "ok": True,
        "data": {"ok": True, "message": "已确认继续执行（request_id: `req-9`）。"},
    }
    r = await http.post(
        "/api/mobile/confirms/req-9", json={"approved": True, "reason": ""}, headers=h
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "message": "已确认继续执行（request_id: `req-9`）。"}
    assert desktop.received[-1]["method"] == "confirm.respond"
    assert desktop.received[-1]["params"] == {
        "install_id": INSTALL_ID,
        "request_id": "req-9",
        "approved": True,
        "reason": "",
    }

    # rpc ok:false（找不到 pending）→ 404 + error
    desktop.replies["confirm.respond"] = {"ok": False, "error": "pending confirm not found: req-x"}
    r = await http.post(
        "/api/mobile/confirms/req-x", json={"approved": False, "reason": "算了"}, headers=h
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "pending confirm not found: req-x"


# --------------------------------------------------------------------------
# 解绑 + 重新绑定
# --------------------------------------------------------------------------


async def test_unbind_then_rebind(gateway: _Gateway, http: httpx.AsyncClient) -> None:
    body = await _bind_ok(http)
    h = _mobile_headers(INSTALL_ID, body["mobile_token"])

    r = await http.delete("/api/mobile/bindings", headers=h)
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    # 原 token 立即失效 + user_map 无绑定 + token store 清除
    r2 = await http.get("/api/mobile/status", headers=h)
    assert r2.status_code == 401
    assert gateway.app.state.user_map.get_device("mobile", INSTALL_ID) is None
    assert gateway.app.state.mobile_tokens.get_device(INSTALL_ID) is None

    # 可重新 bind
    sid = await _create_connect_session(http)
    r3 = await _bind(http, INSTALL_ID, sid)
    assert r3.status_code == 200, r3.text
    r4 = await http.get(
        "/api/mobile/status",
        headers=_mobile_headers(INSTALL_ID, r3.json()["mobile_token"]),
    )
    assert r4.status_code == 200
