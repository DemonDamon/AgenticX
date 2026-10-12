#!/usr/bin/env python3
"""Read-only usage lookup for runtime plugins.

Jev (and later other model/provider plugins) persist structured cards that are
stripped from the LLM context. Meta queries them on demand through this module.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping

from agenticx.llms.provider_fault import human_hint_for_fault
from agenticx.runtime.jev_intent import FALLBACK_CAUSE_ZH, HARD_FALLBACK_REASONS

SUPPORTED_PLUGINS = ("all", "jev")
ALL_PLUGIN_ALIASES = frozenset({"", "all", "models", "model", "llm", "provider"})
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
    ts_ms = _row_ts_ms(row, meta)
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
        "ts_ms": ts_ms,
        "plugin": "jev",
    }


def _row_ts_ms(row: Mapping[str, Any], meta: Mapping[str, Any]) -> int:
    for blob in (row, meta):
        for key in ("ts_ms", "timestamp", "created_at"):
            raw = blob.get(key)
            if raw is None or raw == "":
                continue
            try:
                value = int(raw)
            except (TypeError, ValueError):
                try:
                    value = int(float(raw))
                except (TypeError, ValueError):
                    continue
            if value < 10_000_000_000:
                value *= 1000
            if value > 0:
                return value
    return 0


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


def parse_time_range(
    *,
    from_date: str = "",
    to_date: str = "",
    range_key: str = "",
    session_scoped: bool = False,
) -> tuple[int, int, str, str]:
    now_ms = int(time.time() * 1000)
    start_text = str(from_date or "").strip()
    end_text = str(to_date or "").strip()
    rk = str(range_key or "").strip().lower()
    if start_text or end_text:
        start_ms = _parse_day_ms(start_text, end_of_day=False) if start_text else 0
        end_ms = _parse_day_ms(end_text, end_of_day=True) if end_text else now_ms
        if start_ms <= 0:
            start_ms = 0
        if end_ms <= 0:
            end_ms = now_ms
        if start_ms > end_ms:
            start_ms, end_ms = end_ms, start_ms
        return start_ms, end_ms, _ms_to_day(start_ms), _ms_to_day(end_ms)
    if rk in {"", "default"}:
        rk = "total" if session_scoped else "month"
    if rk in {"day", "today", "1d"}:
        return now_ms - 86400000, now_ms, _ms_to_day(now_ms - 86400000), _ms_to_day(now_ms)
    if rk in {"week", "7d"}:
        return now_ms - 7 * 86400000, now_ms, _ms_to_day(now_ms - 7 * 86400000), _ms_to_day(now_ms)
    if rk in {"month", "30d"}:
        return now_ms - 30 * 86400000, now_ms, _ms_to_day(now_ms - 30 * 86400000), _ms_to_day(now_ms)
    return 0, now_ms, "", _ms_to_day(now_ms)


def _parse_day_ms(raw: str, *, end_of_day: bool) -> int:
    text = str(raw or "").strip().lower()
    if not text:
        return 0
    today = datetime.now().date()
    if text in {"today"}:
        day = today
    elif text in {"yesterday"}:
        day = today - timedelta(days=1)
    else:
        try:
            day = datetime.strptime(text[:10], "%Y-%m-%d").date()
        except ValueError:
            return 0
    stamp = datetime(day.year, day.month, day.day)
    if end_of_day:
        stamp = stamp + timedelta(days=1) - timedelta(milliseconds=1)
    return int(stamp.timestamp() * 1000)


def _ms_to_day(ts_ms: int) -> str:
    if ts_ms <= 0:
        return ""
    return datetime.fromtimestamp(ts_ms / 1000.0).strftime("%Y-%m-%d")


def _normalize_plugin(raw: str) -> str:
    name = str(raw or "").strip().lower()
    if name in ALL_PLUGIN_ALIASES:
        return "all"
    return name or "all"


def _split_plugin_filters(plugin: str, model: str, provider: str) -> tuple[str, str, str]:
    name = _normalize_plugin(plugin)
    mdl = str(model or "").strip()
    prov = str(provider or "").strip()
    if name == "all" or name == "jev":
        return name, mdl, prov
    if not mdl and not prov:
        if "/" in name or any(ch.isdigit() for ch in name) or "-" in name:
            return "all", name, prov
        return "all", mdl, name
    return "all", mdl or name, prov


def _hint_for_kind(kind: str) -> str:
    key = str(kind or "").strip()
    if key in {"timeout", "jev_timeout", "jev_soft_timeout", "transient", "server_error"}:
        return human_hint_for_fault("transient")
    if key in {"rate_limit"}:
        return human_hint_for_fault("rate_limit")
    if key in {"billing", "auth", "context_window", "tool_unavailable"}:
        return human_hint_for_fault(key)  # type: ignore[arg-type]
    if key in FALLBACK_CAUSE_ZH:
        return FALLBACK_CAUSE_ZH[key]
    return human_hint_for_fault("unknown")


def _filter_jev_events(
    events: list[dict[str, Any]],
    *,
    purpose: str,
    model: str,
    start_ms: int,
    end_ms: int,
) -> list[dict[str, Any]]:
    needle = str(model or "").strip().lower()
    out: list[dict[str, Any]] = []
    for event in events:
        if not _matches_purpose(event, purpose):
            continue
        if needle and needle not in str(event.get("model") or "").lower():
            continue
        ts_ms = int(event.get("ts_ms") or 0)
        if ts_ms and (ts_ms < start_ms or ts_ms > end_ms):
            continue
        out.append(event)
    return out


def _query_jev_usage(
    *,
    purpose: str,
    session_id: str,
    model: str,
    limit: int,
    start_ms: int,
    end_ms: int,
    sessions_root: Path | str | None,
    live_messages: Iterable[Mapping[str, Any]] | None,
    live_session_id: str,
    wanted: str,
) -> dict[str, Any]:
    cap = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
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

    matched = _filter_jev_events(
        events,
        purpose=purpose,
        model=model,
        start_ms=start_ms,
        end_ms=end_ms,
    )
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
        "plugin": "jev",
        "scope": "current" if wanted else "all",
        "purpose": str(purpose or "all").strip().lower() or "all",
        "session_id": wanted,
        "model": model,
        "from_ms": start_ms,
        "to_ms": end_ms,
        "sessions_scanned": scanned,
        "sessions_with_hits": len({str(event.get("session_id") or "") for event in matched}),
        "totals": _summarize(matched),
        "recent": recent,
        "supported": list(SUPPORTED_PLUGINS),
        "note": note,
    }


def _query_model_usage(
    *,
    plugin: str,
    purpose: str,
    session_id: str,
    model: str,
    provider: str,
    limit: int,
    start_ms: int,
    end_ms: int,
    from_day: str,
    to_day: str,
    usage_store: Any | None,
) -> dict[str, Any]:
    from agenticx.runtime.usage_store import UsageStore, get_usage_store

    store = usage_store if usage_store is not None else get_usage_store()
    if not isinstance(store, UsageStore):
        store = get_usage_store()
    cap = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    focus = str(purpose or "all").strip().lower() or "all"
    fault_kind = ""
    fault_phase = ""
    if focus in {"timeout", "timeouts"}:
        fault_kind = "timeout"
    elif focus in {"retry", "retries"}:
        fault_phase = "retry"

    call_totals = store.summarize_calls_sync(
        start_ms=start_ms,
        end_ms=end_ms,
        session_id=session_id,
        provider=provider,
        model=model,
    )
    fault_totals = store.summarize_faults_sync(
        start_ms=start_ms,
        end_ms=end_ms,
        session_id=session_id,
        provider=provider,
        model=model,
    )
    calls = store.query_calls_sync(
        start_ms=start_ms,
        end_ms=end_ms,
        session_id=session_id,
        provider=provider,
        model=model,
        limit=cap,
    )
    faults = store.query_faults_sync(
        start_ms=start_ms,
        end_ms=end_ms,
        session_id=session_id,
        provider=provider,
        model=model,
        kind=fault_kind,
        phase=fault_phase,
        limit=max(cap, 20),
    )
    streaks = store.consecutive_fault_streaks_sync(
        start_ms=start_ms,
        end_ms=end_ms,
        session_id=session_id,
        provider=provider,
        model=model,
        limit=cap,
    )
    for row in streaks:
        row["hint"] = _hint_for_kind(str(row.get("kind") or ""))

    if focus in {"failed", "failure", "failures", "timeout", "timeouts", "retry", "retries"}:
        recent = faults[:cap]
    elif focus in {"ok", "adopted", "success"}:
        recent = calls[:cap]
    else:
        merged = [
            {**row, "sort_ts": int(row.get("ts_ms") or 0)}
            for row in (*calls, *faults)
        ]
        merged.sort(key=lambda item: int(item.get("sort_ts") or 0), reverse=True)
        recent = merged[:cap]
        for row in recent:
            row.pop("sort_ts", None)

    diagnosis = None
    if session_id:
        last_fault = faults[0] if faults else None
        last_call = calls[0] if calls else None
        last_outcome = "unknown"
        last_ts = 0
        if last_fault and int(last_fault.get("ts_ms") or 0) >= int((last_call or {}).get("ts_ms") or 0):
            last_outcome = "failed"
            last_ts = int(last_fault.get("ts_ms") or 0)
        elif last_call:
            last_outcome = "ok"
            last_ts = int(last_call.get("ts_ms") or 0)
        own_streak = next(
            (
                row
                for row in streaks
                if str(row.get("session_id") or "") == session_id
                and (not model or model.lower() in str(row.get("model") or "").lower())
            ),
            None,
        )
        diagnosis = {
            "session_id": session_id,
            "model": model or str((last_fault or last_call or {}).get("model") or ""),
            "last_outcome": last_outcome,
            "last_ts_ms": last_ts,
            "consecutive_failures": int((own_streak or {}).get("count") or 0),
            "latest_kind": str((last_fault or {}).get("kind") or ""),
            "latest_phase": str((last_fault or {}).get("phase") or ""),
            "latest_message": str((last_fault or {}).get("message") or ""),
            "retryable": bool((last_fault or {}).get("retryable")),
            "hint": _hint_for_kind(str((last_fault or {}).get("kind") or "")),
        }

    note = (
        "Read-only model/provider usage. Successful calls come from the local usage ledger; "
        "timeouts, retries, and failures are recorded from this version onward. "
        "Rows are not injected into the model context."
    )
    if call_totals["calls"] == 0 and fault_totals["faults"] == 0:
        note = (
            "No matching model calls or faults in this range. "
            "Older failures were not persisted before this tool started recording them."
        )
    return {
        "ok": True,
        "plugin": plugin,
        "scope": "current" if session_id else "all",
        "purpose": focus,
        "session_id": session_id,
        "model": model,
        "provider": provider,
        "from_date": from_day,
        "to_date": to_day,
        "from_ms": start_ms,
        "to_ms": end_ms,
        "totals": {
            **call_totals,
            **fault_totals,
        },
        "consecutive": streaks,
        "diagnosis": diagnosis,
        "recent": recent,
        "supported": list(SUPPORTED_PLUGINS),
        "note": note,
    }


def query_plugin_usage(
    *,
    plugin: str = "all",
    scope: str = "all",
    purpose: str = "all",
    session_id: str = "",
    model: str = "",
    provider: str = "",
    from_date: str = "",
    to_date: str = "",
    range_key: str = "",
    limit: int = DEFAULT_LIMIT,
    sessions_root: Path | str | None = None,
    live_messages: Iterable[Mapping[str, Any]] | None = None,
    live_session_id: str = "",
    usage_store: Any | None = None,
) -> dict[str, Any]:
    name, model_f, provider_f = _split_plugin_filters(plugin, model, provider)
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
    start_ms, end_ms, from_day, to_day = parse_time_range(
        from_date=from_date,
        to_date=to_date,
        range_key=range_key,
        session_scoped=bool(wanted),
    )
    if name == "jev":
        return _query_jev_usage(
            purpose=purpose,
            session_id=wanted,
            model=model_f,
            limit=cap,
            start_ms=start_ms,
            end_ms=end_ms,
            sessions_root=sessions_root,
            live_messages=live_messages,
            live_session_id=live_session_id,
            wanted=wanted,
        )
    return _query_model_usage(
        plugin=name,
        purpose=purpose,
        session_id=wanted,
        model=model_f,
        provider=provider_f,
        limit=cap,
        start_ms=start_ms,
        end_ms=end_ms,
        from_day=from_day,
        to_day=to_day,
        usage_store=usage_store,
    )
