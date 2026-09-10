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
)
from agenticx.runtime.replay_ledger.effects import classify_tool_effect
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

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
    ) -> None:
        self.store = store
        self.session_id = str(session_id or "").strip()
        self.agent_id = str(agent_id or "meta").strip()
        self.provider = str(provider or "").strip() or None
        self.model = str(model or "").strip() or None
        self.resume_run_id = str(resume_run_id or "").strip() or None
        self._resume_consumed = False
        self.current_run_id: str | None = None
        self.turn_id: str | None = None
        self._tool_events: dict[str, str] = {}
        self._output_started = False
        self._finished = False
        self._disabled = False

    def start_turn(
        self,
        *,
        turn_id: str,
        user_input: str,
        history_metadata: dict[str, Any] | None = None,
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
                    self.store.mark_partial(run_id, "resume_turn_mismatch")
                    self._disabled = True
                    self._resume_consumed = True
                    raise ValueError(
                        "resume turn mismatch: "
                        f"expected {self.turn_id}, got {existing.turn_id}"
                    )
                self.turn_id = existing.turn_id
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
                    )
                )
                run_exists = True
            self.current_run_id = run_id
            if resuming:
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
        return self.store.append_event(self.current_run_id, event)

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
                )
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
                )
                if orphan:
                    self.store.mark_partial(self.current_run_id, "orphan_tool_result")
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
                )
        except Exception:
            self._degrade("recorder_observe_failed")

    def _degrade(self, reason: str) -> None:
        run_id = self.current_run_id
        self._disabled = True
        if run_id:
            try:
                self.store.mark_partial(run_id, reason)
            except Exception:
                logger.warning(
                    "replay ledger degradation could not be persisted", exc_info=True
                )

    def finish(self, status: str) -> None:
        """Append a terminal marker and close the active run once."""
        if self._finished or self._disabled or self.current_run_id is None:
            return
        try:
            self._append("run_completed", payload={"status": status})
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
        )
    except Exception:
        logger.warning("failed to construct replay ledger recorder", exc_info=True)
        return None
