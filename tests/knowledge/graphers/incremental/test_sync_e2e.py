"""K3-5: IncrementalGraphSync closed-loop e2e."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.graphers.incremental.extract import (
    ExtractedEntity,
    ExtractedGraph,
)
from agenticx.knowledge.graphers.incremental.sources import SourceDocument
from agenticx.knowledge.graphers.incremental.sync import IncrementalGraphSync, SyncRunStore
from agenticx.knowledge.lifecycle.model import KnowledgeStatus


class CountingExtractor:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def extract(self, doc: SourceDocument) -> ExtractedGraph:
        self.calls.append(doc.id)
        return ExtractedGraph(
            entities=[
                ExtractedEntity(
                    id=f"ent-{doc.id}",
                    name=f"Entity-{doc.id}",
                    attrs={"rev": doc.content_hash[:8]},
                )
            ],
            relations=[],
        )


def test_sync_skips_unchanged_and_publishes(tmp_path: Path) -> None:
    extractor = CountingExtractor()
    sync = IncrementalGraphSync(
        tmp_path, extractor=extractor, auto_publish=True, actor="ops"
    )

    r1 = sync.sync(
        [
            SourceDocument(id="doc-a", content="alpha"),
            SourceDocument(id="doc-b", content="bravo"),
        ]
    )
    assert sorted(r1.added) == ["doc-a", "doc-b"]
    assert sorted(r1.extracted_source_ids) == ["doc-a", "doc-b"]
    assert sorted(extractor.calls) == ["doc-a", "doc-b"]
    assert sync.graph.get_entity("ent-doc-a") is not None
    assert sync.object_store.get_object("ent-doc-a").status is KnowledgeStatus.PUBLISHED
    assert sync.trail.list_for("ent-doc-a")

    extractor.calls.clear()
    r2 = sync.sync(
        [
            SourceDocument(id="doc-a", content="alpha"),  # unchanged
            SourceDocument(id="doc-b", content="BRAVO"),  # changed
            SourceDocument(id="doc-c", content="charlie"),  # added
        ]
    )
    assert r2.unchanged == ["doc-a"]
    assert r2.changed == ["doc-b"]
    assert r2.added == ["doc-c"]
    assert sorted(r2.extracted_source_ids) == ["doc-b", "doc-c"]
    assert sorted(extractor.calls) == ["doc-b", "doc-c"]
    assert "doc-a" not in extractor.calls

    runs = SyncRunStore(tmp_path).list_runs()
    assert len(runs) >= 2
    assert runs[-1].run_id == r2.run_id


def test_sync_without_auto_publish_leaves_drafts(tmp_path: Path) -> None:
    sync = IncrementalGraphSync(
        tmp_path, extractor=CountingExtractor(), auto_publish=False
    )
    r = sync.sync([SourceDocument(id="d1", content="x")])
    assert r.published_object_ids == []
    assert sync.object_store.get_object("ent-d1").status is KnowledgeStatus.DRAFT
    assert len(sync.graph.entities) == 0
