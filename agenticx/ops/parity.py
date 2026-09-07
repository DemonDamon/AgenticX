"""Read-only trace parity over session disk evidence.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from agenticx.ops.query import TraceSpan, clamp_limit
from agenticx.runtime.subagent_runs.contracts import RunRecord

PRESENT = "present"
MISSING = "missing"
N_A = "n_a"

PARITY_KINDS = ("tool_call", "delegate", "spawn", "confirm", "model")
RUN_KINDS = ("delegate", "spawn")

ATTR_RUN_KIND = "agenticx.run.kind"
ATTR_RUN_ID = "agenticx.run.id"
ATTR_RUN_AVATAR_SESSION = "agenticx.run.avatar_session_id"
ATTR_CONFIRM_ID = "agenticx.confirm.request_id"
ATTR_EVIDENCE = "agenticx.evidence.source"
ATTR_PARITY_RUNTIME = "agenticx.parity.runtime"
ATTR_PARITY_SPAN = "agenticx.parity.span"
ATTR_PARITY_USAGE = "agenticx.parity.usage"

DELEGATE_TOOL_NAMES = frozenset({"delegate_to_avatar", "spawn_subagent"})
_SKIP_TOOL_NAMES = frozenset({"assistant.reply", "confirm.wait", "delegate", "spawn"})
_SUMMARY_MAX = 128


@dataclass
class ParityRow:
    kind: str
    key: str
    name: str
    runtime: str = MISSING
    span: str = MISSING
    usage: str = N_A
    status: str = "missing"
    summary: str = ""
    ts: datetime | None = None
    attrs: dict[str, str] = field(default_factory=dict)


def run_kind_for_tool_name(name: str) -> str:
    n = (name or "").strip()
    if n == "delegate_to_avatar":
        return "delegate"
    if n == "spawn_subagent":
        return "spawn"
    return ""


def run_status_from_record(status: str) -> str:
    flag = (status or "").strip().lower()
    if flag == "completed":
        return "ok"
    if flag in {"failed", "cancelled"}:
        return "error"
    return "unknown"


def _clip_summary(*parts: str) -> str:
    text = " ".join(p for p in parts if p).strip()
    if len(text) <= _SUMMARY_MAX:
        return text
    return text[:_SUMMARY_MAX]


def _read_json(path: Path) -> object | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_run_records(session_dir: Path) -> list[RunRecord]:
    root = Path(session_dir) / "subagent_runs"
    index_path = root / "index.json"
    raw = _read_json(index_path)
    if not isinstance(raw, dict):
        return []
    runs_obj = raw.get("runs")
    if not isinstance(runs_obj, dict):
        return []
    records: list[RunRecord] = []
    for run_id in runs_obj:
        rid = str(run_id or "").strip()
        if not rid:
            continue
        payload = _read_json(root / f"{rid}.json")
        if not isinstance(payload, dict):
            continue
        try:
            records.append(RunRecord.from_dict(payload))
        except (TypeError, ValueError):
            continue
    records.sort(key=lambda item: (float(item.created_at or 0), item.run_id))
    return records


def _pending_request_id(item: object) -> str:
    if not isinstance(item, dict):
        return ""
    for key in ("request_id", "id"):
        text = str(item.get(key) or "").strip()
        if text:
            return text
    return ""


def load_confirm_pendings(session_dir: Path) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []

    def _add(request_id: str) -> None:
        rid = (request_id or "").strip()
        if not rid or rid in seen:
            return
        seen.add(rid)
        out.append({"request_id": rid})

    state = _read_json(Path(session_dir) / "agent_state.json")
    if isinstance(state, dict):
        checkpoint = state.get("checkpoint")
        if isinstance(checkpoint, dict):
            confirm_state = checkpoint.get("confirm_state")
            pending = confirm_state.get("pending") if isinstance(confirm_state, dict) else None
            if isinstance(pending, list):
                for item in pending:
                    _add(_pending_request_id(item))

    runs_root = Path(session_dir) / "subagent_runs"
    if runs_root.is_dir():
        for path in sorted(runs_root.glob("*.activity.jsonl")):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except OSError:
                continue
            for line in lines:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                if str(obj.get("type") or "").strip() != "confirm":
                    continue
                _add(_pending_request_id(obj))
    return out


def load_gateway_usage_hits(session_id: str) -> bool:
    raw = os.environ.get("AGENTICX_GATEWAY_USAGE_JSONL", "").strip()
    if not raw:
        return False
    path = Path(raw)
    if not path.is_file():
        return False
    want = (session_id or "").strip()
    if not want:
        return False
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    for line in lines:
        text = line.strip()
        if not text:
            continue
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        sid = str(obj.get("session_id") or obj.get("sessionId") or "").strip()
        if sid == want:
            return True
    return False


def _message_has_tool_id(messages: list, span_id: str) -> bool:
    want = (span_id or "").strip()
    if not want:
        return False
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        calls = msg.get("tool_calls") or []
        if isinstance(calls, list):
            for call in calls:
                if isinstance(call, dict) and str(call.get("id") or "").strip() == want:
                    return True
        if str(msg.get("tool_call_id") or "").strip() == want:
            return True
    return False


def _observation_has_name(session_dir: Path, name: str) -> bool:
    from agenticx.learning.analyzer import load_session_observations

    want = (name or "").strip()
    if not want:
        return False
    for row in load_session_observations(Path(session_dir)):
        if isinstance(row, dict) and str(row.get("tool_name") or "").strip() == want:
            return True
    return False


def _assistant_usage_present(messages: list) -> bool:
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role") or "") != "assistant":
            continue
        usage = msg.get("usage")
        if not isinstance(usage, dict):
            continue
        try:
            tokens = int(usage.get("input_tokens") or 0) or int(usage.get("total_tokens") or 0)
        except (TypeError, ValueError):
            continue
        if tokens > 0:
            return True
    return False


def _has_assistant_message(messages: list) -> bool:
    return any(
        isinstance(msg, dict) and str(msg.get("role") or "") == "assistant" for msg in messages
    )


def _row_status(row: ParityRow, *, mismatch: bool = False) -> str:
    if mismatch and row.runtime == PRESENT and row.span == PRESENT:
        return "mismatch"
    if row.usage == N_A:
        if row.runtime == PRESENT and row.span == PRESENT:
            return "ok"
        return "missing"
    if row.runtime == PRESENT and row.span == PRESENT and row.usage == PRESENT:
        return "ok"
    return "missing"


def _span_matches_run(span: TraceSpan, run: RunRecord) -> bool:
    attrs = span.attributes if isinstance(span.attributes, dict) else {}
    if str(attrs.get(ATTR_RUN_ID) or "").strip() == run.run_id:
        return True
    if span.span_id == run.run_id:
        return True
    src = (run.source_tool_call_id or "").strip()
    return bool(src) and span.span_id == src


def build_parity(
    session_dir: Path,
    spans: list,
    messages: list,
    *,
    session_id: str = "",
) -> list[ParityRow]:
    sid = (session_id or "").strip() or Path(session_dir).name
    safe_spans = [s for s in spans if isinstance(s, TraceSpan)]
    safe_messages = [m for m in messages if isinstance(m, dict)]
    rows: list[ParityRow] = []

    for span in safe_spans:
        name = str(span.name or "")
        if name in _SKIP_TOOL_NAMES:
            continue
        attrs = span.attributes if isinstance(span.attributes, dict) else {}
        if str(attrs.get(ATTR_RUN_ID) or "").strip():
            continue
        runtime = PRESENT
        if not _message_has_tool_id(safe_messages, span.span_id) and not _observation_has_name(
            session_dir, name
        ):
            runtime = MISSING
        row = ParityRow(
            kind="tool_call",
            key=str(span.span_id or ""),
            name=name,
            runtime=runtime,
            span=PRESENT,
            usage=N_A,
            ts=span.start_ts,
        )
        row.status = _row_status(row)
        row.summary = _clip_summary(row.kind, row.status, span.status)
        rows.append(row)

    for run in load_run_records(session_dir):
        kind = run.kind if run.kind in RUN_KINDS else "delegate"
        span_hit = next((s for s in safe_spans if _span_matches_run(s, run)), None)
        mapped = run_status_from_record(run.status)
        span_status = str(getattr(span_hit, "status", "") or "")
        mismatch = bool(
            span_hit is not None
            and (
                (mapped == "error" and span_status == "ok")
                or (mapped == "ok" and span_status == "error")
            )
        )
        row = ParityRow(
            kind=kind,
            key=run.run_id,
            name=run.name or kind,
            runtime=PRESENT,
            span=PRESENT if span_hit is not None else MISSING,
            usage=N_A,
        )
        row.status = _row_status(row, mismatch=mismatch)
        row.summary = _clip_summary(kind, row.status, mapped)
        rows.append(row)

    for pending in load_confirm_pendings(session_dir):
        rid = str(pending.get("request_id") or "").strip()
        if not rid:
            continue
        span_hit = next(
            (
                s
                for s in safe_spans
                if s.name == "confirm.wait"
                and (
                    s.span_id == rid
                    or str((s.attributes or {}).get(ATTR_CONFIRM_ID) or "").strip() == rid
                )
            ),
            None,
        )
        row = ParityRow(
            kind="confirm",
            key=rid,
            name="confirm.wait",
            runtime=PRESENT,
            span=PRESENT if span_hit is not None else MISSING,
            usage=N_A,
        )
        row.status = _row_status(row)
        row.summary = _clip_summary("confirm", row.status, "unknown")
        rows.append(row)

    has_reply = any(s.name == "assistant.reply" for s in safe_spans)
    has_assistant = _has_assistant_message(safe_messages)
    if has_assistant or has_reply:
        usage = MISSING
        runtime = PRESENT
        if _assistant_usage_present(safe_messages) or load_gateway_usage_hits(sid):
            usage = PRESENT
        row = ParityRow(
            kind="model",
            key="model",
            name="model",
            runtime=runtime,
            span=PRESENT if has_reply else MISSING,
            usage=usage,
        )
        row.status = _row_status(row)
        row.summary = _clip_summary("model", row.status)
        rows.append(row)

    order = {name: index for index, name in enumerate(PARITY_KINDS)}
    rows.sort(key=lambda item: (order.get(item.kind, 99), item.key))
    return rows[: clamp_limit(200)]
