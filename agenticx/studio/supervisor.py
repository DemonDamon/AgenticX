#!/usr/bin/env python3
"""Background session supervisor for unattended task continuation.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

from agenticx.runtime.stall_policy import (
    StallEvaluateInput,
    evaluate_stall_for_continuation,
    latest_todo_from_messages,
    todos_completed,
)
from agenticx.studio.continuation import (
    SCRATCH_SUPERVISOR_STARTED_KEY,
    format_continuation_notice,
    get_continuation_round,
    load_unattended_config,
    prepare_continue,
)

_log = logging.getLogger(__name__)

POLL_INTERVAL_SEC = 30.0
SESSION_META_UNATTENDED = "unattended_enabled"


def _supervisor_log_dir() -> Path:
    root = Path(os.path.expanduser("~/.agenticx/logs/supervisor"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def _log_supervisor_event(session_id: str, payload: dict[str, Any]) -> None:
    try:
        path = _supervisor_log_dir() / f"{session_id}.log"
        row = {"ts": time.time(), **payload}
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception as exc:
        _log.debug("supervisor log write failed: %s", exc)


def _session_unattended_enabled(managed: Any) -> bool:
    session = managed.studio_session
    sp = getattr(session, "scratchpad", None)
    if isinstance(sp, dict) and sp.get(SESSION_META_UNATTENDED) is True:
        return True
    try:
        meta_path = Path(os.path.expanduser("~/.agenticx/sessions")) / managed.session_id
        # Metadata also on session store — check scratchpad set by desktop.
    except Exception:
        pass
    return False


def set_session_unattended_enabled(session: Any, enabled: bool) -> None:
    sp = getattr(session, "scratchpad", None)
    if not isinstance(sp, dict):
        sp = {}
        setattr(session, "scratchpad", sp)
    sp[SESSION_META_UNATTENDED] = bool(enabled)
    if enabled and SCRATCH_SUPERVISOR_STARTED_KEY not in sp:
        sp[SCRATCH_SUPERVISOR_STARTED_KEY] = time.time()


def _last_progress_ts(messages: list[dict[str, Any]]) -> float:
    best = 0.0
    for item in reversed(messages or []):
        ts = item.get("timestamp")
        try:
            t = float(ts) / 1000.0 if ts and float(ts) > 1e12 else float(ts or 0)
        except (TypeError, ValueError):
            t = 0.0
        if t > best:
            best = t
    return best


def _messages_from_managed(managed: Any) -> list[dict[str, Any]]:
    hist = getattr(managed.studio_session, "chat_history", None) or []
    return list(hist)


class SessionSupervisor:
    """Poll sessions and trigger internal continuation when unattended mode is on."""

    def __init__(self, manager: Any, *, continue_fn: Any) -> None:
        self._manager = manager
        self._continue_fn = continue_fn
        self._task: Optional[asyncio.Task[None]] = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="session-supervisor")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                _log.warning("session supervisor tick error: %s", exc)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=POLL_INTERVAL_SEC)
            except asyncio.TimeoutError:
                continue

    async def _tick(self) -> None:
        cfg = load_unattended_config()
        if not cfg.get("enabled"):
            return
        max_cont = int(cfg["max_continuations_per_session"])
        max_hours = float(cfg["max_wall_clock_hours"])
        stall_after = int(cfg["stall_continue_after_seconds"])
        detect_sec = int(
            __import__("agenticx.studio.continuation", fromlist=["get_runtime_value"]).get_runtime_value(
                "runtime.stall_detect_silence_seconds", 90
            )
        )

        sessions = self._manager.list_sessions()
        now = time.time()
        for row in sessions:
            sid = str(row.get("session_id", "") or "").strip()
            if not sid:
                continue
            managed = self._manager.get(sid, touch=False)
            if managed is None:
                continue
            if not _session_unattended_enabled(managed):
                continue

            sp = getattr(managed.studio_session, "scratchpad", {}) or {}
            started = float(sp.get(SCRATCH_SUPERVISOR_STARTED_KEY, managed.created_at) or managed.created_at)
            if max_hours > 0 and (now - started) > max_hours * 3600.0:
                await self._fail_session(
                    managed,
                    f"达到 max_wall_clock_hours={max_hours}",
                )
                continue

            round_n = get_continuation_round(managed.studio_session)
            if round_n >= max_cont:
                await self._fail_session(
                    managed,
                    f"达到 max_continuations_per_session={max_cont}",
                )
                continue

            messages = _messages_from_managed(managed)
            if todos_completed(messages):
                self._append_done_notice(managed)
                set_session_unattended_enabled(managed.studio_session, False)
                self._manager.persist(sid)
                continue

            exec_state = str(
                row.get("execution_state")
                or getattr(managed, "execution_state", "idle")
                or "idle"
            ).strip()
            if exec_state == "running":
                # Let active runs finish; stall silence handled on next tick.
                pass

            last_msg = messages[-1] if messages else None
            last_ts = _last_progress_ts(messages) or managed.updated_at
            silent = max(0.0, now - last_ts) if last_ts else 0.0
            session_age = max(0.0, now - float(managed.created_at or now))

            eval_result = evaluate_stall_for_continuation(
                StallEvaluateInput(
                    execution_state=exec_state,
                    sse_active=False,
                    silent_seconds=silent,
                    stall_detect_silence_seconds=detect_sec,
                    last_message=last_msg,
                    session_age_seconds=session_age,
                )
            )
            if not eval_result.should_auto_continue:
                continue
            if silent < stall_after and exec_state != "interrupted":
                continue

            reason = eval_result.continue_reason
            if reason == "exhausted" and not cfg.get("auto_resume_exhausted"):
                continue
            if reason == "interrupted" and not cfg.get("auto_resume_interrupted"):
                continue

            _log_supervisor_event(
                sid,
                {
                    "action": "continue",
                    "reason": reason,
                    "round": round_n + 1,
                    "silent_seconds": silent,
                },
            )
            try:
                await self._continue_fn(
                    sid,
                    reason=reason,
                    source="supervisor",
                    skip_dedupe=False,
                )
            except Exception as exc:
                _log.warning("supervisor continue failed sid=%s: %s", sid, exc)

    def _append_done_notice(self, managed: Any) -> None:
        parsed = latest_todo_from_messages(_messages_from_managed(managed))
        summary = ""
        if parsed:
            summary = f"（{parsed.completed}/{parsed.total}）"
        row = {
            "id": __import__("uuid").uuid4().hex,
            "role": "tool",
            "content": f"✅ 任务已完成{summary}",
            "agent_id": "meta",
            "metadata": {"kind": "unattended_done", "source": "supervisor"},
        }
        managed.studio_session.chat_history.append(row)

    async def _fail_session(self, managed: Any, reason: str) -> None:
        sid = managed.session_id
        row = {
            "id": __import__("uuid").uuid4().hex,
            "role": "tool",
            "content": f"⛔ 无人值守已停止：{reason}",
            "agent_id": "meta",
            "metadata": {"kind": "unattended_failed", "source": "supervisor", "reason": reason},
        }
        managed.studio_session.chat_history.append(row)
        self._manager.set_execution_state(sid, "failed")
        set_session_unattended_enabled(managed.studio_session, False)
        meta = {"failure_reason": reason}
        sp = getattr(managed.studio_session, "scratchpad", None)
        if isinstance(sp, dict):
            sp["__unattended_failure__"] = reason
        self._manager.persist(sid)
        _log_supervisor_event(sid, {"action": "failed", "reason": reason})
        _ = meta


async def maybe_start_supervisor(app: Any, manager: Any, continue_fn: Any) -> Optional[asyncio.Task[None]]:
    cfg = load_unattended_config()
    if not cfg.get("enabled"):
        return None
    sup = SessionSupervisor(manager, continue_fn=continue_fn)
    app.state.session_supervisor = sup
    await sup.start()
    return None
