"""Session-local and ops-level change event logs (JSONL).

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from agenticx.ops.query import ChangeEvent, clamp_limit


def change_log_path(session_dir: Path) -> Path:
    return Path(session_dir) / "changes.jsonl"


def record_change_event(session_dir: Path, event: ChangeEvent) -> None:
    path = change_log_path(session_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    ts = event.ts.isoformat() if isinstance(event.ts, datetime) else ""
    payload = {
        "ts": ts,
        "deployment_id": event.deployment_id or "",
        "action": event.action or "",
        "summary": event.summary or "",
        "source": event.source or "first_party",
    }
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")


def read_change_events(session_dir: Path, limit: int) -> list[ChangeEvent]:
    path = change_log_path(session_dir)
    if not path.is_file():
        return []
    cap = clamp_limit(limit)
    events: list[ChangeEvent] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
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
        events.append(_event_from_row(obj))
    return events[-cap:]


def default_ops_changes_path() -> Path:
    raw = os.environ.get("AGENTICX_OPS_CHANGES_PATH", "").strip()
    if raw:
        return Path(raw)
    return Path.home() / ".agenticx" / "ops" / "changes.jsonl"


def _event_from_row(obj: dict) -> ChangeEvent:
    ts_raw = obj.get("ts") or ""
    ts: datetime | None = None
    if ts_raw:
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except ValueError:
            ts = None
    return ChangeEvent(
        ts=ts,
        deployment_id=str(obj.get("deployment_id") or ""),
        action=str(obj.get("action") or ""),
        summary=str(obj.get("summary") or ""),
        source=str(obj.get("source") or "first_party"),
    )


def record_ops_change_event(event: ChangeEvent) -> None:
    path = default_ops_changes_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    ts = event.ts.isoformat() if isinstance(event.ts, datetime) else ""
    payload = {
        "ts": ts,
        "deployment_id": event.deployment_id or "",
        "action": event.action or "",
        "summary": event.summary or "",
        "source": event.source or "changeplane",
    }
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")


def read_ops_change_events(*, deployment_id: str = "", limit: int = 50) -> list[ChangeEvent]:
    path = default_ops_changes_path()
    if not path.is_file():
        return []
    cap = clamp_limit(limit)
    want = (deployment_id or "").strip()
    events: list[ChangeEvent] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
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
        event = _event_from_row(obj)
        if want and event.deployment_id != want:
            continue
        events.append(event)
    return events[-cap:]
