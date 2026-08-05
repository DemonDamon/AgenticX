#!/usr/bin/env python3
"""Server-side automation scheduler (HA Plan D).

A semantic port of the Desktop ``AutomationScheduler`` tick loop so定时任务
can run without the Electron main process, and only on one replica (leader
election via the coordination bus). The tick decision logic mirrors the
TypeScript original branch-for-branch, including its quirks:

- ``minuteKey`` uses LOCAL time components; ``lastRunAt`` is stored as a UTC
  ISO-8601 string, so the ``startswith(minuteKey)`` dedup only fires in UTC
  timezones (the in-memory per-minute latch does the primary dedup, same as
  Desktop);
- ``interval`` frequency with a missing/non-positive ``hours`` never runs
  (JS ``NaN === 0`` is false).

Execution reuses the same HTTP surface the Desktop scheduler drives
(``POST /api/sessions`` with ``avatar_id=automation:<task_id>`` → optional
taskspace attach → ``POST /api/chat`` → drain SSE), so session isolation,
the runner system prompt, and the session run lock all behave identically.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from agenticx.runtime._automation_tasks_io import load_automation_tasks, save_automation_tasks
from agenticx.runtime.coordination.leader import LeaderGate

logger = logging.getLogger(__name__)

_TICK_INTERVAL_SEC = 30.0
_DEFAULT_CHAT_TIMEOUT_MS = 30 * 60 * 1000


def resolve_scheduler_mode() -> str:
    """env ``AGX_AUTOMATION_SCHEDULER`` > ``runtime.automation.scheduler`` >
    default (``server`` in HA mode, else ``electron``)."""
    env = os.environ.get("AGX_AUTOMATION_SCHEDULER", "").strip().lower()
    if env in ("electron", "server"):
        return env
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg = ConfigManager.get_value("runtime.automation.scheduler")
        if isinstance(cfg, str) and cfg.strip().lower() in ("electron", "server"):
            return cfg.strip().lower()
    except Exception:
        pass
    if os.environ.get("AGX_HA_MODE", "").strip().lower() == "redis":
        return "server"
    if os.environ.get("AGX_STORAGE_BACKEND", "").strip().lower() == "redis":
        return "server"
    return "electron"


def _minute_key(now: datetime) -> str:
    return f"{now.year}-{now.month:02d}-{now.day:02d}T{now.hour:02d}:{now.minute:02d}"


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _is_within_date_range(task: Dict[str, Any], current_date: str) -> bool:
    date_range = task.get("effectiveDateRange")
    if not isinstance(date_range, dict):
        return True
    start = str(date_range.get("start") or "")
    end = str(date_range.get("end") or "")
    if start and current_date < start:
        return False
    if end and current_date > end:
        return False
    return True


def _should_run(
    task: Dict[str, Any],
    current_time: str,
    current_date: str,
    day_of_week: int,
    hour: int,
) -> bool:
    freq = task.get("frequency")
    if not isinstance(freq, dict):
        return False
    freq_type = freq.get("type")
    days = freq.get("days")
    days_list = days if isinstance(days, list) else []
    if freq_type == "daily":
        return freq.get("time") == current_time and day_of_week in days_list
    if freq_type == "interval":
        if day_of_week not in days_list:
            return False
        hours = freq.get("hours")
        if not isinstance(hours, (int, float)) or hours <= 0:
            return False
        return hour % int(hours) == 0 and current_time.endswith(":00")
    if freq_type == "once":
        return freq.get("date") == current_date and freq.get("time") == current_time
    return False


class ServerAutomationScheduler:
    """Async tick loop firing due automation tasks (leader-only)."""

    def __init__(
        self,
        leader_gate: LeaderGate,
        *,
        base_url: str,
        token: str = "",
        tick_interval: float = _TICK_INTERVAL_SEC,
    ) -> None:
        self._leader_gate = leader_gate
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._tick_interval = tick_interval
        self._last_check_minute = ""
        self._task: Optional[asyncio.Task] = None
        self._running: set[str] = set()

    async def start(self) -> None:
        if self._task is not None:
            return
        await self._leader_gate.start()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self._leader_gate.stop()

    async def _loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("automation scheduler tick failed")
            await asyncio.sleep(self._tick_interval)

    # ── tick (ported decision logic) ──

    async def tick(self, *, now: Optional[datetime] = None) -> List[str]:
        """Fire due tasks once. Returns fired task ids (empty when not leader)."""
        if not await self._leader_gate.am_i_leader():
            return []
        now = now or datetime.now()
        minute_key = _minute_key(now)
        if minute_key == self._last_check_minute:
            return []
        self._last_check_minute = minute_key

        tasks = load_automation_tasks()
        day_of_week = 7 if now.weekday() == 6 else now.weekday() + 1  # 1=Mon..7=Sun
        current_time = f"{now.hour:02d}:{now.minute:02d}"
        current_date = f"{now.year}-{now.month:02d}-{now.day:02d}"

        dirty = False
        fired: List[str] = []
        for task in tasks:
            if not isinstance(task, dict):
                continue
            if not task.get("enabled"):
                continue
            if not _is_within_date_range(task, current_date):
                continue
            if not _should_run(task, current_time, current_date, day_of_week, now.hour):
                continue
            last_run_at = str(task.get("lastRunAt") or "")
            if last_run_at and last_run_at.startswith(minute_key):
                continue
            task["lastRunAt"] = _utc_iso_now()
            dirty = True
            fired.append(str(task.get("id") or ""))
            asyncio.create_task(self._execute_task(task))
        if dirty:
            await asyncio.to_thread(save_automation_tasks, tasks)
        return fired

    # ── execution (mirrors Desktop runAutomationTaskHttp) ──

    def _http_client(self):
        import httpx

        # Localhost calls must bypass any system SOCKS/HTTP proxy.
        transport = httpx.AsyncHTTPTransport()
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["x-agx-desktop-token"] = self._token
        return httpx.AsyncClient(
            base_url=self._base_url,
            headers=headers,
            transport=transport,
            timeout=httpx.Timeout(None, connect=10.0),
        )

    async def _execute_task(self, task: Dict[str, Any]) -> None:
        task_id = str(task.get("id") or "").strip()
        if not task_id or task_id in self._running:
            return
        self._running.add(task_id)
        try:
            ok, error, session_id = await self._run_task_http(task)
            self._record_run_result(task_id, ok=ok, error=error)
            logger.info(
                "automation task fired by server scheduler id=%s ok=%s session=%s",
                task_id,
                ok,
                (session_id or "")[:8],
            )
        except Exception as exc:
            self._record_run_result(task_id, ok=False, error=str(exc))
            logger.exception("automation task execution failed id=%s", task_id)
        finally:
            self._running.discard(task_id)

    async def _run_task_http(self, task: Dict[str, Any]) -> tuple[bool, str, str]:
        prompt = str(task.get("prompt") or "").strip()
        if not prompt:
            return False, "任务提示词为空", ""
        provider = str(task.get("provider") or "").strip()
        model = str(task.get("model") or "").strip()
        timeout_ms = _resolve_chat_timeout_ms()

        async with self._http_client() as client:
            create_body: Dict[str, Any] = {
                "avatar_id": f"automation:{task.get('id')}",
                "name": task.get("name"),
            }
            if provider and model:
                create_body["provider"] = provider
                create_body["model"] = model
            resp = await client.post("/api/sessions", json=create_body)
            if resp.status_code != 200:
                return False, f"创建自动化会话失败 HTTP {resp.status_code}", ""
            session_id = str(resp.json().get("session_id") or "").strip()
            if not session_id:
                return False, "创建自动化会话失败（空 session_id）", ""
            self._persist_task_session_id(str(task.get("id") or ""), session_id)

            workspace = str(task.get("workspace") or "").strip()
            if workspace:
                try:
                    await client.post(
                        "/api/taskspace/workspaces",
                        json={"session_id": session_id, "path": workspace},
                    )
                except Exception:
                    logger.debug("automation taskspace attach failed", exc_info=True)

            chat_body: Dict[str, Any] = {
                "session_id": session_id,
                "user_input": prompt,
                "mode": "interactive",
            }
            if provider and model:
                chat_body["provider"] = provider
                chat_body["model"] = model

            return await self._drain_chat(client, chat_body, session_id, timeout_ms)

    async def _drain_chat(
        self,
        client: Any,
        chat_body: Dict[str, Any],
        session_id: str,
        timeout_ms: int,
    ) -> tuple[bool, str, str]:
        error_text = ""
        saw_done = False

        async def _drain() -> None:
            nonlocal error_text, saw_done
            async with client.stream("POST", "/api/chat", json=chat_body) as resp:
                if resp.status_code != 200:
                    body = (await resp.aread()).decode("utf-8", "replace")[:240]
                    error_text = f"HTTP {resp.status_code}: {body}"
                    return
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    try:
                        import json as _json

                        payload = _json.loads(line[5:].strip())
                    except Exception:
                        continue
                    ptype = str(payload.get("type") or "")
                    if ptype == "error":
                        data = payload.get("data") or {}
                        error_text = str(data.get("text") or data.get("error") or "执行失败")
                    elif ptype == "done":
                        saw_done = True
                        return

        try:
            await asyncio.wait_for(_drain(), timeout=timeout_ms / 1000)
        except (asyncio.TimeoutError, TimeoutError):
            minutes = max(1, round(timeout_ms / 60000))
            return False, f"自动化执行超时（>{minutes} 分钟）", session_id
        if error_text:
            return False, error_text, session_id
        return (saw_done, "" if saw_done else "流未正常结束", session_id)

    # ── task record updates ──

    def _persist_task_session_id(self, task_id: str, session_id: str) -> None:
        if not task_id or not session_id:
            return
        try:
            tasks = load_automation_tasks()
            for task in tasks:
                if isinstance(task, dict) and str(task.get("id") or "") == task_id:
                    task["sessionId"] = session_id
                    save_automation_tasks(tasks)
                    return
        except Exception:
            logger.debug("persist automation session id failed", exc_info=True)

    def _record_run_result(self, task_id: str, *, ok: bool, error: str = "") -> None:
        try:
            tasks = load_automation_tasks()
            for task in tasks:
                if not isinstance(task, dict) or str(task.get("id") or "") != task_id:
                    continue
                task["lastRunStatus"] = "success" if ok else "error"
                task["lastRunAt"] = _utc_iso_now()
                if ok:
                    task.pop("lastRunError", None)
                else:
                    task["lastRunError"] = (error or "执行失败")[:500]
                save_automation_tasks(tasks)
                return
        except Exception:
            logger.debug("record automation run result failed", exc_info=True)


def _resolve_chat_timeout_ms() -> int:
    raw = os.environ.get("AGX_AUTOMATION_CHAT_TIMEOUT_MS", "").strip()
    if raw:
        try:
            value = int(raw)
            if value > 0:
                return value
        except ValueError:
            pass
    return _DEFAULT_CHAT_TIMEOUT_MS
