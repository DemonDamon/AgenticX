#!/usr/bin/env python3
"""Case search — V1 keyword/substring retrieval over the case corpus (SP-D).

No vector index: at the current scale (<100 cases) keyword matching over
summary/problem/solution is enough; revisit when the corpus grows.

Author: Damon Li
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

from agenticx.cases.model import CaseEntry, parse_case_md
from agenticx.cases.store import CaseStore

# Scored fields: L0 summary weighs most (it exists for retrieval), the two
# L1 narrative sections less. score = Σ weight over matched fields.
_FIELD_WEIGHTS: dict[str, float] = {
    "summary": 3.0,
    "problem": 2.0,
    "solution": 1.0,
}


@dataclass
class CaseHit:
    """One scored search result."""

    entry: CaseEntry
    score: float
    matched_on: list[str] = field(default_factory=list)  # e.g. ["summary", "problem"]


def _iter_entries(store: CaseStore) -> Iterator[CaseEntry]:
    """Yield every parseable case-entry under the store root (all orgs)."""
    if not store.root.is_dir():
        return
    for path in sorted(store.root.rglob("*.md")):
        try:
            yield parse_case_md(path)
        except (OSError, ValueError):
            continue  # non-case markdown files are tolerated, same as CaseStore.get


def _scope_allows(entry: CaseEntry, scope_filter: dict[str, str] | None) -> bool:
    """Hard filter: values must be equal; a missing scope key passes (conservative)."""
    if not scope_filter:
        return True
    for key, value in scope_filter.items():
        if key in entry.scope and str(entry.scope[key]) != str(value):
            return False
    return True


def search_cases(
    query: str,
    *,
    store: CaseStore,
    scope_filter: dict[str, str] | None = None,
    top_k: int = 5,
) -> list[CaseHit]:
    """Keyword search over the case corpus.

    The query is split on whitespace; each keyword is substring-matched
    (case-insensitive) against summary/problem/solution. A field that hits
    on any keyword contributes its weight to the score and is listed in
    `matched_on`. `scope_filter` hard-filters on scope fields (missing keys
    pass through). Empty query / no hits → empty list, never raises.
    """
    keywords = [token for token in str(query or "").lower().split() if token]
    if not keywords:
        return []

    hits: list[CaseHit] = []
    for entry in _iter_entries(store):
        if not _scope_allows(entry, scope_filter):
            continue
        score = 0.0
        matched_on: list[str] = []
        for field_name, weight in _FIELD_WEIGHTS.items():
            text = str(getattr(entry, field_name, "") or "").lower()
            if not text:
                continue
            if any(keyword in text for keyword in keywords):
                score += weight
                matched_on.append(field_name)
        if score > 0:
            hits.append(CaseHit(entry=entry, score=score, matched_on=matched_on))

    hits.sort(key=lambda hit: (-hit.score, hit.entry.case_id))
    return hits[:top_k]
