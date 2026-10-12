#!/usr/bin/env python3
"""Tests for session performance summaries.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.runtime.session_perf import summarize_session_perf


def _write_run(root: Path, session_id: str, run_id: str, events: list[dict], run: dict) -> None:
    run_dir = root / session_id / "runs" / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "run.json").write_text(json.dumps(run), encoding="utf-8")
    lines = "\n".join(json.dumps(event) for event in events)
    (run_dir / "events.jsonl").write_text(lines + "\n", encoding="utf-8")


def test_ttft_and_wall_from_events(tmp_path: Path) -> None:
    events = [
        {"type": "round_started", "round_idx": 1, "ts": 1000.0, "payload": {}},
        {"type": "assistant_output_started", "ts": 1002.5, "payload": {}},
    ]
    _write_run(
        tmp_path,
        "sess-1",
        "run-1",
        events,
        {
            "run_id": "run-1",
            "model": "mimo",
            "status": "completed",
            "created_at": 1000,
            "completed_at": 1209,
        },
    )
    body = summarize_session_perf(tmp_path, "sess-1")
    assert body["latest"]["ttft_ms"] == 2500
    assert body["latest"]["wall_ms"] == 209000
    assert body["runs"][0]["ttft_ms"] == 2500


def test_missing_first_token_is_null(tmp_path: Path) -> None:
    events = [{"type": "round_started", "round_idx": 1, "ts": 1000.0, "payload": {}}]
    _write_run(
        tmp_path,
        "sess-2",
        "run-2",
        events,
        {
            "run_id": "run-2",
            "model": "mimo",
            "status": "completed",
            "created_at": 1000,
            "completed_at": 1010,
        },
    )
    body = summarize_session_perf(tmp_path, "sess-2")
    assert body["latest"]["ttft_ms"] is None
    assert body["latest"]["wall_ms"] == 10000


def test_output_rate_uses_turn_tokens_over_model_wait(tmp_path: Path) -> None:
    events = [
        {"type": "round_started", "round_idx": 1, "ts": 1000.0, "payload": {}},
        {"type": "assistant_output_completed", "ts": 1010.0, "payload": {}},
    ]
    _write_run(
        tmp_path,
        "sess-rate",
        "run-rate",
        events,
        {
            "run_id": "run-rate",
            "model": "mimo",
            "status": "completed",
            "created_at": 1000,
            "completed_at": 1010,
        },
    )
    messages = [
        {
            "role": "assistant",
            "timestamp": 1010000,
            "usage": {"output_tokens": 100, "turn_output_tokens": 200},
        }
    ]
    (tmp_path / "sess-rate" / "messages.json").write_text(
        json.dumps(messages),
        encoding="utf-8",
    )
    body = summarize_session_perf(tmp_path, "sess-rate")
    latest = body["latest"]
    assert latest["turn_output_tokens"] == 200
    assert latest["output_tokens"] == 100
    assert latest["model_wait_total_ms"] == 10000
    assert latest["output_tokens_per_sec"] == 20.0
    assert "_completed" not in latest
