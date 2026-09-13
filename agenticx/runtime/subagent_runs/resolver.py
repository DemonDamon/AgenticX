#!/usr/bin/env python3
"""Resolve canonical sub-agent runs with same-session live overlays.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

from agenticx.runtime.subagent_runs.contracts import RunRecord
from agenticx.runtime.subagent_runs.store import SubAgentRunStore

_ACTIVE_STATUSES = {
    "running",
    "pending",
    "awaiting_confirm",
    "awaiting_input",
}
_TERMINAL_STATUSES = {"completed", "failed", "cancelled", "paused"}


def apply_live_overrides(
    target: dict[str, Any],
    record: RunRecord,
    memory: dict[str, Any],
    *,
    summary_only: bool,
) -> None:
    """Apply a sufficiently fresh live row without reviving terminal runs."""
    if str(record.status or "").strip() in _TERMINAL_STATUSES:
        return
    memory_updated = float(memory.get("updated_at", 0) or 0)
    record_updated = float(record.updated_at or 0)
    memory_status = str(memory.get("status", "") or "")
    if memory_status not in _ACTIVE_STATUSES and memory_updated < record_updated:
        return
    for key in (
        "status",
        "result_summary",
        "error_text",
        "updated_at",
        "provider",
        "model",
        "avatar_id",
        "avatar_session_id",
        "badge_seq",
        "cluster_id",
        "name",
        "role",
    ):
        if key in memory and memory.get(key) is not None:
            target[key] = memory[key]
    if summary_only:
        return
    for key in ("output_files", "result_file"):
        if memory.get(key):
            target[key] = memory[key]
    recent = memory.get("recent_events")
    if isinstance(recent, list) and recent:
        target["recent_events"] = recent[-20:]


def _team_memory_rows(
    owner_session_id: str,
    team_manager: Any | None,
) -> list[dict[str, Any]]:
    if team_manager is None:
        return []
    manager_owner = str(getattr(team_manager, "owner_session_id", "") or "").strip()
    if manager_owner != owner_session_id:
        return []
    getter = getattr(team_manager, "get_status_with_task_fallback", None)
    if not callable(getter):
        getter = getattr(team_manager, "get_status", None)
    if not callable(getter):
        return []
    payload = getter()
    rows = payload.get("subagents", []) if isinstance(payload, dict) else []
    return [dict(row) for row in rows if isinstance(row, dict)]


def _delegate_memory_rows(
    owner_session_id: str,
    session_manager: Any | None,
) -> list[dict[str, Any]]:
    sessions = getattr(session_manager, "_sessions", None)
    if not isinstance(sessions, dict):
        return []
    rows: list[dict[str, Any]] = []
    for managed in sessions.values():
        if getattr(managed, "archived", False):
            continue
        info = getattr(managed, "_delegation_info", None)
        if not isinstance(info, dict):
            continue
        info_owner = str(info.get("from_session", "") or "").strip()
        run_id = str(info.get("delegation_id", "") or "").strip()
        if info_owner != owner_session_id or not run_id:
            continue
        updated_at = float(
            info.get("updated_at", 0)
            or getattr(managed, "updated_at", 0)
            or info.get("completed_at", 0)
            or info.get("started_at", 0)
            or 0
        )
        rows.append(
            {
                "run_id": run_id,
                "agent_id": run_id,
                "kind": "delegate",
                "delegation": True,
                "name": str(
                    info.get("avatar_name", "")
                    or getattr(managed, "avatar_name", "")
                    or run_id
                ),
                "role": str(info.get("role", "") or "delegated avatar"),
                "task": str(info.get("task", "") or ""),
                "status": str(info.get("status", "") or "running"),
                "updated_at": updated_at,
                "created_at": float(info.get("started_at", 0) or updated_at),
                "result_summary": str(info.get("summary", "") or ""),
                "error_text": str(info.get("error", "") or ""),
                "output_files": list(info.get("output_files", []) or []),
                "avatar_id": str(
                    info.get("avatar_id", "")
                    or getattr(managed, "avatar_id", "")
                ),
                "avatar_session_id": str(
                    info.get("avatar_session_id", "")
                    or getattr(managed, "session_id", "")
                ),
                "source": "live",
            }
        )
    return rows


def _memory_map(
    owner_session_id: str,
    *,
    session_manager: Any | None,
    team_manager: Any | None,
) -> dict[str, dict[str, Any]]:
    rows = _team_memory_rows(owner_session_id, team_manager)
    rows.extend(_delegate_memory_rows(owner_session_id, session_manager))
    merged: dict[str, dict[str, Any]] = {}
    for row in rows:
        run_id = str(row.get("run_id", "") or row.get("agent_id", "")).strip()
        if not run_id:
            continue
        previous = merged.get(run_id)
        if previous is None or float(row.get("updated_at", 0) or 0) >= float(
            previous.get("updated_at", 0) or 0
        ):
            row["run_id"] = run_id
            row.setdefault("agent_id", run_id)
            merged[run_id] = row
    return merged


def _merge_ledger_row(
    record: RunRecord,
    memory: dict[str, Any] | None,
) -> dict[str, Any]:
    payload = record.to_dict()
    if memory:
        apply_live_overrides(payload, record, memory, summary_only=False)
    payload["source"] = "ledger"
    payload["delegation"] = record.kind == "delegate"
    payload.setdefault("agent_id", record.run_id)
    return payload


def list_resolved_runs(
    owner_session_id: str,
    *,
    session_manager: Any | None = None,
    team_manager: Any | None = None,
    include_legacy: bool = False,
) -> list[dict[str, Any]]:
    """List owner-scoped ledger records merged with current live state."""
    del include_legacy
    owner_id = str(owner_session_id or "").strip()
    if not owner_id:
        return []
    store = SubAgentRunStore(owner_id)
    memory = _memory_map(
        owner_id,
        session_manager=session_manager,
        team_manager=team_manager,
    )
    rows_by_id: dict[str, dict[str, Any]] = {}
    for record in store.list_runs():
        if record.owner_session_id != owner_id:
            continue
        rows_by_id[record.run_id] = _merge_ledger_row(
            record,
            memory.pop(record.run_id, None),
        )
    for run_id, row in memory.items():
        if str(row.get("status", "") or "").strip() not in _ACTIVE_STATUSES:
            continue
        live = dict(row)
        live["run_id"] = run_id
        live.setdefault("agent_id", run_id)
        live.setdefault("source", "live")
        live.setdefault("delegation", live.get("kind") == "delegate")
        rows_by_id[run_id] = live
    return sorted(
        rows_by_id.values(),
        key=lambda row: (
            float(row.get("created_at", 0) or 0),
            str(row.get("run_id", "") or ""),
        ),
    )


def resolve_run(
    owner_session_id: str,
    run_id: str,
    *,
    session_manager: Any | None = None,
    team_manager: Any | None = None,
    include_legacy: bool = False,
) -> dict[str, Any] | None:
    """Resolve one owner-scoped run without cross-session fallback."""
    owner_id = str(owner_session_id or "").strip()
    requested_id = str(run_id or "").strip()
    if not owner_id or not requested_id:
        return None
    rows = list_resolved_runs(
        owner_id,
        session_manager=session_manager,
        team_manager=team_manager,
        include_legacy=include_legacy,
    )
    requested_key = requested_id.lower()
    exact = next(
        (
            row
            for row in rows
            if str(row.get("run_id", "") or "").strip().lower() == requested_key
        ),
        None,
    )
    if exact is not None:
        return exact
    aliases = [
        row
        for row in rows
        if requested_key
        in {
            str(row.get("name", "") or "").strip().lower(),
            str(row.get("avatar_id", "") or "").strip().lower(),
        }
    ]
    active = [
        row
        for row in aliases
        if str(row.get("status", "") or "").strip() in _ACTIVE_STATUSES
    ]
    candidates = active or aliases
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda row: (
            float(row.get("updated_at", 0) or row.get("created_at", 0) or 0),
            float(row.get("created_at", 0) or 0),
            str(row.get("run_id", "") or ""),
        ),
    )
