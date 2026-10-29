"""G1: InMemory + File GraphStore unit tests."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.graphers.models import Entity, EntityType, Relationship, RelationType
from agenticx.knowledge.graphers.store import FileGraphStore, InMemoryGraphStore


def _entity(eid: str = "e1", name: str = "Pump") -> Entity:
    return Entity(id=eid, name=name, entity_type=EntityType.UNKNOWN)


def _rel(rid: str = "r1", src: str = "e1", tgt: str = "e1") -> Relationship:
    return Relationship(
        id=rid,
        source_entity_id=src,
        target_entity_id=tgt,
        relation_type=RelationType.RELATED_TO,
    )


def test_memory_upsert_get_delete_stats() -> None:
    store = InMemoryGraphStore()
    assert store.backend_name == "memory"
    store.upsert_entity(_entity())
    store.upsert_relationship(_rel())
    assert store.get_entity("e1") is not None
    assert store.get_entity("e1").name == "Pump"
    assert store.get_relationship("r1") is not None
    stats = store.stats()
    assert stats["backend"] == "memory"
    assert stats["entity_count"] == 1
    assert stats["relationship_count"] == 1

    store.upsert_entity(_entity(name="Pump-v2"))
    assert store.get_entity("e1").name == "Pump-v2"

    assert store.delete_relationship("r1") is True
    assert store.get_relationship("r1") is None
    assert store.delete_entity("e1") is True
    assert store.get_entity("e1") is None
    assert store.stats()["entity_count"] == 0


def test_memory_delete_entity_cascades_rels() -> None:
    store = InMemoryGraphStore()
    store.upsert_entity(_entity("e1"))
    store.upsert_entity(_entity("e2", name="Valve"))
    store.upsert_relationship(_rel("r1", "e1", "e2"))
    assert store.delete_entity("e1") is True
    assert store.get_relationship("r1") is None
    assert store.get_entity("e2") is not None


def test_file_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "graph.json"
    store = FileGraphStore(path)
    assert store.backend_name == "file"
    store.upsert_entity(_entity())
    store.upsert_relationship(_rel())
    assert path.is_file()

    reloaded = FileGraphStore(path)
    assert reloaded.get_entity("e1") is not None
    assert reloaded.get_entity("e1").name == "Pump"
    assert reloaded.get_relationship("r1") is not None
    stats = reloaded.stats()
    assert stats["backend"] == "file"
    assert stats["entity_count"] == 1
    assert "path" in stats
