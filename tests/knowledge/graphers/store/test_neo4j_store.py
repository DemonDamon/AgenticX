"""G2: Neo4jGraphStore — mock driver unit + optional live NEO4J_URI."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

from agenticx.knowledge.graphers.models import Entity, EntityType, Relationship, RelationType
from agenticx.knowledge.graphers.store.factory import create_graph_store
from agenticx.knowledge.graphers.store.memory import InMemoryGraphStore
from agenticx.knowledge.graphers.store.neo4j_store import (
    Neo4jGraphStore,
    neo4j_env_configured,
)


class _FakeResult:
    def __init__(self, record: Optional[Dict[str, Any]] = None) -> None:
        self._record = record

    def single(self) -> Optional[Dict[str, Any]]:
        return self._record


class _FakeSession:
    def __init__(self) -> None:
        self.calls: List[tuple] = []
        self._get_entity: Optional[Dict[str, Any]] = None
        self._get_rel: Optional[Dict[str, Any]] = None
        self._stats_ent = 0
        self._stats_rel = 0

    def __enter__(self) -> "_FakeSession":
        return self

    def __exit__(self, *args: Any) -> None:
        return None

    def run(self, cypher: str, **params: Any) -> _FakeResult:
        self.calls.append((cypher, params))
        c = " ".join(cypher.split())
        if c.startswith("RETURN 1"):
            return _FakeResult({"1": 1})
        if "MERGE (e:AgxEntity" in c:
            self._stats_ent = max(self._stats_ent, 1)
            self._get_entity = dict(params.get("props") or {})
            self._get_entity["id"] = params.get("id")
            self._get_entity["tenant_id"] = params.get("tenant_id")
            return _FakeResult({})
        if "MERGE (source)-[r:AgxRel" in c or "CREATE (source)-[r:AgxRel" in c:
            self._stats_rel = max(self._stats_rel, 1)
            self._get_rel = {
                "r": dict(params.get("props") or {}),
                "source_id": params.get("source_id"),
                "target_id": params.get("target_id"),
            }
            self._get_rel["r"]["id"] = params.get("id")
            return _FakeResult({})
        if "DETACH DELETE e" in c:
            deleted = 1 if self._get_entity else 0
            self._get_entity = None
            self._stats_ent = 0
            return _FakeResult({"deleted": deleted})
        if "DELETE r" in c and "AgxRel" in c:
            deleted = 1 if self._get_rel else 0
            self._get_rel = None
            self._stats_rel = 0
            return _FakeResult({"deleted": deleted})
        if "RETURN e" in c and "MATCH (e:AgxEntity" in c:
            if self._get_entity:
                return _FakeResult({"e": self._get_entity})
            return _FakeResult(None)
        if "RETURN r, s.id" in c or "RETURN r, s.id AS source_id" in c:
            if self._get_rel:
                return _FakeResult(self._get_rel)
            return _FakeResult(None)
        if "RETURN count(e) AS c" in c:
            return _FakeResult({"c": self._stats_ent})
        if "RETURN count(r) AS c" in c:
            return _FakeResult({"c": self._stats_rel})
        return _FakeResult({})


class _FakeDriver:
    def __init__(self) -> None:
        self.session_obj = _FakeSession()

    def session(self, database: str = "neo4j") -> _FakeSession:
        return self.session_obj

    def close(self) -> None:
        return None


def test_factory_defaults_to_memory_without_uri(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NEO4J_URI", raising=False)
    store = create_graph_store()
    assert isinstance(store, InMemoryGraphStore)
    assert store.backend_name == "memory"


def test_factory_neo4j_when_requested_with_driver() -> None:
    driver = _FakeDriver()
    store = Neo4jGraphStore(
        "bolt://localhost:7687",
        "neo4j",
        "password",
        driver=driver,
        auto_connect=False,
        tenant_id="brand-a",
    )
    assert store.backend_name == "neo4j"
    ent = Entity(id="e1", name="Pump", entity_type=EntityType.UNKNOWN)
    store.upsert_entity(ent)
    got = store.get_entity("e1")
    assert got is not None
    assert got.name == "Pump"
    store.upsert_relationship(
        Relationship(
            id="r1",
            source_entity_id="e1",
            target_entity_id="e1",
            relation_type=RelationType.RELATED_TO,
        )
    )
    assert store.get_relationship("r1") is not None
    stats = store.stats()
    assert stats["backend"] == "neo4j"
    assert stats["entity_count"] >= 1
    assert store.delete_relationship("r1") is True
    assert store.delete_entity("e1") is True


@pytest.mark.skipif(not neo4j_env_configured(), reason="NEO4J_URI not set; skip live Neo4j")
def test_live_neo4j_upsert_roundtrip() -> None:
    store = create_graph_store(backend="neo4j")
    assert isinstance(store, Neo4jGraphStore)
    eid = "brand-a-test-entity-live"
    rid = "brand-a-test-rel-live"
    try:
        store.upsert_entity(Entity(id=eid, name="Brand-A Live Pump", entity_type=EntityType.OBJECT))
        store.upsert_relationship(
            Relationship(
                id=rid,
                source_entity_id=eid,
                target_entity_id=eid,
                relation_type=RelationType.RELATED_TO,
            )
        )
        assert store.get_entity(eid) is not None
        assert store.get_relationship(rid) is not None
        st = store.stats()
        assert st["backend"] == "neo4j"
        assert st["entity_count"] >= 1
    finally:
        store.delete_relationship(rid)
        store.delete_entity(eid)
        store.close()
