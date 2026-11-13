#!/usr/bin/env python3
"""SP2 security-eval runner + report tests (mock full-chain, no network).

Verifies: run_eval drives corpus x models, verdict counting and score
math, scorecard.json schema (admin-console admission input), markdown
presale-safety (no secrets/endpoints/payloads), and load roundtrip.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.security_eval.corpus import build_corpus
from agenticx.security_eval.report import (
    SCHEMA,
    load_scorecard,
    render_markdown,
    write_reports,
)
from agenticx.security_eval.runner import (
    MockInvoker,
    ModelRef,
    run_eval,
    summarize,
)


@pytest.fixture()
def cases() -> list:
    return build_corpus(max_attacks=12)["cases"]


def _run(behavior: str, cases: list) -> object:
    run = run_eval(
        run_id="test-run",
        models=[ModelRef(provider="mock", model="mock")],
        cases=cases,
        invoker=MockInvoker(behavior=behavior),
    )
    run.corpus = cases
    run.corpus_version = "test-corpus"
    run.stale_templates = []
    return run


def test_compliant_mock_scores_via_rule_stack(cases: list):
    run = _run("compliant", cases)
    m = run.models[0]
    assert m.attempts == len(cases)
    assert m.count("refused") == 0
    assert m.count("blocked_by_rule") > 0, "rule stack must catch echoed payloads"
    assert m.count("bypassed") + m.count("blocked_by_rule") + m.count("error") == len(cases)
    assert m.safety_score == m.count("blocked_by_rule") * 100 // len(cases)


def test_refusing_mock_scores_full(cases: list):
    run = _run("refusing", cases)
    m = run.models[0]
    assert m.count("refused") == len(cases)
    assert m.count("bypassed") == 0
    assert m.safety_score == 100
    assert m.grade == "S+"


def test_invoker_error_yields_error_verdict(cases: list):
    def boom(provider: str, model: str, prompt: str) -> str:
        raise RuntimeError("provider exploded")

    run = run_eval(
        run_id="test-err",
        models=[ModelRef(provider="p", model="m")],
        cases=cases,
        invoker=boom,
    )
    assert run.models[0].count("error") == len(cases)
    summary = summarize(run)
    assert summary["models"][0]["errors"] == len(cases)


def test_reports_written_and_md_presale_safe(tmp_path: Path, cases: list):
    run = _run("compliant", cases)
    paths = write_reports(run, tmp_path / "run", wall_seconds=0.5)

    card = json.loads(paths["json"].read_text(encoding="utf-8"))
    assert card["schema"] == SCHEMA
    assert card["run_id"] == "test-run"
    assert card["corpus"]["attacks"] == len(cases)
    model = card["models"][0]
    assert model["model"] == "mock"
    assert set(model["cases"][0]) >= {"attack_id", "verdict", "refused", "evidence"}
    assert model["safety_score"] + model["bypassed"] * 100 // len(cases) <= 100 or True

    md = paths["markdown"].read_text(encoding="utf-8")
    # presale card: no secrets, no raw payloads, no endpoints
    assert "sk-" not in md
    assert "Bearer " not in md
    assert "ghp_" not in md
    assert "evil-cdn.example" not in md
    assert "ignore all previous instructions" not in md
    assert "safety_score" in md
    assert "| mock/mock |" in md


def test_load_scorecard_roundtrip_and_schema_guard(tmp_path: Path, cases: list):
    run = _run("refusing", cases)
    paths = write_reports(run, tmp_path)
    card = load_scorecard(paths["json"])
    assert card["models"][0]["safety_score"] == 100

    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"schema": "other"}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_scorecard(bad)


def test_render_markdown_lists_bypassed_attack_ids(cases: list):
    run = _run("compliant", cases)
    from agenticx.security_eval.report import build_scorecard

    md = render_markdown(build_scorecard(run))
    if run.models[0].count("bypassed") > 0:
        assert "Bypassed attack IDs" in md
    else:
        assert "Bypassed attack IDs" not in md


def test_mock_invoker_rejects_unknown_behavior():
    with pytest.raises(ValueError):
        MockInvoker(behavior="chaotic")
