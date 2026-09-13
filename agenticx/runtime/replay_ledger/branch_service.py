#!/usr/bin/env python3
"""Create a new session from a durable replay checkpoint.

Author: Damon Li
"""

from __future__ import annotations

import threading
import uuid
from collections import Counter
from typing import Any

from agenticx.cli.studio import StudioSession
from agenticx.runtime.isolate_run import discard_isolate, save_isolate_state
from agenticx.runtime.replay_ledger.contracts import (
    RunEvent,
    WorkspaceSnapshotRef,
)
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore
from agenticx.runtime.replay_ledger.workspace_snapshot import (
    restore_git_workspace_snapshot,
)

_BRANCH_LOCKS_GUARD = threading.Lock()
_BRANCH_LOCKS: dict[str, threading.Lock] = {}


class BranchServiceError(RuntimeError):
    """Base error carrying a stable API-safe code."""

    status_code = 400

    def __init__(self, code: str, detail: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail or code


class BranchNotFoundError(BranchServiceError):
    """Requested run or event does not exist."""

    status_code = 404


class BranchConflictError(BranchServiceError):
    """Source state conflicts with safe branching."""

    status_code = 409


class BranchInternalError(BranchServiceError):
    """Internal branch creation failure with a stable sanitized code."""

    status_code = 500


def resolve_branch_checkpoint(
    *,
    events: list[RunEvent],
    requested_event_id: str,
) -> tuple[RunEvent | None, str]:
    """Resolve a selected event to its nearest prior stable checkpoint."""
    selected = next(
        (event for event in events if event.event_id == requested_event_id),
        None,
    )
    if selected is None:
        return None, "event_not_found"
    latest_gap_seq = max(
        (
            event.seq
            for event in events
            if event.type == "ledger_gap" and event.seq <= selected.seq
        ),
        default=0,
    )
    upper_seq = selected.seq - 1 if selected.type == "tool_call" else selected.seq
    candidates = [
        event
        for event in events
        if latest_gap_seq < event.seq <= upper_seq
        and event.branchable
        and bool(event.checkpoint_ref)
    ]
    if not candidates:
        return None, "no_stable_checkpoint"
    return max(candidates, key=lambda event: event.seq), ""


def _lock_for(session_id: str) -> threading.Lock:
    with _BRANCH_LOCKS_GUARD:
        return _BRANCH_LOCKS.setdefault(session_id, threading.Lock())


def _safe_event(event: RunEvent) -> dict[str, Any]:
    return {
        "event_id": event.event_id,
        "seq": event.seq,
        "type": event.type,
        "title": event.title,
    }


def _effect_warnings(events: list[RunEvent], resolved_seq: int) -> list[dict[str, Any]]:
    counts: Counter[tuple[str, str]] = Counter()
    for event in events:
        if (
            event.seq <= resolved_seq
            and event.type == "tool_call"
            and event.effect_class in {"external_write", "unknown"}
        ):
            counts[(event.effect_class, event.title or "unknown_tool")] += 1
    return [
        {"effect_class": effect, "tool_name": tool, "count": count}
        for (effect, tool), count in sorted(counts.items())
    ]


class BranchService:
    """Coordinate immutable source reads and atomic branch creation."""

    def __init__(self, *, store: ReplayLedgerStore, manager: Any) -> None:
        self.store = store
        self.manager = manager

    def _cleanup_target(
        self,
        target_session_id: str,
        workspace_state: dict[str, str],
    ) -> None:
        if workspace_state:
            temporary = StudioSession()
            save_isolate_state(temporary, workspace_state)
            discard_isolate(temporary)
        delete_session = getattr(self.manager, "delete", None)
        if callable(delete_session):
            try:
                delete_session(target_session_id)
            except Exception:
                pass

    def create_branch(
        self,
        *,
        source_run_id: str,
        source_event_id: str,
        instruction: str,
        provider: str | None = None,
        model: str | None = None,
    ) -> dict[str, Any]:
        """Create a branch session without executing its continuation."""
        normalized_instruction = str(instruction or "").strip()
        if not normalized_instruction:
            raise BranchServiceError("instruction_required")
        if len(normalized_instruction) > 20_000:
            raise BranchServiceError("instruction_too_long")
        record = self.store.get_run(source_run_id)
        if record is None:
            raise BranchNotFoundError("run_not_found")
        if record.completeness != "complete" or record.gap_reason:
            raise BranchConflictError("run_incomplete")
        with _lock_for(record.session_id):
            source = self.manager.get(record.session_id, touch=False)
            if source is None:
                raise BranchNotFoundError("source_session_not_found")
            if (
                record.status == "running"
                or getattr(source, "execution_state", "idle") == "running"
            ):
                raise BranchConflictError("source_session_running")
            events, has_more = self.store.read_events(
                source_run_id,
                limit=max(1, record.event_count + 1),
            )
            if has_more:
                raise BranchServiceError("run_events_incomplete")
            refreshed_record = self.store.get_run(source_run_id)
            if (
                refreshed_record is None
                or refreshed_record.completeness != "complete"
                or refreshed_record.gap_reason
            ):
                raise BranchConflictError("run_incomplete")
            requested = next(
                (event for event in events if event.event_id == source_event_id),
                None,
            )
            if requested is None:
                raise BranchNotFoundError("event_not_found")
            resolved, reason = resolve_branch_checkpoint(
                events=events,
                requested_event_id=source_event_id,
            )
            if resolved is None:
                raise BranchConflictError(reason)
            checkpoint = self.store.read_checkpoint(
                source_run_id,
                str(resolved.checkpoint_ref or ""),
            )
            if checkpoint is None:
                raise BranchConflictError("checkpoint_unavailable")
            snapshot_data = self.store.read_blob(
                source_run_id,
                str(checkpoint.workspace_ref or resolved.workspace_ref or ""),
            )
            if not isinstance(snapshot_data, dict):
                raise BranchConflictError("workspace_snapshot_unavailable")
            snapshot = WorkspaceSnapshotRef.from_dict(snapshot_data)
            if not snapshot.branchable:
                raise BranchConflictError(snapshot.reason or "workspace_not_branchable")
            target_session_id = str(uuid.uuid4())
            workspace_state: dict[str, str] = {}
            if snapshot.mode == "git":
                try:
                    workspace_state = restore_git_workspace_snapshot(
                        snapshot,
                        target_session_id=target_session_id,
                    )
                except Exception as exc:
                    code = str(exc)
                    if not code.startswith("workspace_restore_failed:"):
                        code = "workspace_restore_failed:unknown"
                    raise BranchInternalError(code) from exc
            lineage = {
                "parent_session_id": record.session_id,
                "parent_run_id": record.run_id,
                "source_event_id": requested.event_id,
                "source_seq": requested.seq,
                "resolved_checkpoint_event_id": resolved.event_id,
                "resolved_checkpoint_seq": resolved.seq,
            }
            try:
                forked = self.manager.fork_session_from_checkpoint(
                    source_session_id=record.session_id,
                    target_session_id=target_session_id,
                    checkpoint=checkpoint,
                    lineage=lineage,
                    workspace_state=workspace_state,
                    provider=str(provider or "").strip() or checkpoint.provider,
                    model=str(model or "").strip() or checkpoint.model,
                )
            except Exception:
                self._cleanup_target(target_session_id, workspace_state)
                raise BranchInternalError("branch_session_create_failed")
            try:
                self.store.increment_branch_count(record.run_id)
            except Exception as exc:
                self._cleanup_target(target_session_id, workspace_state)
                raise BranchInternalError("branch_lineage_persist_failed") from exc
            return {
                "ok": True,
                "session_id": forked.session_id,
                "source_run_id": record.run_id,
                "resolved_checkpoint_seq": resolved.seq,
                "requested_event": _safe_event(requested),
                "resolved_event": _safe_event(resolved),
                "lineage": lineage,
                "warnings": _effect_warnings(events, resolved.seq),
                "instruction": normalized_instruction,
                "provider": str(provider or "").strip() or checkpoint.provider,
                "model": str(model or "").strip() or checkpoint.model,
            }
