#!/usr/bin/env python3
"""Capture provider-safe logical state for replay branching.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from agenticx.runtime.agent_runtime import _sanitize_context_messages
from agenticx.runtime.replay_ledger.contracts import ContextCheckpoint, RunEvent

_UNSTABLE_TYPES = {
    "tool_call",
    "tool_progress",
    "confirm_required",
    "clarification_required",
    "assistant_output_started",
    "stall",
    "ledger_gap",
}
_LIVE_SCRATCHPAD_MARKERS = (
    "future",
    "lock",
    "connection",
    "transport",
    "client",
    "mcp_hub",
    "mcp_",
    "connected",
    "confirm_gate",
    "clarify_gate",
    "approval",
    "allowlist",
    "allow_once",
    "one_time",
)


def _tool_call_ids(message: dict[str, Any]) -> set[str]:
    calls = message.get("tool_calls")
    if not isinstance(calls, list):
        return set()
    return {
        str(call.get("id") or "").strip()
        for call in calls
        if isinstance(call, dict) and str(call.get("id") or "").strip()
    }


def latest_tool_batch_is_complete(messages: list[dict[str, Any]]) -> bool:
    """Return whether the newest assistant tool batch has every tool result."""
    assistant_index = -1
    expected: set[str] = set()
    for index in range(len(messages) - 1, -1, -1):
        row = messages[index]
        if not isinstance(row, dict) or row.get("role") != "assistant":
            continue
        expected = _tool_call_ids(row)
        if expected:
            assistant_index = index
            break
    if assistant_index < 0:
        return True
    responded = {
        str(row.get("tool_call_id") or "").strip()
        for row in messages[assistant_index + 1 :]
        if isinstance(row, dict) and row.get("role") == "tool"
    }
    return expected.issubset(responded)


def _interaction_response_is_in_context(
    event: RunEvent,
    agent_messages: list[dict[str, Any]],
) -> bool:
    request_id = str(event.payload.get("id") or "").strip()
    if not request_id:
        return False
    keys = {
        "interaction_id",
        "request_id",
        "confirm_id",
        "clarification_id",
    }
    for message in agent_messages:
        candidates = [message]
        metadata = message.get("metadata")
        if isinstance(metadata, dict):
            candidates.append(metadata)
        for candidate in candidates:
            if any(str(candidate.get(key) or "").strip() == request_id for key in keys):
                return True
    return False


def context_is_branch_stable(
    event: RunEvent,
    agent_messages: list[dict[str, Any]],
) -> tuple[bool, str]:
    """Classify one event boundary without repairing incomplete tool batches."""
    if event.type == "ledger_gap" or event.payload.get("ledger_gap_before") is True:
        return False, "ledger_gap"
    if event.type in {"confirm_required", "confirm_response"}:
        if event.type == "confirm_required":
            return False, "pending_confirm"
        if not _interaction_response_is_in_context(event, agent_messages):
            return False, "confirm_response_not_in_context"
    if event.type in {"clarification_required", "clarification_response"}:
        if event.type == "clarification_required":
            return False, "pending_clarification"
        if not _interaction_response_is_in_context(event, agent_messages):
            return False, "clarification_response_not_in_context"
    if event.type in _UNSTABLE_TYPES:
        return False, "unstable_event"
    if event.type == "tool_result" and not latest_tool_batch_is_complete(
        agent_messages
    ):
        return False, "incomplete_tool_batch"
    if event.type not in {
        "tool_result",
        "confirm_response",
        "clarification_response",
        "assistant_output_completed",
        "run_completed",
    }:
        return False, "not_stable_boundary"
    return True, ""


def _json_safe(value: Any, warnings: list[str], path: str) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, list):
        return [
            safe
            for index, item in enumerate(value)
            if (safe := _json_safe(item, warnings, f"{path}[{index}]")) is not _SKIP
        ]
    if isinstance(value, tuple):
        return _json_safe(list(value), warnings, path)
    if isinstance(value, dict):
        output: dict[str, Any] = {}
        for key, item in value.items():
            text_key = str(key)
            safe = _json_safe(item, warnings, f"{path}.{text_key}")
            if safe is not _SKIP:
                output[text_key] = safe
        return output
    warnings.append(f"skipped non-serializable value at {path}")
    return _SKIP


_SKIP = object()


def _safe_scratchpad(raw: Any, warnings: list[str]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    filtered: dict[str, Any] = {}
    for key, value in raw.items():
        name = str(key)
        lowered = name.lower()
        if any(marker in lowered for marker in _LIVE_SCRATCHPAD_MARKERS):
            warnings.append(f"skipped live scratchpad key {name}")
            continue
        safe = _json_safe(value, warnings, f"scratchpad.{name}")
        if safe is not _SKIP:
            filtered[name] = safe
    return filtered


def capture_context_checkpoint(
    session: Any,
    *,
    workspace_ref: str | None,
) -> tuple[ContextCheckpoint, list[str]]:
    """Capture a canonical checkpoint while excluding live capabilities."""
    warnings: list[str] = []
    raw_messages = [
        dict(row)
        for row in (getattr(session, "agent_messages", None) or [])
        if isinstance(row, dict)
    ]
    if not latest_tool_batch_is_complete(raw_messages):
        raise ValueError("incomplete_tool_batch")
    agent_messages = _sanitize_context_messages(raw_messages)
    if not latest_tool_batch_is_complete(agent_messages):
        raise ValueError("checkpoint_has_unpaired_tool_call")
    prompt = str(getattr(session, "system_prompt", "") or "")
    todo_manager = getattr(session, "todo_manager", None)
    todo_items = (
        todo_manager.to_payload()
        if todo_manager is not None and hasattr(todo_manager, "to_payload")
        else []
    )
    checkpoint = ContextCheckpoint(
        agent_messages=_json_safe(agent_messages, warnings, "agent_messages"),
        chat_history=_json_safe(
            [
                dict(row)
                for row in (getattr(session, "chat_history", None) or [])
                if isinstance(row, dict)
            ],
            warnings,
            "chat_history",
        ),
        context_files={
            str(key): str(value)
            for key, value in dict(
                getattr(session, "context_files", None) or {}
            ).items()
        },
        taskspaces=_json_safe(
            list(getattr(session, "taskspaces", None) or []),
            warnings,
            "taskspaces",
        ),
        active_taskspace_id=(
            str(getattr(session, "active_taskspace_id", "") or "").strip() or None
        ),
        scratchpad=_safe_scratchpad(getattr(session, "scratchpad", None), warnings),
        artifacts=_json_safe(
            dict(getattr(session, "artifacts", None) or {}),
            warnings,
            "artifacts",
        ),
        todo_items=_json_safe(todo_items, warnings, "todo_items"),
        provider=str(getattr(session, "provider_name", "") or "").strip() or None,
        model=str(getattr(session, "model_name", "") or "").strip() or None,
        session_mode=str(
            getattr(session, "session_mode", "daily_office") or "daily_office"
        ),
        system_prompt_sha256=hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        workspace_ref=workspace_ref,
    )
    json.dumps(checkpoint.to_dict(), ensure_ascii=False, sort_keys=True)
    return checkpoint, warnings
