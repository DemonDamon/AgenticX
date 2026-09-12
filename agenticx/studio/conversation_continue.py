#!/usr/bin/env python3
"""Conversation-level continue-from-message (dialogue branch, not state restore).

Author: Damon Li
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Sequence


class ConversationContinueError(RuntimeError):
    """Stable API-safe error carrying a machine-readable code."""

    def __init__(self, code: str, detail: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail or code


def _role_of(item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    return str(item.get("role", "") or "").strip()


def _id_of(item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    return str(item.get("id", "") or "").strip()


def slice_transcript_for_continue(
    chat_history: Sequence[dict[str, Any]] | None,
    agent_messages: Sequence[dict[str, Any]] | None,
    message_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Slice ``(chat_history, agent_messages)`` up to and including ``message_id``.

    Rules (frozen by plan):
    - chat cut point is the first row whose ``id`` equals ``message_id``.
    - tool rows are not valid cut points.
    - agent_messages align by user-turn count, keeping the cut round's full
      tool chain when the cut point is an assistant row.
    """
    target = str(message_id or "").strip()
    if not target:
        raise ConversationContinueError("message_not_found")
    chat = [dict(item) for item in (chat_history or []) if isinstance(item, dict)]
    agents = [dict(item) for item in (agent_messages or []) if isinstance(item, dict)]

    idx = -1
    for pos, item in enumerate(chat):
        if _id_of(item) == target:
            idx = pos
            break
    if idx < 0:
        raise ConversationContinueError("message_not_found")

    cut_role = _role_of(chat[idx])
    if cut_role == "tool":
        raise ConversationContinueError("message_not_continueable")
    if cut_role not in {"user", "assistant"}:
        raise ConversationContinueError("message_not_continueable")

    chat_prefix = deepcopy(chat[: idx + 1])

    user_turns = sum(1 for item in chat_prefix if _role_of(item) == "user")
    if user_turns <= 0:
        return chat_prefix, []

    seen = 0
    user_idx = -1
    for pos, item in enumerate(agents):
        if _role_of(item) == "user":
            seen += 1
            if seen == user_turns:
                user_idx = pos
                break
    if user_idx < 0:
        raise ConversationContinueError("unstable_transcript")

    if cut_role == "user":
        agent_prefix = deepcopy(agents[: user_idx + 1])
    else:
        end = len(agents)
        for pos in range(user_idx + 1, len(agents)):
            if _role_of(agents[pos]) == "user":
                end = pos
                break
        agent_prefix = deepcopy(agents[:end])

    try:
        from agenticx.runtime.agent_runtime import _sanitize_context_messages
    except Exception:
        _sanitize_context_messages = None  # type: ignore[assignment]
    if _sanitize_context_messages is not None:
        try:
            cleaned = _sanitize_context_messages(agent_prefix)
        except Exception as exc:
            raise ConversationContinueError("unstable_transcript") from exc
        agent_prefix = [dict(item) for item in (cleaned or [])]

    if _has_unpaired_tool_calls(agent_prefix):
        raise ConversationContinueError("unstable_transcript")
    return chat_prefix, agent_prefix


def _has_unpaired_tool_calls(agent_prefix: Sequence[dict[str, Any]]) -> bool:
    declared: set[str] = set()
    answered: set[str] = set()
    for item in agent_prefix:
        if not isinstance(item, dict):
            continue
        role = _role_of(item)
        if role == "assistant":
            calls = item.get("tool_calls") or []
            if isinstance(calls, list):
                for call in calls:
                    if isinstance(call, dict):
                        cid = str(call.get("id", "") or "").strip()
                        if cid:
                            declared.add(cid)
        elif role == "tool":
            cid = str(item.get("tool_call_id", "") or "").strip()
            if cid:
                answered.add(cid)
    return any(cid not in answered for cid in declared)


def build_conversation_lineage(parent_session_id: str, message_id: str) -> dict[str, Any]:
    return {
        "kind": "conversation",
        "parent_session_id": str(parent_session_id or "").strip(),
        "source_message_id": str(message_id or "").strip(),
        "workspace_mode": "shared_current",
        "shared_write_prompted": False,
    }


def get_conversation_lineage(session: Any) -> dict[str, Any] | None:
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        return None
    raw = scratch.get("conversation_lineage")
    if not isinstance(raw, dict):
        return None
    return raw


def _is_write_path_effect(tool_name: str, effect_class: str | None) -> bool:
    effect = str(effect_class or "").strip()
    if effect:
        return effect in {"local_write", "unknown"}
    name = str(tool_name or "").strip().lower()
    if not name:
        return False
    try:
        from agenticx.runtime.replay_ledger.effects import classify_tool_effect
    except Exception:
        return name in {"file_write", "file_edit", "bash_exec", "bash_bg_start"}
    try:
        classified = classify_tool_effect(name, {})
    except Exception:
        return False
    return classified in {"local_write", "unknown"}


def should_prompt_shared_write(
    session: Any,
    tool_name: str,
    effect_class: str | None = None,
) -> bool:
    """True when a conversation branch must confirm before its first local write."""
    lineage = get_conversation_lineage(session)
    if not isinstance(lineage, dict):
        return False
    if str(lineage.get("kind", "") or "") != "conversation":
        return False
    if str(lineage.get("workspace_mode", "") or "") != "shared_current":
        return False
    if bool(lineage.get("shared_write_prompted", False)):
        return False
    return _is_write_path_effect(tool_name, effect_class)


def mark_shared_write_prompted(session: Any) -> None:
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        return
    lineage = scratch.get("conversation_lineage")
    if isinstance(lineage, dict):
        lineage["shared_write_prompted"] = True
