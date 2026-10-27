#!/usr/bin/env python3
"""Self-iteration prompt helpers stay pure and do not create versions.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.managed.eval_iterate import (
    build_candidate,
    parse_iteration_response,
    select_failures,
)
from agenticx.managed.manifest import validate_manifest


def test_select_failures_order_and_cap() -> None:
    rows = [
        {"status": "failed", "score_milli": index, "position": 30 - index}
        for index in range(25)
    ]
    rows.append({"status": "passed", "score_milli": 0, "position": 0})
    rows.extend(
        [
            {"status": "failed", "score_milli": 3, "position": 2},
            {"status": "failed", "score_milli": 3, "position": 1},
        ]
    )
    selected = select_failures(rows)
    assert len(selected) == 20
    scores = [int(row["score_milli"]) for row in selected]
    assert scores == sorted(scores)
    assert scores[0] == 0
    assert 24 not in scores
    tied = [int(row["position"]) for row in selected if row["score_milli"] == 3]
    assert tied == sorted(tied)


def test_parse_iteration_response_tolerates_wrapping() -> None:
    text = 'note before {"system": "新提示", "rationale": "because"} trailing'
    assert parse_iteration_response(text) == ("新提示", "because")
    assert parse_iteration_response("not json") is None


def test_build_candidate_diff_and_hash() -> None:
    base = {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "旧提示",
    }
    built = build_candidate(base, "新提示")
    assert "-旧提示" in built["diff"]["system"]
    assert "+新提示" in built["diff"]["system"]
    checked = validate_manifest(built["manifest"])
    assert checked.ok
    assert built["manifest_hash"] == checked.manifest_hash
    assert built["manifest"]["system"] == "新提示"


def test_build_candidate_no_change_raises() -> None:
    base = {"schema": "agx.agent/v1", "model": "fake/scripted", "system": "same"}
    try:
        build_candidate(base, "same")
    except ValueError as exc:
        assert str(exc) == "optimizer produced no change"
    else:
        raise AssertionError("expected no change")
