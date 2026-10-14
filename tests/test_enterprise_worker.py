#!/usr/bin/env python3
"""Enterprise desktop worker claim, execute, and report loop.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.enterprise_worker import (
    AUTH_ERROR,
    AUTH_PAUSE_S,
    EnterpriseWorker,
)

_TOKEN = "agx-pat-test"
_DEVICE_RE = re.compile(r"^near-[0-9a-f]{32}$")
_ENTERPRISE = "http://enterprise.test"
_LOCAL = "http://127.0.0.1:9"


def _isolate_config(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "config.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    ConfigManager._invalidate_yaml_cache(None)


def _enable(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, worker: bool) -> None:
    _isolate_config(monkeypatch, tmp_path)
    ConfigManager.set_value("enterprise.enabled", True)
    ConfigManager.set_value("enterprise.token", _TOKEN)
    ConfigManager.set_value("enterprise.base_url", _ENTERPRISE)
    ConfigManager.set_value("enterprise.worker.enabled", worker)


def _agent(prompt: str = "be helpful") -> dict[str, str]:
    return {
        "id": "agent-1",
        "slug": "desktop-coder",
        "displayName": "桌面工程师",
        "systemPrompt": prompt,
        "model": "local-model",
    }


def _task(task_id: str = "task-1", prompt: str = "be helpful") -> dict[str, Any]:
    return {
        "id": task_id,
        "agent": _agent(prompt),
        "room_id": "room-1",
        "input": {
            "messages": [{"role": "user", "name": "张三", "content": "你好"}],
            "instruction": "列出文件",
        },
    }


def _sse(events: list[dict[str, Any]]) -> str:
    return "".join(
        "data: " + json.dumps(event, ensure_ascii=False) + "\n\n" for event in events
    )


def _ok_chat() -> str:
    return _sse(
        [
            {"type": "token", "data": {"text": "忽略"}},
            {
                "type": "tool_call",
                "data": {"name": "bash_exec", "tool_call_id": "c1", "arguments": {}},
            },
            {
                "type": "tool_result",
                "data": {
                    "name": "bash_exec",
                    "tool_call_id": "c1",
                    "result": "a.txt",
                    "is_error": False,
                },
            },
            {"type": "final", "data": {"text": "<think>hidden</think>已列出"}},
            {"type": "done", "data": {}},
        ]
    )


def _confirm_chat() -> str:
    return _sse(
        [
            {"type": "tool_call", "data": {"name": "bash_exec", "tool_call_id": "c1"}},
            {
                "type": "confirm_required",
                "data": {
                    "id": "req-1",
                    "question": "run?",
                    "agent_id": "meta",
                    "context": {"tool": "bash_exec", "request_id": "req-1"},
                },
            },
            {
                "type": "tool_result",
                "data": {
                    "name": "bash_exec",
                    "tool_call_id": "c1",
                    "result": "CANCELLED: denied",
                    "is_error": True,
                },
            },
            {"type": "final", "data": {"text": "已拒绝"}},
            {"type": "done", "data": {}},
        ]
    )


class _Avatar:
    def __init__(self, avatar_id: str, name: str, system_prompt: str) -> None:
        self.id = avatar_id
        self.name = name
        self.system_prompt = system_prompt


class _Registry:
    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []
        self.updated: list[dict[str, Any]] = []
        self.items: dict[str, _Avatar] = {}

    def create_avatar(
        self,
        name: str,
        system_prompt: str = "",
        tags: list[str] | None = None,
        **kwargs: Any,
    ) -> _Avatar:
        assert "default_model" not in kwargs
        avatar = _Avatar(f"av-{len(self.items) + 1}", name, system_prompt)
        self.items[avatar.id] = avatar
        self.created.append(
            {
                "name": name,
                "system_prompt": system_prompt,
                "tags": tags,
                "extra": kwargs,
            }
        )
        return avatar

    def get_avatar(self, avatar_id: str) -> _Avatar | None:
        return self.items.get(avatar_id)

    def update_avatar(self, avatar_id: str, patch: dict[str, Any]) -> _Avatar:
        avatar = self.items[avatar_id]
        if "name" in patch:
            avatar.name = str(patch["name"])
        if "system_prompt" in patch:
            avatar.system_prompt = str(patch["system_prompt"])
        self.updated.append(patch)
        return avatar


class _Script:
    def __init__(self, chat: str | None = None, *, chat_status: int = 200) -> None:
        self.chat = chat or _ok_chat()
        self.chat_status = chat_status
        self.requests: list[httpx.Request] = []
        self.claims = 0
        self.heartbeat_status = 200
        self.tasks: list[dict[str, Any] | None] = [_task()]
        self.registry = _Registry()

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path.endswith("/heartbeat"):
            if self.heartbeat_status == 401:
                return httpx.Response(401, json={"code": "40101", "message": "expired"})
            return httpx.Response(200, json={"agents": [_agent()]})
        if path.endswith("/claim"):
            self.claims += 1
            task = self.tasks.pop(0) if self.tasks else None
            return httpx.Response(200, json={"task": task})
        if path == "/api/sessions":
            return httpx.Response(200, json={"ok": True, "session_id": "sess-1"})
        if path == "/api/chat":
            if self.chat_status >= 400:
                return httpx.Response(self.chat_status, json={"detail": "boom"})
            return httpx.Response(200, text=self.chat)
        if path == "/api/confirm":
            return httpx.Response(200, json={"ok": True})
        if path.endswith("/complete") or path.endswith("/fail"):
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"detail": "missing"})

    def json_bodies(self, suffix: str) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = []
        for request in self.requests:
            if request.url.path.endswith(suffix) or request.url.path == suffix:
                found.append(json.loads(request.content.decode("utf-8")))
        return found

    def paths(self) -> list[str]:
        return [request.url.path for request in self.requests]


def _worker(script: _Script) -> tuple[EnterpriseWorker, httpx.AsyncClient]:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(script.handler),
        trust_env=False,
    )
    worker = EnterpriseWorker(
        local_base_url=_LOCAL,
        desktop_token="desktop-test",
        http=client,
    )
    return worker, client


@pytest.mark.asyncio
async def test_disabled_run_once_sends_nothing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=False)
    script = _Script()
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is False
    assert script.requests == []


@pytest.mark.asyncio
async def test_heartbeat_then_null_claim_skips_chat(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    script = _Script()
    script.tasks = [None]
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is False
    assert script.paths() == [
        "/api/desktop/worker/heartbeat",
        "/api/desktop/worker/tasks/claim",
    ]
    heartbeat = script.json_bodies("/heartbeat")[0]
    assert isinstance(heartbeat["device_name"], str)
    assert _DEVICE_RE.fullmatch(heartbeat["device_id"])
    assert "/api/chat" not in script.paths()
    auth = script.requests[0].headers["authorization"]
    assert auth.startswith("Bearer ")
    assert _TOKEN not in json.dumps(worker.status())


@pytest.mark.asyncio
async def test_claim_executes_locally_and_completes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    script = _Script()
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_worker.AvatarRegistry",
        lambda: script.registry,
    )
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is True
    created = script.registry.created
    assert created[0]["name"] == "企业·桌面工程师"
    assert created[0]["system_prompt"] == "be helpful"
    assert created[0]["tags"] == ["enterprise"]
    assert created[0]["extra"] == {}
    session = script.json_bodies("/api/sessions")[0]
    assert session == {"avatar_id": "av-1"}
    chat = script.json_bodies("/api/chat")[0]
    assert "房间最近对话" in chat["user_input"]
    assert "张三：你好" in chat["user_input"]
    assert "请回应：列出文件" in chat["user_input"]
    assert script.requests[3].headers["x-agx-desktop-token"] == "desktop-test"
    complete = script.json_bodies("/complete")[0]
    assert complete["device_id"] == script.json_bodies("/heartbeat")[0]["device_id"]
    assert complete["content"] == "已列出"
    assert "<think>" not in complete["content"]
    assert complete["tool_steps"] == [{"tool": "bash_exec", "ok": True}]
    assert script.json_bodies("/fail") == []


@pytest.mark.asyncio
async def test_confirm_required_is_denied(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    script = _Script(chat=_confirm_chat())
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_worker.AvatarRegistry",
        lambda: script.registry,
    )
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is True
    confirm = script.json_bodies("/api/confirm")[0]
    assert confirm == {
        "session_id": "sess-1",
        "request_id": "req-1",
        "approved": False,
        "agent_id": "meta",
    }
    complete = script.json_bodies("/complete")[0]
    assert complete["tool_steps"] == [
        {"tool": "bash_exec", "ok": False, "denied": True}
    ]


@pytest.mark.asyncio
async def test_local_chat_failure_reports_fail(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    script = _Script(chat_status=500)
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_worker.AvatarRegistry",
        lambda: script.registry,
    )
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is True
    assert script.json_bodies("/complete") == []
    fail = script.json_bodies("/fail")[0]
    assert fail["error"]
    assert _TOKEN not in fail["error"]
    assert str(Path.home()) not in fail["error"]
    assert fail["device_id"]


@pytest.mark.asyncio
async def test_exception_fail_redacts_token_and_home(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    script = _Script()

    class _Boom(_Registry):
        def create_avatar(
            self,
            name: str,
            system_prompt: str = "",
            tags: list[str] | None = None,
            **kwargs: Any,
        ) -> _Avatar:
            raise RuntimeError(f"write failed {_TOKEN} at {Path.home()}/avatars")

    script.registry = _Boom()
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_worker.AvatarRegistry",
        lambda: script.registry,
    )
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is True
    fail = script.json_bodies("/fail")[0]
    assert fail["error"]
    assert _TOKEN not in fail["error"]
    assert "agx-pat-" not in fail["error"]
    assert str(Path.home()) not in fail["error"]


@pytest.mark.asyncio
async def test_empty_reply_after_think_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    script = _Script(
        chat=_sse(
            [
                {"type": "final", "data": {"text": "<think>only</think>"}},
                {"type": "done", "data": {}},
            ]
        )
    )
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_worker.AvatarRegistry",
        lambda: script.registry,
    )
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is True
    assert script.json_bodies("/complete") == []
    assert script.json_bodies("/fail")[0]["error"] == "empty response"


@pytest.mark.asyncio
async def test_enterprise_401_pauses_claims(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    script = _Script()
    script.heartbeat_status = 401
    worker, client = _worker(script)
    started = time.monotonic()
    async with client:
        assert await worker.run_once() is False
        assert await worker.run_once() is False
    assert script.paths() == ["/api/desktop/worker/heartbeat"]
    assert worker.status()["last_error"] == AUTH_ERROR
    remaining = worker._claim_pause_until - started
    assert AUTH_PAUSE_S - 1 <= remaining <= AUTH_PAUSE_S + 1


@pytest.mark.asyncio
async def test_device_id_is_stable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    script = _Script()
    script.tasks = [None, None]
    first, client_a = _worker(script)
    async with client_a:
        await first.run_once()
    device_id = first.status()["device_id"]
    assert _DEVICE_RE.fullmatch(device_id)
    second_script = _Script()
    second_script.tasks = [None]
    second, client_b = _worker(second_script)
    async with client_b:
        await second.run_once()
    assert second.status()["device_id"] == device_id
    assert second_script.json_bodies("/heartbeat")[0]["device_id"] == device_id


@pytest.mark.asyncio
async def test_reuses_session_and_updates_prompt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=True)
    script = _Script()
    script.tasks = [_task("task-1", "be helpful"), _task("task-2", "be careful")]
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_worker.AvatarRegistry",
        lambda: script.registry,
    )
    worker, client = _worker(script)
    async with client:
        assert await worker.run_once() is True
        assert await worker.run_once() is True
    assert script.paths().count("/api/sessions") == 1
    assert len(script.registry.created) == 1
    assert script.registry.updated[-1]["system_prompt"] == "be careful"
    assert script.registry.updated[-1]["tags"] == ["enterprise"]


@pytest.mark.asyncio
async def test_owned_client_ignores_proxy_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _enable(monkeypatch, tmp_path, worker=False)
    seen: dict[str, Any] = {}
    real = httpx.AsyncClient

    def factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        seen.update(kwargs)
        kwargs["transport"] = httpx.MockTransport(lambda _request: httpx.Response(200))
        return real(*args, **kwargs)

    monkeypatch.setattr("agenticx.runtime.enterprise_worker.httpx.AsyncClient", factory)
    worker = EnterpriseWorker(local_base_url=_LOCAL, desktop_token=None)
    worker._client()
    await worker._close_owned_client()
    assert seen.get("trust_env") is False
