#!/usr/bin/env python3
"""Smoke tests for evidence-aware success_evidence gate (AC-3)."""

import agenticx.learning.skill_quality_gate as gate


def _write_only_observations():
    return [{"tool_name": "file_write", "success": True}]


def test_default_non_strict_keeps_legacy_full_score():
    check = gate._check_success_evidence(_write_only_observations())
    assert check.name == "success_evidence"
    assert check.passed is True
    assert check.score == 1.0


def test_strict_mode_caps_unverified_writes(monkeypatch):
    monkeypatch.setattr(
        gate, "get_learning_config", lambda: {"evidence_gate_strict": True}
    )
    check = gate._check_success_evidence(_write_only_observations())
    assert check.passed is True
    assert check.score == 0.5
    assert "unverified" in check.reason


def test_empty_observations_fail():
    check = gate._check_success_evidence([])
    assert check.passed is False
    assert check.score == 0.0


def test_verified_session_scores_full_even_strict(monkeypatch):
    monkeypatch.setattr(
        gate, "get_learning_config", lambda: {"evidence_gate_strict": True}
    )
    obs = [
        {"tool_name": "file_write", "success": True},
        {"tool_name": "bash_exec", "result_summary": "pytest: 5 passed", "success": True},
    ]
    check = gate._check_success_evidence(obs)
    assert check.passed is True
    assert check.score == 1.0


def test_read_only_session_is_not_applicable(monkeypatch):
    monkeypatch.setattr(
        gate, "get_learning_config", lambda: {"evidence_gate_strict": True}
    )
    check = gate._check_success_evidence([{"tool_name": "file_read", "success": True}])
    assert check.passed is True
    assert check.score == 0.6
    assert check.reason == "read-only session"
