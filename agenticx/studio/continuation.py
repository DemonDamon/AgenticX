#!/usr/bin/env python3
"""Session continuation prompts and bookkeeping for unattended recovery.

Author: Damon Li
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Literal, Optional, Tuple

from agenticx.cli.config_manager import ConfigManager

_log = logging.getLogger(__name__)

ContinuationReason = Literal["stall", "interrupted", "exhausted", "rate_limit", "manual"]
ContinuationSource = Literal["desktop_manual", "desktop_auto_nudge", "supervisor"]

DEDUP_WINDOW_SEC = 60.0
SCRATCH_LAST_KEY = "__continuation_last__"
SCRATCH_ROUND_KEY = "__continuation_round__"
SCRATCH_SUPERVISOR_STARTED_KEY = "__supervisor_started_at__"

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
        return False, "", get_continuation_round(session), {}

    round_n = bump_continuation_round(session)
    mark_continue_attempt(session, reason, source)
    prompt = resolve_continuation_prompt(reason, execution_state=state)
    notice = append_continuation_notice(
        session.chat_history,
        source=source,
        reason=reason,
        round_n=round_n,
        max_rounds=max_rounds,
    )
    return True, prompt, round_n, notice
