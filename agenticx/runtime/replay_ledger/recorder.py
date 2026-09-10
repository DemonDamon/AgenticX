#!/usr/bin/env python3
"""Best-effort normalization of runtime events into replay events.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from typing import Any

from agenticx.runtime.agent_runtime import _tool_result_status
from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.replay_ledger.contracts import (
    EVENT_TYPES,
    ReplayRunRecord,
    RunEvent,
    WorkspaceSnapshotRef,
)
from agenticx.runtime.replay_ledger.effects import classify_tool_effect
from agenticx.runtime.replay_ledger.context_checkpoint import (
    capture_context_checkpoint,
    context_is_branch_stable,
)
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore
from agenticx.runtime.replay_ledger.workspace_snapshot import (
    capture_git_workspace_snapshot,
)

logger = logging.getLogger(__name__)

_EVENT_MAP = {
    EventType.ROUND_START.value: "round_started",
    EventType.TOOL_PROGRESS.value: "tool_progress",
    EventType.CONFIRM_REQUIRED.value: "confirm_required",
    EventType.CONFIRM_RESPONSE.value: "confirm_response",
    EventType.CLARIFICATION_REQUIRED.value: "clarification_required",
    EventType.CLARIFICATION_RESPONSE.value: "clarification_response",
    EventType.CLARIFICATION_SUSPENDED.value: "clarification_suspended",
    EventType.COMPACTION.value: "compaction",
    EventType.CONTEXT_STATS.value: "context_stats",
    EventType.STALL.value: "stall",
    EventType.ERROR.value: "error",
}


class ReplayLedgerRecorder:
    """Record one active runtime turn without affecting execution."""

    def __init__(
        self,
        *,
        store: ReplayLedgerStore,
        session_id: str,
        agent_id: str,
        provider: str | None,
        model: str | None,
        resume_run_id: str | None = None,
        branch_lineage: dict[str, Any] | None = None,
    ) -> None:
        self.store = store
        self.session_id = str(session_id or "").strip()
        self.agent_id = str(agent_id or "meta").strip()
        self.provider = str(provider or "").strip() or None
        self.model = str(model or "").strip() or None
        self.resume_run_id = str(resume_run_id or "").strip() or None
        self.branch_lineage = dict(branch_lineage or {})
        self._resume_consumed = False
        self.current_run_id: str | None = None
        self.turn_id: str | None = None
        self._tool_events: dict[str, str] = {}
        self._output_started = False
        self._finished = False
        self._disabled = False
        self._last_session: Any = None
        self._last_workspace_ref: str | None = None
        self._workspace_dirty = True
        self._after_gap = False
        self._gap_event_appended = False

    def start_turn(
        self,
        *,
        turn_id: str,
        user_input: str,
        history_metadata: dict[str, Any] | None = None,
        session: Any = None,
    ) -> str:
        """Open or resume exactly one run."""
        if self.current_run_id is not None and not self._finished:
            raise RuntimeError("recorder already has an active run")
        if self._finished:
            self.current_run_id = None
            self.turn_id = None
            self._tool_events.clear()
            self._output_started = False
            self._finished = False
            self._disabled = False
            self._last_session = None
            self._last_workspace_ref = None
            self._workspace_dirty = True
            self._after_gap = False
            self._gap_event_appended = False
        now = time.time()
        self.turn_id = str(turn_id or "").strip() or uuid.uuid4().hex
        resuming = bool(self.resume_run_id and not self._resume_consumed)
        run_id = self.resume_run_id if resuming else uuid.uuid4().hex
        run_exists = False
        try:
            if resuming:
                existing = self.store.get_run(run_id)
                if existing is None:
                    raise ValueError(f"resume run not found: {run_id}")
                if (
                    existing.session_id != self.session_id
                    or existing.agent_id != self.agent_id
                ):
                    self._disabled = True
                    self._resume_consumed = True
                    raise ValueError(
                        "resume run ownership mismatch: "
                        f"expected {self.session_id}/{self.agent_id}, "
                        f"got {existing.session_id}/{existing.agent_id}"
                    )
                if existing.turn_id != self.turn_id:
                    self._after_gap = True
                    self.store.mark_partial(run_id, "resume_turn_mismatch")
                    self._disabled = True
                    self._resume_consumed = True
                    raise ValueError(
                        "resume turn mismatch: "
                        f"expected {self.turn_id}, got {existing.turn_id}"
                    )
                self.turn_id = existing.turn_id
                self._after_gap = existing.completeness != "complete" or bool(
                    existing.gap_reason
                )
                run_exists = True
            else:
                self.store.open_run(
                    ReplayRunRecord(
                        run_id=run_id,
                        session_id=self.session_id,
                        turn_id=self.turn_id,
                        agent_id=self.agent_id,
                        status="running",
                        created_at=now,
                        updated_at=now,
                        provider=self.provider,
                        model=self.model,
                        parent_run_id=(
                            str(self.branch_lineage.get("parent_run_id") or "").strip()
                            or None
                        ),
                        forked_from_event_id=(
                            str(
                                self.branch_lineage.get("source_event_id") or ""
                            ).strip()
                            or None
                        ),
                        forked_from_seq=(
                            int(self.branch_lineage["source_seq"])
                            if self.branch_lineage.get("source_seq") is not None
                            else None
                        ),
                    )
                )
                run_exists = True
            self.current_run_id = run_id
            if session is not None and not self._after_gap:
                self._capture_initial_workspace(session)
            if resuming:
                if self._after_gap:
                    self._append_gap(existing.gap_reason or "run_incomplete")
                self._append(
                    "run_resumed", payload={"history_metadata": history_metadata or {}}
                )
                self._resume_consumed = True
            else:
                self._append(
                    "run_started", payload={"history_metadata": history_metadata or {}}
                )
                self._append(
                    "user_message",
                    payload={
                        "text": str(user_input or ""),
                        "history_metadata": history_metadata or {},
                    },
                )
        except Exception:
            if run_exists:
                self._degrade("recorder_start_failed")
            raise
        return run_id

    def _capture_initial_workspace(self, session: Any) -> None:
        """Capture the turn's initial Git tree before runtime events execute."""
        if self.current_run_id is None:
            return
        self._last_session = session
        try:
            snapshot = capture_git_workspace_snapshot(
                session,
                session_id=self.session_id,
                run_id=self.current_run_id,
                seq=1,
                sessions_root=self.store.sessions_root,
            )
            self._last_workspace_ref = self.store.write_blob(
                self.current_run_id,
                snapshot.to_dict(),
            )
            self._workspace_dirty = False
        except Exception:
            self._last_workspace_ref = None
            self._workspace_dirty = True
            self._activate_gap("initial_workspace_snapshot_failed")
            logger.warning(
                "initial replay workspace snapshot capture failed",
                exc_info=True,
            )

    def _append_gap(self, reason: str) -> None:
        """Append at most one explicit gap marker for the active recorder."""
        if (
            self._gap_event_appended
            or self.current_run_id is None
            or self.turn_id is None
        ):
            return
        gap = RunEvent(
            event_id=uuid.uuid4().hex,
            run_id=self.current_run_id,
            session_id=self.session_id,
            turn_id=self.turn_id,
            seq=0,
            ts=time.time(),
            type="ledger_gap",
            agent_id=self.agent_id,
            payload={"reason": str(reason or "unknown_gap")},
            branchable=False,
            unbranchable_reason="ledger_gap",
        )
        try:
            self.store.append_event(self.current_run_id, gap)
            self._gap_event_appended = True
        except Exception:
            logger.warning(
                "replay ledger gap marker could not be appended", exc_info=True
            )

    def _activate_gap(self, reason: str, *, append_marker: bool = True) -> None:
        """Persist a partial run and prevent every later stable checkpoint."""
        self._after_gap = True
        run_id = self.current_run_id
        if run_id is None:
            return
        try:
            self.store.mark_partial(run_id, reason)
        except Exception:
            logger.warning(
                "replay ledger degradation could not be persisted", exc_info=True
            )
        if append_marker:
            self._append_gap(reason)

    def _append(
        self,
        event_type: str,
        *,
        runtime_event: RuntimeEvent | None = None,
        payload: dict[str, Any] | None = None,
        payload_ref: str | None = None,
        round_idx: int | None = None,
        tool_call_id: str | None = None,
        parent_event_id: str | None = None,
        effect_class: str = "none",
        branchable: bool = False,
        unbranchable_reason: str | None = None,
        title: str = "",
        summary: str = "",
        session: Any = None,
    ) -> RunEvent:
        if self.current_run_id is None or self.turn_id is None:
            raise RuntimeError("recorder has no active run")
        event = RunEvent(
            event_id=uuid.uuid4().hex,
            run_id=self.current_run_id,
            session_id=self.session_id,
            turn_id=self.turn_id,
            seq=0,
            ts=time.time(),
            type=event_type,
            agent_id=self.agent_id,
            round_idx=round_idx,
            tool_call_id=tool_call_id,
            parent_event_id=parent_event_id,
            title=title,
            summary=summary,
            payload=payload or {},
            payload_ref=payload_ref,
            effect_class=effect_class,
            branchable=branchable,
            unbranchable_reason=unbranchable_reason,
        )
        append_gap_after_event = False
        if session is not None:
            self._last_session = session
            if self._after_gap:
                stable, reason = False, "ledger_gap"
            else:
                stable, reason = context_is_branch_stable(
                    event,
                    [
                        dict(row)
                        for row in (getattr(session, "agent_messages", None) or [])
                        if isinstance(row, dict)
                    ],
                )
            if stable and not event.unbranchable_reason:
                try:
                    if self._last_workspace_ref is None or self._workspace_dirty:
                        record = self.store.get_run(self.current_run_id)
                        next_seq = (record.last_seq if record is not None else 0) + 1
                        snapshot = capture_git_workspace_snapshot(
                            session,
                            session_id=self.session_id,
                            run_id=self.current_run_id,
                            seq=next_seq,
                            sessions_root=self.store.sessions_root,
                        )
                        self._last_workspace_ref = self.store.write_blob(
                            self.current_run_id, snapshot.to_dict()
                        )
                        self._workspace_dirty = False
                    else:
                        snapshot_data = self.store.read_blob(
                            self.current_run_id, self._last_workspace_ref
                        )
                        snapshot = WorkspaceSnapshotRef.from_dict(
                            snapshot_data if isinstance(snapshot_data, dict) else {}
                        )
                    checkpoint, checkpoint_warnings = capture_context_checkpoint(
                        session,
                        workspace_ref=self._last_workspace_ref,
                    )
                    if checkpoint_warnings:
                        logger.warning(
                            "replay checkpoint omitted live values: %s",
                            "; ".join(checkpoint_warnings),
                        )
                    event.workspace_ref = self._last_workspace_ref
                    event.checkpoint_ref = self.store.write_checkpoint(
                        self.current_run_id, checkpoint
                    )
                    event.branchable = snapshot.branchable
                    event.unbranchable_reason = (
                        None if snapshot.branchable else snapshot.reason
                    )
                except Exception:
                    event.branchable = False
                    event.checkpoint_ref = None
                    event.workspace_ref = None
                    event.unbranchable_reason = "context_checkpoint_failed"
                    self._activate_gap(
                        "context_checkpoint_failed",
                        append_marker=False,
                    )
                    append_gap_after_event = True
                    logger.warning("replay checkpoint capture failed", exc_info=True)
            elif not event.unbranchable_reason:
                event.unbranchable_reason = reason or None
        try:
            stored = self.store.append_event(self.current_run_id, event)
        except Exception:
            self._activate_gap("ledger_append_failed")
            raise
        if append_gap_after_event:
            self._append_gap("context_checkpoint_failed")
        if stored.branchable:
            try:
                self.store.mark_branchable(self.current_run_id, stored.seq)
            except Exception:
                self._activate_gap("branchable_metadata_failed")
                raise
        return stored

    @staticmethod
    def _tool_id(data: dict[str, Any]) -> str | None:
        return str(data.get("tool_call_id") or data.get("id") or "").strip() or None

    @staticmethod
    def _preview(value: Any, limit: int = 500) -> str:
        if isinstance(value, str):
            text = value
        else:
            text = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
        return text.replace("\n", " ")[:limit]

    def observe(
        self,
        event: RuntimeEvent,
        *,
        session: Any,
        round_idx: int | None = None,
    ) -> None:
        """Observe a runtime event; all persistence failures are contained."""
        if self._disabled or self.current_run_id is None:
            return
        try:
            data = dict(event.data or {})
            event_type = str(event.type or "")
            if event_type == EventType.TOKEN.value:
                if not self._output_started:
                    self._append(
                        "assistant_output_started",
                        runtime_event=event,
                        round_idx=round_idx,
                    )
                    self._output_started = True
                return
            if event_type == EventType.TOOL_CALL.value:
                tool_name = str(data.get("name", "") or "")
                arguments = data.get("arguments")
                safe_arguments = arguments if isinstance(arguments, dict) else {}
                tool_call_id = self._tool_id(data)
                payload_ref = self.store.write_blob(
                    self.current_run_id,
                    {"name": tool_name, "arguments": arguments},
                )
                stored = self._append(
                    "tool_call",
                    runtime_event=event,
                    payload={
                        "name": tool_name,
                        "arguments_summary": self._preview(arguments),
                        "source_tool_call_id": tool_call_id,
                    },
                    payload_ref=payload_ref,
                    round_idx=round_idx,
                    tool_call_id=tool_call_id,
                    effect_class=classify_tool_effect(tool_name, safe_arguments),
                    title=tool_name,
                    session=session,
                )
                if stored.effect_class in {"local_write", "unknown"}:
                    self._workspace_dirty = True
                if tool_call_id:
                    self._tool_events[tool_call_id] = stored.event_id
                return
            if event_type == EventType.TOOL_RESULT.value:
                private_data = dict(getattr(event, "private_data", None) or {})
                tool_name = str(data.get("name") or data.get("tool_name") or "")
                result = next(
                    (
                        source[key]
                        for source, keys in (
                            (private_data, ("raw_result",)),
                            (data, ("result", "content", "text")),
                        )
                        for key in keys
                        if key in source
                    ),
                    None,
                )
                tool_call_id = self._tool_id(data)
                payload_ref = self.store.write_blob(
                    self.current_run_id,
                    {
                        "name": tool_name,
                        "result": result,
                        "structured": data.get("structured"),
                    },
                )
                preview = self._preview(result)
                digest = hashlib.sha256(preview.encode("utf-8")).hexdigest()
                explicit_status = (
                    str(
                        private_data.get("tool_status") or data.get("tool_status") or ""
                    )
                    .strip()
                    .lower()
                )
                tool_status = _tool_result_status(
                    result,
                    explicit_status=explicit_status,
                    is_error=(
                        bool(private_data.get("is_error")) or bool(data.get("is_error"))
                    ),
                )
                parent_event_id = self._tool_events.get(tool_call_id or "")
                orphan = parent_event_id is None
                self._append(
                    "tool_result",
                    runtime_event=event,
                    payload={
                        "name": tool_name,
                        "status": tool_status,
                        "length": len(str(result)),
                        "preview": preview,
                        "preview_sha256": digest,
                    },
                    payload_ref=payload_ref,
                    round_idx=round_idx,
                    tool_call_id=tool_call_id,
                    parent_event_id=parent_event_id,
                    title=tool_name,
                    branchable=False,
                    unbranchable_reason="orphan_tool_result" if orphan else None,
                    session=session,
                )
                if orphan:
                    self._activate_gap("orphan_tool_result")
                return
            if event_type == EventType.FINAL.value:
                payload_ref = self.store.write_blob(self.current_run_id, data)
                self._append(
                    "assistant_output_completed",
                    runtime_event=event,
                    payload={
                        "text_preview": self._preview(data.get("text", "")),
                        "terminal_reason": data.get("terminal_reason"),
                    },
                    payload_ref=payload_ref,
                    round_idx=round_idx,
                    session=session,
                )
                for artifact in data.get("references", []) or []:
                    if isinstance(artifact, dict):
                        artifact_ref = self.store.write_blob(
                            self.current_run_id, artifact
                        )
                        self._append(
                            "artifact",
                            payload_ref=artifact_ref,
                            payload={"kind": "reference"},
                        )
                self.finish("completed")
                return
            mapped = _EVENT_MAP.get(event_type)
            if mapped in EVENT_TYPES:
                resolved_round = round_idx
                if mapped == "round_started":
                    resolved_round = int(data.get("round", 0) or 0) or round_idx
                self._append(
                    mapped,
                    runtime_event=event,
                    payload=data,
                    round_idx=resolved_round,
                    tool_call_id=self._tool_id(data),
                    summary=self._preview(data.get("text", data.get("summary", ""))),
                    session=session,
                )
        except Exception:
            self._degrade("recorder_observe_failed")

    def _degrade(self, reason: str) -> None:
        self._activate_gap(reason)

    def finish(self, status: str) -> None:
        """Append a terminal marker and close the active run once."""
        if self._finished or self._disabled or self.current_run_id is None:
            return
        try:
            self._append(
                "run_completed",
                payload={"status": status},
                session=self._last_session,
            )
            self.store.close_run(self.current_run_id, status, time.time())
            self._finished = True
        except Exception:
            self._degrade("recorder_finish_failed")


def recorder_for_session(
    manager: Any,
    session_id: str,
    *,
    agent_id: str,
    resume_run_id: str | None = None,
) -> ReplayLedgerRecorder | None:
    """Build a recorder from the manager's injected local sessions root."""
    try:
        managed = manager.get(session_id, touch=False)
        if managed is None:
            return None
        session = managed.studio_session
        return ReplayLedgerRecorder(
            store=ReplayLedgerStore(manager._sessions_root),
            session_id=session_id,
            agent_id=agent_id,
            provider=getattr(session, "provider_name", None),
            model=getattr(session, "model_name", None),
            resume_run_id=resume_run_id,
            branch_lineage=(
                dict(session.scratchpad.get("run_branch_lineage") or {})
                if isinstance(getattr(session, "scratchpad", None), dict)
                and isinstance(session.scratchpad.get("run_branch_lineage"), dict)
                else None
            ),
        )
    except Exception:
        logger.warning("failed to construct replay ledger recorder", exc_info=True)
        return None
