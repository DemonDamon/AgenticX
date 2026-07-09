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
from agenticx.runtime.scratchpad_utils import scratchpad_truthy
from agenticx.studio.continuation import (
    SCRATCH_SUPERVISOR_STARTED_KEY,
    format_continuation_notice,
    get_continuation_round,
    load_unattended_config,
    no_progress_reject_reason,
    prepare_continue,
)

_log = logging.getLogger(__name__)

POLL_INTERVAL_SEC = 30.0
SESSION_META_UNATTENDED = "unattended_enabled"


def _has_pending_clarification(managed: Any) -> bool:
    """True if the session has an unresolved clarification question.

    Blocks supervisor stall-recovery from auto-continuing a session that is
    legitimately waiting for human input (the clarify gate future is still
    pending). Without this, the supervisor would mistake "user hasn't
    answered yet" for "agent stalled" and reboot the turn repeatedly.
    """
    try:
        clarify_gate = getattr(managed, "clarify_gate", None)
        if clarify_gate is not None and hasattr(clarify_gate, "has_pending"):
            if clarify_gate.has_pending():
                return True
        sub_gates = getattr(managed, "sub_clarify_gates", None)
        if isinstance(sub_gates, dict):
            for gate in sub_gates.values():
                if gate is not None and hasattr(gate, "has_pending") and gate.has_pending():
                    return True
        # Also inspect the persisted chat_history tail: an unresolved
        # clarification prompt (no following user answer / tool result with
        # the same request_id) means the turn is parked on human input.
        session = getattr(managed, "studio_session", None)
        history = getattr(session, "chat_history", None) if session is not None else None
        if isinstance(history, list) and history:
            tail = history[-1]
            if isinstance(tail, dict):
                meta = tail.get("metadata")
                if isinstance(meta, dict) and meta.get("kind") == "clarification":
                    return True
    except Exception:
        pass
    return False


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
    if isinstance(sp, dict) and scratchpad_truthy(sp.get(SESSION_META_UNATTENDED)):
        return True
    return False


def set_session_unattended_enabled(session: Any, enabled: bool) -> None:
    sp = getattr(session, "scratchpad", None)
    if not isinstance(sp, dict):
        sp = {}
        setattr(session, "scratchpad", sp)
    sp[SESSION_META_UNATTENDED] = bool(enabled)
    if enabled:
        if SCRATCH_SUPERVISOR_STARTED_KEY not in sp:
            sp[SCRATCH_SUPERVISOR_STARTED_KEY] = time.time()
    else:
        # Reset the wall-clock anchor on disable so a later manual re-enable
        # starts a fresh window instead of re-tripping the old (stale) limit.
        sp.pop(SCRATCH_SUPERVISOR_STARTED_KEY, None)


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


def _last_continue_attempt_ts(session: Any) -> float:
    sp = getattr(session, "scratchpad", None)
    if not isinstance(sp, dict):
        return 0.0
    raw = sp.get("__continuation_last__")
    if not isinstance(raw, dict):
        return 0.0
    try:
        return max(0.0, float(raw.get("ts", 0) or 0))
    except (TypeError, ValueError):
        return 0.0


def _row_kind(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    meta_raw = row.get("metadata")
    meta = meta_raw if isinstance(meta_raw, dict) else {}
    return str(meta.get("kind", "") or "").strip()


def _supervisor_silence_anchor(managed: Any, messages: list[dict[str, Any]]) -> float:
    session = managed.studio_session
    base = _last_progress_ts(messages) or float(getattr(managed, "updated_at", 0) or 0)
    if not messages:
        return base
    tail_kind = _row_kind(messages[-1])
    if tail_kind not in {"turn_interrupted", "continuation_notice"}:
        return base
    return max(
        base,
        float(getattr(managed, "updated_at", 0) or 0),
        _last_continue_attempt_ts(session),
    )


def _messages_from_managed(managed: Any) -> list[dict[str, Any]]:
    hist = getattr(managed.studio_session, "chat_history", None) or []
    return list(hist)


def _has_supervisor_notice(
    messages: list[dict[str, Any]],
    *,
    kind: str,
    limit_code: Optional[str] = None,
) -> bool:
    """True if chat history already contains this supervisor notice (dedupe guard)."""
    for item in reversed(messages or []):
        meta_raw = item.get("metadata")
        meta = meta_raw if isinstance(meta_raw, dict) else {}
        content = str(item.get("content") or "")
        if kind == "unattended_done":
            if meta.get("kind") == "unattended_done" or "任务已完成" in content:
                return True
            continue
        if kind == "unattended_failed":
            is_fail = meta.get("kind") == "unattended_failed" or "无人值守已停止" in content
            if not is_fail:
                continue
            if not limit_code:
                return True
            if meta.get("limit_code") == limit_code:
                return True
            if limit_code == "wall_clock" and "自动运行时长上限" in content:
                return True
            if limit_code == "max_continuations" and "次数上限" in content:
                return True
    return False


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
            # Cold-start guard: `list_sessions()` is cheap (metadata only), but
            # `manager.get()` materializes a session's full messages/todos/
            # taskspaces from disk the first time it is called. Right after
            # server startup, `_sessions` is empty, so calling `get()` here
            # unconditionally for every historical session (hundreds on a
            # long-lived install) synchronously blocks the event loop for the
            # duration of the full-disk restore of ALL of them — this was the
            # dominant cause of the multi-second-to-1-minute cold-start stall.
            # Unattended mode is opt-in per session and rare, so first check
            # only the in-memory cache, then fall back to a single cheap
            # scratchpad-only SQLite read before paying for full restore.
            managed = self._manager.get_if_loaded(sid)
            if managed is None:
                if not self._manager.session_scratchpad_flag(
                    sid, SESSION_META_UNATTENDED
                ):
                    continue
                managed = self._manager.get(sid, touch=False)
            if managed is None:
                continue
            if not _session_unattended_enabled(managed):
                continue

            # If the session is parked on a clarification question, do NOT
            # auto-continue or wall-clock-fail it -- it is legitimately
            # waiting for the user, not stalled.
            if _has_pending_clarification(managed):
                continue

            sp = getattr(managed.studio_session, "scratchpad", {}) or {}
            started = float(sp.get(SCRATCH_SUPERVISOR_STARTED_KEY, managed.created_at) or managed.created_at)
            if max_hours > 0 and (now - started) > max_hours * 3600.0:
                await self._fail_session(
                    managed,
                    f"已连续运行约 {max_hours:g} 小时，达到自动运行时长上限",
                    code="wall_clock",
                )
                continue

            round_n = get_continuation_round(managed.studio_session)
            if round_n >= max_cont:
                await self._fail_session(
                    managed,
                    f"已自动续跑 {max_cont} 次，达到次数上限",
                    code="max_continuations",
                )
                continue

            messages = _messages_from_managed(managed)
            if todos_completed(messages):
                if not _has_supervisor_notice(messages, kind="unattended_done"):
                    self._append_done_notice(managed)
                set_session_unattended_enabled(managed.studio_session, False)
                await self._manager.persist_async(sid)
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
            last_ts = _supervisor_silence_anchor(managed, messages) or managed.updated_at
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
            last_continue_ts = _last_continue_attempt_ts(managed.studio_session)
            if (
                exec_state == "interrupted"
                and last_continue_ts > 0
                and (now - last_continue_ts) < stall_after
            ):
                continue

            reason = eval_result.continue_reason
            if reason == "exhausted" and not cfg.get("auto_resume_exhausted"):
                continue
            if reason == "interrupted" and not cfg.get("auto_resume_interrupted"):
                continue
            no_progress_reason = no_progress_reject_reason(managed.studio_session)
            if no_progress_reason:
                await self._fail_session(managed, no_progress_reason, code="no_progress")
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

    async def _fail_session(
        self, managed: Any, reason: str, *, code: Optional[str] = None
    ) -> None:
        sid = managed.session_id
        messages = _messages_from_managed(managed)
        if _has_supervisor_notice(messages, kind="unattended_failed", limit_code=code):
            self._manager.set_execution_state(sid, "failed")
            set_session_unattended_enabled(managed.studio_session, False)
            await self._manager.persist_async(sid)
            return
        row = {
            "id": __import__("uuid").uuid4().hex,
            "role": "tool",
            "content": f"⛔ 无人值守已停止：{reason}",
            "agent_id": "meta",
            "metadata": {
                "kind": "unattended_failed",
                "source": "supervisor",
                "reason": reason,
                "limit_code": code,
            },
        }
        managed.studio_session.chat_history.append(row)
        self._manager.set_execution_state(sid, "failed")
        set_session_unattended_enabled(managed.studio_session, False)
        meta = {"failure_reason": reason}
        sp = getattr(managed.studio_session, "scratchpad", None)
        if isinstance(sp, dict):
            sp["__unattended_failure__"] = reason
        await self._manager.persist_async(sid)
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
