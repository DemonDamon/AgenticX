#!/usr/bin/env python3
"""Pure helpers for automation run health.

Shared semantics with ``desktop/electron/automation-run-health.ts``: a
scheduled run records an in-flight marker, consecutive failures can
auto-pause a task, and a run still marked in-flight when the scheduler
starts is recorded as interrupted without counting as another failure.

Inputs are never mutated. Callers truncate error text before
``apply_run_outcome``.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

INTERRUPTED_TEXT = (
    "上次运行在完成前中断（应用退出或进程崩溃），其中的外部操作可能已部分执行。"
    "请先查看那次会话，再决定是否重跑。"
)

AUTO_PAUSE_FAILURE_THRESHOLD = 3

# Case-insensitive substring match, first hit wins.
# "无人值守等待审批超时" is intentionally absent: missing one approval is
# normal and is left to the consecutive-failure threshold.
NEEDS_USER_ACTION_MARKERS: tuple[dict[str, str], ...] = (
    {"needle": "无人值守运行不批准受保护操作", "label": "任务里有需要批准的操作"},
    {"needle": "企业登录已失效", "label": "企业账号登录已失效"},
    {"needle": "invalid_api_key", "label": "模型 API Key 无效"},
    {"needle": "incorrect api key", "label": "模型 API Key 无效"},
    {"needle": "http 401", "label": "鉴权失败"},
    {"needle": "http 403", "label": "没有权限"},
)

_HEALTH_CARRY_KEYS = (
    "runningSince",
    "consecutiveFailures",
    "autoPausedReason",
    "autoPausedAt",
)


def match_needs_user_action(error: Optional[str]) -> Optional[str]:
    """Return the Chinese label for the first matching marker, or None."""
    text = (error or "").lower()
    if not text:
        return None
    for marker in NEEDS_USER_ACTION_MARKERS:
        if marker["needle"].lower() in text:
            return marker["label"]
    return None


def mark_run_started(task: Mapping[str, Any], now_iso: str) -> dict[str, Any]:
    """R1: record that a scheduled run has started."""
    out = dict(task)
    out["runningSince"] = now_iso
    return out


def _failure_count(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return value


def apply_run_outcome(
    task: Mapping[str, Any],
    *,
    ok: bool,
    error: str,
    trigger: str,
    now_iso: str,
) -> dict[str, Any]:
    """Apply R2/R3/R4/R5 for ``schedule``, or R7/R8 for ``manual``."""
    if trigger not in ("schedule", "manual"):
        raise ValueError(f"unknown trigger: {trigger}")
    out = dict(task)
    out["lastRunAt"] = now_iso
    if ok:
        out["lastRunStatus"] = "success"
        out.pop("lastRunError", None)
        out["consecutiveFailures"] = 0
        if trigger == "schedule":
            out.pop("runningSince", None)
        return out

    out["lastRunStatus"] = "error"
    out["lastRunError"] = error if isinstance(error, str) else ""
    if trigger == "manual":
        return out

    out.pop("runningSince", None)
    consecutive_failures = _failure_count(out.get("consecutiveFailures")) + 1
    out["consecutiveFailures"] = consecutive_failures
    label = match_needs_user_action(str(out.get("lastRunError") or ""))
    if label:
        out["enabled"] = False
        out["autoPausedReason"] = "需要你处理：" + label
        out["autoPausedAt"] = now_iso
    elif consecutive_failures >= AUTO_PAUSE_FAILURE_THRESHOLD:
        out["enabled"] = False
        out["autoPausedReason"] = f"连续失败 {consecutive_failures} 次，已自动暂停"
    return out


def mark_interrupted_on_startup(
    task: Mapping[str, Any],
    running_ids: set[str],
) -> dict[str, Any]:
    """R6: mark a leftover in-flight run as interrupted.

    Returns the same object when nothing changes so callers can detect a
    no-op by identity. Does not increment the failure counter and does not
    change ``enabled``.
    """
    running_since = task.get("runningSince")
    if not isinstance(running_since, str) or not running_since:
        return task  # type: ignore[return-value]
    task_id = str(task.get("id") or "")
    if task_id in running_ids:
        return task  # type: ignore[return-value]
    out = dict(task)
    out["lastRunStatus"] = "interrupted"
    out["lastRunError"] = INTERRUPTED_TEXT
    out.pop("runningSince", None)
    return out


def apply_user_enable_toggle(
    prev: Optional[Mapping[str, Any]],
    nxt: Mapping[str, Any],
) -> dict[str, Any]:
    """R9: re-enabling a task clears the auto-pause marker and failure count.

    Health fields missing from ``nxt`` are copied from ``prev``. The task
    editor rebuilds a payload that omits them, and dropping them on every
    save would wipe an in-flight marker or an auto-pause reason.
    """
    out = dict(nxt)
    if prev is not None:
        for key in _HEALTH_CARRY_KEYS:
            if key not in out and key in prev:
                out[key] = prev[key]
        if prev.get("enabled") is False and nxt.get("enabled") is True:
            out.pop("autoPausedReason", None)
            out.pop("autoPausedAt", None)
            out["consecutiveFailures"] = 0
    return out
