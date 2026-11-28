"""Replay-ledger bridge for the structured harness event outlet.

Translates outlet events (``turn_started`` / ``turn_finished``) of one
external-harness turn into replay-ledger rows through the regular
``ReplayLedgerRecorder``. The ledger data model is untouched: only the
existing event types are written (run_started / user_message /
assistant_output_completed / error / run_completed).

Contract (best-effort everywhere, the harness turn itself is never
affected):

- a repeated ``turn_started`` while a run is already open is ignored;
- an orphan ``turn_finished`` without an open run is ignored;
- any recorder failure disables the bridge for the rest of the turn.

The replay_ledger imports live inside functions on purpose: the harness
package keeps no module-level dependency on ``agenticx.runtime``.

Author: Damon Li
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any, Optional

from agenticx.harness.types import (
    HARNESS_EVENT_TURN_FINISHED,
    HARNESS_EVENT_TURN_STARTED,
    HarnessEvent,
)

logger = logging.getLogger(__name__)

#: Ledger session namespace of one studio session's harness turns.
HARNESS_LEDGER_NAMESPACE = "harness"

_TURN_STATUS_TO_LEDGER_STATUS = {
    "success": "completed",
    "timeout": "interrupted",
}


def harness_ledger_session_id(owner_session_id: str) -> str:
    """Ledger namespace id that isolates one owner session's harness turns."""
    owner = str(owner_session_id or "").strip()
    return f"{owner}:{HARNESS_LEDGER_NAMESPACE}"


class HarnessLedgerBridge:
    """Consume outlet events of one surface session into one recorder."""

    def __init__(self, recorder: Any) -> None:
        self._recorder = recorder
        self._run_open = False
        self._disabled = False

    def on_event(self, event: HarnessEvent) -> None:
        """Sink callback; every failure is contained here."""
        try:
            self._handle(event)
        except Exception:
            self._disabled = True
            logger.warning("harness ledger bridge failed", exc_info=True)

    def _handle(self, event: HarnessEvent) -> None:
        if self._disabled:
            return
        if event.type == HARNESS_EVENT_TURN_STARTED:
            if self._run_open:
                # A retry or a fallback path re-announced the same turn;
                # the first announcement already opened the run.
                return
            self._recorder.start_turn(
                turn_id=uuid.uuid4().hex,
                user_input=str(event.payload.get("user_text") or ""),
                session=None,
            )
            self._run_open = True
            return
        if event.type == HARNESS_EVENT_TURN_FINISHED:
            if not self._run_open:
                # Orphan finish (e.g. an early error result before the
                # turn was ever established): nothing to close.
                return
            status = str(event.payload.get("status") or "")
            if status == "success":
                self._recorder.observe(_final_event(event), session=None)
            else:
                self._recorder.observe(_error_event(event), session=None)
                self._recorder.finish(
                    _TURN_STATUS_TO_LEDGER_STATUS.get(status, "failed")
                )
            self._run_open = False


def _final_event(event: HarnessEvent) -> Any:
    """RuntimeEvent carrying the final assistant payload (text in blob)."""
    from agenticx.runtime.events import RuntimeEvent

    payload = dict(event.payload or {})
    return RuntimeEvent(
        type="final",
        data={
            "text": str(payload.get("result_text") or ""),
            "terminal_reason": "completed",
            "harness": str(event.harness or ""),
            "detail": dict(payload.get("detail") or {}),
        },
    )


def _error_event(event: HarnessEvent) -> Any:
    """RuntimeEvent carrying the failure summary."""
    from agenticx.runtime.events import RuntimeEvent

    payload = dict(event.payload or {})
    return RuntimeEvent(
        type="error",
        data={
            "text": str(payload.get("result_text") or "")[:500],
            "status": str(payload.get("status") or ""),
            "harness": str(event.harness or ""),
        },
    )


def build_turn_ledger_bridge(
    *,
    sessions_root: Optional[Path],
    session_id: str,
    agent_id: str,
    provider: Optional[str],
    model: Optional[str],
) -> Optional[HarnessLedgerBridge]:
    """Build the bridge for one owner session, or None when unusable.

    ``session_id`` is the ledger namespace id (already validated by the
    caller); ``agent_id`` is the harness id of the running turns.
    """
    if sessions_root is None:
        return None
    try:
        from agenticx.runtime.replay_ledger.contracts import validate_ledger_id
        from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
        from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

        namespace = validate_ledger_id(session_id, "session_id")
        recorder = ReplayLedgerRecorder(
            store=ReplayLedgerStore(sessions_root),
            session_id=namespace,
            agent_id=str(agent_id or "").strip() or "harness",
            provider=str(provider or "").strip() or None,
            model=str(model or "").strip() or None,
            # External-CLI turn text (user prompt + CLI output) must not
            # reach the enterprise trace outbox (03 D-6b precedent).
            enterprise_trace=False,
        )
        return HarnessLedgerBridge(recorder)
    except Exception:
        logger.warning("harness ledger bridge unavailable", exc_info=True)
        return None
