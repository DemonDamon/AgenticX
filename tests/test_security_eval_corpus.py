#!/usr/bin/env python3
"""SP2 security-eval corpus tests.

Verifies: corpus builds, every guard-derived attack payload matches its
live source regex (reverse-generation invariant), ids are unique, and
OWASP/category mapping is populated.

Author: Damon Li
"""

from __future__ import annotations

import re

from agenticx.security_eval.corpus import (
    CATEGORY_OWASP,
    AttackCase,
    build_corpus,
    corpus_version,
    seed_version,
)
from agenticx.skills.guard_engine import load_pattern_set


def _build() -> dict:
    return build_corpus()


def test_corpus_builds_with_seed_and_guard_sources():
    result = _build()
    cases = result["cases"]
    assert len(cases) >= 30
    sources = {c.source.split(":", 1)[0] for c in cases}
    assert "guard" in sources and "seed" in sources
    assert result["version"] == corpus_version()
    assert seed_version() in corpus_version()


def test_guard_derived_payloads_match_live_regexes():
    result = _build()
    assert result["stale_templates"] == [], (
        f"corpus drift — payload no longer matches live rule: {result['stale_templates']}"
    )
    patterns = {p.pattern_name: p for p in load_pattern_set().patterns}
    for case in result["cases"]:
        if not case.source.startswith("guard:"):
            continue
        pattern = patterns[case.source.split(":", 1)[1]]
        assert pattern.regex.search(case.prompt), (
            f"{case.id}: payload must match live regex of {pattern.pattern_name}"
        )
        assert case.pattern_id == pattern.pattern_id


def test_attack_ids_unique_and_metadata_populated():
    result = _build()
    ids = [c.id for c in result["cases"]]
    assert len(ids) == len(set(ids))
    for case in result["cases"]:
        assert isinstance(case, AttackCase)
        assert case.prompt.strip()
        assert case.category
        assert re.fullmatch(r"LLM0[1-9]|LLM10", case.owasp), case.owasp


def test_guard_category_owasp_map_covers_derived_categories():
    result = _build()
    derived = [c for c in result["cases"] if c.source.startswith("guard:")]
    assert derived
    for case in derived:
        # derived cases get their OWASP from the guard category map
        assert case.owasp == CATEGORY_OWASP.get(case.category, "LLM01")


def test_max_attacks_caps_corpus():
    result = build_corpus(max_attacks=5)
    assert len(result["cases"]) == 5


def test_category_filter_limits_scope():
    result = build_corpus(categories=["exfiltration"])
    assert result["cases"]
    assert all(c.category == "exfiltration" for c in result["cases"])
