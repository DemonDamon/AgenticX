#!/usr/bin/env python3
"""Rubric cases, rule checks, judging, and summary math.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.evaluation.llm_judge import MockLLMProvider
from agenticx.managed.evaluation import (
    ItemOutcome,
    RuleResult,
    judge_item,
    run_rule_checks,
    score_item,
    summarize,
    validate_rubric,
)

_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "managed_agents" / "rubric_cases.json"
EXPECTED_RUBRIC_HASHES = {
    "minimal_rules_ok": "sha256:02816488ee02a090d8c4c341394d8ef89f5e3415cf97b6a54c3c4c50bca40365",
    "full_ok": "sha256:def2796d42a73a51016b8dc9ed6e7f972505e19632ec89269dfbfcaee78ebb97",
}


def _cases() -> list[dict]:
    payload = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    return list(payload["cases"])


def test_rubric_cases() -> None:
    for fixture in _cases():
        result = validate_rubric(fixture["input"])
        assert result.ok is fixture["ok"], fixture["name"]
        assert result.errors == fixture["errors"], fixture["name"]
        assert result.normalized == fixture["normalized"], fixture["name"]
        if fixture["ok"]:
            assert result.content_hash == EXPECTED_RUBRIC_HASHES[fixture["name"]]


@pytest.mark.parametrize(
    ("rules", "outcome", "trace", "expected"),
    [
        (
            [{"type": "contains", "value": "Hello", "case_sensitive": False}],
            ItemOutcome("hello world", (), "end_turn", None),
            None,
            ("contains", True, "found"),
        ),
        (
            [{"type": "contains", "value": "Hello", "case_sensitive": True}],
            ItemOutcome("hello world", (), "end_turn", None),
            None,
            ("contains", False, "not found"),
        ),
        (
            [{"type": "not_contains", "value": "secret", "case_sensitive": False}],
            ItemOutcome("public answer", (), "end_turn", None),
            None,
            ("not_contains", True, "not found"),
        ),
        (
            [{"type": "regex", "pattern": "汇总"}],
            ItemOutcome("月度汇总表", (), "end_turn", None),
            None,
            ("regex", True, "matched"),
        ),
        (
            [{"type": "regex", "pattern": "("}],
            ItemOutcome("text", (), "end_turn", None),
            None,
            ("regex", False, "invalid regex"),
        ),
        (
            [{"type": "tool_called", "name": "file_write"}],
            ItemOutcome("", ("file_read", "file_write"), "end_turn", None),
            None,
            ("tool_called", True, "found"),
        ),
        (
            [{"type": "tool_not_called", "name": "bash_exec"}],
            ItemOutcome("", ("file_write",), "end_turn", None),
            None,
            ("tool_not_called", True, "not found"),
        ),
        (
            [{"type": "max_tool_calls", "value": 1}],
            ItemOutcome("", ("a",), "end_turn", None),
            None,
            ("max_tool_calls", True, "1 calls"),
        ),
        (
            [{"type": "max_tool_calls", "value": 0}],
            ItemOutcome("", ("a",), "end_turn", None),
            None,
            ("max_tool_calls", False, "1 calls"),
        ),
        (
            [{"type": "stop_reason", "value": "end_turn"}],
            ItemOutcome("ok", (), "policy_blocked", None),
            None,
            ("stop_reason", False, "policy_blocked"),
        ),
        (
            [],
            ItemOutcome("", ("a", "b", "c"), "end_turn", None),
            ["a", "c"],
            ("expected_tool_trace", True, "matched"),
        ),
        (
            [],
            ItemOutcome("", ("c", "a"), "end_turn", None),
            ["a", "c"],
            ("expected_tool_trace", False, "missing c"),
        ),
    ],
)
def test_rule_checks(rules, outcome, trace, expected) -> None:
    results = run_rule_checks(rules, outcome, trace)
    assert len(results) == 1
    assert (results[0].type, results[0].passed, results[0].detail) == expected


@pytest.mark.asyncio
async def test_judge_binary_and_score() -> None:
    binary = await judge_item(
        {"criteria": "be useful", "mode": "binary", "pass_threshold": 0.7, "judge_model": "fake/m"},
        query="q",
        answer="a",
        expected_answer=None,
        provider=MockLLMProvider(default_response='{"passed": true, "reason": "ok"}'),
    )
    assert binary["score"] == 1.0
    assert binary["passed"] is True
    assert binary["error"] is None

    scored = await judge_item(
        {"criteria": "be useful", "mode": "score", "pass_threshold": 0.7, "judge_model": "fake/m"},
        query="q",
        answer="a",
        expected_answer="expected",
        provider=MockLLMProvider(default_response='{"score": 0.65, "reason": "mid"}'),
    )
    assert scored["score"] == 0.65
    assert scored["passed"] is False

    broken = await judge_item(
        {"criteria": "be useful", "mode": "binary", "pass_threshold": 0.7, "judge_model": "fake/m"},
        query="q",
        answer="a",
        expected_answer=None,
        provider=MockLLMProvider(default_response="???"),
    )
    assert broken["error"] == "judge_failed"
    assert broken["passed"] is False


def test_score_item_rules_fail_overrides_judge() -> None:
    status, score = score_item(
        {},
        [RuleResult("contains", False, "not found")],
        {"score": 1.0, "passed": True, "reason": "ok", "error": None},
    )
    assert status == "failed"
    assert score == 1.0


def test_summarize_excludes_errors() -> None:
    summary = summarize(
        [
            {"status": "passed", "score_milli": 1000},
            {"status": "passed", "score_milli": 1000},
            {"status": "failed", "score_milli": 0},
            {"status": "error", "score_milli": None},
        ]
    )
    assert summary["pass_rate"] == 0.6667
    assert summary["errored"] == 1
    assert summary["passed"] == 2
    assert summary["failed"] == 1
