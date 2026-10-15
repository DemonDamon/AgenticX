#!/usr/bin/env python3
"""Upload one completed replay turn to the enterprise agent-trace inbox.

Spans carry the run trajectory: who spoke, which model or tool ran, status,
timing, and token counts. The user message and the assistant reply preview
are copied, clipped to 500 characters. Tool arguments, tool results, and
subagent task text are never copied into the outbox or the HTTP body.

The outbox file is ``~/.agenticx/enterprise_trace/outbox.jsonl``. The path is
resolved at call time through :func:`agenticx.utils.agx_home.agx_home`, the
same home ``ConfigManager`` uses for ``config.yaml``.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from agenticx.runtime.replay_ledger.contracts import ReplayRunRecord, RunEvent
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore
from agenticx.utils.agx_home import agx_home

logger = logging.getLogger(__name__)

MAX_OUTBOX_LINES = 2000
_UPLOAD_BATCH = 200
_TRACE_BODY_LIMIT = 120
_ERROR_LIMIT = 500
_NARRATIVE_LIMIT = 500
_MODEL_LIMIT = 128
_PROVIDER_LIMIT = 64
_NAME_LIMIT = 128
_MAX_INT = 2_147_483_647
_ID_DISALLOWED = re.compile(r"[^A-Za-z0-9._:-]")
_MODEL_EVENT_TYPES = frozenset(
    {
        "context_stats",
        "assistant_output_started",
        "assistant_output_completed",
        "error",
    }
)
_USAGE_COPY_KEYS = (
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "total_tokens",
    "prompt_tokens",
    "completion_tokens",
)
_ZERO_USAGE = {
    "input_tokens": 0,
    "output_tokens": 0,
    "reasoning_tokens": 0,
    "total_tokens": 0,
}

_io_lock = threading.Lock()
_flush_guard = threading.Lock()
_flush_thread: threading.Thread | None = None

SpanDraft = tuple[float, int, dict[str, Any]]


def outbox_path() -> Path:
    """Return the trace outbox, following the current AgenticX home."""

    return agx_home() / "enterprise_trace" / "outbox.jsonl"


def trace_upload_enabled() -> bool:
    """True when enterprise login is on and trace upload is not disabled.

    Requires ``enterprise.enabled is True``, a non-empty ``enterprise.token``,
    and a non-empty ``enterprise.base_url``. ``enterprise.trace_upload`` may
    be omitted; only an explicit ``False`` turns upload off.
    """

    try:
        from agenticx.cli.config_manager import ConfigManager

        if ConfigManager.get_value("enterprise.enabled") is not True:
            return False
        token = ConfigManager.get_value("enterprise.token")
        if not isinstance(token, str) or not token.strip():
            return False
        base_url = ConfigManager.get_value("enterprise.base_url")
        if not isinstance(base_url, str) or not base_url.strip():
            return False
        if ConfigManager.get_value("enterprise.trace_upload") is False:
            return False
        return True
    except Exception:
        logger.debug("enterprise trace config read failed", exc_info=True)
        return False


def build_spans(run: ReplayRunRecord, events: list[RunEvent]) -> list[dict[str, Any]]:
    """Map one replay run to ordered enterprise spans.

    Token counts are read only from these payload fields, and stay 0 when
    the fields are absent:

    * ``assistant_output_completed`` payload ``usage_metadata`` or ``usage``.
      Recognized keys are ``input_tokens``, ``output_tokens``,
      ``reasoning_tokens``, and ``total_tokens`` (aliases ``prompt_tokens``
      and ``completion_tokens``). The recorder writes only ``text_preview``
      and ``terminal_reason`` on that event. The FINAL blob stores
      ``usage_metadata``; :func:`enqueue_completed_run` copies those numeric
      keys onto the in-memory payload before this function runs. The blob's
      The blob's ``text`` is not copied. A clipped ``reasoning`` preview is
      copied onto the model span as ``metadata.thought``.
    * Otherwise the same keys on the round's ``context_stats`` payload.
      Live ``context_stats`` rows carry ``prompt_tokens_approx`` and
      tool-result estimates. Those are not provider usage and are ignored.

    When both sources in one round have usage, the assistant payload wins.

    Errors:

    * Tool spans read ``tool_result`` payload ``status`` written by the
      recorder (``completed`` -> ok, ``error`` -> error, ``cancelled`` ->
      cancelled). ``preview``, arguments, and result text are not uploaded.
    * A model span is ``error`` when its round contains an ``error`` event
      and no ``assistant_output_completed``. The summary is that event's
      ``text``, then ``detail``, clipped to 500 characters.
    * Subagent spans pair ``subagent_started`` with ``subagent_completed``
      or ``subagent_error``. ``metadata.subagent_name`` is payload ``name``.
      ``subagent_error`` (or a completed payload status of error/cancelled)
      sets the span status. The summary is payload ``error`` / ``error_text``,
      then ``text`` on an error span only.
    * The final ``run`` span maps run status ``completed`` -> ok,
      ``failed`` -> error, ``cancelled`` / ``interrupted`` -> cancelled.
      ``metadata`` is ``agent_id``, ``event_count``, and ``user_text`` when
      a ``user_message`` event has text.
    * A model span copies ``assistant_output_completed`` ``text_preview``
      into ``metadata.reply``, and the FINAL blob's ``reasoning`` into
      ``metadata.thought``. Both are clipped to 500 characters.
    """

    ordered = sorted(events, key=lambda item: (item.ts, item.seq, item.event_id))
    trace_id = _trace_id(run.session_id, run.run_id)
    model = _clip_optional(run.model, _MODEL_LIMIT)
    provider = _clip_optional(run.provider, _PROVIDER_LIMIT)
    drafts: list[SpanDraft] = []
    window: list[RunEvent] | None = None
    early: list[RunEvent] = []
    open_tools: dict[str, list[RunEvent]] = {}
    open_subs: dict[str, list[RunEvent]] = {}

    def close_window() -> None:
        nonlocal window
        if window is None:
            return
        drafts.append(_model_draft(window, trace_id, model, provider))
        window = None

    for event in ordered:
        if event.type == "round_started":
            close_window()
            window = [event, *early]
            early = []
            continue
        if event.type in _MODEL_EVENT_TYPES:
            if window is None:
                early.append(event)
            else:
                window.append(event)
            continue
        if event.type == "tool_call":
            key = event.tool_call_id or f"call-{event.event_id}"
            open_tools.setdefault(key, []).append(event)
            continue
        if event.type == "tool_result":
            call = _pop_match(open_tools, event.tool_call_id)
            drafts.append(_tool_draft(call, event, trace_id))
            continue
        if event.type == "subagent_started":
            open_subs.setdefault(_sub_key(event), []).append(event)
            continue
        if event.type in {"subagent_completed", "subagent_error"}:
            start = _pop_match(open_subs, _sub_key(event))
            drafts.append(_subagent_draft(start, event, trace_id))

    close_window()
    if early:
        drafts.append(_model_draft(early, trace_id, model, provider))
    for calls in open_tools.values():
        for call in calls:
            drafts.append(_tool_draft(call, None, trace_id))
    for starts in open_subs.values():
        for start in starts:
            drafts.append(_subagent_draft(start, None, trace_id, run.status))

    drafts.sort(key=lambda item: (item[0], item[1]))
    spans = [item[2] for item in drafts]
    spans.append(_run_span(run, ordered, trace_id, model, provider))
    for index, span in enumerate(spans, start=1):
        span["step_no"] = index
    _link_span_parents(spans)
    return spans


def _link_span_parents(spans: list[dict[str, Any]]) -> None:
    """Hang model and subagent spans under the run, and tool spans under the open model span."""

    run_step = next((span["step_no"] for span in spans if span.get("step_kind") == "run"), None)
    if not isinstance(run_step, int):
        return
    open_model: int | None = None
    for span in spans:
        kind = span.get("step_kind")
        if kind == "run":
            continue
        metadata = span.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
            span["metadata"] = metadata
        if kind == "model":
            metadata["parent_step_no"] = run_step
            step_no = span.get("step_no")
            open_model = step_no if isinstance(step_no, int) else None
        elif kind == "tool":
            metadata["parent_step_no"] = open_model if open_model is not None else run_step
        else:
            metadata["parent_step_no"] = run_step


def enqueue_completed_run(store: ReplayLedgerStore, run_id: str) -> None:
    """Append spans for one closed run and start a single background flush.

    Any failure is logged at debug and swallowed so replay recording stays
    unaffected.
    """

    try:
        if not trace_upload_enabled():
            return
        run = store.get_run(run_id)
        if run is None:
            return
        events = _load_events(store, run_id)
        _hydrate_usage_from_blobs(store, events)
        spans = build_spans(run, events)
        if not spans:
            return
        _append_outbox(spans)
        _start_flush_thread()
    except Exception:
        logger.debug("enterprise trace enqueue failed", exc_info=True)


def flush_outbox(timeout_s: float = 10.0) -> int:
    """POST queued spans and return how many the server accepted.

    A 2xx drops that batch after counting it. Any other 4xx except 401 and
    429 drops the batch without counting it. 401, 429, 5xx, and network
    errors leave the batch on disk for a later flush.
    """

    if not trace_upload_enabled():
        return 0
    uploaded = 0
    while True:
        with _io_lock:
            entries = _load_entries_unlocked()
            if not entries:
                return uploaded
            batch = entries[:_UPLOAD_BATCH]
            batch_lines = [line for line, _span in batch]
            batch_spans = [span for _line, span in batch]
        outcome = _post_spans(batch_spans, timeout_s)
        if outcome == "keep":
            return uploaded
        with _io_lock:
            _drop_prefix_unlocked(batch_lines)
        if outcome == "ok":
            uploaded += len(batch_spans)


def _trace_id(session_id: str, run_id: str) -> str:
    session = _id_piece(session_id) or "s"
    run = _id_piece(run_id) or "r"
    if len(session) + 1 + len(run) > _TRACE_BODY_LIMIT:
        run = run[: max(1, _TRACE_BODY_LIMIT - 2)]
        session_keep = _TRACE_BODY_LIMIT - 1 - len(run)
        session = session[: max(1, session_keep)]
        body = f"{session}:{run}"
        if len(body) > _TRACE_BODY_LIMIT:
            body = body[:_TRACE_BODY_LIMIT]
    else:
        body = f"{session}:{run}"
    return f"near:{body}"


def _id_piece(value: str | None) -> str:
    return _ID_DISALLOWED.sub("", str(value or ""))


def _clip_optional(value: str | None, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _nonneg_int(value: Any) -> int:
    if isinstance(value, bool) or value is None:
        return 0
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    if number > _MAX_INT:
        return _MAX_INT
    return number


def _ms(delta_seconds: float) -> int:
    if delta_seconds <= 0:
        return 0
    return _nonneg_int(int(delta_seconds * 1000))


def _clip_text(value: str, limit: int = _ERROR_LIMIT) -> str:
    return " ".join(str(value or "").split())[:limit]


def _user_text(events: list[RunEvent]) -> str:
    for event in events:
        if event.type != "user_message":
            continue
        text = _payload(event).get("text")
        if isinstance(text, str) and text.strip():
            return _clip_text(text, _NARRATIVE_LIMIT)
    return ""


def _reply_text(events: list[RunEvent]) -> str:
    for event in events:
        if event.type != "assistant_output_completed":
            continue
        preview = _payload(event).get("text_preview")
        if isinstance(preview, str) and preview.strip():
            return _clip_text(preview, _NARRATIVE_LIMIT)
    return ""


def _thought_text(events: list[RunEvent]) -> str:
    for event in events:
        if event.type != "assistant_output_completed":
            continue
        preview = _payload(event).get("reasoning_preview")
        if isinstance(preview, str) and preview.strip():
            return _clip_text(preview, _NARRATIVE_LIMIT)
    return ""


def _usage_from_payload(payload: Any) -> dict[str, int] | None:
    if not isinstance(payload, dict):
        return None
    sources: list[dict[str, Any]] = []
    for key in ("usage_metadata", "usage"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            sources.append(nested)
    sources.append(payload)
    for source in sources:
        parsed = _parse_usage(source)
        if parsed is not None:
            return parsed
    return None


def _parse_usage(source: dict[str, Any]) -> dict[str, int] | None:
    """Parse a usage dict. ``prompt_tokens_approx`` is intentionally ignored."""

    found = False

    def take(*keys: str) -> int:
        nonlocal found
        for key in keys:
            if key in source:
                found = True
                return _nonneg_int(source.get(key))
        return 0

    input_tokens = take("input_tokens", "prompt_tokens")
    output_tokens = take("output_tokens", "completion_tokens")
    reasoning_tokens = take("reasoning_tokens")
    total_tokens = take("total_tokens")
    if not found:
        return None
    if total_tokens == 0 and (input_tokens or output_tokens):
        total_tokens = _nonneg_int(input_tokens + output_tokens)
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "reasoning_tokens": reasoning_tokens,
        "total_tokens": total_tokens,
    }


def _payload(event: RunEvent | None) -> dict[str, Any]:
    if event is None or not isinstance(event.payload, dict):
        return {}
    return event.payload


def _error_summary(payload: dict[str, Any], *, include_text: bool) -> str:
    keys = ["error_message", "error", "error_text"]
    if include_text:
        keys.extend(["text", "detail"])
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return _clip_text(value)
    return ""


def _base_span(
    *,
    trace_id: str,
    step_kind: str,
    status: str,
    duration_ms: int,
    usage: dict[str, int] | None = None,
    model: str = "",
    provider: str = "",
    error_message: str = "",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    counts = usage or _ZERO_USAGE
    span: dict[str, Any] = {
        "trace_id": trace_id,
        "step_kind": step_kind,
        "status": status,
        "input_tokens": counts["input_tokens"],
        "output_tokens": counts["output_tokens"],
        "reasoning_tokens": counts["reasoning_tokens"],
        "total_tokens": counts["total_tokens"],
        "duration_ms": duration_ms,
        "cost_usd": 0,
    }
    if model:
        span["model"] = model
    if provider:
        span["provider"] = provider
    if error_message:
        span["error_message"] = error_message[:_ERROR_LIMIT]
    if metadata:
        span["metadata"] = metadata
    return span


def _anchor(events: list[RunEvent]) -> tuple[float, int]:
    for event in events:
        if event.type == "round_started":
            return event.ts, event.seq
    first = events[0]
    return first.ts, first.seq


def _round_usage(events: list[RunEvent]) -> dict[str, int]:
    context_usage: dict[str, int] | None = None
    final_usage: dict[str, int] | None = None
    for event in events:
        parsed = _usage_from_payload(event.payload)
        if parsed is None:
            continue
        if event.type == "assistant_output_completed":
            final_usage = parsed
        elif event.type == "context_stats":
            context_usage = parsed
    return final_usage or context_usage or dict(_ZERO_USAGE)


def _model_duration(events: list[RunEvent]) -> int:
    start_ts, _seq = _anchor(events)
    end_ts = start_ts
    for event in events:
        if event.type in _MODEL_EVENT_TYPES and event.ts > end_ts:
            end_ts = event.ts
    return _ms(end_ts - start_ts)


def _model_draft(
    events: list[RunEvent],
    trace_id: str,
    model: str,
    provider: str,
) -> SpanDraft:
    has_final = any(event.type == "assistant_output_completed" for event in events)
    status = "ok"
    error_message = ""
    if not has_final:
        for event in events:
            if event.type != "error":
                continue
            status = "error"
            summary = _error_summary(_payload(event), include_text=True)
            if summary:
                error_message = summary
    ts, seq = _anchor(events)
    metadata: dict[str, Any] = {}
    reply = _reply_text(events)
    thought = _thought_text(events)
    if reply:
        metadata["reply"] = reply
    if thought:
        metadata["thought"] = thought
    span = _base_span(
        trace_id=trace_id,
        step_kind="model",
        status=status,
        duration_ms=_model_duration(events),
        usage=_round_usage(events),
        model=model,
        provider=provider,
        error_message=error_message,
        metadata=metadata or None,
    )
    return ts, seq, span


def _tool_status(payload: dict[str, Any]) -> str:
    status = str(payload.get("status") or "").strip().lower()
    if status in {"cancelled", "canceled"}:
        return "cancelled"
    if status in {"error", "failed", "failure"}:
        return "error"
    return "ok"


def _tool_name(call: RunEvent | None, result: RunEvent | None) -> str:
    for event in (call, result):
        if event is None:
            continue
        payload = _payload(event)
        name = str(payload.get("name") or payload.get("tool_name") or event.title or "")
        name = name.strip()
        if name:
            return name[:_NAME_LIMIT]
    return "tool"


def _tool_draft(
    call: RunEvent | None,
    result: RunEvent | None,
    trace_id: str,
) -> SpanDraft:
    anchor = result or call
    assert anchor is not None
    if result is None:
        status = "error"
        error_message = ""
        duration = 0
    else:
        status = _tool_status(_payload(result))
        error_message = ""
        if status != "ok":
            error_message = _error_summary(_payload(result), include_text=False)
        start_ts = call.ts if call is not None else result.ts
        duration = _ms(result.ts - start_ts)
    span = _base_span(
        trace_id=trace_id,
        step_kind="tool",
        status=status,
        duration_ms=duration,
        error_message=error_message,
        metadata={"tool_name": _tool_name(call, result)},
    )
    return anchor.ts, anchor.seq, span


def _sub_key(event: RunEvent) -> str:
    payload = _payload(event)
    return str(payload.get("agent_id") or event.agent_id or event.event_id)


def _sub_name(start: RunEvent | None, end: RunEvent | None) -> str:
    for event in (start, end):
        if event is None:
            continue
        payload = _payload(event)
        name = str(payload.get("name") or event.title or "").strip()
        if name:
            return name[:_NAME_LIMIT]
    return "subagent"


def _subagent_status(end: RunEvent | None, run_status: str) -> str:
    if end is None:
        if run_status in {"cancelled", "interrupted"}:
            return "cancelled"
        return "error"
    if end.type == "subagent_error":
        return "error"
    payload_status = str(_payload(end).get("status") or "").strip().lower()
    if payload_status in {"cancelled", "canceled"}:
        return "cancelled"
    if payload_status in {"error", "failed", "failure"}:
        return "error"
    return "ok"


def _subagent_draft(
    start: RunEvent | None,
    end: RunEvent | None,
    trace_id: str,
    run_status: str = "completed",
) -> SpanDraft:
    anchor = start or end
    assert anchor is not None
    status = _subagent_status(end, run_status)
    error_message = ""
    if status != "ok" and end is not None:
        error_message = _error_summary(_payload(end), include_text=True)
    if start is not None and end is not None:
        duration = _ms(end.ts - start.ts)
    else:
        duration = 0
    span = _base_span(
        trace_id=trace_id,
        step_kind="subagent",
        status=status,
        duration_ms=duration,
        error_message=error_message,
        metadata={"subagent_name": _sub_name(start, end)},
    )
    return anchor.ts, anchor.seq, span


def _run_status(status: str) -> str:
    if status == "completed":
        return "ok"
    if status == "failed":
        return "error"
    if status in {"cancelled", "interrupted"}:
        return "cancelled"
    return "error"


def _run_span(
    run: ReplayRunRecord,
    events: list[RunEvent],
    trace_id: str,
    model: str,
    provider: str,
) -> dict[str, Any]:
    status = _run_status(run.status)
    error_message = ""
    if status == "error":
        for event in events:
            if event.type != "error":
                continue
            summary = _error_summary(_payload(event), include_text=True)
            if summary:
                error_message = summary
        if not error_message and run.gap_reason:
            error_message = _clip_text(run.gap_reason)
    end = run.completed_at if run.completed_at is not None else run.updated_at
    event_count = run.event_count if run.event_count > 0 else len(events)
    metadata: dict[str, Any] = {
        "agent_id": run.agent_id or "meta",
        "event_count": event_count,
    }
    user_text = _user_text(events)
    if user_text:
        metadata["user_text"] = user_text
    return _base_span(
        trace_id=trace_id,
        step_kind="run",
        status=status,
        duration_ms=_ms(float(end) - float(run.created_at)),
        model=model,
        provider=provider,
        error_message=error_message,
        metadata=metadata,
    )


def _pop_match(
    pending: dict[str, list[RunEvent]],
    key: str | None,
) -> RunEvent | None:
    if not key:
        return None
    bucket = pending.get(key)
    if not bucket:
        return None
    event = bucket.pop(0)
    if not bucket:
        del pending[key]
    return event


def _load_events(store: ReplayLedgerStore, run_id: str) -> list[RunEvent]:
    events: list[RunEvent] = []
    after = 0
    while True:
        page, has_more = store.read_events(run_id, after_seq=after, limit=500)
        if not page:
            break
        events.extend(page)
        after = page[-1].seq
        if not has_more:
            break
    return events


def _hydrate_usage_from_blobs(store: ReplayLedgerStore, events: list[RunEvent]) -> None:
    """Copy token counts and a clipped reasoning preview from the FINAL blob.

    The recorder keeps ``usage_metadata`` and ``reasoning`` in the blob, not
    on the ``assistant_output_completed`` payload. The assistant ``text`` in
    that blob is left untouched.
    """

    for event in events:
        if event.type != "assistant_output_completed":
            continue
        payload = _payload(event)
        ref = str(event.payload_ref or "").strip()
        if not ref:
            continue
        try:
            blob = store.read_blob(event.run_id, ref)
        except Exception:
            logger.debug("enterprise trace blob read failed", exc_info=True)
            continue
        if not isinstance(blob, dict):
            continue
        merged = dict(payload)
        changed = False
        if _usage_from_payload(payload) is None:
            usage = blob.get("usage_metadata")
            if not isinstance(usage, dict):
                usage = blob.get("usage")
            if isinstance(usage, dict):
                copied = {key: usage[key] for key in _USAGE_COPY_KEYS if key in usage}
                if copied:
                    merged["usage_metadata"] = copied
                    changed = True
        if not str(payload.get("reasoning_preview") or "").strip():
            reasoning = blob.get("reasoning")
            if isinstance(reasoning, str) and reasoning.strip():
                merged["reasoning_preview"] = _clip_text(reasoning, _NARRATIVE_LIMIT)
                changed = True
        if changed:
            event.payload = merged


def _append_outbox(spans: list[dict[str, Any]]) -> None:
    path = outbox_path()
    lines = [
        json.dumps(span, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        for span in spans
    ]
    with _io_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        existing = _read_raw_lines(path)
        existing.extend(lines)
        if len(existing) > MAX_OUTBOX_LINES:
            existing = existing[-MAX_OUTBOX_LINES:]
        _write_raw_lines(path, existing)


def _start_flush_thread() -> None:
    global _flush_thread
    with _flush_guard:
        if _flush_thread is not None and _flush_thread.is_alive():
            return
        thread = threading.Thread(
            target=_flush_thread_main,
            name="enterprise-trace-flush",
            daemon=True,
        )
        _flush_thread = thread
        thread.start()


def _flush_thread_main() -> None:
    try:
        flush_outbox()
    except Exception:
        logger.debug("enterprise trace flush failed", exc_info=True)


def _read_raw_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    return [line for line in text.splitlines() if line.strip()]


def _write_raw_lines(path: Path, lines: list[str]) -> None:
    if not lines:
        if path.exists():
            path.unlink()
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _load_entries_unlocked() -> list[tuple[str, dict[str, Any]]]:
    path = outbox_path()
    raw_lines = _read_raw_lines(path)
    entries: list[tuple[str, dict[str, Any]]] = []
    dropped = False
    for line in raw_lines:
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            dropped = True
            continue
        if not isinstance(parsed, dict):
            dropped = True
            continue
        entries.append((line, parsed))
    if dropped:
        _write_raw_lines(path, [line for line, _span in entries])
    return entries


def _drop_prefix_unlocked(batch_lines: list[str]) -> None:
    path = outbox_path()
    current = _read_raw_lines(path)
    if current[: len(batch_lines)] == batch_lines:
        _write_raw_lines(path, current[len(batch_lines) :])
        return
    remaining = list(current)
    for line in batch_lines:
        try:
            remaining.remove(line)
        except ValueError:
            continue
    _write_raw_lines(path, remaining)


def _local_host(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").lower()
    return host in {"127.0.0.1", "localhost"}


def _enterprise_endpoint() -> tuple[str, str] | None:
    try:
        from agenticx.cli.config_manager import ConfigManager

        base_url = ConfigManager.get_value("enterprise.base_url")
        token = ConfigManager.get_value("enterprise.token")
    except Exception:
        logger.debug("enterprise trace endpoint read failed", exc_info=True)
        return None
    if not isinstance(base_url, str) or not isinstance(token, str):
        return None
    base = base_url.strip().rstrip("/")
    secret = token.strip()
    if not base or not secret:
        return None
    return base, secret


def _post_spans(spans: list[dict[str, Any]], timeout_s: float) -> str:
    endpoint = _enterprise_endpoint()
    if endpoint is None:
        return "keep"
    base_url, token = endpoint
    url = f"{base_url}/api/desktop/agent-traces"
    try:
        with httpx.Client(
            timeout=timeout_s, trust_env=not _local_host(base_url)
        ) as client:
            response = client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"spans": spans},
            )
    except Exception:
        logger.debug("enterprise trace upload failed", exc_info=True)
        return "keep"
    code = response.status_code
    if 200 <= code < 300:
        return "ok"
    if code in {401, 429} or code >= 500:
        logger.debug("enterprise trace kept batch after HTTP %s", code)
        return "keep"
    if 400 <= code < 500:
        logger.debug("enterprise trace dropped batch after HTTP %s", code)
        return "drop"
    return "keep"
