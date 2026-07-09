#!/usr/bin/env python3
"""Session continuation prompts and bookkeeping for unattended recovery.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
import uuid
from typing import Any, Literal, Optional, Tuple

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.stall_policy import latest_todo_from_messages

_log = logging.getLogger(__name__)

ContinuationReason = Literal["stall", "interrupted", "exhausted", "rate_limit", "manual"]
ContinuationSource = Literal["desktop_manual", "desktop_auto_nudge", "supervisor"]

DEDUP_WINDOW_SEC = 60.0
SCRATCH_LAST_KEY = "__continuation_last__"
SCRATCH_ROUND_KEY = "__continuation_round__"
SCRATCH_SUPERVISOR_STARTED_KEY = "__supervisor_started_at__"
SCRATCH_LAST_TURN_FAILURE_KEY = "__last_turn_failure__"
SCRATCH_NO_PROGRESS_KEY = "__continuation_no_progress__"
SCRATCH_PENDING_FINGERPRINT_KEY = "__continuation_pending_fingerprint__"

REASON_LABELS: dict[str, str] = {
    "stall": "停滞",
    "interrupted": "中断",
    "exhausted": "轮次耗尽",
    "rate_limit": "限流暂停",
    "manual": "手动恢复",
}


def get_runtime_value(path: str, default: Any) -> Any:
    try:
        val = ConfigManager.get_value(path)
        return default if val is None else val
    except Exception:
        return default


def live_reattach_enabled() -> bool:
    """When True, chat SSE uses per-session event hub + reattach endpoint."""
    return bool(get_runtime_value("runtime.live_reattach_enabled", False))


def load_unattended_config() -> dict[str, Any]:
    """Load runtime.unattended.* with conservative defaults."""
    enabled = bool(get_runtime_value("runtime.unattended.enabled", False))
    max_cont = int(
        get_runtime_value("runtime.unattended.max_continuations_per_session", 20) or 20
    )
    max_hours = float(get_runtime_value("runtime.unattended.max_wall_clock_hours", 6) or 6)
    stall_after = int(
        get_runtime_value("runtime.unattended.stall_continue_after_seconds", 120) or 120
    )
    auto_exhausted = bool(
        get_runtime_value("runtime.unattended.auto_resume_exhausted", True)
    )
    auto_interrupted = bool(
        get_runtime_value("runtime.unattended.auto_resume_interrupted", True)
    )
    backoff_raw = get_runtime_value(
        "runtime.unattended.rate_limit_backoff_seconds", [60, 120, 300]
    )
    if not isinstance(backoff_raw, list):
        backoff_raw = [60, 120, 300]
    backoff = [int(x) for x in backoff_raw if isinstance(x, (int, float)) and int(x) > 0]
    if not backoff:
        backoff = [60, 120, 300]
    return {
        "enabled": enabled,
        "max_continuations_per_session": max(1, min(100, max_cont)),
        "max_wall_clock_hours": max(0.25, min(48.0, max_hours)),
        "stall_continue_after_seconds": max(30, min(600, stall_after)),
        "auto_resume_exhausted": auto_exhausted,
        "auto_resume_interrupted": auto_interrupted,
        "rate_limit_backoff_seconds": backoff,
    }


def is_continuation_user_prompt(text: str) -> bool:
    """True when *text* is an internal continuation/nudge prompt, not end-user chat."""
    t = (text or "").strip()
    if not t:
        return True
    if t.startswith("[系统通知]") or t.startswith("[auto-nudge]"):
        return True
    if "【续跑约束】" in t:
        return True
    known = (
        resolve_continuation_prompt("exhausted"),
        resolve_continuation_prompt("interrupted"),
        resolve_continuation_prompt("rate_limit"),
        resolve_continuation_prompt("stall"),
        resolve_continuation_prompt("manual"),
        resolve_continuation_prompt("interrupted", execution_state="interrupted"),
    )
    return t in known


def resolve_continuation_prompt(
    reason: ContinuationReason,
    *,
    execution_state: str = "idle",
) -> str:
    """LLM-facing continuation text (not shown as user bubble when skip_user_history)."""
    if reason == "exhausted":
        return "继续执行，从上次停止的地方接续。"
    if reason == "interrupted" or execution_state == "interrupted":
        return (
            "上一次任务被中断，请从未完成的 todo 项继续，并更新 todo_write 状态。"
        )
    if reason == "rate_limit":
        return (
            "先前因 API 限流暂停。请从未完成的 todo 项继续执行，并更新 todo_write 状态。"
        )
    if reason == "stall":
        return (
            "[auto-nudge] 任务似乎停滞，请汇报当前进度；"
            "若仍有未完成 todo 项请继续执行并更新 todo_write。"
        )
    # manual + idle fallback
    return (
        "请汇报之前任务的执行结果；若文档或文件已生成请给出路径摘要；"
        "若仍有未完成项请继续。"
    )


def _last_failure_label(session: Any) -> str:
    sp = _scratchpad(session)
    raw = sp.get(SCRATCH_LAST_TURN_FAILURE_KEY)
    if isinstance(raw, dict):
        detector = str(raw.get("detector", "") or "").strip()
        text = str(raw.get("text", "") or "").strip()
        if detector:
            return detector
        if text:
            return text[:80]
    history = getattr(session, "chat_history", None)
    if isinstance(history, list):
        for item in reversed(history):
            if not isinstance(item, dict):
                continue
            meta_raw = item.get("metadata")
            meta = meta_raw if isinstance(meta_raw, dict) else {}
            if str(meta.get("kind", "") or "") != "turn_interrupted":
                continue
            cause = str(meta.get("cause", "") or "").strip()
            if cause in {"runtime_failure", "no_final"}:
                return str(meta.get("detector", "") or "").strip() or cause
            break
    return ""


def _large_artifact_retry_constraints(failure_label: str) -> str:
    return (
        f"【续跑约束】上次中断原因：{failure_label}。\n"
        "若当前 todo 是生成 HTML/长文档/完整报告：\n"
        "1) 禁止一次性 file_write 整页超长内容；\n"
        "2) 先 file_write 骨架（标题+目录+占位，≤100 行）；\n"
        "3) 再按章节多次 file_write/file_edit 追加；\n"
        "4) 每完成一章立即 todo_write 更新进度。"
    )


def resolve_continuation_prompt_for_session(
    session: Any,
    reason: ContinuationReason,
    *,
    execution_state: str = "idle",
) -> str:
    """Build a continuation prompt with session-specific recovery constraints."""
    base = resolve_continuation_prompt(reason, execution_state=execution_state)
    failure_label = _last_failure_label(session)
    if not failure_label:
        return base
    return f"{base}\n\n{_large_artifact_retry_constraints(failure_label)}"


def format_continuation_notice(
    source: ContinuationSource,
    reason: ContinuationReason,
    *,
    round_n: int = 1,
    max_rounds: Optional[int] = None,
) -> str:
    """Human-visible notice stored as tool message in chat history."""
    label = REASON_LABELS.get(reason, reason)
    if source == "desktop_auto_nudge":
        cap = f"（第 {round_n}/{max_rounds} 次）" if max_rounds else f"（第 {round_n} 次）"
        return f"🔔 自动续跑提醒{cap} · 原因：{label}"
    if source == "supervisor":
        return f"🔁 无人值守续跑 · 原因：{label} · 第 {round_n} 轮"
    return f"🔁 手动续跑 · 原因：{label}"


def infer_reason_from_states(
    *,
    stall_state: str,
    execution_state: str,
) -> ContinuationReason:
    if stall_state == "exhausted":
        return "exhausted"
    if execution_state == "interrupted":
        return "interrupted"
    if stall_state == "stall":
        return "stall"
    return "manual"


def _scratchpad(session: Any) -> dict[str, Any]:
    sp = getattr(session, "scratchpad", None)
    if not isinstance(sp, dict):
        sp = {}
        setattr(session, "scratchpad", sp)
    return sp


def get_continuation_round(session: Any) -> int:
    sp = _scratchpad(session)
    try:
        return int(sp.get(SCRATCH_ROUND_KEY, 0) or 0)
    except (TypeError, ValueError):
        return 0


def bump_continuation_round(session: Any) -> int:
    sp = _scratchpad(session)
    n = get_continuation_round(session) + 1
    sp[SCRATCH_ROUND_KEY] = n
    return n


def should_dedupe_continue(session: Any, reason: str) -> bool:
    sp = _scratchpad(session)
    last = sp.get(SCRATCH_LAST_KEY)
    if not isinstance(last, dict):
        return False
    if str(last.get("reason", "")).strip() != str(reason).strip():
        return False
    try:
        ts = float(last.get("ts", 0))
    except (TypeError, ValueError):
        return False
    return (time.time() - ts) < DEDUP_WINDOW_SEC


def mark_continue_attempt(session: Any, reason: str, source: str) -> None:
    sp = _scratchpad(session)
    sp[SCRATCH_LAST_KEY] = {"reason": reason, "source": source, "ts": time.time()}


def _is_notice_tool_row(item: dict[str, Any]) -> bool:
    meta_raw = item.get("metadata")
    meta = meta_raw if isinstance(meta_raw, dict) else {}
    kind = str(meta.get("kind", "") or "").strip()
    return kind in {
        "turn_interrupted",
        "continuation_notice",
        "unattended_done",
        "unattended_failed",
        "todo_disk_reconcile",
        "clarification",
    }


def _tool_row_identity(item: dict[str, Any]) -> str:
    tool_name = str(
        item.get("tool_name", item.get("toolName", item.get("name", ""))) or ""
    ).strip()
    content = str(item.get("content", "") or "")
    digest = hashlib.sha1(content.encode("utf-8", errors="ignore")).hexdigest()[:12]
    return f"{tool_name}:{len(content)}:{digest}"


def continuation_progress_fingerprint(session: Any) -> dict[str, Any]:
    """Return a compact progress fingerprint for no-progress continuation guards."""
    history = getattr(session, "chat_history", None)
    rows = [row for row in history if isinstance(row, dict)] if isinstance(history, list) else []
    parsed = latest_todo_from_messages(rows)
    in_progress = ""
    completed = 0
    total = 0
    if parsed is not None:
        completed = parsed.completed
        total = parsed.total
        for item in parsed.items:
            if item.get("status") == "in_progress":
                in_progress = str(item.get("content", "") or "")
                break
    real_tool_rows = [
        row
        for row in rows
        if str(row.get("role", "") or "") == "tool" and not _is_notice_tool_row(row)
    ]
    artifact_count = 0
    for row in real_tool_rows:
        tool_name = str(
            row.get("tool_name", row.get("toolName", row.get("name", ""))) or ""
        ).strip()
        if tool_name in {"file_write", "file_edit"}:
            artifact_count += 1
    last_tool = _tool_row_identity(real_tool_rows[-1]) if real_tool_rows else ""
    return {
        "completed": completed,
        "total": total,
        "in_progress": in_progress,
        "real_tool_count": len(real_tool_rows),
        "artifact_count": artifact_count,
        "last_tool": last_tool,
    }


def _no_progress_limit() -> int:
    raw = get_runtime_value("runtime.unattended.max_no_progress_continues", 3)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 3
    return max(1, min(20, value))


def _no_progress_state(session: Any) -> dict[str, Any]:
    sp = _scratchpad(session)
    raw = sp.get(SCRATCH_NO_PROGRESS_KEY)
    if isinstance(raw, dict):
        return raw
    state: dict[str, Any] = {"count": 0}
    sp[SCRATCH_NO_PROGRESS_KEY] = state
    return state


def no_progress_reject_reason(session: Any) -> str:
    state = _no_progress_state(session)
    limit = _no_progress_limit()
    try:
        count = int(state.get("count", 0) or 0)
    except (TypeError, ValueError):
        count = 0
    if count < limit:
        return ""
    return (
        f"连续 {count} 次续跑无新进展，已停止自动恢复。"
        "请换模型，或改为先写骨架、再分章写文件后手动恢复。"
    )


def mark_continuation_progress_start(session: Any) -> None:
    sp = _scratchpad(session)
    sp[SCRATCH_PENDING_FINGERPRINT_KEY] = continuation_progress_fingerprint(session)


def finalize_continuation_progress(session: Any, *, interrupted: bool) -> None:
    sp = _scratchpad(session)
    before = sp.pop(SCRATCH_PENDING_FINGERPRINT_KEY, None)
    if not isinstance(before, dict):
        return
    after = continuation_progress_fingerprint(session)
    state = _no_progress_state(session)
    if after != before:
        state["count"] = 0
        state["last_fingerprint"] = after
        return
    if interrupted:
        try:
            count = int(state.get("count", 0) or 0)
        except (TypeError, ValueError):
            count = 0
        state["count"] = count + 1
        state["last_fingerprint"] = after
    else:
        state["count"] = 0
        state["last_fingerprint"] = after


def append_continuation_notice(
    chat_history: list,
    *,
    source: ContinuationSource,
    reason: ContinuationReason,
    round_n: int,
    max_rounds: Optional[int] = None,
) -> dict[str, Any]:
    row = {
        "id": uuid.uuid4().hex,
        "role": "tool",
        "content": format_continuation_notice(
            source, reason, round_n=round_n, max_rounds=max_rounds
        ),
        "agent_id": "meta",
        "metadata": {
            "source": source,
            "reason": reason,
            "continuation_round": round_n,
            "kind": "continuation_notice",
        },
    }
    chat_history.append(row)
    return row


async def interrupt_running_for_continue(manager: Any, session_id: str) -> str:
    """Request interrupt on a running session and wait until it settles."""
    sid = str(session_id or "").strip()
    if not sid:
        return "idle"
    managed = manager.get(sid, touch=False)
    if managed is None:
        return "idle"
    exec_state = str(getattr(managed, "execution_state", "idle") or "idle")
    if exec_state != "running":
        return exec_state
    manager.request_interrupt(sid)
    for _ in range(20):
        await asyncio.sleep(0.1)
        managed = manager.get(sid, touch=False)
        if managed is None:
            break
        cur = str(getattr(managed, "execution_state", "idle") or "idle")
        if cur in {"idle", "interrupted"}:
            exec_state = cur
            break
    manager.set_execution_state(sid, "interrupted")
    await manager.persist_async(sid)
    return "interrupted"


def prepare_continue(
    managed: Any,
    *,
    reason: ContinuationReason,
    source: ContinuationSource,
    execution_state: Optional[str] = None,
    max_rounds: Optional[int] = None,
    skip_dedupe: bool = False,
) -> Tuple[bool, str, int, dict[str, Any]]:
    """Validate and record a continuation attempt.

    Returns (ok, prompt, round_n, notice_row).
  """
    session = managed.studio_session
    state = (execution_state or getattr(managed, "execution_state", "idle") or "idle").strip()

    if not skip_dedupe and should_dedupe_continue(session, reason):
        _log.info("continuation deduped session=%s reason=%s", managed.session_id, reason)
        return False, "", get_continuation_round(session), {"reject_text": "续跑请求已去重，请稍后再试"}

    reject_text = no_progress_reject_reason(session)
    if reject_text:
        _log.info("continuation rejected session=%s reason=no_progress", managed.session_id)
        return False, "", get_continuation_round(session), {"reject_text": reject_text}

    round_n = bump_continuation_round(session)
    mark_continue_attempt(session, reason, source)
    mark_continuation_progress_start(session)
    prompt = resolve_continuation_prompt_for_session(
        session,
        reason,
        execution_state=state,
    )
    notice = append_continuation_notice(
        session.chat_history,
        source=source,
        reason=reason,
        round_n=round_n,
        max_rounds=max_rounds,
    )
    return True, prompt, round_n, notice
