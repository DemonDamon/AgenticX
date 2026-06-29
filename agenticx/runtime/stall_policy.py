#!/usr/bin/env python3
"""Stall detection helpers (Python parity with desktop task-stall-policy).

Author: Damon Li
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any, Literal, Optional

CHANNEL_C_GRACE_SEC = 5.0

ContinuationReason = Literal["stall", "interrupted", "exhausted", "rate_limit", "manual"]

# Trailing punctuation that suggests the model stopped mid-thought (often before a tool call).
_UNFINISHED_TRAILING_RE = re.compile(r"[:：,，;；、—…]+$", re.UNICODE)

# Mirror of session_manager._HANDOFF_BODY_RE — keep in sync.
_HANDOFF_BODY_RE_LOCAL = re.compile(
    r"我现在进入第[一二三四五六七八九十0-9]+[项步阶段点]"
    r"|现在开始(?:进行|优化|处理|执行|动手)"
    r"|让我开始(?:进行|优化|处理|执行|动手)"
    r"|我(?:现在)?去(?:读取|加载|执行|处理|优化|改|看)"
    r"|我来(?:试试|看看|读取|加载|执行|改|优化)"
    r"|接下来我(?:就|来|去|会)(?:读取|执行|改|优化|开始)",
)

_HANDOFF_BODY_MAX_CHARS = 300


def _last_message_is_deferred_handoff(message: Optional[dict[str, Any]]) -> bool:
    """True if the assistant's last message is a verbal handoff w/o tool calls."""
    if not message or not isinstance(message, dict):
        return False
    if str(message.get("role", "")).strip() != "assistant":
        return False
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        return False
    body = str(message.get("content", "") or "").strip()
    if not body or len(body) >= _HANDOFF_BODY_MAX_CHARS:
        return False
    return bool(_HANDOFF_BODY_RE_LOCAL.search(body))


def _assistant_body_text(message: dict[str, Any]) -> str:
    return str(message.get("content", "")).strip()


def _looks_like_unfinished_assistant_body(text: str) -> bool:
    trimmed = str(text or "").strip()
    if not trimmed:
        return False
    return bool(_UNFINISHED_TRAILING_RE.search(trimmed))


def message_looks_like_assistant_final(message: Optional[dict[str, Any]]) -> bool:
    if not message or not isinstance(message, dict):
        return False
    if str(message.get("role", "")).strip() != "assistant":
        return False
    if str(message.get("id", "")).strip() == "__stream__":
        return False
    content = _assistant_body_text(message)
    if not content:
        return False
    if _looks_like_unfinished_assistant_body(content):
        return False
    return True


def should_trigger_incomplete_end_stall(
    execution_state: str,
    *,
    sse_active: bool,
    last_message: Optional[dict[str, Any]],
    grace_elapsed_sec: float,
) -> bool:
    if sse_active:
        return False
    if grace_elapsed_sec < CHANNEL_C_GRACE_SEC:
        return False
    state = (execution_state or "").strip().lower()
    if state not in {"idle", "interrupted"}:
        return False
    return not message_looks_like_assistant_final(last_message)


@dataclass
class TodoParseResult:
    items: list[dict[str, str]]
    completed: int
    total: int
    all_done: bool
    has_todos: bool


def parse_todo_tool_content(text: str) -> Optional[TodoParseResult]:
    """Parse todo_write tool result text (same line formats as desktop)."""
    body = str(text or "").strip()
    if not body:
        return None
    if body.startswith("🗂"):
        body = re.sub(r"^🗂\s*任务清单更新", "", body).strip()
    if not body:
        return None
    items: list[dict[str, str]] = []
    completed = 0
    total = 0
    has_summary = False
    for line in [ln.strip() for ln in body.split("\n") if ln.strip()]:
        summary = re.match(r"^\((\d+)\s*/\s*(\d+)\s*completed\)$", line, re.I)
        if summary:
            completed = int(summary.group(1))
            total = int(summary.group(2))
            has_summary = True
            continue
        done = re.match(r"^(?:-\s*)?\[[xX]\]\s+(.+)$", line)
        if done:
            items.append({"status": "completed", "content": done.group(1)})
            continue
        doing = re.match(r"^(?:-\s*)?\[>\]\s+(.+?)(?:\s+<-\s+(.+))?$", line)
        if doing:
            items.append(
                {
                    "status": "in_progress",
                    "content": doing.group(1).strip(),
                }
            )
            continue
        todo = re.match(r"^(?:-\s*)?\[\s\]\s+(.+)$", line)
        if todo:
            items.append({"status": "pending", "content": todo.group(1)})
    if not items:
        return None
    if not body.startswith("🗂") and not has_summary and len(items) < 2:
        return None
    if not total:
        total = len(items)
    if not completed:
        completed = sum(1 for i in items if i.get("status") == "completed")
    open_items = [i for i in items if i.get("status") in {"pending", "in_progress"}]
    all_done = len(open_items) == 0 and len(items) > 0
    return TodoParseResult(
        items=items,
        completed=completed,
        total=total,
        all_done=all_done,
        has_todos=True,
    )


def latest_todo_from_messages(messages: list[dict[str, Any]]) -> Optional[TodoParseResult]:
    for item in reversed(messages or []):
        if str(item.get("role", "")).strip() != "tool":
            continue
        tool_name = str(item.get("tool_name", item.get("toolName", "")) or "").strip()
        if tool_name != "todo_write":
            continue
        parsed = parse_todo_tool_content(str(item.get("content", "")))
        if parsed:
            return parsed
    return None


def todos_completed(messages: list[dict[str, Any]]) -> bool:
    parsed = latest_todo_from_messages(messages)
    if parsed is None:
        return False
    return parsed.all_done


@dataclass
class StallEvaluateInput:
    execution_state: str
    sse_active: bool
    silent_seconds: float
    stall_detect_silence_seconds: int
    last_message: Optional[dict[str, Any]]
    session_age_seconds: float
    stall_state_hint: str = "none"


@dataclass
class StallEvaluateResult:
    should_stall: bool
    should_auto_continue: bool
    continue_reason: ContinuationReason
    channel: str = ""


def evaluate_stall_for_continuation(inp: StallEvaluateInput) -> StallEvaluateResult:
    """Decide if unattended continuation should fire (supervisor / policy)."""
    silence = max(30, int(inp.stall_detect_silence_seconds))
    silent = max(0.0, float(inp.silent_seconds))
    exec_state = (inp.execution_state or "idle").strip().lower()

    channel_a = inp.sse_active and silent >= silence
    channel_b = (
        not inp.sse_active
        and exec_state == "running"
        and silent >= silence
    )
    channel_c = should_trigger_incomplete_end_stall(
        exec_state,
        sse_active=inp.sse_active,
        last_message=inp.last_message,
        grace_elapsed_sec=inp.session_age_seconds,
    )

    should_stall = channel_a or channel_b or channel_c
    # Promote: a deferred handoff message is itself a stall signal, even when no
    # other channel fires (idle session + body that looks "final" superficially).
    if not should_stall and _last_message_is_deferred_handoff(inp.last_message):
        should_stall = True
    if not should_stall and inp.stall_state_hint != "stall":
        return StallEvaluateResult(False, False, "manual")

    if exec_state == "interrupted":
        reason: ContinuationReason = "interrupted"
    elif inp.stall_state_hint == "exhausted":
        reason = "exhausted"
    elif channel_c:
        reason = "stall"
    else:
        reason = "stall"

    # Auto-continue when stalled and not purely idle-with-final
    can_continue = exec_state in {"running", "interrupted", "idle"}
    if exec_state == "idle" and message_looks_like_assistant_final(inp.last_message):
        # Override: deferred handoff (口头交接但未调工具) — supervisor must continue.
        if _last_message_is_deferred_handoff(inp.last_message):
            can_continue = True
        else:
            can_continue = False

    return StallEvaluateResult(
        should_stall=should_stall,
        should_auto_continue=should_stall and can_continue,
        continue_reason=reason,
        channel="A" if channel_a else "B" if channel_b else "C" if channel_c else "",
    )
