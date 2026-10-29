"""G4: IncrementalGraphSync e2e with GraphStore as publish SoT."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.graphers.incremental.extract import (
    ExtractedEntity,
    ExtractedGraph,
)
from agenticx.knowledge.graphers.incremental.sources import SourceDocument
from agenticx.knowledge.graphers.incremental.sync import IncrementalGraphSync
from agenticx.knowledge.graphers.store import InMemoryGraphStore
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


def test_sync_publishes_into_graph_store(tmp_path: Path) -> None:
    gstore = InMemoryGraphStore()
    sync = IncrementalGraphSync(
        tmp_path,
        extractor=CountingExtractor(),
        auto_publish=True,
        graph_store=gstore,
        actor="ops",
    )
    r1 = sync.sync(
        [
            SourceDocument(id="doc-a", content="alpha"),
            SourceDocument(id="doc-b", content="bravo"),
        ]
    )
    assert r1.graph_stats.get("store_backend") == "memory"
    assert gstore.get_entity("ent-doc-a") is not None
    assert gstore.get_entity("ent-doc-b") is not None
    assert gstore.stats()["entity_count"] == 2
    assert sync.object_store.get_object("ent-doc-a").status is KnowledgeStatus.PUBLISHED

    r2 = sync.sync(
        [
            SourceDocument(id="doc-a", content="alpha"),
            # doc-b removed
        ]
    )
    assert "doc-b" in r2.removed
    assert "ent-doc-b" in r2.retired_object_ids
    assert gstore.get_entity("ent-doc-b") is None
    assert gstore.get_entity("ent-doc-a") is not None
    assert r2.graph_stats.get("retire", {}).get("deleted_entities", 0) >= 1


def test_sync_without_graph_store_keeps_compat(tmp_path: Path) -> None:
    sync = IncrementalGraphSync(
        tmp_path, extractor=CountingExtractor(), auto_publish=True
    )
    r = sync.sync([SourceDocument(id="d1", content="x")])
    assert r.graph_stats.get("store_backend") == "knowledge_graph_memory"
    assert sync.graph.get_entity("ent-d1") is not None
