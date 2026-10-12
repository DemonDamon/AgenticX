#!/usr/bin/env python3
"""Append-only outbox for desktop agent actions that belong in enterprise audit.

Events stay on disk until the desktop uploader drains them. Nothing here may
raise into the tool path: a full disk or a bad summary is dropped, not fatal.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from agenticx.utils.agx_home import agx_home

logger = logging.getLogger(__name__)

_OUTBOX_NAME = "outbox.jsonl"
_OUTBOX_MAX_BYTES = 20 * 1024 * 1024
_WARN_EVERY = 100
_SUMMARY_SCAN_LIMIT = 400
_SUMMARY_LIMIT = 200
_FIELD_LIMIT = 256

_REDACTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"agx-pat-[A-Za-z0-9_\-]+"), "agx-pat-***"),
    (re.compile(r"sk-[A-Za-z0-9_\-]{12,}"), "sk-***"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), "gh*_***"),
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+"), "Bearer ***"),
    (re.compile(r"(?i)\b(api[_-]?key|token|secret|password|passwd)\b\s*[=:]\s*\S+"), r"\1=***"),
)

_STRING_FIELDS = (
    "kind",
    "session_id",
    "agent_id",
    "tool_name",
    "subject",
    "outcome",
    "decision_source",
    "risk",
    "args_digest",
    "summary",
    "ts",
    "event_id",
)

_emit_lock = threading.Lock()
_oversize_skips = 0


def audit_enabled() -> bool:
    """True only when this desktop is signed into an enterprise."""

    try:
        from agenticx.cli.config_manager import ConfigManager

        if ConfigManager.get_value("enterprise.enabled") is not True:
            return False
        token = ConfigManager.get_value("enterprise.token")
        return isinstance(token, str) and bool(token.strip())
    except Exception:
        return False


def redact_summary(text: str) -> str:
    """Clip, mask secrets, then clip again so a replacement cannot grow the line."""

    clipped = str(text or "")[:_SUMMARY_SCAN_LIMIT]
    for pattern, replacement in _REDACTIONS:
        clipped = pattern.sub(replacement, clipped)
    return clipped[:_SUMMARY_LIMIT]


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _clip(value: str, limit: int) -> str:
    return value[:limit]


def _prepare(event: dict[str, Any]) -> dict[str, Any]:
    raw_id = event.get("event_id")
    event_id = raw_id.strip() if isinstance(raw_id, str) and raw_id.strip() else uuid.uuid4().hex
    raw_ts = event.get("ts")
    ts = raw_ts.strip() if isinstance(raw_ts, str) and raw_ts.strip() else _utc_stamp()
    summary = redact_summary(str(event.get("summary") or ""))
    payload: dict[str, Any] = {
        "v": 1,
        "event_id": event_id,
        "ts": ts,
        "kind": str(event.get("kind") or ""),
        "session_id": str(event.get("session_id") or ""),
        "agent_id": str(event.get("agent_id") or ""),
        "tool_name": str(event.get("tool_name") or ""),
        "subject": str(event.get("subject") or ""),
        "outcome": str(event.get("outcome") or ""),
        "decision_source": str(event.get("decision_source") or ""),
        "risk": str(event.get("risk") or ""),
        "args_digest": str(event.get("args_digest") or ""),
        "summary": summary,
    }
    for key in _STRING_FIELDS:
        limit = _SUMMARY_LIMIT if key == "summary" else _FIELD_LIMIT
        payload[key] = _clip(str(payload.get(key) or ""), limit)
    return payload


def emit_action_audit(event: dict[str, Any] | None) -> None:
    """Append one outbox line. Never raises."""

    global _oversize_skips
    try:
        if not audit_enabled():
            return
        if not isinstance(event, dict):
            return
        payload = _prepare(event)
        path = agx_home() / "action_audit" / _OUTBOX_NAME
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with _emit_lock:
            if path.is_file() and path.stat().st_size >= _OUTBOX_MAX_BYTES:
                _oversize_skips += 1
                if _oversize_skips % _WARN_EVERY == 0:
                    logger.warning(
                        "action audit outbox is full (%s bytes); dropping events until it is drained",
                        path.stat().st_size,
                    )
                return
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
                handle.flush()
    except Exception:
        logger.debug("action audit emit failed", exc_info=True)
