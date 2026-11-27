"""Read-only reattach fallback that replays a crash-interrupted turn from the
local replay ledger, plus the cursor bridge between the three sequence spaces.

Cursor bridge (three numbering spaces that are deliberately not unified):

* live seq   -- ``SessionEventHub._seq``. A plain integer emitted as the SSE
                ``id:`` on the live path. Lives only as long as one hub
                instance (one turn, one process); never persisted.
* bus cursor -- Redis ``INCR ev:sess:{sid}:seq``. A plain integer that
                survives restarts and replicas while the capped log keeps the
                row. On the inactive-hub path the reader treats a plain integer
                as a bus cursor first.
* ledger seq -- the run's ``events.jsonl`` sequence. Durable forever. Exposed
                to clients only in the namespaced form
                ``ledger:<run_id>:<seq>``.

A cursor is only valid in its own space; no numeric conversion between spaces
exists or is promised. A plain-integer cursor that resolves against neither a
live hub nor the bus is reported to the client as a ``replay_gap`` before the
ledger replay starts.

Author: Damon Li
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.replay_ledger.contracts import RunEvent, is_payload_summary
from agenticx.runtime.replay_ledger.resume_anchor import find_open_run, read_run_events
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

LEDGER_CURSOR_PREFIX = "ledger:"
LEDGER_CURSOR_PATTERN = re.compile(r"^ledger:([A-Za-z0-9._:-]{1,128}):(\d{1,18})$")

# Ledger event types whose payload was persisted as-is and whose SSE shape is
# the ledger payload itself.
_PASSTHROUGH_TYPES = frozenset(
    {
        EventType.CONFIRM_REQUIRED.value,
        EventType.CONFIRM_RESPONSE.value,
        EventType.CLARIFICATION_REQUIRED.value,
        EventType.CLARIFICATION_RESPONSE.value,
        EventType.CLARIFICATION_SUSPENDED.value,
        EventType.COMPACTION.value,
        EventType.CONTEXT_STATS.value,
        EventType.STALL.value,
        EventType.ERROR.value,
        EventType.TOOL_PROGRESS.value,
    }
)
_INTERRUPTED_STATES = frozenset({"running", "interrupted"})


def parse_ledger_cursor(*raw_values: str | None) -> tuple[str, int] | None:
    """Return ``(run_id, seq)`` from the first value shaped like a ledger cursor."""
    for raw in raw_values:
        match = LEDGER_CURSOR_PATTERN.fullmatch(str(raw or "").strip())
        if match:
            return match.group(1), int(match.group(2))
    return None


def format_ledger_cursor(run_id: str, seq: int) -> str:
    """Format the namespaced SSE id of one ledger event."""
    return f"{LEDGER_CURSOR_PREFIX}{run_id}:{int(seq)}"


def ledger_event_to_runtime_event(store: ReplayLedgerStore, event: RunEvent) -> RuntimeEvent | None:
    """Rebuild the runtime event behind one ledger event, or None if it has no SSE form."""
    if event.type == "round_started":
        payload = store.resolve_payload(event)
        if is_payload_summary(payload):
            return None  # the full payload lived in a blob that is no longer readable
        return RuntimeEvent(
            type=EventType.ROUND_START.value,
            data=dict(payload) if isinstance(payload, dict) else {},
            agent_id=event.agent_id,
        )
    if event.type in _PASSTHROUGH_TYPES:
        payload = store.resolve_payload(event)
        if is_payload_summary(payload):
            return None  # the full payload lived in a blob that is no longer readable
        return RuntimeEvent(
            type=event.type,
            data=dict(payload) if isinstance(payload, dict) else {},
            agent_id=event.agent_id,
        )
    if not event.payload_ref:
        return None
    blob = store.read_blob(event.run_id, event.payload_ref)
    if not isinstance(blob, dict):
        return None
    if event.type == "tool_call":
        arguments = blob.get("arguments")
        return RuntimeEvent(
            type=EventType.TOOL_CALL.value,
            data={
                "name": str(blob.get("name") or ""),
                "arguments": arguments if isinstance(arguments, dict) else {},
                "tool_call_id": str(event.tool_call_id or ""),
            },
            agent_id=event.agent_id,
        )
    if event.type == "tool_result":
        data = {
            "name": str(blob.get("name") or ""),
            "result": blob.get("result"),
            "tool_call_id": str(event.tool_call_id or ""),
        }
        if "structured" in blob:
            data["structured"] = blob["structured"]
        return RuntimeEvent(type=EventType.TOOL_RESULT.value, data=data, agent_id=event.agent_id)
    if event.type == "assistant_output_completed":
        return RuntimeEvent(type=EventType.FINAL.value, data=dict(blob), agent_id=event.agent_id)
    return None


def read_reattach_replay(
    sessions_root: Path | str,
    session_id: str,
    execution_state: str,
    *,
    after: tuple[str, int] | None = None,
) -> dict[str, Any] | None:
    """Read the SSE-replayable events of the session's crash-interrupted turn.

    Returns ``{"run_id": str, "rows": [(cursor, RuntimeEvent), ...]}``, or None
    when the ledger has nothing to replay for this session.
    """
    if str(execution_state or "").strip() not in _INTERRUPTED_STATES:
        return None
    store = ReplayLedgerStore(Path(sessions_root))
    record = find_open_run(store, session_id)
    if record is None:
        return None
    start_seq = 0
    if after is not None and after[0] == record.run_id:
        start_seq = int(after[1])
    rows: list[tuple[str, RuntimeEvent]] = []
    for event in read_run_events(store, record.run_id):
        if int(event.seq) <= start_seq:
            continue
        runtime_event = ledger_event_to_runtime_event(store, event)
        if runtime_event is None:
            continue
        rows.append((format_ledger_cursor(record.run_id, int(event.seq)), runtime_event))
    return {"run_id": record.run_id, "rows": rows}
