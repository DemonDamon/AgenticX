"""V1: GraphStore neighborhood / subgraph / list query helpers."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.graphers.models import Entity, EntityType, Relationship, RelationType
from agenticx.knowledge.graphers.store import FileGraphStore, InMemoryGraphStore


def _seed_brand_a(store: InMemoryGraphStore) -> None:
    store.upsert_entity(
        Entity(id="brand-a-entity-pump-01", name="Pump 01", entity_type=EntityType.UNKNOWN,
               attributes={"site": "plant-a", "kind": "pump"})
    )
    store.upsert_entity(
        Entity(id="brand-a-site-plant-a", name="Plant A", entity_type=EntityType.UNKNOWN,
               attributes={"kind": "site"})
    )
    store.upsert_entity(
        Entity(id="brand-a-entity-valve-01", name="Valve 01", entity_type=EntityType.UNKNOWN,
               attributes={"site": "plant-a", "kind": "valve"})
    )
    store.upsert_relationship(
        Relationship(
            id="brand-a-rel-pump-at-plant",
            source_entity_id="brand-a-entity-pump-01",
            target_entity_id="brand-a-site-plant-a",
            relation_type=RelationType.RELATED_TO,
            description="Pump located at Plant A",
        )
    )
    store.upsert_relationship(
        Relationship(
            id="brand-a-rel-valve-at-plant",
            source_entity_id="brand-a-entity-valve-01",
            target_entity_id="brand-a-site-plant-a",
            relation_type=RelationType.RELATED_TO,
            description="Valve located at Plant A",
        )
    )


def test_list_entities_and_relationships_ordered() -> None:
    store = InMemoryGraphStore()
    _seed_brand_a(store)
    ents = store.list_entities(limit=10)
    rels = store.list_relationships(limit=10)
    assert [e.id for e in ents] == sorted(e.id for e in ents)
    assert len(ents) == 3
    assert len(rels) == 2
    assert store.list_entities(limit=1)[0].id == sorted(e.id for e in ents)[0]


def test_neighborhood_depth_one() -> None:
    store = InMemoryGraphStore()
    _seed_brand_a(store)
    nb = store.neighborhood("brand-a-entity-pump-01", depth=1, limit=50)
    assert nb["center_id"] == "brand-a-entity-pump-01"
    ids = {n["id"] for n in nb["nodes"]}
    assert "brand-a-entity-pump-01" in ids
    assert "brand-a-site-plant-a" in ids
    assert "brand-a-entity-valve-01" not in ids  # depth 1 from pump does not reach valve
    assert len(nb["edges"]) == 1


def test_neighborhood_depth_two_reaches_valve() -> None:
    store = InMemoryGraphStore()
    _seed_brand_a(store)
    nb = store.neighborhood("brand-a-entity-pump-01", depth=2, limit=50)
    ids = {n["id"] for n in nb["nodes"]}
    assert "brand-a-entity-valve-01" in ids
    assert len(nb["edges"]) == 2


def test_neighborhood_missing_center() -> None:
    store = InMemoryGraphStore()
    _seed_brand_a(store)
    nb = store.neighborhood("missing", depth=1)
    assert nb["nodes"] == []
    assert nb["edges"] == []


def test_subgraph_all_and_filter() -> None:
    store = InMemoryGraphStore()
    _seed_brand_a(store)
    full = store.subgraph(limit_nodes=200)
    assert full["stats"]["backend"] == "memory"
    assert len(full["nodes"]) == 3
    assert len(full["edges"]) == 2

    partial = store.subgraph(
        entity_ids=["brand-a-entity-pump-01", "brand-a-site-plant-a"],
        limit_nodes=200,
    )
    assert len(partial["nodes"]) == 2
    assert len(partial["edges"]) == 1


def test_file_store_query_helpers(tmp_path: Path) -> None:
    path = tmp_path / "brand-a-graph.json"
    store = FileGraphStore(path)
    mem = InMemoryGraphStore()
    _seed_brand_a(mem)
    for e in mem.list_entities():
        store.upsert_entity(e)
    for r in mem.list_relationships():
        store.upsert_relationship(r)
    sub = store.subgraph()
    assert sub["stats"]["backend"] == "file"
    assert len(sub["nodes"]) == 3
    nb = store.neighborhood("brand-a-site-plant-a", depth=1)
    assert len(nb["nodes"]) == 3
