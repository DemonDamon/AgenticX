#!/usr/bin/env python3
"""Read-only usage lookup for runtime plugins.

Jev (and later other model/provider plugins) persist structured cards that are
stripped from the LLM context. Meta queries them on demand through this module.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable, Mapping

from agenticx.runtime.jev_intent import FALLBACK_CAUSE_ZH, HARD_FALLBACK_REASONS

SUPPORTED_PLUGINS = ("jev",)
JEV_KINDS = frozenset({"jev_decision", "jev_kb_gate"})
MAX_SESSION_DIRS = 400
MAX_MESSAGES_FILE_BYTES = 8 * 1024 * 1024
DEFAULT_LIMIT = 8
MAX_LIMIT = 30

OUTCOME_ZH = {
    "adopted": "已采用",
    "timeout": "超时",
    "soft_timeout": "判定较慢",
    "http_error": "请求失败",
    "no_key": "未配置密钥",
    "low_confidence": "置信不足",
    "fell_back_to_meta": "已回落 Near",
    "fallback": "未采用",
}


def resolve_sessions_root(override: Path | str | None = None) -> Path:
    if override is not None:
        return Path(override).expanduser()
    raw = os.environ.get("AGX_SESSIONS_ROOT", "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".agenticx" / "sessions"


def safe_session_id(raw: str | None) -> str:
    sid = str(raw or "").strip()
    if not sid or sid in {".", ".."} or "/" in sid or "\\" in sid:
        return ""
    return sid


def classify_outcome(source: str, fallback_reason: str) -> str:
    reason = str(fallback_reason or "").strip()
    if reason == "jev_timeout":
        return "timeout"
    if reason == "jev_soft_timeout":
        return "soft_timeout"
    if reason == "jev_http":
        return "http_error"
    if reason == "jev_no_key":
        return "no_key"
    if reason == "jev_fallback_llm":
        return "low_confidence"
    if reason == "jev_fallback_meta":
        return "fell_back_to_meta"
    if reason:
        return "fallback"
    if str(source or "").strip() == "jev":
        return "adopted"
    return "fallback"


def parse_messages_payload(raw: object) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        inner = raw.get("messages")
        rows = inner if isinstance(inner, list) else []
    else:
        return []
    return [row for row in rows if isinstance(row, dict)]


def extract_jev_event(session_id: str, row: Mapping[str, Any]) -> dict[str, Any] | None:
    meta = row.get("metadata")
    if not isinstance(meta, dict):
        return None
    kind = str(meta.get("kind") or "").strip()
    if kind not in JEV_KINDS:
        return None
    purpose = str(meta.get("purpose") or "").strip()
    source = str(meta.get("source") or "").strip()
    reason = str(meta.get("fallback_reason") or "").strip()
    action = str(meta.get("action") or "").strip()
    model = str(meta.get("model") or meta.get("requested_model") or "").strip()
    try:
        latency_ms = int(meta.get("latency_ms") or 0)
    except (TypeError, ValueError):
        latency_ms = 0
    labels = meta.get("target_labels")
    if not isinstance(labels, list):
        labels = []
    targets = [str(item) for item in labels if str(item).strip()]
    if not targets:
        ids = meta.get("target_ids")
        if isinstance(ids, list):
            targets = [str(item) for item in ids if str(item).strip()]
    confidence = meta.get("confidence")
    if confidence is not None:
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = None
    outcome = classify_outcome(source, reason)
    content = str(row.get("content") or meta.get("content") or "").strip()
    return {
        "session_id": session_id,
        "kind": kind,
        "purpose": purpose,
        "source": source or "fallback",
        "model": model,
        "action": action,
        "targets": targets,
        "confidence": confidence,
        "latency_ms": latency_ms,
        "fallback_reason": reason,
        "fallback_reason_zh": FALLBACK_CAUSE_ZH.get(reason, ""),
        "outcome": outcome,
        "outcome_zh": OUTCOME_ZH.get(outcome, outcome),
        "summary": content,
    }


def _event_key(event: Mapping[str, Any]) -> tuple[Any, ...]:
    return (
        event.get("session_id"),
        event.get("kind"),
        event.get("purpose"),
        event.get("action"),
        event.get("fallback_reason"),
        event.get("latency_ms"),
        event.get("source"),
        event.get("model"),
        str(event.get("summary") or "")[:120],
    )


def _collect_from_rows(
    session_id: str,
    rows: Iterable[Mapping[str, Any]],
    seen: set[tuple[Any, ...]],
    out: list[dict[str, Any]],
) -> None:
    for row in rows:
        event = extract_jev_event(session_id, row)
        if event is None:
            continue
        key = _event_key(event)
        if key in seen:
            continue
        seen.add(key)
        out.append(event)


def _load_session_messages(path: Path) -> list[dict[str, Any]]:
    try:
        if path.stat().st_size > MAX_MESSAGES_FILE_BYTES:
            return []
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError, ValueError):
        return []
    return parse_messages_payload(raw)


def _iter_session_dirs(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    dirs = [item for item in root.iterdir() if item.is_dir() and safe_session_id(item.name)]
    dirs.sort(
        key=lambda item: (item / "messages.json").stat().st_mtime
        if (item / "messages.json").is_file()
        else item.stat().st_mtime,
        reverse=True,
    )
    return dirs[:MAX_SESSION_DIRS]


def _matches_purpose(event: Mapping[str, Any], purpose: str) -> bool:
    focus = str(purpose or "all").strip().lower()
    if focus in {"", "all"}:
        return True
    if focus in {"routing", "group_routing"}:
        return str(event.get("purpose") or "") == "group_routing"
    if focus in {"kb", "kb_auto"}:
        return str(event.get("purpose") or "") == "kb_auto"
    if focus in {"timeout", "timeouts"}:
        return event.get("outcome") in {"timeout", "soft_timeout"}
    if focus in {"failed", "failure", "failures"}:
        return str(event.get("fallback_reason") or "") in HARD_FALLBACK_REASONS
    if focus in {"adopted", "ok"}:
        return event.get("outcome") == "adopted"
    return True


def _percentile(sorted_values: list[int], fraction: float) -> int:
    if not sorted_values:
        return 0
    if len(sorted_values) == 1:
        return sorted_values[0]
    index = int(round((len(sorted_values) - 1) * fraction))
    return sorted_values[max(0, min(index, len(sorted_values) - 1))]


def _summarize(events: list[dict[str, Any]]) -> dict[str, Any]:
    by_reason: dict[str, int] = {}
    by_action: dict[str, int] = {}
    by_model: dict[str, int] = {}
    by_purpose: dict[str, int] = {}
    latencies: list[int] = []
    adopted = 0
    fallbacks = 0
    for event in events:
        reason = str(event.get("fallback_reason") or "") or "adopted"
        action = str(event.get("action") or "") or "unknown"
        model = str(event.get("model") or "") or "unknown"
        purpose = str(event.get("purpose") or "") or "unknown"
        by_reason[reason] = by_reason.get(reason, 0) + 1
        by_action[action] = by_action.get(action, 0) + 1
        by_model[model] = by_model.get(model, 0) + 1
        by_purpose[purpose] = by_purpose.get(purpose, 0) + 1
        if event.get("outcome") == "adopted":
            adopted += 1
        else:
            fallbacks += 1
        latency = int(event.get("latency_ms") or 0)
        if latency > 0:
            latencies.append(latency)
    latencies.sort()
    return {
        "calls": len(events),
        "adopted": adopted,
        "fallbacks": fallbacks,
        "by_reason": by_reason,
        "by_action": by_action,
        "by_model": by_model,
        "by_purpose": by_purpose,
        "latency_ms": {
            "samples": len(latencies),
            "avg": int(sum(latencies) / len(latencies)) if latencies else 0,
            "p50": _percentile(latencies, 0.50),
            "p95": _percentile(latencies, 0.95),
        },
    }


def query_plugin_usage(
    *,
    plugin: str = "jev",
    scope: str = "all",
    purpose: str = "all",
    session_id: str = "",
    limit: int = DEFAULT_LIMIT,
    sessions_root: Path | str | None = None,
    live_messages: Iterable[Mapping[str, Any]] | None = None,
    live_session_id: str = "",
) -> dict[str, Any]:
    name = str(plugin or "jev").strip().lower() or "jev"
    if name not in SUPPORTED_PLUGINS:
        return {
            "ok": False,
            "plugin": name,
            "error": "unsupported_plugin",
            "supported": list(SUPPORTED_PLUGINS),
        }
    try:
        cap = int(limit)
    except (TypeError, ValueError):
        cap = DEFAULT_LIMIT
    cap = max(1, min(cap, MAX_LIMIT))
    wanted = safe_session_id(session_id)
    scope_key = str(scope or "all").strip().lower() or "all"
    if scope_key == "current" and not wanted:
        wanted = safe_session_id(live_session_id)
        if not wanted:
            return {
                "ok": False,
                "plugin": name,
                "error": "missing_session_id",
                "hint": "Pass session_id or call from a session so current-scope can resolve.",
            }

    root = resolve_sessions_root(sessions_root)
    events: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    scanned = 0
    live_sid = safe_session_id(live_session_id)
    if live_messages is not None and live_sid and (not wanted or wanted == live_sid):
        _collect_from_rows(live_sid, live_messages, seen, events)

    if wanted:
        scanned = 1
        _collect_from_rows(wanted, _load_session_messages(root / wanted / "messages.json"), seen, events)
    else:
        for folder in _iter_session_dirs(root):
            scanned += 1
            _collect_from_rows(
                folder.name,
                _load_session_messages(folder / "messages.json"),
                seen,
                events,
            )

    matched = [event for event in events if _matches_purpose(event, purpose)]
    recent = list(reversed(matched[-cap:]))
    note = (
        "No persisted Jev cards in the scanned sessions. "
        "Cards are UI-only and stripped from normal chat context."
        if not matched
        else (
            "Read-only scan of persisted Jev cards. "
            "These rows are not injected into the model context."
        )
    )
    return {
        "ok": True,
        "plugin": name,
        "scope": "current" if wanted else "all",
        "purpose": str(purpose or "all").strip().lower() or "all",
        "session_id": wanted,
        "sessions_scanned": scanned,
        "sessions_with_hits": len({str(event.get("session_id") or "") for event in matched}),
        "totals": _summarize(matched),
        "recent": recent,
        "supported": list(SUPPORTED_PLUGINS),
        "note": note,
    }
