"""W3: GraphStore sole recommended read facade (neighborhood / subgraph)."""

from __future__ import annotations

from agenticx.knowledge.graphers.models import Entity, EntityType, Relationship, RelationType
from agenticx.knowledge.graphers.store import InMemoryGraphStore
from agenticx.knowledge.graphers.store.protocol import GraphStore
from agenticx.knowledge.graphers.store.query import build_neighborhood, build_subgraph


def _seed(store: InMemoryGraphStore) -> None:
    store.upsert_entity(
        Entity(id="metric-gmv", name="GMV", entity_type=EntityType.UNKNOWN)
    )
    store.upsert_entity(
        Entity(id="table-orders", name="订单事实", entity_type=EntityType.UNKNOWN)
    )
    store.upsert_relationship(
        Relationship(
            id="rel-gmv-depends-orders",
            source_entity_id="metric-gmv",
            target_entity_id="table-orders",
            relation_type=RelationType.RELATED_TO,
            description="GMV depends on orders fact table",
        )
    )


def test_memory_store_is_graphstore_protocol() -> None:
    store = InMemoryGraphStore()
    assert isinstance(store, GraphStore)


def test_neighborhood_via_protocol_surface() -> None:
    store = InMemoryGraphStore()
    _seed(store)
    nb = store.neighborhood("metric-gmv", depth=1, limit=50)
    assert nb["center_id"] == "metric-gmv"
    ids = {n["id"] for n in nb["nodes"]}
    assert ids == {"metric-gmv", "table-orders"}
    assert len(nb["edges"]) == 1
    assert nb["edges"][0]["id"] == "rel-gmv-depends-orders"


def test_subgraph_via_protocol_surface() -> None:
    store = InMemoryGraphStore()
    _seed(store)
    sub = store.subgraph(entity_ids=["metric-gmv", "table-orders"], limit_nodes=50)
    assert len(sub["nodes"]) == 2
    assert len(sub["edges"]) == 1
    assert sub["stats"]["backend"] == "memory"


def test_query_helpers_match_store_methods() -> None:
    """Protocol methods and shared helpers must stay aligned."""
    store = InMemoryGraphStore()
    _seed(store)
    via_store = store.neighborhood("metric-gmv", depth=1)
    via_helper = build_neighborhood(
        center_id="metric-gmv",
        entities=store._entities,  # noqa: SLF001 — test alignment only
        relationships=store._relationships,  # noqa: SLF001
        depth=1,
    )
    assert via_store == via_helper

    via_store_sub = store.subgraph(limit_nodes=10)
    via_helper_sub = build_subgraph(
        entities=store._entities,  # noqa: SLF001
        relationships=store._relationships,  # noqa: SLF001
        limit_nodes=10,
        backend=store.backend_name,
    )
    assert via_store_sub == via_helper_sub
