#!/usr/bin/env python3
"""Smoke tests for learning signal extraction from observations.

Validates hermes-agent proposal v2 §4.4 and Phase 1 / G3.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.learning.analyzer import (
    SessionSignals,
    extract_signals,
    filter_session,
    load_observations,
)


def _obs(tool: str, success: bool = True, session_id: str = "s1", elapsed_ms: int = 100) -> dict:
    return {
        "tool_name": tool,
        "success": success,
        "session_id": session_id,
        "elapsed_ms": elapsed_ms,
        "turn_index": 1,
    }


class TestExtractSignals:
    def test_empty(self) -> None:
        s = extract_signals([])
        assert s.tool_call_count == 0
        assert s.success_rate == 1.0
        assert not s.is_complex

    def test_basic_counts(self) -> None:
        obs = [_obs("bash_exec"), _obs("file_read"), _obs("bash_exec", success=False)]
        s = extract_signals(obs)
        assert s.tool_call_count == 3
        assert s.unique_tools == 2
        assert s.success_count == 2
        assert s.error_count == 1

    def test_error_recovery_detected(self) -> None:
        obs = [
            _obs("bash_exec", success=False),
            _obs("bash_exec", success=True),
        ]
        s = extract_signals(obs)
        assert s.error_recovery_count == 1
        assert s.has_error_recovery

    def test_error_recovery_different_tool_not_counted(self) -> None:
        obs = [
            _obs("bash_exec", success=False),
            _obs("file_read", success=True),
        ]
        s = extract_signals(obs)
        assert s.error_recovery_count == 0

    def test_retry_pattern(self) -> None:
        obs = [_obs("bash_exec"), _obs("bash_exec"), _obs("bash_exec")]
        s = extract_signals(obs)
        assert s.retry_pattern_count == 2

    def test_is_complex(self) -> None:
        obs = [_obs("t1"), _obs("t2"), _obs("t3"), _obs("t1"), _obs("t2")]
        s = extract_signals(obs)
        assert s.is_complex

    def test_not_complex_few_calls(self) -> None:
        obs = [_obs("t1"), _obs("t2")]
        s = extract_signals(obs)
        assert not s.is_complex

    def test_success_rate(self) -> None:
        obs = [_obs("t", success=True)] * 3 + [_obs("t", success=False)]
        s = extract_signals(obs)
        assert abs(s.success_rate - 0.75) < 0.01

    def test_elapsed_ms_accumulated(self) -> None:
        obs = [_obs("t", elapsed_ms=100), _obs("t", elapsed_ms=200)]
        s = extract_signals(obs)
        assert s.total_elapsed_ms == 300


class TestFilterSession:
    def test_filter(self) -> None:
        obs = [_obs("t", session_id="s1"), _obs("t", session_id="s2"), _obs("t", session_id="s1")]
        filtered = filter_session(obs, "s1")
        assert len(filtered) == 2

    def test_empty_session_id_returns_all(self) -> None:
        obs = [_obs("t", session_id="s1"), _obs("t", session_id="s2")]
        assert len(filter_session(obs, "")) == 2


class TestLoadObservations:
    def test_load_valid_jsonl(self, tmp_path: Path) -> None:
        f = tmp_path / "observations.jsonl"
        lines = [json.dumps(_obs("t1")), json.dumps(_obs("t2"))]
        f.write_text("\n".join(lines) + "\n")
        obs = load_observations(f)
        assert len(obs) == 2
        assert obs[0]["tool_name"] == "t1"

    def test_skip_malformed_lines(self, tmp_path: Path) -> None:
        f = tmp_path / "observations.jsonl"
        f.write_text('{"tool_name":"ok"}\nnot json\n{"tool_name":"ok2"}\n')
        obs = load_observations(f)
        assert len(obs) == 2

    def test_missing_file(self, tmp_path: Path) -> None:
        obs = load_observations(tmp_path / "nope.jsonl")
        assert obs == []

    def test_empty_file(self, tmp_path: Path) -> None:
        f = tmp_path / "empty.jsonl"
        f.write_text("")
        assert load_observations(f) == []
