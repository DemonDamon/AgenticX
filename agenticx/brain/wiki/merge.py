#!/usr/bin/env python3
"""Integrate-merge for brain wiki pages (SP31, ported from SP30b engine).

Merge rules (llm-wiki template's "Integrate rather than overwrite"):
- identical claim (normalized key)  -> merge provenance (dedupe), keep one
- new claim                        -> appended
- LLM-surfaced conflicts (already written as `## 矛盾` bullets) are carried
  through verbatim as contradiction claims
Cross-document compiles may only ADD to a page, never remove another
document's claims. Semantic contradiction detection is deliberately NOT
attempted here: the generation prompt instructs the model to surface
conflicts itself (it sees the existing index/overview), and this module's
job is the deterministic guarantee that whatever it surfaces survives
future merges.

Author: Damon Li
"""

from __future__ import annotations
from typing import List

from .page import (
    PAGE_STATUS_CONTRADICTED,
    Claim,
    WikiPage,
)


def _merge_claim_lists(existing: List[Claim], incoming: List[Claim]) -> List[Claim]:
    by_key: dict = {}
    for c in existing:
        by_key.setdefault(c.key(), c)
    for inc in incoming:
        match = by_key.get(inc.key())
        if match is not None:
            merged_sources = list(match.sources)
            for s in inc.sources:
                if s not in merged_sources:
                    merged_sources.append(s)
            by_key[inc.key()] = Claim(text=match.text, sources=merged_sources)
        else:
            by_key[inc.key()] = inc

    merged: List[Claim] = []
    seen: set = set()
    for c in list(existing) + list(incoming):
        k = c.key()
        if k in seen:
            continue
        seen.add(k)
        merged.append(by_key[k])
    return merged


def integrate_merge(existing: WikiPage, incoming: WikiPage) -> WikiPage:
    """Merge an incoming (freshly generated) page INTO an existing structured
    page. Mutates and returns `existing`.

    - claims: union with provenance merge; nothing dropped
    - contradiction claims: deduped union (LLM-surfaced conflicts survive)
    - status: contradicted as soon as the page carries kept conflicts
    - sources frontmatter: union
    """
    existing.claims = _merge_claim_lists(existing.claims, incoming.claims)
    existing.contradiction_claims = _merge_claim_lists(
        existing.contradiction_claims, incoming.contradiction_claims)
    if existing.contradiction_claims:
        existing.status = PAGE_STATUS_CONTRADICTED
    if not existing.description and incoming.description:
        existing.description = incoming.description
    for s in incoming.sources:
        if s not in existing.sources:
            existing.sources.append(s)
    return existing
