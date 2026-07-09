"""Persist visible notices when a chat SSE turn ends without FINAL."""

from __future__ import annotations

import uuid
from typing import Any

TURN_INTERRUPTED_KIND = "turn_interrupted"

_CAUSE_MESSAGES: dict[str, str] = {
    "user_interrupt": "已按用户请求中断当前生成。可点「恢复执行」继续。",
    "runtime_failure": "运行出错，本轮未收到模型最终响应。可点「恢复执行」重试。",
    "client_disconnect": "连接已断开，本轮在工具执行后未收到模型最终响应。可点「恢复执行」继续。",
    "cancelled": "本轮生成已取消，未收到模型最终响应。可点「恢复执行」继续。",
    "no_final": "上一步工具执行后未收到模型最终响应。可点「恢复执行」继续。",
    "deferred_action": "模型只回复了开场白，尚未执行后续工具。可点「恢复执行」继续。",
    "unknown": "本轮请求已中断（未收到模型最终响应）。可点「恢复执行」继续。",
}

_DETECTOR_MESSAGES: dict[str, str] = {
    "llm_round_timeout": "模型响应超时",
    "llm_stream_timeout": "模型流式响应超时",
    "streamed_tool_call_truncated": "工具参数流式截断",
}


def _last_history_row(session: Any) -> dict[str, Any] | None:
    history = getattr(session, "chat_history", None)
    if not isinstance(history, list) or not history:
        return None
    last = history[-1]
    return last if isinstance(last, dict) else None


def _row_meta(row: dict[str, Any]) -> dict[str, Any]:
    meta_raw = row.get("metadata")
    return meta_raw if isinstance(meta_raw, dict) else {}


def _last_row_is_tool_result(session: Any) -> bool:
    """True when the turn ended on a real tool execution row (not a status notice)."""
    last = _last_history_row(session)
    if last is None or str(last.get("role", "")) != "tool":
        return False
    meta = _row_meta(last)
    notice_kind = str(meta.get("kind") or "").strip()
    if notice_kind in {
        TURN_INTERRUPTED_KIND,
        "continuation_notice",
        "unattended_done",
        "unattended_failed",
        "todo_disk_reconcile",
    }:
        return False
    if str(last.get("tool_call_id", "") or meta.get("tool_call_id", "")).strip():
        return True
    tool_name = str(last.get("tool_name", "") or meta.get("tool_name", "")).strip()
    if tool_name and tool_name not in {"group_progress"}:
        return True
    content = str(last.get("content") or "").strip()
    if content.startswith("exit_code="):
        return True
    return False


def _normalize_detector(detector: str | None) -> str:
    return str(detector or "").strip().lower()


def _detector_suffix(detector: str | None) -> str:
    label = _DETECTOR_MESSAGES.get(_normalize_detector(detector), "")
    if not label:
        return ""
    return f"（原因：{label}）"


def interruption_notice_content(
    *,
    cause: str,
    session: Any,
    detector: str | None = None,
) -> str:
    key = cause if cause in _CAUSE_MESSAGES else "unknown"
    if key in {"no_final", "unknown"} and _last_row_is_tool_result(session):
        return _CAUSE_MESSAGES["no_final"] + _detector_suffix(detector)
    return _CAUSE_MESSAGES[key] + _detector_suffix(detector)


def has_turn_interruption_notice(session: Any) -> bool:
    last = _last_history_row(session)
    if last is None:
        return False
    return _row_meta(last).get("kind") == TURN_INTERRUPTED_KIND


def _history_has_user_message(session: Any) -> bool:
    """True when the session's chat history contains at least one user turn."""
    history = getattr(session, "chat_history", None)
    if not isinstance(history, list):
        return False
    for row in history:
        if isinstance(row, dict) and str(row.get("role", "")) == "user":
            return True
    return False


def append_turn_interruption_notice(
    session: Any,
    *,
    cause: str | None,
    saw_final: bool,
    detector: str | None = None,
) -> bool:
    """Append a turn_interrupted tool row when a turn ends without FINAL (idempotent)."""
    if saw_final or not cause:
        return False
    history = getattr(session, "chat_history", None)
    if not isinstance(history, list):
        return False
    if has_turn_interruption_notice(session):
        return False
    # 无任何用户轮的会话（例如空会话上被误触发的 continuation/resume 立即失败）不应
    # 留下「恢复执行」失败占位——保持「新会话」中性态，避免用户一进新对话就看到中断卡。
    if not _history_has_user_message(session):
        return False
    content = interruption_notice_content(cause=cause, session=session, detector=detector)
    metadata = {
        "kind": TURN_INTERRUPTED_KIND,
        "cause": cause,
        "source": "runtime",
    }
    normalized_detector = _normalize_detector(detector)
    if normalized_detector:
        metadata["detector"] = normalized_detector
    history.append(
        {
            "id": uuid.uuid4().hex,
            "role": "tool",
            "content": content,
            "agent_id": "meta",
            "metadata": metadata,
        }
    )
    return True


def resolve_turn_interruption_cause(
    manager: Any,
    session_id: str,
    *,
    saw_final: bool,
    had_runtime_failure: bool,
    client_disconnected: bool = False,
    runtime_cancelled: bool = False,
) -> str | None:
    if saw_final:
        return None
    if manager.should_interrupt(session_id):
        return "user_interrupt"
    if had_runtime_failure:
        return "runtime_failure"
    if client_disconnected and runtime_cancelled:
        return "client_disconnect"
    if runtime_cancelled:
        return "cancelled"
    return "no_final"


def clear_stale_unattended_failure(session: Any) -> None:
    """Drop supervisor wall-clock failure scratchpad when user starts a new manual turn."""
    scratchpad = getattr(session, "scratchpad", None)
    if isinstance(scratchpad, dict):
        scratchpad.pop("__unattended_failure__", None)
