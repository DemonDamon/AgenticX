#!/usr/bin/env python3
"""Summarize one session's replay runs into wall, TTFT, and tool time.

Author: Damon Li
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.runtime.replay_ledger.contracts import validate_ledger_id


def summarize_session_perf(sessions_root: Path, session_id: str) -> dict[str, Any]:
    """Read run ledgers and tool observations. Missing timings stay None."""
    sid = validate_ledger_id(str(session_id or "").strip(), "session_id")
    session_dir = Path(sessions_root) / sid
    observations = _load_observations(session_dir / "tool_call_observations.json")
    runs_dir = session_dir / "runs"
    detailed: list[dict[str, Any]] = []
    if runs_dir.is_dir():
        for run_dir in runs_dir.iterdir():
            if not run_dir.is_dir():
                continue
            run_path = run_dir / "run.json"
            if not run_path.is_file():
                continue
            try:
                run = json.loads(run_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(run, dict):
                continue
            events = _load_events(run_dir / "events.jsonl")
            detailed.append(_summarize_run(run, events, observations))
    detailed.sort(key=lambda row: float(row.get("_created") or 0.0), reverse=True)
    latest = _public_run(detailed[0]) if detailed else None
    briefs = [
        {
            "run_id": row["run_id"],
            "model": row["model"],
            "status": row["status"],
            "wall_ms": row["wall_ms"],
            "ttft_ms": row["ttft_ms"],
            "created_at": row["created_at"],
        }
        for row in detailed[:20]
    ]
    return {"session_id": sid, "runs": briefs, "latest": latest}


def _public_run(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key != "_created"}


def _summarize_run(
    run: dict[str, Any],
    events: list[dict[str, Any]],
    observations: list[dict[str, Any]],
) -> dict[str, Any]:
    created = _as_float(run.get("created_at"))
    completed = _as_float(run.get("completed_at"))
    wall_ms = None
    if created is not None and completed is not None:
        wall_ms = int(round((completed - created) * 1000))
    ttft_ms = _ttft_ms(events)
    model_waits = _model_waits(events)
    window_end = completed
    if window_end is None and events:
        window_end = _as_float(events[-1].get("ts"))
    tool_elapsed_ms, slowest = _tools_in_window(observations, created, window_end)
    created_iso = _iso(created)
    return {
        "_created": created if created is not None else 0.0,
        "run_id": str(run.get("run_id") or ""),
        "model": str(run.get("model") or ""),
        "status": str(run.get("status") or ""),
        "wall_ms": wall_ms,
        "ttft_ms": ttft_ms,
        "model_waits": model_waits,
        "tool_elapsed_ms": tool_elapsed_ms,
        "slowest_tool": slowest,
        "created_at": created_iso,
    }


def _ttft_ms(events: list[dict[str, Any]]) -> int | None:
    first_round = next(
        (
            event
            for event in events
            if event.get("type") == "round_started" and event.get("round_idx") == 1
        ),
        None,
    )
    if first_round is None:
        return None
    start = _as_float(first_round.get("ts"))
    if start is None:
        return None
    first_token = next(
        (
            event
            for event in events
            if event.get("type") == "assistant_output_started"
            and (_as_float(event.get("ts")) or -1) >= start
        ),
        None,
    )
    if first_token is None:
        return None
    token_ts = _as_float(first_token.get("ts"))
    if token_ts is None:
        return None
    return int(round((token_ts - start) * 1000))


def _model_waits(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    starts = [index for index, event in enumerate(events) if event.get("type") == "round_started"]
    waits: list[dict[str, Any]] = []
    for position, index in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(events)
        start_event = events[index]
        start_ts = _as_float(start_event.get("ts"))
        if start_ts is None:
            continue
        target = next(
            (
                event
                for event in events[index + 1 : end]
                if event.get("type") in {"tool_call", "assistant_output_completed"}
            ),
            None,
        )
        if target is None:
            continue
        target_ts = _as_float(target.get("ts"))
        if target_ts is None:
            continue
        if target.get("type") == "tool_call":
            payload = target.get("payload") if isinstance(target.get("payload"), dict) else {}
            until = str(payload.get("name") or "tool_call")
        else:
            until = "assistant_output_completed"
        waits.append({"wait_ms": int(round((target_ts - start_ts) * 1000)), "until": until})
    waits.sort(key=lambda row: int(row["wait_ms"]), reverse=True)
    return waits[:3]


def _tools_in_window(
    observations: list[dict[str, Any]],
    start: float | None,
    end: float | None,
) -> tuple[int, dict[str, Any] | None]:
    if start is None or end is None:
        return 0, None
    chosen: list[dict[str, Any]] = []
    for row in observations:
        ts = _parse_obs_ts(row.get("timestamp"))
        if ts is None or ts < start or ts > end:
            continue
        elapsed = row.get("elapsed_ms")
        if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)):
            continue
        chosen.append({"name": str(row.get("tool_name") or ""), "elapsed_ms": int(elapsed)})
    if not chosen:
        return 0, None
    slowest = max(chosen, key=lambda row: int(row["elapsed_ms"]))
    return sum(int(row["elapsed_ms"]) for row in chosen), slowest


def _load_events(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            rows.append(item)
    return rows


def _load_observations(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict)]


def _as_float(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _iso(epoch: float | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _parse_obs_ts(value: object) -> float | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None
