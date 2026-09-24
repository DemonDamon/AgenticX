"""Pending memory recall and ingest generation guards.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.memory.item_status import MemoryItemStore, apply_memory_status
from agenticx.studio.kb.contracts import IngestJob, IngestJobStatus
from agenticx.studio.kb.jobs import JobRegistry


def test_pending_memory_hidden_until_confirmed(tmp_path) -> None:
    store = MemoryItemStore(tmp_path / "items.json")
    pending = store.add("likes dark mode", inferred=True, origin="model")
    explicit = store.add("call me Damon", inferred=False, origin="user")
    rows = apply_memory_status(
        [{"id": pending["id"], "content": "likes dark mode", "status": "pending"}],
        query="dark",
        store=store,
    )
    assert all(row.get("id") != pending["id"] for row in rows)
    visible_name = apply_memory_status([], query="Damon", store=store)
    assert any(row.get("id") == explicit["id"] for row in visible_name)
    assert store.confirm(pending["id"])["status"] == "active"
    confirmed = apply_memory_status([], query="dark", store=store)
    assert any(row.get("id") == pending["id"] for row in confirmed)


def test_cancelled_ingest_ignores_late_done_and_old_generation() -> None:
    registry = JobRegistry(max_workers=1)
    try:
        cancelled = IngestJob(id="old", document_id="doc", status=IngestJobStatus.CANCELLED, generation=1)
        current = IngestJob(id="new", document_id="doc", status=IngestJobStatus.PARSING, generation=2)
        registry._jobs[cancelled.id] = cancelled
        registry._jobs[current.id] = current
        registry._update(cancelled.id, status=IngestJobStatus.DONE, generation=1)
        registry._update(current.id, status=IngestJobStatus.DONE, generation=1)
        assert cancelled.status == IngestJobStatus.CANCELLED
        assert current.status == IngestJobStatus.PARSING
        registry._update(current.id, status=IngestJobStatus.FAILED, generation=2)
        assert current.status == IngestJobStatus.FAILED
        registry._update(current.id, status=IngestJobStatus.DONE, generation=2)
        assert current.status == IngestJobStatus.FAILED
    finally:
        registry.shutdown(wait=False)
