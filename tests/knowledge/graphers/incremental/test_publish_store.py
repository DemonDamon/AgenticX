"""G3: publish_to_store / retire_from_store against fake GraphStore."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.graphers.incremental.publish import (
    publish_objects,
    publish_to_store,
    retire_from_store,
    submit_for_review,
)
from agenticx.knowledge.graphers.store import InMemoryGraphStore
from agenticx.knowledge.lifecycle.model import KnowledgeObject, KnowledgeStatus
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore


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


def test_publish_to_store_upserts(tmp_path: Path) -> None:
    obj_store = KnowledgeObjectFileStore(tmp_path)
    _seed(obj_store)
    submit_for_review(obj_store, ["ent-1", "rel-1"])
    publish_objects(obj_store, ["ent-1", "rel-1"])

    gstore = InMemoryGraphStore()
    stats = publish_to_store(obj_store, gstore, object_ids=["ent-1", "rel-1"])
    assert stats["store_backend"] == "memory"
    assert stats["entities_upserted"] == 1
    assert stats["relations_upserted"] == 1
    assert gstore.get_entity("ent-1") is not None
    assert gstore.get_entity("ent-1").name == "Pump"
    assert gstore.get_relationship("rel-1") is not None
    assert stats["entity_count"] == 1


def test_draft_not_published_to_store(tmp_path: Path) -> None:
    obj_store = KnowledgeObjectFileStore(tmp_path)
    _seed(obj_store)
    gstore = InMemoryGraphStore()
    stats = publish_to_store(obj_store, gstore)
    assert stats["entities_upserted"] == 0
    assert gstore.stats()["entity_count"] == 0


def test_retire_from_store_deletes(tmp_path: Path) -> None:
    obj_store = KnowledgeObjectFileStore(tmp_path)
    _seed(obj_store)
    submit_for_review(obj_store, ["ent-1", "rel-1"])
    publish_objects(obj_store, ["ent-1", "rel-1"])
    gstore = InMemoryGraphStore()
    publish_to_store(obj_store, gstore, object_ids=["ent-1", "rel-1"])
    obj_store.transition("ent-1", KnowledgeStatus.RETIRED)
    obj_store.transition("rel-1", KnowledgeStatus.RETIRED)
    # retire relation first then entity (or cascade via entity delete)
    rstats = retire_from_store(obj_store, gstore, ["rel-1", "ent-1"])
    assert rstats["deleted_relations"] == 1
    assert rstats["deleted_entities"] == 1
    assert gstore.get_entity("ent-1") is None


class _FailingStatsStore(InMemoryGraphStore):
    """Primary upserts work; stats() is a secondary side effect that fails."""

    def stats(self):  # type: ignore[override]
        raise RuntimeError("stats unavailable")


class _FlakyUpsertStore(InMemoryGraphStore):
    """Fail upsert_entity for a specific id; relations still work."""

    def __init__(self, fail_entity_id: str) -> None:
        super().__init__()
        self.fail_entity_id = fail_entity_id

    def upsert_entity(self, entity):  # type: ignore[override]
        if entity.id == self.fail_entity_id:
            raise RuntimeError(f"upsert blocked for {entity.id}")
        return super().upsert_entity(entity)


def test_publish_to_store_ok_true_on_success(tmp_path: Path) -> None:
    obj_store = KnowledgeObjectFileStore(tmp_path)
    _seed(obj_store)
    submit_for_review(obj_store, ["ent-1", "rel-1"])
    publish_objects(obj_store, ["ent-1", "rel-1"])
    gstore = InMemoryGraphStore()
    stats = publish_to_store(obj_store, gstore, object_ids=["ent-1", "rel-1"])
    assert stats["ok"] is True
    assert stats["warnings"] == []
    assert stats["primary_failures"] == []


def test_publish_secondary_stats_failure_is_warning_not_ok_false(tmp_path: Path) -> None:
    """Primary upserts succeed; secondary stats() failure surfaces as warning."""
    obj_store = KnowledgeObjectFileStore(tmp_path)
    _seed(obj_store)
    submit_for_review(obj_store, ["ent-1", "rel-1"])
    publish_objects(obj_store, ["ent-1", "rel-1"])

    gstore = _FailingStatsStore()
    stats = publish_to_store(obj_store, gstore, object_ids=["ent-1", "rel-1"])
    assert stats["entities_upserted"] == 1
    assert stats["relations_upserted"] == 1
    assert gstore.get_entity("ent-1") is not None
    assert stats["ok"] is True  # primary succeeded — do not lie
    assert any(w.startswith("store_stats_failed:") for w in stats["warnings"])
    assert stats["primary_failures"] == []


def test_publish_secondary_hook_failure_is_warning(tmp_path: Path) -> None:
    obj_store = KnowledgeObjectFileStore(tmp_path)
    _seed(obj_store)
    submit_for_review(obj_store, ["ent-1", "rel-1"])
    publish_objects(obj_store, ["ent-1", "rel-1"])
    gstore = InMemoryGraphStore()

    def boom(_result: dict) -> None:
        raise RuntimeError("optional index rebuild failed")

    stats = publish_to_store(
        obj_store,
        gstore,
        object_ids=["ent-1", "rel-1"],
        secondary_hooks=[boom],
    )
    assert stats["ok"] is True
    assert stats["entities_upserted"] == 1
    assert any("secondary_hook_failed:" in w for w in stats["warnings"])
    assert "optional index rebuild failed" in stats["warnings"][0]


def test_publish_primary_upsert_failure_sets_ok_false(tmp_path: Path) -> None:
    obj_store = KnowledgeObjectFileStore(tmp_path)
    _seed(obj_store)
    submit_for_review(obj_store, ["ent-1", "rel-1"])
    publish_objects(obj_store, ["ent-1", "rel-1"])

    gstore = _FlakyUpsertStore(fail_entity_id="ent-1")
    stats = publish_to_store(obj_store, gstore, object_ids=["ent-1", "rel-1"])
    assert stats["ok"] is False
    assert stats["entities_upserted"] == 0
    assert stats["relations_upserted"] == 1  # relation still upserted
    assert len(stats["primary_failures"]) == 1
    assert stats["primary_failures"][0]["object_id"] == "ent-1"
    assert stats["primary_failures"][0]["kind"] == "entity"
    # secondary warnings empty; primary failure must not be reclassified as warning
    assert stats["warnings"] == []
