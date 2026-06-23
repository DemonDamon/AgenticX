"""Tests for deterministic drift scoring and Pareto selection."""

from __future__ import annotations

from pathlib import Path

from agenticx.learning.drift_detector import pareto_front, score_candidate


def test_score_candidate_keyword_hits(tmp_path: Path) -> None:
    benchmark = tmp_path / "benchmark.yaml"
    benchmark.write_text(
        """
cases:
  - input: "deploy"
    expect_keywords: ["step", "verify"]
""".strip(),
        encoding="utf-8",
    )
    good = "---\nname: x\n---\n\n## Procedure\ndeploy step one\nverify output\n"
    bad = "---\nname: x\n---\n\nNo useful content\n"
    good_score = score_candidate(
        base_skill_md=None,
        candidate_skill_md=good,
        benchmark_path=benchmark,
    )
    bad_score = score_candidate(
        base_skill_md=None,
        candidate_skill_md=bad,
        benchmark_path=benchmark,
    )
    assert good_score["accuracy"] > bad_score["accuracy"]


def test_pareto_front_keeps_non_dominated() -> None:
    a = Path("/tmp/a")
    b = Path("/tmp/b")
    c = Path("/tmp/c")
    front = pareto_front(
        [
            (a, {"accuracy": 0.9, "brevity": 0.2, "robustness": 0.8}),
            (b, {"accuracy": 0.7, "brevity": 0.9, "robustness": 0.7}),
            (c, {"accuracy": 0.5, "brevity": 0.5, "robustness": 0.5}),
        ]
    )
    assert a in front
    assert b in front
    assert c not in front
