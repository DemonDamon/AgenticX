#!/usr/bin/env python3
"""Process-level DurableJobStore accessor for tools and runtime.

Author: Damon Li
"""

from __future__ import annotations

from typing import Optional

from agenticx.runtime.durable_jobs.store import DurableJobStore

_store: Optional[DurableJobStore] = None


def get_durable_job_store() -> DurableJobStore:
    """Return the process default durable job store (lazy-created)."""
    global _store
    if _store is None:
        _store = DurableJobStore()
    return _store


def set_durable_job_store(store: DurableJobStore | None) -> None:
    """Replace the process default store (tests / custom wiring)."""
    global _store
    _store = store


def reset_durable_job_store() -> None:
    """Clear the process default store (tests)."""
    set_durable_job_store(None)
