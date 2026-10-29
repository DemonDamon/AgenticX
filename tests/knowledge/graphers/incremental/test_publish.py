"""K3-4: review trail + publish into KnowledgeGraph."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.graphers.incremental.publish import (
    merge_published_into_graph,
    publish_objects,
    submit_for_review,
)
from agenticx.knowledge.graphers.models import KnowledgeGraph
from agenticx.knowledge.lifecycle.model import KnowledgeObject, KnowledgeStatus
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore
from agenticx.knowledge.lifecycle.trail import ChangeTrailStore


def _seed(store: KnowledgeObjectFileStore) -> None:
    store.upsert_object(
        KnowledgeObject(
            id="ent-1",
            kind="entity",
            attrs={"name": "Pump", "entity_type": "unknown"},
            source_ids=["src-1"],
        )
    )
    store.upsert_object(
        KnowledgeObject(
            id="rel-1",
            kind="relation",
            attrs={"relation_type": "related_to"},
            relations=[
                {
                    "rel": "related_to",
                    "source_entity_id": "ent-1",
                    "target_entity_id": "ent-1",
                }
            ],
            source_ids=["src-1"],
        )
    )


def test_draft_not_merged(tmp_path: Path) -> None:
    store = KnowledgeObjectFileStore(tmp_path)
    _seed(store)
    graph = KnowledgeGraph(name="g")
    stats = merge_published_into_graph(store, graph)
    assert stats["entities_added"] == 0
    assert stats["relations_added"] == 0
    assert len(graph.entities) == 0


def test_publish_merges_and_trail(tmp_path: Path) -> None:
    trail = ChangeTrailStore(tmp_path)
    store = KnowledgeObjectFileStore(tmp_path, trail=trail, actor="reviewer")
    _seed(store)
    submit_for_review(store, ["ent-1", "rel-1"])
    assert store.get_object("ent-1").status is KnowledgeStatus.PENDING_REVIEW
    publish_objects(store, ["ent-1", "rel-1"])
    assert store.get_object("ent-1").status is KnowledgeStatus.PUBLISHED

    graph = KnowledgeGraph(name="g")
    stats = merge_published_into_graph(store, graph, object_ids=["ent-1", "rel-1"])
    assert stats["entities_added"] == 1
    assert stats["relations_added"] == 1
    assert graph.get_entity("ent-1") is not None
    assert graph.get_entity("ent-1").name == "Pump"
    assert graph.get_relationship("rel-1") is not None

    actions = [e.action for e in trail.list_for("ent-1")]
    assert "create" in actions
    assert "transition" in actions or "retire" in actions
