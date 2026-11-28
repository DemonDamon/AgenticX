"""Project the crash-resume anchor from the durable replay ledger.

The anchor that crash recovery needs (which round to re-enter, which tool
calls were dispatched but never answered, which confirmation questions are
still open) is a pure function of a run's persisted events. It is computed on
read and never stored as a second copy.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from typing import Any

from agenticx.runtime.checkpoint import AgentCheckpoint
from agenticx.runtime.replay_ledger.contracts import ReplayRunRecord, RunEvent
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

logger = logging.getLogger(__name__)

READ_PAGE_SIZE = 500


def read_run_events(store: ReplayLedgerStore, run_id: str) -> list[RunEvent]:
    """Read every event of one run in seq order."""
    events: list[RunEvent] = []
    after_seq = 0
    while True:
        page, has_more = store.read_events(run_id, after_seq=after_seq, limit=READ_PAGE_SIZE)
        if not page:
            break
        events.extend(page)
        after_seq = int(page[-1].seq)
        if not has_more:
            break
    return events


def find_open_run(store: ReplayLedgerStore, session_id: str) -> ReplayRunRecord | None:
    """Return the session's newest run if it was never closed, else None.

    Only the latest run of a session can be the interrupted one. An older run
    left open by an earlier crash or by a failed ``finish`` must not shadow a
    newer turn, whose checkpoint then stays the recovery source.
    """
    runs = store.list_runs(session_id)
    if not runs:
        return None
    latest = max(runs, key=lambda run: (float(run.created_at or 0.0), str(run.run_id)))
    return latest if latest.status == "running" else None


def _round_of(event: RunEvent) -> int:
    if event.round_idx is not None:
        return int(event.round_idx)
    try:
        return int((event.payload or {}).get("round", 0) or 0)
    except (AttributeError, TypeError, ValueError):
        return 0


def _pending_tool_call(store: ReplayLedgerStore, event: RunEvent) -> dict[str, Any]:
    arguments: Any = {}
    name = ""
    if event.payload_ref:
        blob = store.read_blob(event.run_id, event.payload_ref)
        if isinstance(blob, dict):
            name = str(blob.get("name") or "")
            if isinstance(blob.get("arguments"), dict):
                arguments = blob["arguments"]
    return {
        "id": str(event.tool_call_id or ""),
        "type": "function",
        "function": {
            "name": name or str((event.payload or {}).get("name") or ""),
            "arguments": json.dumps(arguments, ensure_ascii=False),
        },
    }


def project_resume_anchor(
    store: ReplayLedgerStore, session_id: str
) -> AgentCheckpoint | None:
    """Project the resume anchor of the session's open run, or return None."""
    record = find_open_run(store, session_id)
    if record is None:
        return None
    events = read_run_events(store, record.run_id)
    refreshed = store.get_run(record.run_id)
    if refreshed is None or refreshed.completeness != "complete" or refreshed.gap_reason:
        # A run with a recorded gap may be missing rows (for example the
        # tool_call written just before a failed append). The projection then
        # cannot tell dispatched from not-dispatched; returning None makes the
        # caller fall back to the stored checkpoint, which marks the whole
        # batch as dispatched.
        return None

    last_round_start = None
    for event in events:
        if event.type == "round_started":
            last_round_start = event
    round_idx = 0 if last_round_start is None else max(0, _round_of(last_round_start) - 1)
    boundary_seq = 0 if last_round_start is None else int(last_round_start.seq)

    latest_result_seq: dict[str, int] = {}
    for event in events:
        if event.type == "tool_result" and event.tool_call_id:
            latest_result_seq[event.tool_call_id] = int(event.seq)
    pending_tool_calls: list[dict[str, Any]] = []
    for event in events:
        if event.type != "tool_call" or not event.tool_call_id:
            continue
        if int(event.seq) <= boundary_seq:
            continue  # belongs to an earlier round
        if latest_result_seq.get(event.tool_call_id, 0) > int(event.seq):
            continue  # answered after this call
        pending_tool_calls.append(_pending_tool_call(store, event))

    confirm_requests: list[dict[str, Any]] = []
    responded: set[str] = set()
    for event in events:
        if event.type not in ("confirm_required", "confirm_response"):
            continue
        payload = store.resolve_payload(event)
        if not isinstance(payload, dict):
            continue
        request_id = str(payload.get("id") or "").strip()
        if not request_id:
            continue
        if event.type == "confirm_response":
            responded.add(request_id)
            continue
        context = payload.get("context")
        confirm_requests.append(
            {
                "request_id": request_id,
                "question": payload.get("question"),
                "context": context if isinstance(context, dict) else {},
            }
        )
    pending_confirms = [item for item in confirm_requests if item["request_id"] not in responded]
    last_request = None
    if confirm_requests:
        last_request = dict(confirm_requests[-1], id=confirm_requests[-1]["request_id"])
        last_request.pop("request_id", None)

    return AgentCheckpoint(
        session_id=record.session_id,
        turn_id=record.turn_id,
        run_id=record.run_id,
        round_idx=round_idx,
        status="awaiting_confirm" if pending_confirms else "in_progress",
        pending_tool_calls=pending_tool_calls,
        confirm_state={"pending": pending_confirms, "last_request": last_request} if confirm_requests else None,
        created_at=float(record.created_at or 0.0),
        updated_at=float(record.updated_at or 0.0),
    )
