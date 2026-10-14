#!/usr/bin/env python3
"""Desktop worker that claims enterprise tasks and runs them locally.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import platform
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from agenticx.avatar.registry import AvatarRegistry
from agenticx.cli.config_manager import ConfigManager
from agenticx.utils.agx_home import agx_home

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_S = 15
CLAIM_INTERVAL_S = 3
DISABLED_SLEEP_S = 5
AUTH_PAUSE_S = 60
TASK_TIMEOUT_S = 8 * 60
CONTENT_MAX = 16000
AUTH_ERROR = "企业登录已失效"
_DEVICE_RE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
_PAT_RE = re.compile(r"agx-pat-\S+")
_BEARER_RE = re.compile(r"Bearer\s+\S+")


class EnterpriseAuthError(Exception):
    """Enterprise rejected the desktop token."""


def worker_enabled() -> bool:
    """True when enterprise login and the local worker switch are both on."""

    try:
        if ConfigManager.get_value("enterprise.enabled") is not True:
            return False
        token = ConfigManager.get_value("enterprise.token")
        if not isinstance(token, str) or not token.strip():
            return False
        base_url = ConfigManager.get_value("enterprise.base_url")
        if not isinstance(base_url, str) or not base_url.strip():
            return False
        return ConfigManager.get_value("enterprise.worker.enabled") is True
    except Exception:
        logger.debug("enterprise worker config read failed")
        return False


def _enterprise_settings() -> tuple[str, str] | None:
    if not worker_enabled():
        return None
    token = ConfigManager.get_value("enterprise.token")
    base_url = ConfigManager.get_value("enterprise.base_url")
    if not isinstance(token, str) or not isinstance(base_url, str):
        return None
    token = token.strip()
    base_url = base_url.strip().rstrip("/")
    if not token or not base_url:
        return None
    return token, base_url


def _state_dir() -> Path:
    return agx_home() / "enterprise_worker"


def _device_path() -> Path:
    return _state_dir() / "device.json"


def _state_path() -> Path:
    return _state_dir() / "state.json"


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _device_name() -> str:
    return platform.node().strip()[:128]


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    temporary.replace(path)


def _redact(text: str, token: str = "") -> str:
    cleaned = text
    if token:
        cleaned = cleaned.replace(token, "[redacted]")
    home = str(Path.home())
    if home:
        cleaned = cleaned.replace(home, "~")
    cleaned = _PAT_RE.sub("[redacted]", cleaned)
    cleaned = _BEARER_RE.sub("Bearer [redacted]", cleaned)
    cleaned = " ".join(cleaned.split())
    return cleaned[:500]


def _public_error(exc: BaseException, token: str = "") -> str:
    text = str(exc).strip() or exc.__class__.__name__
    cleaned = _redact(text, token)
    return cleaned or "task failed"


def _visible_reply(text: str) -> str:
    cleaned = _THINK_RE.sub("", text).strip()
    return cleaned[:CONTENT_MAX]


def _agent_card(raw: dict[str, Any]) -> dict[str, str]:
    return {
        "id": str(raw.get("id") or ""),
        "slug": str(raw.get("slug") or ""),
        "displayName": str(raw.get("displayName") or ""),
        "systemPrompt": str(raw.get("systemPrompt") or ""),
        "model": str(raw.get("model") or ""),
    }


def _render_room_input(task_input: dict[str, Any]) -> str:
    lines = ["房间最近对话"]
    messages = task_input.get("messages")
    if isinstance(messages, list):
        for item in messages:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("role") or "").strip()
            content = str(item.get("content") or "")
            lines.append(f"{name}：{content}")
    instruction = str(task_input.get("instruction") or "")
    lines.append(f"请回应：{instruction}")
    return "\n".join(lines)


def _note_tool_call(steps: list[dict[str, Any]], data: dict[str, Any]) -> None:
    name = str(data.get("name") or data.get("tool_name") or "").strip()
    if not name:
        return
    steps.append(
        {
            "tool": name,
            "ok": True,
            "_id": str(data.get("tool_call_id") or data.get("id") or ""),
        }
    )


def _note_tool_result(steps: list[dict[str, Any]], data: dict[str, Any]) -> None:
    name = str(data.get("name") or data.get("tool_name") or "").strip()
    call_id = str(data.get("tool_call_id") or data.get("id") or "")
    result = str(data.get("result") or data.get("content") or "")
    status = str(data.get("tool_status") or "").lower()
    failed = bool(data.get("is_error")) or status in {"error", "failed", "failure"}
    failed = failed or result.startswith(("ERROR:", "CANCELLED:"))
    for step in reversed(steps):
        same_id = bool(call_id) and step.get("_id") == call_id
        same_name = bool(name) and step.get("tool") == name
        if not (same_id or same_name):
            continue
        if not step.get("denied"):
            step["ok"] = not failed
        return
    if name:
        steps.append({"tool": name, "ok": not failed, "_id": call_id})


def _note_denied(steps: list[dict[str, Any]], tool_name: str) -> None:
    for step in reversed(steps):
        if step.get("tool") == tool_name and not step.get("denied"):
            step["ok"] = False
            step["denied"] = True
            return
    steps.append({"tool": tool_name, "ok": False, "denied": True, "_id": ""})


def _public_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    published: list[dict[str, Any]] = []
    for step in steps:
        item: dict[str, Any] = {
            "tool": step.get("tool") or "tool",
            "ok": bool(step.get("ok")),
        }
        if step.get("denied"):
            item["ok"] = False
            item["denied"] = True
        published.append(item)
    return published


def _parse_sse_block(block: str) -> dict[str, Any] | None:
    data_lines: list[str] = []
    for line in block.split("\n"):
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    if not data_lines:
        return None
    try:
        parsed = json.loads("\n".join(data_lines))
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict):
        return parsed
    return None


async def _iter_sse(response: httpx.Response):
    buffer = ""
    async for chunk in response.aiter_text():
        buffer += chunk
        while "\n\n" in buffer:
            block, buffer = buffer.split("\n\n", 1)
            event = _parse_sse_block(block)
            if event is not None:
                yield event
    if buffer.strip():
        event = _parse_sse_block(buffer)
        if event is not None:
            yield event


class EnterpriseWorker:
    """Polls enterprise for one desktop task at a time and answers locally."""

    def __init__(
        self,
        *,
        local_base_url: str,
        desktop_token: str | None,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self._local_base = local_base_url.rstrip("/")
        self._desktop_token = desktop_token
        self._http = http
        self._owns_http = http is None
        self._loop_running = False
        self._agents: list[dict[str, str]] = []
        self._last_heartbeat_at: str | None = None
        self._current_task_id: str | None = None
        self._last_error: str | None = None
        self._claim_pause_until = 0.0
        self._last_heartbeat_mono = 0.0
        self._device_id = ""

    def status(self) -> dict[str, Any]:
        enabled = worker_enabled()
        return {
            "enabled": enabled,
            "running": bool(self._loop_running and enabled),
            "device_id": self._read_device_id(),
            "agents": [dict(item) for item in self._agents],
            "last_heartbeat_at": self._last_heartbeat_at,
            "current_task_id": self._current_task_id,
            "last_error": self._last_error,
        }

    async def run_forever(self) -> None:
        self._loop_running = True
        try:
            while True:
                executed = False
                try:
                    if not worker_enabled():
                        await asyncio.sleep(DISABLED_SLEEP_S)
                        continue
                    executed = await self.run_once()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    token = ""
                    settings = _enterprise_settings()
                    if settings is not None:
                        token = settings[0]
                    self._last_error = _public_error(exc, token)
                    logger.warning(
                        "enterprise worker iteration failed: %s",
                        self._last_error,
                    )
                if not executed:
                    await asyncio.sleep(CLAIM_INTERVAL_S)
        finally:
            self._loop_running = False
            await self._close_owned_client()

    async def run_once(self) -> bool:
        """Heartbeat when due, then claim and run at most one task."""

        settings = _enterprise_settings()
        if settings is None:
            return False
        token, base = settings
        now = time.monotonic()
        heartbeat_due = (
            self._last_heartbeat_mono == 0.0
            or now - self._last_heartbeat_mono >= HEARTBEAT_INTERVAL_S
        )
        if heartbeat_due:
            try:
                await self._heartbeat(token, base)
            except EnterpriseAuthError:
                return False
            except Exception as exc:
                self._last_error = _public_error(exc, token)
                logger.warning(
                    "enterprise worker heartbeat failed: %s",
                    self._last_error,
                )
        if time.monotonic() < self._claim_pause_until:
            return False
        if not worker_enabled():
            return False
        try:
            task = await self._claim(token, base)
        except EnterpriseAuthError:
            return False
        if task is None:
            return False
        await self._execute(token, base, task)
        return True

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(trust_env=False)
        return self._http

    async def _close_owned_client(self) -> None:
        if self._owns_http and self._http is not None:
            await self._http.aclose()
            self._http = None

    def _local_headers(self) -> dict[str, str]:
        token = str(self._desktop_token or "").strip()
        if not token:
            return {}
        return {"x-agx-desktop-token": token}

    def _read_device_id(self) -> str:
        if self._device_id:
            return self._device_id
        path = _device_path()
        if not path.is_file():
            return ""
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return ""
        if not isinstance(payload, dict):
            return ""
        device_id = str(payload.get("device_id") or "")
        if _DEVICE_RE.fullmatch(device_id):
            self._device_id = device_id
            return device_id
        return ""

    def _ensure_device_id(self) -> str:
        existing = self._read_device_id()
        if existing:
            return existing
        device_id = f"near-{uuid.uuid4().hex}"
        _write_json(_device_path(), {"device_id": device_id})
        self._device_id = device_id
        return device_id

    def _load_state(self) -> dict[str, dict[str, str]]:
        path = _state_path()
        empty: dict[str, dict[str, str]] = {"avatars": {}, "sessions": {}}
        if not path.is_file():
            return empty
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return empty
        if not isinstance(payload, dict):
            return empty
        avatars = payload.get("avatars")
        sessions = payload.get("sessions")
        return {
            "avatars": dict(avatars) if isinstance(avatars, dict) else {},
            "sessions": dict(sessions) if isinstance(sessions, dict) else {},
        }

    def _save_state(self, state: dict[str, dict[str, str]]) -> None:
        _write_json(
            _state_path(),
            {
                "avatars": state.get("avatars") or {},
                "sessions": state.get("sessions") or {},
            },
        )

    def _pause_for_auth(self) -> None:
        self._claim_pause_until = time.monotonic() + AUTH_PAUSE_S
        self._last_error = AUTH_ERROR

    async def _enterprise_post(
        self,
        token: str,
        url: str,
        payload: dict[str, Any],
    ) -> httpx.Response:
        response = await self._client().post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(30.0, connect=10.0),
        )
        if response.status_code == 401:
            self._pause_for_auth()
            raise EnterpriseAuthError()
        return response

    async def _local_post(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        timeout: httpx.Timeout | None = None,
    ) -> httpx.Response:
        return await self._client().post(
            f"{self._local_base}{path}",
            json=payload,
            headers=self._local_headers(),
            timeout=timeout or httpx.Timeout(30.0, connect=10.0),
        )

    async def _heartbeat(self, token: str, base: str) -> None:
        self._last_heartbeat_mono = time.monotonic()
        response = await self._enterprise_post(
            token,
            f"{base}/api/desktop/worker/heartbeat",
            {
                "device_id": self._ensure_device_id(),
                "device_name": _device_name(),
            },
        )
        response.raise_for_status()
        payload = response.json()
        agents = payload.get("agents") if isinstance(payload, dict) else None
        cards: list[dict[str, str]] = []
        if isinstance(agents, list):
            cards = [_agent_card(item) for item in agents if isinstance(item, dict)]
        self._agents = cards
        self._last_heartbeat_at = _utc_stamp()
        if self._last_error == AUTH_ERROR:
            self._last_error = None

    async def _claim(self, token: str, base: str) -> dict[str, Any] | None:
        response = await self._enterprise_post(
            token,
            f"{base}/api/desktop/worker/tasks/claim",
            {"device_id": self._ensure_device_id()},
        )
        response.raise_for_status()
        payload = response.json()
        task = payload.get("task") if isinstance(payload, dict) else None
        if not isinstance(task, dict):
            return None
        if not str(task.get("id") or "").strip():
            return None
        return task

    async def _execute(self, token: str, base: str, task: dict[str, Any]) -> None:
        task_id = str(task.get("id") or "").strip()
        self._current_task_id = task_id
        try:
            try:
                async with asyncio.timeout(TASK_TIMEOUT_S):
                    content, steps = await self._run_task(task)
            except TimeoutError:
                await self._fail(token, base, task_id, "task timed out")
                return
            visible = _visible_reply(content)
            if not visible:
                await self._fail(token, base, task_id, "empty response")
                return
            await self._complete(token, base, task_id, visible, steps)
            if self._last_error != AUTH_ERROR:
                self._last_error = None
        except EnterpriseAuthError:
            return
        except Exception as exc:
            await self._fail(token, base, task_id, _public_error(exc, token))
        finally:
            self._current_task_id = None

    def _ensure_avatar(self, agent: dict[str, str]) -> str:
        agent_id = agent["id"].strip()
        if not agent_id:
            raise RuntimeError("enterprise agent id missing")
        display = agent["displayName"].strip() or agent["slug"].strip() or agent_id
        name = f"企业·{display}"
        prompt = agent["systemPrompt"]
        state = self._load_state()
        existing_id = str(state["avatars"].get(agent_id) or "").strip()
        registry = AvatarRegistry()
        if existing_id:
            current = registry.get_avatar(existing_id)
            if current is not None:
                current_prompt = str(getattr(current, "system_prompt", "") or "")
                current_name = str(getattr(current, "name", "") or "")
                if current_prompt != prompt or current_name != name:
                    registry.update_avatar(
                        existing_id,
                        {
                            "name": name,
                            "system_prompt": prompt,
                            "tags": ["enterprise"],
                        },
                    )
                return existing_id
        created = registry.create_avatar(
            name,
            system_prompt=prompt,
            tags=["enterprise"],
        )
        state["avatars"][agent_id] = created.id
        self._save_state(state)
        return created.id

    async def _ensure_session(self, agent_id: str, room_id: str, avatar_id: str) -> str:
        state = self._load_state()
        key = f"{agent_id}:{room_id}"
        existing = str(state["sessions"].get(key) or "").strip()
        if existing:
            return existing
        response = await self._local_post("/api/sessions", {"avatar_id": avatar_id})
        if response.status_code >= 400:
            raise RuntimeError(f"local session failed ({response.status_code})")
        payload = response.json()
        session_id = ""
        if isinstance(payload, dict):
            session_id = str(payload.get("session_id") or "").strip()
        if not session_id:
            raise RuntimeError("local session failed")
        state["sessions"][key] = session_id
        self._save_state(state)
        return session_id

    async def _run_task(self, task: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        agent_raw = task.get("agent")
        agent = _agent_card(agent_raw if isinstance(agent_raw, dict) else {})
        room_id = str(task.get("room_id") or "").strip()
        if not agent["id"] or not room_id:
            raise RuntimeError("enterprise task is missing agent or room")
        avatar_id = self._ensure_avatar(agent)
        session_id = await self._ensure_session(agent["id"], room_id, avatar_id)
        task_input = task.get("input")
        rendered = _render_room_input(
            task_input if isinstance(task_input, dict) else {}
        )
        return await self._chat(session_id, rendered)

    async def _chat(
        self,
        session_id: str,
        user_input: str,
    ) -> tuple[str, list[dict[str, Any]]]:
        steps: list[dict[str, Any]] = []
        chunks: list[str] = []
        final_text: str | None = None
        saw_error = ""
        async with self._client().stream(
            "POST",
            f"{self._local_base}/api/chat",
            json={"session_id": session_id, "user_input": user_input},
            headers=self._local_headers(),
            timeout=httpx.Timeout(TASK_TIMEOUT_S, connect=10.0),
        ) as response:
            if response.status_code >= 400:
                await response.aread()
                raise RuntimeError(f"local chat failed ({response.status_code})")
            async for event in _iter_sse(response):
                event_type = str(event.get("type") or "")
                data = event.get("data") if isinstance(event.get("data"), dict) else {}
                if event_type == "token":
                    chunks.append(str(data.get("text") or ""))
                elif event_type == "final":
                    text = data.get("text")
                    if isinstance(text, str) and text:
                        final_text = text
                elif event_type == "tool_call":
                    _note_tool_call(steps, data)
                elif event_type == "tool_result":
                    _note_tool_result(steps, data)
                elif event_type == "confirm_required":
                    await self._deny_confirm(session_id, data, steps)
                elif event_type == "error":
                    saw_error = str(
                        data.get("text") or data.get("error") or "chat error"
                    )
                elif event_type == "done":
                    break
        if saw_error:
            raise RuntimeError(_redact(saw_error))
        content = final_text if final_text is not None else "".join(chunks)
        return content, _public_steps(steps)

    async def _deny_confirm(
        self,
        session_id: str,
        data: dict[str, Any],
        steps: list[dict[str, Any]],
    ) -> None:
        context = data.get("context") if isinstance(data.get("context"), dict) else {}
        tool_name = str(
            context.get("tool") or data.get("tool") or data.get("name") or "tool"
        )
        request_id = str(
            data.get("id") or data.get("request_id") or context.get("request_id") or ""
        ).strip()
        agent_id = str(
            data.get("agent_id") or context.get("agent_id") or "meta"
        ).strip() or "meta"
        _note_denied(steps, tool_name)
        if not request_id:
            return
        response = await self._local_post(
            "/api/confirm",
            {
                "session_id": session_id,
                "request_id": request_id,
                "approved": False,
                "agent_id": agent_id,
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(f"local confirm failed ({response.status_code})")

    async def _complete(
        self,
        token: str,
        base: str,
        task_id: str,
        content: str,
        steps: list[dict[str, Any]],
    ) -> None:
        response = await self._enterprise_post(
            token,
            _task_url(base, task_id, "complete"),
            {
                "device_id": self._ensure_device_id(),
                "content": content,
                "tool_steps": steps,
            },
        )
        response.raise_for_status()

    async def _fail(self, token: str, base: str, task_id: str, error: str) -> None:
        message = _redact(error, token).strip() or "task failed"
        self._last_error = message
        try:
            response = await self._enterprise_post(
                token,
                _task_url(base, task_id, "fail"),
                {"device_id": self._ensure_device_id(), "error": message},
            )
            response.raise_for_status()
        except EnterpriseAuthError:
            raise
        except Exception as exc:
            logger.warning(
                "enterprise worker fail report failed: %s",
                _public_error(exc, token),
            )


def _task_url(base: str, task_id: str, action: str) -> str:
    return f"{base}/api/desktop/worker/tasks/{quote(task_id, safe='')}/{action}"
