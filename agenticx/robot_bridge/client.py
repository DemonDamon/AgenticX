#!/usr/bin/env python3
"""Async HTTP client for the local robot policy bridge (``agx-robot-bridge serve``).

Author: Hongyi Zhao
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from agenticx.cli.config_manager import RobotSettings

_DEFAULT_TIMEOUT_S = 10.0
_START_HINT = "请先在 bridge 环境运行 `agx-robot-bridge serve`"

# Tests inject an ``httpx.MockTransport`` here; production always uses the default transport.
_TRANSPORT_OVERRIDE: httpx.AsyncBaseTransport | None = None


class RobotBridgeError(Exception):
    def __init__(
        self, code: str, message: str, *, hint: str = "", status: int = 0
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint
        self.status = status


class RobotBridgeClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._transport = transport

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        timeout: float = _DEFAULT_TIMEOUT_S,
    ) -> dict[str, Any]:
        try:
            # trust_env=False: localhost requests must never be routed through ALL_PROXY / HTTP(S)_PROXY.
            async with httpx.AsyncClient(
                base_url=self._base_url,
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=timeout,
                transport=self._transport,
                trust_env=False,
            ) as client:
                resp = await client.request(method, path, json=json, params=params)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise RobotBridgeError(
                "bridge_unreachable",
                f"未连接到机器人桥接服务（{self._base_url}）",
                hint=_START_HINT,
            ) from exc
        except httpx.TimeoutException as exc:
            raise RobotBridgeError(
                "bridge_timeout",
                f"机器人桥接服务响应超时（{method} {path}，{timeout:.0f}s）",
            ) from exc
        except httpx.HTTPError as exc:
            raise RobotBridgeError(
                "bridge_error", f"与机器人桥接服务通信失败：{exc}"
            ) from exc

        try:
            data = resp.json()
        except ValueError:
            data = None
        if resp.status_code >= 400:
            if isinstance(data, dict) and data.get("error_code"):
                raise RobotBridgeError(
                    str(data.get("error_code")),
                    str(data.get("error") or ""),
                    hint=str(data.get("hint") or ""),
                    status=resp.status_code,
                )
            raise RobotBridgeError(
                f"http_{resp.status_code}",
                resp.text[:200] or f"HTTP {resp.status_code}",
                status=resp.status_code,
            )
        if not isinstance(data, dict):
            raise RobotBridgeError(
                "bridge_bad_response",
                f"机器人桥接服务返回了非 JSON 响应（{method} {path}）",
            )
        return data

    @staticmethod
    def _session_path(sid: str, suffix: str = "") -> str:
        return f"/session/{quote(sid, safe='')}{suffix}"

    async def health(self) -> dict[str, Any]:
        return await self._request("GET", "/health")

    async def create_session(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/session", json=body)

    async def get_session(self, sid: str, since: int = 0) -> dict[str, Any]:
        return await self._request(
            "GET", self._session_path(sid), params={"since": since}
        )

    async def start(self, sid: str) -> dict[str, Any]:
        return await self._request("POST", self._session_path(sid, "/start"))

    async def set_task(self, sid: str, task: str) -> dict[str, Any]:
        return await self._request(
            "POST", self._session_path(sid, "/task"), json={"task": task}
        )

    async def reset(self, sid: str) -> dict[str, Any]:
        return await self._request("POST", self._session_path(sid, "/reset"))

    async def stop(self, sid: str, *, timeout_s: float) -> dict[str, Any]:
        return await self._request(
            "POST", self._session_path(sid, "/stop"), timeout=timeout_s
        )

    async def snapshot(self, sid: str, camera: str | None) -> dict[str, Any]:
        params = {"camera": camera} if camera else None
        return await self._request(
            "GET", self._session_path(sid, "/snapshot"), params=params
        )


def resolve_client(settings: RobotSettings) -> RobotBridgeClient:
    """Build a client from settings; the token comes from ``robot.token`` or the bridge token file."""
    token = settings.token.strip()
    if not token:
        path = Path(settings.token_file).expanduser()
        try:
            token = path.read_text(encoding="utf-8").strip()
        except OSError:
            token = ""
        if not token:
            raise RobotBridgeError(
                "token_missing",
                f"未找到 bridge token（{path}）",
                hint="首次运行 `agx-robot-bridge serve` 会自动生成 token 文件",
            )
    return RobotBridgeClient(settings.bridge_url, token, transport=_TRANSPORT_OVERRIDE)
