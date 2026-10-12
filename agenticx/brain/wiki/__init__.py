#!/usr/bin/env python3
"""Structured wiki page model + integrate-merge (SP31).

Ported from the SP30b experience-wiki engine, adapted to the brain page
contract. Used by `agenticx.brain.wiki_compiler` for incremental,
merge-on-write compilation.

Author: Damon Li
"""

from .merge import integrate_merge
from .page import (
    PAGE_STATUS_ACTIVE,
    PAGE_STATUS_CONTRADICTED,
    Claim,
    MissingSourceError,
    WikiPage,
)

__all__ = [
    "integrate_merge",
    "PAGE_STATUS_ACTIVE",
    "PAGE_STATUS_CONTRADICTED",
    "Claim",
    "MissingSourceError",
    "WikiPage",
]
