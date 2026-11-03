#!/usr/bin/env python3
"""HandoffEngine (SP4): orchestrate one harness switch.

Pipeline per execute_handoff call:

1. decide strategy (policy; user strategy honored or fails closed)
2. summarize into the fixed eight sections (+ V2 memory/knowledge
   injection points)
3. redact (NFR: before anything is persisted or injected)
4. wrap into the non-executable injection payload
5. persist append-only (supersedes the previous active handoff)
6. establish the target thread: fresh spawn, or adopt the resumable
   native thread on the resume tier
7. inject: send the wrapped payload followed by the pending user turn
   as the first turn on the target harness

Failures at any step propagate as :class:`HandoffError` so callers
(SP5b switch UI) can keep the session on the previous harness.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.registry import HarnessRegistry
from agenticx.harness.types import (
    SessionNotFoundError,
    TurnRequest,
    TurnResult,
)
from agenticx.harness.handoff.policy import (
    HandoffPolicyConfig,
    decide_strategy,
)
from agenticx.harness.handoff.security import (
    redact_summary,
    redact_text,
    summary_to_payload,
)
from agenticx.harness.handoff.store import HandoffStore
from agenticx.harness.handoff.summarizer import (
    SummarizationProvider,
    SummarizationResult,
    TemplateSummarizer,
)
from agenticx.harness.handoff.types import (
    STRATEGY_MANUAL,
    STRATEGY_RESUME,
    AppThreadSnapshot,
    ContextHandoff,
    SwitchPlan,
)


class HandoffError(Exception):
    """Handoff execution failed; the session stays on its harness."""


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


@dataclass
class HandoffResult:
    handoff: ContextHandoff
    plan: SwitchPlan
    turn: Optional[TurnResult] = None
    injected_payload: str = ""
    detail: Dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.turn is not None and self.turn.ok


@dataclass
class HandoffEngineConfig:
    turn_wait_seconds: float = 240.0
    policy: HandoffPolicyConfig = field(default_factory=HandoffPolicyConfig)


class HandoffEngine:
    def __init__(
        self,
        registry: HarnessRegistry,
        store: HandoffStore,
        summarizer: Optional[SummarizationProvider] = None,
        config: Optional[HandoffEngineConfig] = None,
    ) -> None:
        self._registry = registry
        self._store = store
        self._summarizer = summarizer or TemplateSummarizer()
        self._config = config or HandoffEngineConfig()

    # ------------------------------------------------------------------
    # planning
    # ------------------------------------------------------------------
    def plan_switch(
        self,
        snapshot: AppThreadSnapshot,
        target_harness: str,
        user_strategy: Optional[str] = None,
    ) -> SwitchPlan:
        return decide_strategy(
            snapshot,
            target_harness,
            config=self._config.policy,
            user_strategy=user_strategy,
        )

    # ------------------------------------------------------------------
    # execution
    # ------------------------------------------------------------------
    def execute_handoff(
        self,
        snapshot: AppThreadSnapshot,
        target_harness: str,
        user_strategy: Optional[str] = None,
        manual_context: Optional[str] = None,
        pending_user_message: str = "",
        spawn_options: Optional[Dict[str, Any]] = None,
    ) -> HandoffResult:
        adapter = self._registry.require(target_harness)
        if not adapter.available():
            raise HandoffError(
                f"harness {target_harness} is not available on this machine"
            )

        plan = self.plan_switch(snapshot, target_harness, user_strategy)
        if plan.strategy == STRATEGY_MANUAL and not (manual_context or "").strip():
            raise HandoffError(
                "manual_context strategy requires manual context text"
            )

        # 2. summarize (eight fixed sections; template provider is local)
        result: SummarizationResult = self._summarizer.summarize(
            snapshot, plan, manual_context=manual_context
        )
        summary = result.summary

        # 3+4. redact then wrap (payload is what gets injected AND stored)
        summary = redact_summary(summary)
        payload = summary_to_payload(summary)
        payload = redact_text(payload)

        # 5. persist append-only, superseding the previous active handoff
        previous = self._store.active_handoff(snapshot.app_thread_id)
        source_run_ids = [
            run.run_id
            for run in snapshot.runs
            if plan.delta_from_position
            < run.end_position
            <= plan.delta_to_position
        ]
        handoff = ContextHandoff(
            handoff_id=f"ho_{uuid.uuid4().hex[:16]}",
            app_thread_id=snapshot.app_thread_id,
            from_harness=snapshot.current_harness or "unknown",
            to_harness=target_harness,
            strategy=plan.strategy,
            summary=summary,
            injected_payload=payload,
            source_end_position=plan.delta_to_position,
            source_run_ids=source_run_ids,
            created_at=_now_iso(),
            created_by_provider=result.provider_id,
            supersedes=previous.handoff_id if previous else None,
            detail={"reason": plan.reason, "notes": plan.notes},
        )
        self._store.append_handoff(handoff)

        # 6. establish the target thread
        cwd = snapshot.cwd or "."
        try:
            spawn_view = adapter.spawn(
                cwd, options=spawn_options or {}
            )
        except Exception as exc:
            raise HandoffError(f"target spawn failed: {exc}") from exc
        session_id = spawn_view["session_id"]

        if plan.strategy == STRATEGY_RESUME:
            if not adapter.capabilities().resume:
                raise HandoffError(
                    f"harness {target_harness} does not support resume"
                )
            native_id = plan.resume_native_thread_id
            try:
                adapter.adopt_thread(session_id, native_id or "")
            except Exception as exc:
                adapter.stop(session_id)
                raise HandoffError(
                    f"resume adoption failed: {exc}"
                ) from exc
            handoff.resumed_native_thread_id = native_id

        handoff.target_session_id = session_id

        # 7. inject: payload first, then the pending user message
        text = payload
        if pending_user_message.strip():
            text = payload + "\n\n" + pending_user_message.strip()
        request = TurnRequest(
            text=text, wait_seconds=self._config.turn_wait_seconds
        )
        try:
            turn = adapter.turn(session_id, request)
        except SessionNotFoundError as exc:
            raise HandoffError(f"target session vanished: {exc}") from exc
        except Exception as exc:
            raise HandoffError(f"injection turn failed: {exc}") from exc

        handoff.target_native_thread_id = (
            turn.detail.get("native_thread_id")
            if isinstance(turn.detail, dict)
            else None
        ) or handoff.resumed_native_thread_id

        return HandoffResult(
            handoff=handoff,
            plan=plan,
            turn=turn,
            injected_payload=payload,
            detail={
                "target_session_id": session_id,
                "strategy": plan.strategy,
                "provider": result.provider_id,
            },
        )

    # ------------------------------------------------------------------
    # audit / rollback linkage
    # ------------------------------------------------------------------
    def audit_view(self, app_thread_id: str):
        return self._store.handoff_statuses(app_thread_id)

    def invalidate_for_rollback(
        self,
        app_thread_id: str,
        rollback_to_position: int,
        reason: str = "session rollback",
    ):
        return self._store.invalidate_covering(
            app_thread_id, rollback_to_position, reason
        )
