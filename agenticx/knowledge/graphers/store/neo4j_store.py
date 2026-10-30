"""Neo4j GraphStore — incremental MERGE publish backend (production default)."""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

from loguru import logger

from agenticx.knowledge.graphers.models import (
    Entity,
    EntityType,
    RelationType,
    Relationship,
)

try:
    from neo4j import GraphDatabase  # type: ignore

    NEO4J_AVAILABLE = True
except ImportError:  # pragma: no cover
    GraphDatabase = None  # type: ignore
    NEO4J_AVAILABLE = False


def _sanitize_property_name(name: str) -> str:
    sanitized = "".join(c if c.isalnum() or c == "_" else "_" for c in name)
    if sanitized and sanitized[0].isdigit():
        sanitized = "prop_" + sanitized
    return sanitized or "unknown_property"


def _sanitize_relationship_type(rel_type: str) -> str:
    sanitized = rel_type.upper().replace(" ", "_").replace("-", "_")
    sanitized = "".join(c if c.isalnum() or c == "_" else "_" for c in sanitized)
    return sanitized or "UNKNOWN_RELATION"


def _sanitize_label(entity_type: str) -> str:
    raw = (entity_type or "unknown").replace("-", "_").replace(" ", "_")
    parts = [p for p in raw.split("_") if p]
    if not parts:
        return "Unknown"
    return "".join(p[:1].upper() + p[1:].lower() for p in parts)


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (set, frozenset)):
        return list(value)
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    return json.dumps(value, ensure_ascii=False, default=str)


class Neo4jGraphStore:
    """Incremental Neo4j-backed GraphStore (MERGE by id; no full clear on upsert).

    Entities use label ``AgxEntity`` (+ type label). Relationships use type
    ``AgxRel`` with ``type_name`` property so MERGE identity is stable across
    relation-type renames.
    """

    def __init__(
        self,
        uri: str,
        username: str,
        password: str,
        database: str = "neo4j",
        *,
        tenant_id: str = "default",
        driver: Any = None,
        auto_connect: bool = True,
    ) -> None:
        if driver is None and not NEO4J_AVAILABLE:
            raise ImportError("Neo4j driver not available. Install with: pip install neo4j")
        self.uri = uri
        self.username = username
        self.password = password
        self.database = database
        self.tenant_id = tenant_id or "default"
        self.driver = driver
        if auto_connect and self.driver is None:
            self.connect()

    @property
    def backend_name(self) -> str:
        return "neo4j"

    def connect(self) -> None:
        if self.driver is not None:
            return
        self.driver = GraphDatabase.driver(self.uri, auth=(self.username, self.password))
        with self.driver.session(database=self.database) as session:
            session.run("RETURN 1")
        logger.info("Neo4jGraphStore connected: {}", self.uri)

    def close(self) -> None:
        if self.driver is not None:
            self.driver.close()
            self.driver = None

    def _session(self):
        if self.driver is None:
            raise RuntimeError("Not connected to Neo4j. Call connect() first.")
        return self.driver.session(database=self.database)

    def ensure_constraints(self) -> None:
        stmt = (
            "CREATE CONSTRAINT entity_id_unique IF NOT EXISTS "
            "FOR (e:AgxEntity) REQUIRE e.id IS UNIQUE"
        )
        with self._session() as session:
            try:
                session.run(stmt)
            except Exception as exc:  # pragma: no cover
                logger.debug("constraint skipped: {}", exc)

    def upsert_entity(self, entity: Entity) -> None:
        label = _sanitize_label(
            entity.entity_type.value
            if isinstance(entity.entity_type, EntityType)
            else str(entity.entity_type)
        )
        props = {
            "id": entity.id,
            "name": entity.name,
            "description": entity.description or "",
            "confidence": float(entity.confidence),
            "entity_type": (
                entity.entity_type.value
                if isinstance(entity.entity_type, EntityType)
                else str(entity.entity_type)
            ),
            "source_chunks": list(entity.source_chunks or []),
            "created_at": entity.created_at.isoformat() if entity.created_at else "",
            "updated_at": entity.updated_at.isoformat() if entity.updated_at else "",
            "tenant_id": self.tenant_id,
            "retired": False,
        }
        for key, value in (entity.attributes or {}).items():
            props[_sanitize_property_name(str(key))] = _jsonable(value)

        cypher = f"""
        MERGE (e:AgxEntity {{id: $id, tenant_id: $tenant_id}})
        SET e:`{label}`
        SET e += $props
        SET e.retired = false
        """
        with self._session() as session:
            session.run(
                cypher,
                id=entity.id,
                tenant_id=self.tenant_id,
                props=props,
            )

    def upsert_relationship(self, relationship: Relationship) -> None:
        rel_type = _sanitize_relationship_type(
            relationship.relation_type.value
            if isinstance(relationship.relation_type, RelationType)
            else str(relationship.relation_type)
        )
        props = {
            "id": relationship.id,
            "description": relationship.description or "",
            "confidence": float(relationship.confidence),
            "relation_type": (
                relationship.relation_type.value
                if isinstance(relationship.relation_type, RelationType)
                else str(relationship.relation_type)
            ),
            "source_chunks": list(relationship.source_chunks or []),
            "created_at": relationship.created_at.isoformat() if relationship.created_at else "",
            "updated_at": relationship.updated_at.isoformat() if relationship.updated_at else "",
            "tenant_id": self.tenant_id,
            "retired": False,
            "type_name": rel_type,
        }
        for key, value in (relationship.attributes or {}).items():
            props[_sanitize_property_name(str(key))] = _jsonable(value)

        cypher = """
        MATCH (source:AgxEntity {id: $source_id, tenant_id: $tenant_id})
        MATCH (target:AgxEntity {id: $target_id, tenant_id: $tenant_id})
        MERGE (source)-[r:AgxRel {id: $id, tenant_id: $tenant_id}]->(target)
        SET r += $props
        SET r.retired = false
        """
        with self._session() as session:
            session.run(
                cypher,
                source_id=relationship.source_entity_id,
                target_id=relationship.target_entity_id,
                id=relationship.id,
                tenant_id=self.tenant_id,
                props=props,
            )

    def delete_entity(self, entity_id: str) -> bool:
        cypher = """
        MATCH (e:AgxEntity {id: $id, tenant_id: $tenant_id})
        WITH e, count(e) AS c
        DETACH DELETE e
        RETURN c AS deleted
        """
        with self._session() as session:
            result = session.run(cypher, id=entity_id, tenant_id=self.tenant_id)
            record = result.single()
            return bool(record and record.get("deleted"))

    def delete_relationship(self, relationship_id: str) -> bool:
        cypher = """
        MATCH ()-[r:AgxRel {id: $id, tenant_id: $tenant_id}]->()
        WITH r, count(r) AS c
        DELETE r
        RETURN c AS deleted
        """
        with self._session() as session:
            result = session.run(cypher, id=relationship_id, tenant_id=self.tenant_id)
            record = result.single()
            return bool(record and record.get("deleted"))

    def get_entity(self, entity_id: str) -> Optional[Entity]:
        cypher = """
        MATCH (e:AgxEntity {id: $id, tenant_id: $tenant_id})
        WHERE coalesce(e.retired, false) = false
        RETURN e
        """
        with self._session() as session:
            result = session.run(cypher, id=entity_id, tenant_id=self.tenant_id)
            record = result.single()
            if not record:
                return None
            return self._node_to_entity(dict(record["e"]))

    def get_relationship(self, relationship_id: str) -> Optional[Relationship]:
        cypher = """
        MATCH (s:AgxEntity)-[r:AgxRel {id: $id, tenant_id: $tenant_id}]->(t:AgxEntity)
        WHERE coalesce(r.retired, false) = false
        RETURN r, s.id AS source_id, t.id AS target_id
        """
        with self._session() as session:
            result = session.run(cypher, id=relationship_id, tenant_id=self.tenant_id)
            record = result.single()
            if not record:
                return None
            return self._rel_to_relationship(
                dict(record["r"]),
                source_id=record["source_id"],
                target_id=record["target_id"],
            )

    def stats(self) -> Dict[str, Any]:
        with self._session() as session:
            ent = session.run(
                """
                MATCH (e:AgxEntity {tenant_id: $tenant_id})
                WHERE coalesce(e.retired, false) = false
                RETURN count(e) AS c
                """,
                tenant_id=self.tenant_id,
            ).single()
            rel = session.run(
                """
                MATCH ()-[r:AgxRel {tenant_id: $tenant_id}]->()
                WHERE coalesce(r.retired, false) = false
                RETURN count(r) AS c
                """,
                tenant_id=self.tenant_id,
            ).single()
        return {
            "backend": self.backend_name,
            "entity_count": int(ent["c"]) if ent else 0,
            "relationship_count": int(rel["c"]) if rel else 0,
            "tenant_id": self.tenant_id,
            "uri": self.uri,
            "database": self.database,
        }


    def list_entities(self, *, limit: int = 500) -> List[Entity]:
        limit = max(1, int(limit))
        cypher = """
        MATCH (e:AgxEntity {tenant_id: $tenant_id})
        WHERE coalesce(e.retired, false) = false
        RETURN e
        ORDER BY e.id
        LIMIT $limit
        """
        with self._session() as session:
            result = session.run(cypher, tenant_id=self.tenant_id, limit=limit)
            out = []
            for record in result:
                out.append(self._node_to_entity(dict(record["e"])))
            return out

    def list_relationships(self, *, limit: int = 1000) -> List[Relationship]:
        limit = max(1, int(limit))
        cypher = """
        MATCH (s:AgxEntity)-[r:AgxRel {tenant_id: $tenant_id}]->(t:AgxEntity)
        WHERE coalesce(r.retired, false) = false
        RETURN r, s.id AS source_id, t.id AS target_id
        ORDER BY r.id
        LIMIT $limit
        """
        with self._session() as session:
            result = session.run(cypher, tenant_id=self.tenant_id, limit=limit)
            out = []
            for record in result:
                out.append(
                    self._rel_to_relationship(
                        dict(record["r"]),
                        source_id=record["source_id"],
                        target_id=record["target_id"],
                    )
                )
            return out

    def neighborhood(
        self,
        entity_id: str,
        *,
        depth: int = 1,
        limit: int = 200,
    ) -> Dict[str, Any]:
        # Prefer shared algorithm over variable-length Cypher for backend parity.
        from agenticx.knowledge.graphers.store.query import build_neighborhood

        ents = {e.id: e for e in self.list_entities(limit=max(limit * 4, 500))}
        rels = {r.id: r for r in self.list_relationships(limit=max(limit * 8, 1000))}
        return build_neighborhood(
            center_id=entity_id,
            entities=ents,
            relationships=rels,
            depth=depth,
            limit=limit,
        )

    def subgraph(
        self,
        *,
        entity_ids: Optional[List[str]] = None,
        limit_nodes: int = 200,
    ) -> Dict[str, Any]:
        from agenticx.knowledge.graphers.store.query import build_subgraph

        ents = {e.id: e for e in self.list_entities(limit=max(limit_nodes * 2, 500))}
        rels = {r.id: r for r in self.list_relationships(limit=max(limit_nodes * 4, 1000))}
        out = build_subgraph(
            entities=ents,
            relationships=rels,
            entity_ids=entity_ids,
            limit_nodes=limit_nodes,
            backend=self.backend_name,
        )
        out["stats"]["tenant_id"] = self.tenant_id
        return out

    @staticmethod
    def _node_to_entity(props: Dict[str, Any]) -> Entity:
        reserved = {
            "id",
            "name",
            "description",
            "confidence",
            "entity_type",
            "source_chunks",
            "created_at",
            "updated_at",
            "tenant_id",
            "retired",
        }
        et_raw = str(props.get("entity_type") or "unknown")
        try:
            et = EntityType(et_raw)
        except ValueError:
            et = EntityType.UNKNOWN
        chunks = props.get("source_chunks") or []
        if isinstance(chunks, str):
            chunks = [chunks]
        attrs = {k: v for k, v in props.items() if k not in reserved}
        return Entity(
            id=str(props.get("id") or ""),
            name=str(props.get("name") or props.get("id") or "unknown"),
            entity_type=et,
            description=props.get("description") or None,
            attributes=attrs,
            source_chunks=set(chunks),
            confidence=float(props.get("confidence") or 1.0),
        )

    @staticmethod
    def _rel_to_relationship(
        props: Dict[str, Any],
        *,
        source_id: str,
        target_id: str,
    ) -> Relationship:
        reserved = {
            "id",
            "description",
            "confidence",
            "relation_type",
            "source_chunks",
            "created_at",
            "updated_at",
            "tenant_id",
            "retired",
            "type_name",
        }
        rtype_raw = str(props.get("relation_type") or props.get("type_name") or "related_to")
        try:
            rtype: Union[RelationType, str] = RelationType(rtype_raw.lower())
        except ValueError:
            rtype = rtype_raw
        chunks = props.get("source_chunks") or []
        if isinstance(chunks, str):
            chunks = [chunks]
        attrs = {k: v for k, v in props.items() if k not in reserved}
        return Relationship(
            id=str(props.get("id") or ""),
            source_entity_id=str(source_id),
            target_entity_id=str(target_id),
            relation_type=rtype,
            description=props.get("description") or None,
            attributes=attrs,
            source_chunks=set(chunks),
            confidence=float(props.get("confidence") or 1.0),
        )


def neo4j_env_configured() -> bool:
    return bool(os.environ.get("NEO4J_URI", "").strip())


def neo4j_settings_from_env() -> Dict[str, str]:
    return {
        "uri": os.environ.get("NEO4J_URI", "bolt://localhost:7687").strip(),
        "username": (
            os.environ.get("NEO4J_USER")
            or os.environ.get("NEO4J_USERNAME")
            or "neo4j"
        ).strip(),
        "password": os.environ.get("NEO4J_PASSWORD", "password"),
        "database": os.environ.get("NEO4J_DATABASE", "neo4j").strip() or "neo4j",
        "tenant_id": os.environ.get("NEO4J_TENANT_ID", "default").strip() or "default",
    }
