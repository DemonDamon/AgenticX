#!/usr/bin/env python3
"""Deterministic drift scoring and Pareto selection for skill proposals.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import random
import re
import shutil
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("agenticx.learning.drift")

_NOISE_SUFFIX = " xyz123noise"


def find_benchmark_for(skill_name: str) -> Path | None:
    """Return ``tests/benchmark.yaml`` for a skill if it exists."""
    root = Path.home() / ".agenticx" / "skills" / skill_name / "tests" / "benchmark.yaml"
    if root.is_file():
        return root
    return None


def _load_benchmark(path: Path) -> list[dict[str, Any]]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(data, dict):
        return []
    cases = data.get("cases")
    if not isinstance(cases, list):
        return []
    return [c for c in cases if isinstance(c, dict)]


def _case_hits(candidate_skill_md: str, case: dict[str, Any]) -> bool:
    haystack = candidate_skill_md.lower()
    input_text = str(case.get("input", "") or "").lower()
    if input_text and input_text not in haystack:
        return False
    keywords = case.get("expect_keywords") or []
    if isinstance(keywords, list) and keywords:
        if not any(str(k).lower() in haystack for k in keywords):
            return False
    pattern = case.get("expect_regex")
    if pattern:
        try:
            if not re.search(str(pattern), candidate_skill_md, re.MULTILINE):
                return False
        except re.error:
            return False
    return True


def _hit_rate(candidate_skill_md: str, cases: list[dict[str, Any]], *, noisy: bool) -> float:
    if not cases:
        return 1.0
    hits = 0
    for case in cases:
        text = candidate_skill_md
        if noisy:
            text = text + _NOISE_SUFFIX + str(random.randint(0, 999))
        if _case_hits(text, case):
            hits += 1
    return hits / len(cases)


def score_candidate(
    *,
    base_skill_md: str | None,
    candidate_skill_md: str,
    benchmark_path: Path,
    review_model: str = "",
) -> dict[str, float]:
    """Return accuracy, brevity, robustness scores in [0, 1]."""
    _ = review_model
    cases = _load_benchmark(benchmark_path)
    base_rate = _hit_rate(candidate_skill_md, cases, noisy=False)
    noisy_rate = _hit_rate(candidate_skill_md, cases, noisy=True)
    base_len = len(base_skill_md or "")
    cand_len = len(candidate_skill_md)
    denom = max(base_len, cand_len, 1)
    brevity = 1.0 - (cand_len / denom)
    brevity = max(0.0, min(1.0, brevity))
    robustness = noisy_rate / base_rate if base_rate > 0 else 1.0
    robustness = max(0.0, min(1.0, robustness))
    return {
        "accuracy": round(base_rate, 4),
        "brevity": round(brevity, 4),
        "robustness": round(robustness, 4),
    }


def pareto_front(scored: list[tuple[Path, dict[str, float]]]) -> list[Path]:
    """Return non-dominated candidate paths (maximize all three dimensions)."""
    if not scored:
        return []
    front: list[tuple[Path, dict[str, float]]] = []
    for path, scores in scored:
        dominated = False
        for _, other in scored:
            if other is scores:
                continue
            if (
                other.get("accuracy", 0) >= scores.get("accuracy", 0)
                and other.get("brevity", 0) >= scores.get("brevity", 0)
                and other.get("robustness", 0) >= scores.get("robustness", 0)
                and (
                    other.get("accuracy", 0) > scores.get("accuracy", 0)
                    or other.get("brevity", 0) > scores.get("brevity", 0)
                    or other.get("robustness", 0) > scores.get("robustness", 0)
                )
            ):
                dominated = True
                break
        if not dominated:
            front.append((path, scores))
    return [p for p, _ in front]


def apply_pareto_pruning(
    candidate_paths: list[Path],
    *,
    base_skill_md: str | None,
    benchmark_path: Path,
) -> list[Path]:
    """Score candidates, keep Pareto front, delete the rest."""
    scored: list[tuple[Path, dict[str, float]]] = []
    for p in candidate_paths:
        skill_md = (p / "SKILL.md").read_text(encoding="utf-8")
        sc = score_candidate(
            base_skill_md=base_skill_md,
            candidate_skill_md=skill_md,
            benchmark_path=benchmark_path,
        )
        scored.append((p, sc))
        meta_path = p / "proposal.json"
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                meta["scores"] = sc
                meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                logger.debug("Failed to write scores for %s", p, exc_info=True)

    keep = set(pareto_front(scored))
    for p in candidate_paths:
        if p not in keep:
            shutil.rmtree(p, ignore_errors=True)
    return [p for p in candidate_paths if p in keep]
