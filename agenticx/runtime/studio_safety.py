#!/usr/bin/env python3
"""Studio mainline SafetyLayer bridge — SP1 safety-layer-mainline.

Wire the existing four-stage SafetyLayer pipeline (truncation -> leak
detection -> policy -> injection defense) and InputValidator into the Studio
mainline tool dispatch choke point (``dispatch_tool_async``).

Modes (``AGX_STUDIO_SAFETY_MODE`` / ``runtime.studio_safety_mode``):
  observe — pipeline runs, events recorded everywhere, results untouched
  enforce — input violations block execution; output redact/sanitize/block apply

Event fan-out (three sinks):
  1. in-memory SafetyAuditLog (queryable via ``layer_state()``)
  2. local append-only ``~/.agenticx/safety/events.jsonl`` (observation-report source)
  3. enterprise audit outbox via ``emit_action_audit`` (kind=safety_event)

Everything here must never raise into the tool path: a safety-pipeline
failure logs a warning and passes the original content through (the
credential-store redaction in ``dispatch_tool_async`` remains an independent
defense line).

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.runtime.harden_flags import studio_safety_layer_enabled, studio_safety_mode
from agenticx.utils.agx_home import agx_home

logger = logging.getLogger(__name__)

_EVENTS_NAME = "events.jsonl"
_EVENTS_MAX_BYTES = 20 * 1024 * 1024
_LATENCY_WINDOW = 2000

# bash_exec already has its own three-layer defense (read-only verdict /
# whitelist / confirm gate); InputValidator's shell rules overlap with it and
# would block legitimate command execution, so it is exempt from input
# validation here. Output sanitization still applies to bash_exec results.
_INPUT_EXEMPT_TOOLS = frozenset({"bash_exec"})

_lock = threading.Lock()
_layer: Optional[Any] = None
_latencies_ms: List[float] = []
_call_counter = 0
_oversize_skips = 0


def _get_layer() -> Any:
    """Lazily construct the SafetyLayer singleton (regex/index build once)."""
    global _layer
    if _layer is None:
        from agenticx.safety.audit import SafetyAuditLog
        from agenticx.safety.layer import SafetyLayer

        _layer = SafetyLayer(audit_log=SafetyAuditLog(max_events=2000))
    return _layer


def _reset() -> None:
    """Test hook: drop the singleton and stats."""
    global _layer, _latencies_ms, _call_counter, _oversize_skips
    with _lock:
        _layer = None
        _latencies_ms = []
        _call_counter = 0
        _oversize_skips = 0


def _wall_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _args_digest(arguments: Dict[str, Any]) -> str:
    try:
        payload = json.dumps(arguments, ensure_ascii=False, sort_keys=True, default=str)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
    except Exception:
        return ""


def _events_path() -> Path:
    return agx_home() / "safety" / _EVENTS_NAME


def _append_events(records: List[Dict[str, Any]]) -> None:
    """Append event records to the local JSONL sink. Never raises."""
    global _oversize_skips
    if not records:
        return
    try:
        path = _events_path()
        with _lock:
            if path.is_file() and path.stat().st_size >= _EVENTS_MAX_BYTES:
                _oversize_skips += 1
                if _oversize_skips % 100 == 0:
                    logger.warning(
                        "safety events file is full (%s bytes); dropping events until rotated",
                        path.stat().st_size,
                    )
                return
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                for record in records:
                    handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
                handle.flush()
    except Exception:
        logger.debug("safety event append failed", exc_info=True)


def _bridge_enterprise(records: List[Dict[str, Any]]) -> None:
    """Mirror events into the enterprise audit outbox. Never raises."""
    if not records:
        return
    try:
        from agenticx.runtime.action_audit import emit_action_audit

        for record in records:
            emit_action_audit({
                "kind": "safety_event",
                "session_id": record.get("session_id", ""),
                "agent_id": record.get("agent_id", ""),
                "tool_name": record.get("tool_name", ""),
                "subject": f"{record.get('stage', '')}:{record.get('action', '')}",
                "outcome": str(record.get("action", "")).lower(),
                "decision_source": f"studio_safety/{record.get('mode', '')}",
                "risk": record.get("severity", ""),
                "args_digest": record.get("args_digest", ""),
                "summary": "rules={} {}".format(
                    ",".join(record.get("rule_ids") or []),
                    record.get("details", "") or "",
                ),
            })
    except Exception:
        logger.debug("safety enterprise bridge failed", exc_info=True)


def _drain_new_events(layer: Any, before_count: int) -> List[Any]:
    try:
        return list(layer.audit_log.events)[before_count:]
    except Exception:
        return []


def _record(
    *,
    stage_hint: str,
    events: List[Any],
    mode: str,
    latency_ms: float,
    session_id: str,
    tool_call_id: str,
    agent_id: str,
    tool_name: str,
    args_digest: str = "",
) -> List[Dict[str, Any]]:
    _latencies_ms.append(latency_ms)
    if len(_latencies_ms) > _LATENCY_WINDOW:
        del _latencies_ms[: len(_latencies_ms) - _LATENCY_WINDOW]
    records: List[Dict[str, Any]] = []
    wall_ts = _wall_ts()
    for event in events:
        records.append({
            "ts": wall_ts,
            "stage": getattr(event.stage, "value", str(event.stage)),
            "tool_name": event.tool_name,
            "action": event.action,
            "rule_ids": list(event.rule_ids or []),
            "severity": event.severity,
            "details": event.details,
            "mode": mode,
            "latency_ms": round(latency_ms, 3),
            "session_id": session_id,
            "tool_call_id": tool_call_id,
            "agent_id": agent_id,
            "args_digest": args_digest,
        })
    if not records:
        # No pipeline stage fired — sample one pass-through marker per 20
        # calls for latency observability without flooding the sink.
        global _call_counter
        with _lock:
            _call_counter += 1
            sampled = _call_counter % 20 == 0
        if sampled:
            records.append({
                "ts": wall_ts,
                "stage": stage_hint,
                "tool_name": tool_name,
                "action": "PASS_THROUGH",
                "rule_ids": [],
                "severity": "INFO",
                "details": "no stage fired",
                "mode": mode,
                "latency_ms": round(latency_ms, 3),
                "session_id": session_id,
                "tool_call_id": tool_call_id,
                "agent_id": agent_id,
                "args_digest": args_digest,
            })
    _append_events(records)
    _bridge_enterprise(records)
    return records


def validate_input(
    tool_name: str,
    arguments: Dict[str, Any],
    *,
    session_id: str = "",
    tool_call_id: str = "",
    agent_id: str = "",
) -> Optional[str]:
    """Pre-execution input validation for the Studio mainline.

    Returns a denial message (blocked) in enforce mode, else ``None``.
    Never raises; a pipeline failure passes through as ``None``.
    """
    if not studio_safety_layer_enabled():
        return None
    if tool_name in _INPUT_EXEMPT_TOOLS:
        return None
    mode = studio_safety_mode()
    layer = _get_layer()
    before = len(layer.audit_log.events)
    start = time.perf_counter()
    try:
        result = layer.validate_tool_input(tool_name, arguments)
    except Exception:
        logger.warning("studio safety input validation failed; passing through", exc_info=True)
        return None
    latency_ms = (time.perf_counter() - start) * 1000
    new_events = _drain_new_events(layer, before)
    _record(
        stage_hint="input_validation",
        events=new_events,
        mode=mode,
        latency_ms=latency_ms,
        session_id=session_id,
        tool_call_id=tool_call_id,
        agent_id=agent_id,
        tool_name=tool_name,
        args_digest=_args_digest(arguments),
    )
    if mode == "enforce" and result.is_blocked:
        blocked = [v.rule_id for v in result.violations if v.is_blocking]
        logger.warning("studio safety blocked input for %s: %s", tool_name, blocked)
        return f"ERROR: Input blocked by safety policy: {', '.join(blocked)}"
    return None


def sanitize_output(
    tool_name: str,
    output: str,
    *,
    session_id: str = "",
    tool_call_id: str = "",
    agent_id: str = "",
) -> str:
    """Post-execution output sanitization for the Studio mainline.

    observe mode returns the original text (events still recorded);
    enforce mode returns the sanitized text. Never raises.
    """
    if not studio_safety_layer_enabled():
        return output
    mode = studio_safety_mode()
    layer = _get_layer()
    before = len(layer.audit_log.events)
    start = time.perf_counter()
    try:
        sanitized = layer.sanitize_tool_output(output, tool_name=tool_name)
    except Exception:
        logger.warning("studio safety output sanitize failed; passing through original", exc_info=True)
        return output
    latency_ms = (time.perf_counter() - start) * 1000
    new_events = _drain_new_events(layer, before)
    _record(
        stage_hint="output_pipeline",
        events=new_events,
        mode=mode,
        latency_ms=latency_ms,
        session_id=session_id,
        tool_call_id=tool_call_id,
        agent_id=agent_id,
        tool_name=tool_name,
    )
    if mode == "observe":
        return output
    return sanitized


def latency_stats() -> Dict[str, Any]:
    """Percentile stats over the recent sanitize/validate call latencies (ms)."""
    with _lock:
        samples = sorted(_latencies_ms)
    if not samples:
        return {"count": 0}
    def _pct(q: float) -> float:
        idx = min(int(q * len(samples)), len(samples) - 1)
        return round(samples[idx], 3)
    return {
        "count": len(samples),
        "p50_ms": _pct(0.50),
        "p95_ms": _pct(0.95),
        "p99_ms": _pct(0.99),
        "max_ms": round(samples[-1], 3),
    }


def layer_state() -> Dict[str, Any]:
    """In-memory audit-log stats + latency stats for diagnostics."""
    layer = _get_layer()
    state: Dict[str, Any] = {"latency": latency_stats()}
    try:
        state["audit"] = layer.audit_log.stats()
    except Exception:
        state["audit"] = {}
    return state


def write_observation_report(out_path: Path) -> Path:
    """Summarize the local events.jsonl into an observation-period markdown report.

    This is the WARN-only gate artifact: review it before flipping
    ``AGX_STUDIO_SAFETY_MODE`` to ``enforce``.
    """
    path = _events_path()
    by_stage: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    by_tool: Dict[str, int] = {}
    by_action: Dict[str, int] = {}
    total = 0
    pass_through = 0
    if path.is_file():
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                total += 1
                action = str(record.get("action", ""))
                if action == "PASS_THROUGH":
                    pass_through += 1
                    continue
                stage = str(record.get("stage", "unknown"))
                by_stage[stage] = by_stage.get(stage, 0) + 1
                sev = str(record.get("severity", "unknown"))
                by_severity[sev] = by_severity.get(sev, 0) + 1
                tool = str(record.get("tool_name", "unknown"))
                by_tool[tool] = by_tool.get(tool, 0) + 1
                by_action[action] = by_action.get(action, 0) + 1
    lines = [
        "# Studio SafetyLayer Observation Report (WARN-only period)",
        "",
        f"Generated: {_wall_ts()}",
        f"Events source: `{path}`",
        "",
        f"- Total event lines: {total} (pass-through markers: {pass_through})",
        f"- Pipeline hits: {total - pass_through}",
        "",
        "## Hits by stage",
        "",
    ]
    lines.extend(f"- {stage}: {count}" for stage, count in sorted(by_stage.items()))
    lines.extend(["", "## Hits by severity", ""])
    lines.extend(f"- {sev}: {count}" for sev, count in sorted(by_severity.items()))
    lines.extend(["", "## Hits by action", ""])
    lines.extend(f"- {action}: {count}" for action, count in sorted(by_action.items()))
    lines.extend(["", "## Top tools", ""])
    top_tools = sorted(by_tool.items(), key=lambda kv: -kv[1])[:20]
    lines.extend(f"- {tool}: {count}" for tool, count in top_tools)
    lines.extend([
        "",
        "## Latency",
        "",
        "```json",
        json.dumps(latency_stats(), ensure_ascii=False, indent=2),
        "```",
        "",
        "## Enforcement gate checklist",
        "",
        "- [ ] Review every CRITICAL hit above for false positives",
        "- [ ] Confirm bash_exec exemption did not hide command-abuse patterns (its own confirm gate covers them)",
        "- [ ] P95 latency within budget (<= 50ms per call)",
        "- [ ] Flip `AGX_STUDIO_SAFETY_MODE=enforce` (or config `runtime.studio_safety_mode=enforce`)",
    ])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path
