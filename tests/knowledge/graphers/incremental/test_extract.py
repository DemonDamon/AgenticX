"""K3-3: mock extract → lifecycle drafts + index."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.graphers.incremental.extract import (
    ExtractedEntity,
    ExtractedGraph,
    ExtractedRelation,
    apply_extraction,
)
from agenticx.knowledge.graphers.incremental.index import SourceObjectIndex
from agenticx.knowledge.graphers.incremental.sources import SourceDocument
from agenticx.knowledge.lifecycle.model import KnowledgeStatus
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore
from agenticx.knowledge.lifecycle.trail import ChangeTrailStore


class MockExtractor:
    def extract(self, doc: SourceDocument) -> ExtractedGraph:
        eid = f"ent-{doc.id}"
        rid = f"rel-{doc.id}"
        other = f"ent-{doc.id}-other"
        return ExtractedGraph(
            entities=[
                ExtractedEntity(id=eid, name=f"Name-{doc.id}", entity_type="concept"),
                ExtractedEntity(id=other, name=f"Other-{doc.id}"),
            ],
            relations=[
                ExtractedRelation(
                    id=rid,
                    source_entity_id=eid,
                    target_entity_id=other,
                    relation_type="related_to",
                )
            ],
        )


def test_apply_extraction_upserts_drafts_and_links(tmp_path: Path) -> None:
    trail = ChangeTrailStore(tmp_path)
    store = KnowledgeObjectFileStore(tmp_path, trail=trail, actor="extractor")
    index = SourceObjectIndex(tmp_path)
    docs = [SourceDocument(id="doc1", content="text one")]
    objs = apply_extraction(
        docs, extractor=MockExtractor(), object_store=store, index=index
    )
    assert len(objs) == 3
    assert all(o.status is KnowledgeStatus.DRAFT for o in objs)
    linked = index.objects_for("doc1")
    assert set(linked) == {"ent-doc1", "ent-doc1-other", "rel-doc1"}
    ent = store.get_object("ent-doc1")
    assert ent.attrs["name"] == "Name-doc1"
    assert ent.source_ids == ["doc1"]
    rel = store.get_object("rel-doc1")
    assert rel.kind == "relation"
    assert trail.list_for("ent-doc1")  # create


def test_reextract_replaces_links(tmp_path: Path) -> None:
    store = KnowledgeObjectFileStore(tmp_path)
    index = SourceObjectIndex(tmp_path)

    class OnceThenOther:
        def __init__(self) -> None:
            self.n = 0

        def extract(self, doc: SourceDocument) -> ExtractedGraph:
            self.n += 1
            if self.n == 1:
                return ExtractedGraph(
                    entities=[ExtractedEntity(id="e1", name="A")], relations=[]
                )
            return ExtractedGraph(
                entities=[ExtractedEntity(id="e2", name="B")], relations=[]
            )

    ex = OnceThenOther()
    doc = SourceDocument(id="d", content="v1")
    apply_extraction([doc], extractor=ex, object_store=store, index=index)
    assert index.objects_for("d") == ["e1"]
    apply_extraction(
        [SourceDocument(id="d", content="v2")],
        extractor=ex,
        object_store=store,
        index=index,
    )
    assert index.objects_for("d") == ["e2"]
